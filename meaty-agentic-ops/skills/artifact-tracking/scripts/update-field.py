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
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

# The shared in-place frontmatter editor. When run as a script the script dir is sys.path[0];
# the insert keeps the import working when this file is loaded by path (as the tests do).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _frontmatter_edit import (  # noqa: E402
    FrontmatterEditor,
    normalize_scalars,
)
from validate_artifact import (  # noqa: E402
    detect_artifact_type,
    load_schema,
    resolve_schema_path,
    validate_metadata,
)


def load_editor(path: Path) -> Optional[FrontmatterEditor]:
    """Open *path* for targeted frontmatter edits, or None when it has no valid frontmatter."""
    editor = FrontmatterEditor.from_text(path.read_text(encoding="utf-8"))
    if editor is None:
        return None
    if not isinstance(editor.metadata(), dict):
        return None
    return editor


def validation_view(editor: FrontmatterEditor) -> Dict[str, Any]:
    """The parsed frontmatter as the SCHEMAS expect it (dates as ISO strings).

    Derived from the editor's current lines, so what gets validated is exactly what would
    be written — never a separately-mutated dict that could drift from the file.
    """
    metadata = normalize_scalars(editor.metadata() or {})
    return metadata if isinstance(metadata, dict) else {}


# YAML spellings that a caller genuinely means as "no value". Anything else that
# *parses* to None came from comment syntax, not from intent.
_EXPLICIT_NULLS = {"", "~", "null", "Null", "NULL"}


def parse_value(raw: str) -> Any:
    """YAML-parse an assignment's value, without letting `#` eat it.

    `yaml.safe_load` treats an unquoted `#` as a comment, so the two shapes a landing
    pointer is most often written in were silently destroyed:

        --append "pr_refs=#87"     -> None   (the whole value became a comment)
        --set    "note=PR #87"     -> 'PR'   (truncated at the `#`)

    Both are SILENT: the write succeeded and stored a null or a prefix. The observed
    symptom was a downstream validator complaining that `pr_refs.0` was not a string —
    blaming pre-existing list content for a null this parser had just created.

    So: parse as YAML (callers legitimately pass `true`, `3`, `[a, b]`), but when the
    parse loses the value to comment syntax, keep the raw text instead. An explicitly
    spelled null (`null`, `~`, empty) still parses to None, because that is intent.
    """
    parsed = yaml.safe_load(raw)
    stripped = raw.strip()

    if parsed is None and stripped not in _EXPLICIT_NULLS:
        return stripped

    # Only fall back when the parse actually lost text to a comment. Testing merely for
    # `"#" in raw` also caught already-quoted values ("'#87'" -> kept its quotes), so
    # compare against what YAML would have kept had it stripped a comment: everything
    # left of the first `#`. If that is what we got back, the `#` was read as a comment.
    if isinstance(parsed, str) and "#" in stripped and stripped.split("#", 1)[0].strip() == parsed:
        return stripped
    return parsed


def parse_assignment(raw: str) -> Tuple[str, Any]:
    """Parse key=value assignment with YAML value parsing."""
    if "=" not in raw:
        raise ValueError(f"Invalid assignment '{raw}'. Expected key=value.")

    key, value = raw.split("=", 1)
    key = key.strip()
    if not key:
        raise ValueError(f"Invalid assignment '{raw}'. Field name is empty.")

    return key, parse_value(value)


def apply_set_updates(editor: FrontmatterEditor, sets: List[str]) -> None:
    """Apply --set updates, editing only each named key's own lines."""
    for assignment in sets:
        key, value = parse_assignment(assignment)
        editor.set(key, value)


def apply_append_updates(editor: FrontmatterEditor, appends: List[str]) -> None:
    """Apply --append updates, inserting one item into each named list block."""
    for assignment in appends:
        key, value = parse_assignment(assignment)
        editor.append(key, value)   # raises FrontmatterEditError (a ValueError) on a non-list


def validate_against_schema(metadata: Dict[str, Any], artifact_type: Optional[str]) -> Tuple[bool, List[str], str]:
    """Validate metadata against resolved schema."""
    detected_type = artifact_type or detect_artifact_type(metadata)
    if detected_type is None:
        return False, ["Could not detect artifact type from doc_type/type"], "unknown"

    schema_path = resolve_schema_path(detected_type)
    schema = load_schema(detected_type)
    is_valid, errors = validate_metadata(metadata, schema, schema_path)
    return is_valid, errors, detected_type


_REQUIRED_PROPERTY_RE = re.compile(r"'(?P<key>[^']+)' is a required property")


def remediation_for(error: str) -> Optional[str]:
    """One actionable line for an error a targeted write cannot be blamed for."""
    match = _REQUIRED_PROPERTY_RE.search(error)
    if match:
        key = match.group("key")
        return (f"add the missing `{key}:` key to this file's frontmatter "
                f"(many plans in the corpus predate it)")
    return None


def partition_errors(before: List[str], after: List[str]) -> Tuple[List[str], List[str]]:
    """Split post-edit errors into (introduced by this edit, pre-existing).

    This is what makes a targeted `--set`/`--append` usable on the large number of
    plans that predate a schema key. Validating the WHOLE document meant one unrelated
    pre-existing gap refused every write — friction at exactly the moment a run is
    trying to close out honestly, so the landing pointer got hand-edited instead.

    The whole document is still validated and every pre-existing violation is still
    REPORTED; it just no longer blocks a write it did not cause. Errors the edit
    introduced still block, so this cannot become a way to author invalid frontmatter.

    Counted, not just set-differenced: appending a second bad entry to a list that
    already had one must be caught, even though the error text of the pre-existing one
    is identical.
    """
    remaining = list(before)
    introduced: List[str] = []
    pre_existing: List[str] = []
    for error in after:
        if error in remaining:
            remaining.remove(error)   # consume one occurrence, so counts matter
            pre_existing.append(error)
        else:
            introduced.append(error)
    return introduced, pre_existing


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser(description="Update frontmatter fields with schema validation")
    parser.add_argument("--file", "-f", type=Path, required=True, help="Markdown file to update")
    parser.add_argument("--set", action="append", default=[], help="Set key=value (repeatable)")
    parser.add_argument("--append", action="append", default=[], help="Append key=value to list field")
    parser.add_argument("--artifact-type", help="Optional explicit artifact type")
    parser.add_argument("--strict", action="store_true",
                        help="Also refuse to write when the file has PRE-EXISTING validation "
                             "errors this update did not cause (the old behaviour).")

    args = parser.parse_args()

    if not args.set and not args.append:
        print("Error: Provide at least one --set or --append update.", file=sys.stderr)
        sys.exit(1)

    if not args.file.exists():
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(1)

    try:
        editor = load_editor(args.file)
        if editor is None:
            print("Error: File does not contain valid YAML frontmatter.", file=sys.stderr)
            sys.exit(1)

        # Baseline the document BEFORE the edit, so a pre-existing violation can be
        # told apart from one this write introduced.
        _, baseline_errors, _ = validate_against_schema(
            validation_view(editor), args.artifact_type)

        apply_set_updates(editor, args.set)
        apply_append_updates(editor, args.append)

        # A date, not a "YYYY-MM-DD" string: PyYAML quotes a date-shaped STRING to preserve its
        # stringness, which would flip this line from `updated: 2026-08-01` to a quoted scalar on
        # the first write. A file that already quotes it keeps its quotes via the editor's
        # quote-preservation path, so either house style survives.
        editor.set("updated", datetime.now().date())

        # Re-read the edited LINES: the object validated below is what lands on disk.
        _, errors, resolved_type = validate_against_schema(
            validation_view(editor), args.artifact_type)
        introduced, pre_existing = partition_errors(baseline_errors, errors)

        if introduced:
            print(f"Error: this update introduces validation errors for type "
                  f"'{resolved_type}':", file=sys.stderr)
            for err in introduced:
                print(f"  - {err}", file=sys.stderr)
            if pre_existing:
                print(f"  ({len(pre_existing)} further pre-existing error(s) not caused "
                      f"by this update are listed below)", file=sys.stderr)
                for err in pre_existing:
                    print(f"  · {err}", file=sys.stderr)
            sys.exit(1)

        if args.strict and pre_existing:
            print(f"Error: --strict and this file has {len(pre_existing)} pre-existing "
                  f"validation error(s) for type '{resolved_type}':", file=sys.stderr)
            for err in pre_existing:
                print(f"  - {err}", file=sys.stderr)
                hint = remediation_for(err)
                if hint:
                    print(f"    fix: {hint}", file=sys.stderr)
            sys.exit(1)

        args.file.write_text(editor.render(), encoding="utf-8")
        print(f"✓ Updated {args.file}")
        print(f"  Validated as: {resolved_type}")

        # Report what we did not block on. A raw validator dump here is what made the
        # original failure unreadable, so each line gets a remediation where we have one.
        if pre_existing:
            print(f"  note: {len(pre_existing)} pre-existing validation error(s) in this "
                  f"file were left alone (not caused by this update):")
            for err in pre_existing:
                hint = remediation_for(err)
                print(f"    · {err}" + (f"\n      fix: {hint}" if hint else ""))

    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # pragma: no cover - defensive CLI path
        print(f"Error: Unexpected failure: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
