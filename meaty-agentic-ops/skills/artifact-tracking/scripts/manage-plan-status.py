#!/usr/bin/env python3
"""
Manage frontmatter fields in planning and related markdown artifacts.

Supports read, query, status updates, and generic field updates across PRDs,
implementation plans, phase plans, spikes, and quick-feature plans.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import yaml


VALID_STATUSES = [
    "draft",
    "pending",
    "planning",
    "in_progress",
    "in-progress",
    "review",
    "completed",
    "complete",
    "approved",
    "deferred",
    "blocked",
    "archived",
    "superseded",
]

PLAN_DIRECTORIES: Dict[str, List[str]] = {
    "prd": ["docs/project_plans/PRDs"],
    "implementation": ["docs/project_plans/implementation_plans"],
    "spike": ["docs/project_plans/SPIKEs", "docs/dev/architecture/spikes"],
    "quick-feature": [".claude/progress/quick-features"],
    "phase-plan": ["docs/project_plans/implementation_plans"],
    "design-spec": ["docs/project_plans/design-specs"],
    "meta-plan": [".claude/plans"],
    "report": ["docs/project_plans/reports", ".claude/findings"],
    "feature-contract": ["docs/project_plans/feature_contracts"],
}

TYPE_ALIASES = {
    "prd": "prd",
    "implementation": "implementation",
    "implementation-plan": "implementation",
    "spike": "spike",
    "quick-feature": "quick-feature",
    "quick_feature": "quick-feature",
    "phase-plan": "phase-plan",
    "phase_plan": "phase-plan",
    "design-spec": "design-spec",
    "design_spec": "design-spec",
    "meta-plan": "meta-plan",
    "meta_plan": "meta-plan",
    "report": "report",
    "feature-contract": "feature-contract",
    "feature_contract": "feature-contract",
    "all": "all",
}


def extract_frontmatter_and_body(
    filepath: Path,
    suppress_errors: bool = False,
) -> Tuple[Optional[Dict[str, Any]], str]:
    """Extract YAML frontmatter and markdown body from a file."""
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as exc:
        if not suppress_errors:
            print(f"Error: Could not read {filepath}: {exc}", file=sys.stderr)
        return None, ""

    if not content.startswith("---\n"):
        if not suppress_errors:
            print("Error: File does not contain YAML frontmatter", file=sys.stderr)
        return None, ""

    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        if not suppress_errors:
            print("Error: Could not parse YAML frontmatter", file=sys.stderr)
        return None, ""

    frontmatter_str, body = match.group(1), match.group(2)
    try:
        frontmatter = yaml.safe_load(frontmatter_str) or {}
    except Exception as exc:
        if not suppress_errors:
            print(f"Error: Invalid YAML frontmatter in {filepath}: {exc}", file=sys.stderr)
        return None, ""

    if not isinstance(frontmatter, dict):
        if not suppress_errors:
            print(f"Error: Frontmatter in {filepath} is not a mapping", file=sys.stderr)
        return None, ""

    return frontmatter, body


def write_frontmatter_and_body(filepath: Path, frontmatter: Dict[str, Any], body: str) -> None:
    """Write frontmatter and body back to a file."""
    frontmatter_yaml = yaml.safe_dump(frontmatter, default_flow_style=False, sort_keys=False)
    filepath.write_text(f"---\n{frontmatter_yaml}---\n{body}", encoding="utf-8")


def parse_yaml_value(value: str) -> Any:
    """Parse CLI value using YAML semantics so arrays/null/numbers are supported."""
    parsed = yaml.safe_load(value)
    return parsed


def normalize_plan_type(plan_type: str) -> Optional[str]:
    """Normalize type aliases to canonical values."""
    return TYPE_ALIASES.get(plan_type)


def parse_date(value: Any) -> str:
    """Normalize date-like values for JSON output."""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return "unknown" if value is None else str(value)


def infer_category(frontmatter: Dict[str, Any], filepath: Path) -> str:
    """Infer category/type label for query output."""
    doc_type = str(frontmatter.get("doc_type") or "")
    legacy_type = str(frontmatter.get("type") or "")
    path_str = str(filepath).replace("\\", "/")

    if doc_type == "phase_plan":
        return "phase-plan"
    if doc_type == "implementation_plan":
        return "implementation"
    if doc_type == "quick_feature" or legacy_type == "quick-feature-plan":
        return "quick-feature"
    if doc_type == "spike" or "/SPIKEs/" in path_str:
        return "spike"
    if doc_type == "prd" or "/PRDs/" in path_str:
        return "prd"
    if doc_type == "design_spec" or "/design-specs/" in path_str:
        return "design-spec"
    if doc_type == "meta_plan" or "/.claude/plans/" in path_str or path_str.startswith(".claude/plans/"):
        return "meta-plan"
    if doc_type == "report" or "/reports/" in path_str or "/.claude/findings/" in path_str or path_str.startswith(".claude/findings/"):
        return "report"
    if doc_type == "feature_contract" or "/feature_contracts/" in path_str:
        return "feature-contract"

    if "/implementation_plans/" in path_str and "/phase-" in path_str:
        return "phase-plan"
    if "/implementation_plans/" in path_str:
        return "implementation"

    return "unknown"


def matches_query_type(frontmatter: Dict[str, Any], filepath: Path, plan_type: str) -> bool:
    """Return whether file belongs to the requested query type."""
    if plan_type == "all":
        return True

    category = infer_category(frontmatter, filepath)
    return category == plan_type


def read_status(filepath: Path) -> Optional[str]:
    """Read and print status from file frontmatter."""
    if not filepath.exists():
        print(f"Error: File not found: {filepath}", file=sys.stderr)
        return None

    frontmatter, _ = extract_frontmatter_and_body(filepath)
    if frontmatter is None:
        return None

    print(f"File: {filepath}")
    print(f"Title: {frontmatter.get('title', filepath.name)}")
    print(f"Status: {frontmatter.get('status', 'not set')}")
    print(f"Created: {parse_date(frontmatter.get('created'))}")
    print(f"Updated: {parse_date(frontmatter.get('updated'))}")
    return frontmatter.get("status")


def validate_status(status: str) -> bool:
    """Validate status value against supported superset."""
    if status in VALID_STATUSES:
        return True
    print(
        f"Error: Invalid status '{status}'. Must be one of: {', '.join(VALID_STATUSES)}",
        file=sys.stderr,
    )
    return False


def update_fields(filepath: Path, status: Optional[str], field: Optional[str], value: Optional[str]) -> bool:
    """Update status and/or arbitrary field in file frontmatter."""
    if not filepath.exists():
        print(f"Error: File not found: {filepath}", file=sys.stderr)
        return False

    if status is None and field is None:
        print("Error: Nothing to update. Provide --status or --field/--value.", file=sys.stderr)
        return False

    if status is not None and not validate_status(status):
        return False

    if (field is None) != (value is None):
        print("Error: --field and --value must be used together", file=sys.stderr)
        return False

    frontmatter, body = extract_frontmatter_and_body(filepath)
    if frontmatter is None:
        return False

    old_status = frontmatter.get("status", "not set")

    if status is not None:
        frontmatter["status"] = status

    if field is not None and value is not None:
        parsed_value = parse_yaml_value(value)
        if field == "status" and isinstance(parsed_value, str):
            if not validate_status(parsed_value):
                return False
        frontmatter[field] = parsed_value

    # Always touch updated on write operations.
    frontmatter["updated"] = datetime.now().strftime("%Y-%m-%d")

    try:
        write_frontmatter_and_body(filepath, frontmatter, body)
    except Exception as exc:
        print(f"Error: Could not write {filepath}: {exc}", file=sys.stderr)
        return False

    print(f"✓ Updated file: {filepath}")
    if status is not None:
        print(f"  Status: {old_status} -> {status}")
    if field is not None:
        print(f"  Field: {field} = {frontmatter.get(field)!r}")
    return True


def iter_query_dirs(plan_type: str) -> Iterable[Path]:
    """Yield query directories for requested type."""
    if plan_type == "all":
        seen = set()
        for dirs in PLAN_DIRECTORIES.values():
            for directory in dirs:
                if directory in seen:
                    continue
                seen.add(directory)
                yield Path(directory)
        return

    for directory in PLAN_DIRECTORIES.get(plan_type, []):
        yield Path(directory)


def query_plans(status: Optional[str], plan_type: str) -> List[Dict[str, Any]]:
    """Query plans by status and type."""
    results: List[Dict[str, Any]] = []

    for directory in iter_query_dirs(plan_type):
        if not directory.exists():
            continue

        for filepath in sorted(directory.rglob("*.md")):
            frontmatter, _ = extract_frontmatter_and_body(filepath, suppress_errors=True)
            if frontmatter is None:
                continue

            if not matches_query_type(frontmatter, filepath, plan_type):
                continue

            file_status = frontmatter.get("status")
            if status is not None and file_status != status:
                continue

            results.append(
                {
                    "file": str(filepath),
                    "title": frontmatter.get("title", filepath.name),
                    "status": file_status or "not set",
                    "created": parse_date(frontmatter.get("created")),
                    "updated": parse_date(frontmatter.get("updated")),
                    "type": infer_category(frontmatter, filepath),
                }
            )

    return results


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(
        description="Manage frontmatter status and fields in planning artifacts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python manage-plan-status.py --read docs/project_plans/PRDs/features/my-feature.md
  python manage-plan-status.py --file docs/project_plans/PRDs/features/my-feature.md --status approved
  python manage-plan-status.py --file docs/project_plans/SPIKEs/foo.md --field priority --value high
  python manage-plan-status.py --query --type spike --status draft
""",
    )

    operation_group = parser.add_mutually_exclusive_group()
    operation_group.add_argument("--read", type=Path, metavar="FILE", help="Read status from file")
    operation_group.add_argument("--query", action="store_true", help="Query documents by filters")

    parser.add_argument("--file", "-f", type=Path, help="File to update")
    parser.add_argument("--status", "-s", help="Status value for update or query filter")
    parser.add_argument("--field", help="Frontmatter field to update")
    parser.add_argument("--value", help="Frontmatter value (YAML syntax supported)")
    parser.add_argument(
        "--type",
        "-t",
        default="all",
        help="Type filter: prd|implementation|spike|quick-feature|phase-plan|design-spec|meta-plan|report|feature-contract|all",
    )

    args = parser.parse_args()

    normalized_type = normalize_plan_type(args.type)
    if normalized_type is None:
        print(
            "Error: Invalid --type. Use prd, implementation, spike, quick-feature, phase-plan, design-spec, meta-plan, report, feature-contract, or all.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        if args.read:
            status = read_status(args.read)
            sys.exit(0 if status is not None else 1)

        if args.query:
            if args.status is not None and not validate_status(args.status):
                sys.exit(1)
            results = query_plans(status=args.status, plan_type=normalized_type)
            print(json.dumps(results, indent=2))
            sys.exit(0)

        if args.file:
            success = update_fields(
                filepath=args.file,
                status=args.status,
                field=args.field,
                value=args.value,
            )
            sys.exit(0 if success else 1)

        parser.print_help()
        print("\nError: Provide --read, --query, or --file for updates.", file=sys.stderr)
        sys.exit(1)

    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:  # pragma: no cover - defensive CLI handler
        print(f"Error: Unexpected error: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
