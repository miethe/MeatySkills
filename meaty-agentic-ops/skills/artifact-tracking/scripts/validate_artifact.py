#!/usr/bin/env python3
"""
Validate markdown frontmatter against artifact schemas.

Supports legacy artifact types and CCDash-aligned doc_type-driven schemas.
"""

from __future__ import annotations

import argparse
import sys
import warnings
from datetime import date, datetime
from io import StringIO
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, Union
from urllib.parse import unquote, urlparse

import jsonschema
import yaml

warnings.filterwarnings(
    "ignore",
    category=DeprecationWarning,
    message="jsonschema.RefResolver is deprecated.*",
)


SCHEMA_FILENAME_MAP = {
    "progress": "progress.schema.yaml",
    "context": "context.schema.yaml",
    "bug-fix": "bug-fix.schema.yaml",
    "observation": "observation.schema.yaml",
    "prd": "prd.schema.yaml",
    "implementation-plan": "implementation-plan.schema.yaml",
    "phase-plan": "phase-plan.schema.yaml",
    "spike": "spike.schema.yaml",
    "quick-feature": "quick-feature.schema.yaml",
    "report": "report.schema.yaml",
    "design-spec": "design-spec.schema.yaml",
    "meta-plan": "meta-plan.schema.yaml",
    "feature-contract": "feature-contract.schema.yaml",
    # skill_spec uses the shared envelope schema; skill-specific fields are
    # documented in field-reference.md § "Skill Spec (doc_type: skill_spec)".
    "skill-spec": "envelope.schema.yaml",
    # human_brief uses the shared envelope schema; brief-specific fields are
    # documented in field-reference.md § "Human Brief (doc_type: human_brief)".
    "human-brief": "envelope.schema.yaml",
}

ARTIFACT_TYPE_ALIASES = {
    "bug_fix": "bug-fix",
    "bug-fix": "bug-fix",
    "observation": "observation",
    "observations": "observation",
    "implementation": "implementation-plan",
    "implementation-plan": "implementation-plan",
    "implementation_plan": "implementation-plan",
    "phase-plan": "phase-plan",
    "phase_plan": "phase-plan",
    "quick-feature": "quick-feature",
    "quick_feature": "quick-feature",
    "quick-feature-plan": "quick-feature",
    "design-spec": "design-spec",
    "design_spec": "design-spec",
    "meta-plan": "meta-plan",
    "meta_plan": "meta-plan",
    "feature-contract": "feature-contract",
    "feature_contract": "feature-contract",
    "prd": "prd",
    "progress": "progress",
    "context": "context",
    "spike": "spike",
    "report": "report",
    "skill-spec": "skill-spec",
    "skill_spec": "skill-spec",
    "human-brief": "human-brief",
    "human_brief": "human-brief",
}

DOC_TYPE_TO_ARTIFACT = {
    "progress": "progress",
    "context": "context",
    "bug_fix": "bug-fix",
    "observation": "observation",
    "prd": "prd",
    "implementation_plan": "implementation-plan",
    "phase_plan": "phase-plan",
    "spike": "spike",
    "quick_feature": "quick-feature",
    "report": "report",
    "design_spec": "design-spec",
    "meta_plan": "meta-plan",
    "feature_contract": "feature-contract",
    "skill_spec": "skill-spec",
    "human_brief": "human-brief",
}

LEGACY_TYPE_TO_ARTIFACT = {
    "progress": "progress",
    "context": "context",
    "bug-fixes": "bug-fix",
    "observations": "observation",
    "quick-feature-plan": "quick-feature",
}

# Path prefix → artifact type for path-based auto-detection.
# Matched against the resolved file path as a string (forward-slash normalized).
PATH_PREFIX_TO_ARTIFACT = {
    "docs/project_plans/human-briefs/": "human-brief",
}

# Required frontmatter fields per artifact type (beyond BASE_STRICT_FIELDS).
REQUIRED_FIELDS_BY_TYPE: Dict[str, list] = {
    "human-brief": [
        "schema_version",
        "doc_type",
        "title",
        "status",
        "created",
        "feature_slug",
        "audience",
    ],
}

# Allowed status values per artifact type.  When empty the global set applies.
ALLOWED_STATUSES_BY_TYPE: Dict[str, list] = {
    "human-brief": ["draft", "in-progress", "completed"],
}

BASE_STRICT_FIELDS = [
    "schema_version",
    "doc_type",
    "title",
    "status",
    "created",
    "updated",
    "feature_slug",
]

STRICT_FIELDS_BY_TYPE = {
    "implementation-plan": BASE_STRICT_FIELDS + ["prd_ref"],
    "phase-plan": BASE_STRICT_FIELDS + ["phase", "phase_title", "prd_ref", "plan_ref"],
}

# Envelope-level typed ref fields recognised by the validator.
# These are optional (not strict-required) but validated when present.
TYPED_REF_FIELDS = [
    "spike_ref",
    "adr_refs",
    "charter_ref",
    "changelog_ref",
    "test_plan_ref",
]

# Enum fields and their allowed values, keyed by artifact type.
ENUM_FIELDS_BY_TYPE: Dict[str, Dict[str, list]] = {
    "implementation-plan": {
        "plan_structure": ["unified", "independent"],
        "progress_init": ["auto", "pre-created"],
    },
    "progress": {
        "execution_model": ["batch-parallel", "sequential", "agent-team"],
    },
}


def normalize_artifact_type(artifact_type: str) -> Optional[str]:
    """Normalize artifact/doc-type aliases to canonical artifact type names."""
    if not artifact_type:
        return None
    return ARTIFACT_TYPE_ALIASES.get(artifact_type)


def resolve_schema_path(artifact_type: str, schema_dir: Optional[Path] = None) -> Path:
    """Resolve schema file path for an artifact type."""
    canonical = normalize_artifact_type(artifact_type)
    if canonical is None or canonical not in SCHEMA_FILENAME_MAP:
        raise FileNotFoundError(f"Unsupported artifact type: {artifact_type}")

    if schema_dir is None:
        schema_dir = Path(__file__).parent.parent / "schemas"

    schema_path = schema_dir / SCHEMA_FILENAME_MAP[canonical]
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema not found: {schema_path}")
    return schema_path


def load_schema(artifact_type: str, schema_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Load schema for artifact type."""
    schema_path = resolve_schema_path(artifact_type, schema_dir)
    with schema_path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def extract_frontmatter(file_content: str) -> Optional[str]:
    """Extract frontmatter block without delimiters."""
    import re

    if not file_content.startswith("---\n"):
        return None

    match = re.match(r"^---\n(.*?)\n---", file_content, re.DOTALL)
    if not match:
        return None
    return match.group(1)


def parse_frontmatter(frontmatter_str: str) -> Dict[str, Any]:
    """Parse YAML frontmatter into a dictionary."""
    def normalize_yaml_scalars(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: normalize_yaml_scalars(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize_yaml_scalars(item) for item in value]
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return value

    metadata = yaml.safe_load(frontmatter_str)
    if metadata is None:
        return {}
    if not isinstance(metadata, dict):
        raise yaml.YAMLError("Frontmatter must parse to a mapping")
    return normalize_yaml_scalars(metadata)


def detect_artifact_type(
    metadata: Dict[str, Any],
    filepath: Optional[Union[str, Path]] = None,
) -> Optional[str]:
    """Detect artifact type from doc_type first, then legacy type field, then path."""
    doc_type = metadata.get("doc_type")
    if isinstance(doc_type, str):
        artifact_type = DOC_TYPE_TO_ARTIFACT.get(doc_type)
        if artifact_type:
            return artifact_type

    legacy_type = metadata.get("type")
    if isinstance(legacy_type, str):
        artifact_type = LEGACY_TYPE_TO_ARTIFACT.get(legacy_type)
        if artifact_type:
            return artifact_type

    # Path-based fallback: match canonical directory prefixes.
    if filepath is not None and not isinstance(filepath, StringIO):
        path_str = str(Path(filepath)).replace("\\", "/")
        for prefix, artifact_type in PATH_PREFIX_TO_ARTIFACT.items():
            if prefix in path_str:
                return artifact_type

    return None


def validate_metadata(
    metadata: Dict[str, Any],
    schema: Dict[str, Any],
    schema_path: Optional[Path] = None,
) -> Tuple[bool, list[str]]:
    """Validate metadata against schema, including $ref resolution."""
    errors: list[str] = []

    try:
        validator_cls = jsonschema.validators.validator_for(schema)
        validator_cls.check_schema(schema)

        if schema_path is not None:
            def yaml_file_handler(uri: str) -> Dict[str, Any]:
                parsed = urlparse(uri)
                yaml_path = Path(unquote(parsed.path))
                with yaml_path.open("r", encoding="utf-8") as handle:
                    return yaml.safe_load(handle)

            resolver = jsonschema.RefResolver(
                base_uri=schema_path.resolve().as_uri(),
                referrer=schema,
                handlers={"file": yaml_file_handler},
            )
            validator = validator_cls(schema, resolver=resolver)
        else:
            validator = validator_cls(schema)

        validation_errors = sorted(validator.iter_errors(metadata), key=lambda err: list(err.path))
        if not validation_errors:
            return True, []

        for error in validation_errors:
            path = ".".join(str(part) for part in error.path) if error.path else "root"
            errors.append(f"  [{path}] {error.message}")
        return False, errors

    except Exception as exc:
        errors.append(f"Validation error: {exc}")
        return False, errors


def strict_recommended_field_errors(metadata: Dict[str, Any], artifact_type: str) -> list[str]:
    """Return missing-field errors for strict recommended field validation."""
    fields = STRICT_FIELDS_BY_TYPE.get(artifact_type, BASE_STRICT_FIELDS)
    missing = []
    for field in fields:
        value = metadata.get(field)
        if field not in metadata or value in (None, "", []):
            missing.append(field)

    return [f"  [strict] Missing recommended field: {field}" for field in missing]


def validate_typed_ref_field_errors(metadata: Dict[str, Any]) -> list[str]:
    """Return errors for typed ref fields when present in metadata.

    Validates envelope-level typed ref fields (spike_ref, adr_refs,
    charter_ref, changelog_ref, test_plan_ref) regardless of artifact type.
    Fields are optional; validation only fires when a field is present.
    """
    errors: list[str] = []

    # String-or-null ref fields: must be null or a string of length 3-256.
    for field in ("spike_ref", "charter_ref", "changelog_ref", "test_plan_ref"):
        if field not in metadata:
            continue
        value = metadata[field]
        if value is None:
            continue
        if not isinstance(value, str):
            errors.append(f"  [{field}] Must be a string or null, got {type(value).__name__}")
            continue
        if len(value) < 3 or len(value) > 256:
            errors.append(f"  [{field}] String length must be 3-256, got {len(value)}")

    # adr_refs: must be a list of strings, each of length 3-256.
    if "adr_refs" in metadata:
        value = metadata["adr_refs"]
        if not isinstance(value, list):
            errors.append(f"  [adr_refs] Must be a list, got {type(value).__name__}")
        else:
            for idx, item in enumerate(value):
                if not isinstance(item, str):
                    errors.append(
                        f"  [adr_refs[{idx}]] Each item must be a string, got {type(item).__name__}"
                    )
                elif len(item) < 3 or len(item) > 256:
                    errors.append(
                        f"  [adr_refs[{idx}]] String length must be 3-256, got {len(item)}"
                    )

    return errors


def validate_human_brief_errors(
    metadata: Dict[str, Any],
    filepath: Optional[Union[str, Path]] = None,
) -> Tuple[list[str], list[str]]:
    """Return (errors, warnings) for human_brief-specific validation rules.

    Checks:
    - All required fields are present and non-empty.
    - audience contains 'humans'.
    - status is one of the allowed values (draft, in-progress, completed).
    - prd_ref or plan_ref is non-null (soft warning for meta-work briefs).
    - prd_ref / plan_ref / intent_ref / epic_ref paths exist when populated.
    """
    errors: list[str] = []
    warnings: list[str] = []

    # Required fields
    required = REQUIRED_FIELDS_BY_TYPE.get("human-brief", [])
    for field in required:
        value = metadata.get(field)
        if field not in metadata or value in (None, "", []):
            errors.append(f"  [human_brief] Missing required field: {field}")

    # audience must include 'humans'
    audience = metadata.get("audience")
    if audience is not None:
        if not isinstance(audience, list) or "humans" not in audience:
            errors.append(
                "  [human_brief.audience] Must be a list containing 'humans'"
            )

    # status must be one of the allowed values
    status = metadata.get("status")
    allowed_statuses = ALLOWED_STATUSES_BY_TYPE.get("human-brief", [])
    if status is not None and status not in allowed_statuses:
        errors.append(
            f"  [human_brief.status] Invalid status {status!r}; "
            f"allowed: {allowed_statuses}"
        )

    # prd_ref / plan_ref — at least one should be set (soft warning for meta-work)
    prd_ref = metadata.get("prd_ref")
    plan_ref = metadata.get("plan_ref")
    if not prd_ref and not plan_ref:
        warnings.append(
            "  [human_brief] Neither prd_ref nor plan_ref is set. "
            "This is acceptable for meta-work briefs; otherwise link the PRD or plan."
        )

    # Linkage path existence checks for populated ref fields
    ref_fields = ("prd_ref", "plan_ref", "intent_ref", "epic_ref")
    for field in ref_fields:
        value = metadata.get(field)
        if not value:
            continue
        ref_path = Path(value)
        if not ref_path.is_absolute():
            ref_path = Path.cwd() / value
        if not ref_path.exists():
            warnings.append(
                f"  [human_brief.{field}] Referenced path does not exist: {value}"
            )

    return errors, warnings


def validate_execution_metadata_errors(
    metadata: Dict[str, Any], artifact_type: str
) -> list[str]:
    """Return errors for execution metadata enum fields when present.

    Validates plan_structure and progress_init for implementation-plan
    documents, and execution_model for progress documents.
    Fields are optional; validation only fires when a field is present.
    """
    errors: list[str] = []

    enum_fields = ENUM_FIELDS_BY_TYPE.get(artifact_type, {})
    for field, allowed in enum_fields.items():
        if field not in metadata:
            continue
        value = metadata[field]
        if value not in allowed:
            errors.append(
                f"  [{field}] Must be one of {allowed!r}, got {value!r}"
            )

    return errors


def format_validation_report(
    filepath: Union[Path, str],
    artifact_type: str,
    is_valid: bool,
    errors: list[str],
    strict: bool = False,
    metadata: Optional[Dict[str, Any]] = None,
    verbose: bool = False,
) -> str:
    """Format a human-readable validation report."""
    lines = [
        "=" * 70,
        "Artifact Validation Report",
        "=" * 70,
        f"File: {filepath}",
        f"Type: {artifact_type}",
        f"Mode: {'strict' if strict else 'standard'}",
        f"Status: {'✓ VALID' if is_valid else '✗ INVALID'}",
        "=" * 70,
    ]

    if is_valid:
        lines.append("\n✓ All validations passed!")
        if verbose and metadata:
            lines.append("\nMetadata Summary:")
            for field in ["title", "doc_type", "type", "status", "feature_slug", "created", "updated"]:
                if field in metadata:
                    lines.append(f"  {field}: {metadata.get(field)}")
    else:
        lines.append(f"\n✗ Validation failed with {len(errors)} error(s):\n")
        lines.extend(errors)

        lines.append("\nSuggestions:")
        lines.append("  • Check required fields and enum values")
        lines.append("  • Ensure frontmatter parses as valid YAML")
        lines.append("  • Re-run with --verbose for detail")

    lines.append("")
    lines.append("=" * 70)
    return "\n".join(lines)


def validate_artifact_file(
    filepath: Union[Path, str, StringIO],
    artifact_type: Optional[str] = None,
    schema_dir: Optional[Path] = None,
    verbose: bool = False,
    strict: bool = False,
) -> bool:
    """Validate one artifact file or in-memory frontmatter content."""
    try:
        if isinstance(filepath, StringIO):
            content = filepath.getvalue()
            filepath_display: Union[str, Path] = "<StringIO>"
        else:
            file_path = Path(filepath)
            if not file_path.exists():
                print(f"Error: File not found: {file_path}", file=sys.stderr)
                return False
            content = file_path.read_text(encoding="utf-8")
            filepath_display = file_path

        frontmatter_str = extract_frontmatter(content)
        if frontmatter_str is None:
            print(f"Error: No YAML frontmatter found in {filepath_display}", file=sys.stderr)
            return False

        try:
            metadata = parse_frontmatter(frontmatter_str)
        except yaml.YAMLError as exc:
            print(f"Error: Invalid YAML frontmatter in {filepath_display}: {exc}", file=sys.stderr)
            return False

        if artifact_type is not None:
            canonical_type = normalize_artifact_type(artifact_type)
            if canonical_type is None:
                print(f"Error: Unsupported artifact type: {artifact_type}", file=sys.stderr)
                return False
            artifact_type = canonical_type
        else:
            artifact_type = detect_artifact_type(metadata, filepath=filepath_display)
            if artifact_type is None:
                print(
                    f"Error: Could not auto-detect artifact type from doc_type/type in {filepath_display}",
                    file=sys.stderr,
                )
                return False

        schema_path = resolve_schema_path(artifact_type, schema_dir)
        schema = load_schema(artifact_type, schema_dir)
        is_valid, errors = validate_metadata(metadata, schema, schema_path)

        if strict:
            errors.extend(strict_recommended_field_errors(metadata, artifact_type))
            if errors:
                is_valid = False

        # Typed ref and execution metadata validation always runs (not strict-only).
        typed_ref_errors = validate_typed_ref_field_errors(metadata)
        exec_meta_errors = validate_execution_metadata_errors(metadata, artifact_type)
        extra_errors = typed_ref_errors + exec_meta_errors
        if extra_errors:
            errors.extend(extra_errors)
            is_valid = False

        # human_brief-specific validation always runs (not strict-only).
        if artifact_type == "human-brief":
            brief_errors, brief_warnings = validate_human_brief_errors(
                metadata, filepath=filepath_display
            )
            if brief_errors:
                errors.extend(brief_errors)
                is_valid = False
            if brief_warnings:
                # Warnings printed to stderr but do not affect validity.
                for w in brief_warnings:
                    print(f"Warning:{w}", file=sys.stderr)

        if verbose or not is_valid:
            print(
                format_validation_report(
                    filepath=filepath_display,
                    artifact_type=artifact_type,
                    is_valid=is_valid,
                    errors=errors,
                    strict=strict,
                    metadata=metadata,
                    verbose=verbose,
                )
            )

        return is_valid

    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return False
    except Exception as exc:  # pragma: no cover - defensive CLI error path
        print(f"Error validating {filepath}: {exc}", file=sys.stderr)
        return False


def resolve_cli_artifact(args: argparse.Namespace) -> Optional[Path]:
    """Resolve artifact path from --file or positional argument."""
    if args.file and args.artifact:
        print("Error: Use either --file/-f or positional artifact, not both.", file=sys.stderr)
        return None
    if args.file:
        return args.file
    if args.artifact:
        return args.artifact
    print("Error: Missing artifact path. Provide positional path or --file/-f.", file=sys.stderr)
    return None


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Validate artifact frontmatter against JSON Schema",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python validate_artifact.py path/to/file.md
  python validate_artifact.py -f path/to/file.md --artifact-type prd
  python validate_artifact.py path/to/file.md --strict --verbose
""",
    )

    parser.add_argument("artifact", nargs="?", type=Path, help="Artifact file path")
    parser.add_argument("--file", "-f", type=Path, help="Artifact file path")
    parser.add_argument(
        "--artifact-type",
        "-t",
        choices=sorted(SCHEMA_FILENAME_MAP.keys()),
        help="Explicit artifact type (auto-detected by default)",
    )
    parser.add_argument("--schema-dir", "-s", type=Path, help="Custom schema directory")
    parser.add_argument("--strict", action="store_true", help="Require recommended CCDash fields")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print detailed validation report")

    args = parser.parse_args()
    artifact = resolve_cli_artifact(args)
    if artifact is None:
        sys.exit(1)

    is_valid = validate_artifact_file(
        filepath=artifact,
        artifact_type=args.artifact_type,
        schema_dir=args.schema_dir,
        verbose=args.verbose,
        strict=args.strict,
    )
    sys.exit(0 if is_valid else 1)


if __name__ == "__main__":
    main()
