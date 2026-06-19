#!/usr/bin/env python3
"""
Update arbitrary frontmatter fields with schema validation.

Examples:
  python update-field.py -f path.md --set "priority=high" --set "risk_level=low"
  python update-field.py -f path.md --append "tags=frontend"
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from validate_artifact import (
    detect_artifact_type,
    load_schema,
    resolve_schema_path,
    validate_metadata,
)


def extract_frontmatter_and_body(path: Path) -> Tuple[Optional[Dict[str, Any]], str]:
    """Extract frontmatter and markdown body."""
    def normalize_yaml_scalars(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: normalize_yaml_scalars(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize_yaml_scalars(item) for item in value]
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return value

    content = path.read_text(encoding="utf-8")
    if not content.startswith("---\n"):
        return None, ""

    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        return None, ""

    metadata = yaml.safe_load(match.group(1)) or {}
    if not isinstance(metadata, dict):
        return None, ""

    return normalize_yaml_scalars(metadata), match.group(2)


def write_frontmatter_and_body(path: Path, metadata: Dict[str, Any], body: str) -> None:
    """Write updated frontmatter and body to disk."""
    frontmatter = yaml.safe_dump(metadata, default_flow_style=False, sort_keys=False)
    path.write_text(f"---\n{frontmatter}---\n{body}", encoding="utf-8")


def parse_assignment(raw: str) -> Tuple[str, Any]:
    """Parse key=value assignment with YAML value parsing."""
    if "=" not in raw:
        raise ValueError(f"Invalid assignment '{raw}'. Expected key=value.")

    key, value = raw.split("=", 1)
    key = key.strip()
    if not key:
        raise ValueError(f"Invalid assignment '{raw}'. Field name is empty.")

    return key, yaml.safe_load(value)


def apply_set_updates(metadata: Dict[str, Any], sets: List[str]) -> None:
    """Apply --set updates in-place."""
    for assignment in sets:
        key, value = parse_assignment(assignment)
        metadata[key] = value


def apply_append_updates(metadata: Dict[str, Any], appends: List[str]) -> None:
    """Apply --append updates in-place for list fields."""
    for assignment in appends:
        key, value = parse_assignment(assignment)

        if key not in metadata:
            metadata[key] = []

        if not isinstance(metadata[key], list):
            raise ValueError(f"Field '{key}' is not a list; cannot append.")

        metadata[key].append(value)


def validate_against_schema(metadata: Dict[str, Any], artifact_type: Optional[str]) -> Tuple[bool, List[str], str]:
    """Validate metadata against resolved schema."""
    detected_type = artifact_type or detect_artifact_type(metadata)
    if detected_type is None:
        return False, ["Could not detect artifact type from doc_type/type"], "unknown"

    schema_path = resolve_schema_path(detected_type)
    schema = load_schema(detected_type)
    is_valid, errors = validate_metadata(metadata, schema, schema_path)
    return is_valid, errors, detected_type


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="Update frontmatter fields with schema validation")
    parser.add_argument("--file", "-f", type=Path, required=True, help="Markdown file to update")
    parser.add_argument("--set", action="append", default=[], help="Set key=value (repeatable)")
    parser.add_argument("--append", action="append", default=[], help="Append key=value to list field")
    parser.add_argument("--artifact-type", help="Optional explicit artifact type")

    args = parser.parse_args()

    if not args.set and not args.append:
        print("Error: Provide at least one --set or --append update.", file=sys.stderr)
        sys.exit(1)

    if not args.file.exists():
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    try:
        metadata, body = extract_frontmatter_and_body(args.file)
        if metadata is None:
            print("Error: File does not contain valid YAML frontmatter.", file=sys.stderr)
            sys.exit(1)

        apply_set_updates(metadata, args.set)
        apply_append_updates(metadata, args.append)

        metadata["updated"] = datetime.now().strftime("%Y-%m-%d")

        is_valid, errors, resolved_type = validate_against_schema(metadata, args.artifact_type)
        if not is_valid:
            print(f"Error: Validation failed for type '{resolved_type}':", file=sys.stderr)
            for err in errors:
                print(f"  - {err}", file=sys.stderr)
            sys.exit(1)

        write_frontmatter_and_body(args.file, metadata, body)
        print(f"✓ Updated {args.file}")
        print(f"  Validated as: {resolved_type}")

    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # pragma: no cover - defensive CLI path
        print(f"Error: Unexpected failure: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
