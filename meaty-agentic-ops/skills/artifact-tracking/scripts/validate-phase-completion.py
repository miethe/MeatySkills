#!/usr/bin/env python3
"""
Validate phase completion gate: every completed task must have timing signals,
verified_by, and evidence before the phase can be marked completed.

Blocks phase-exit when any completed task is missing required fields.

Usage:
    python validate-phase-completion.py -f .claude/progress/prd/phase-7-progress.md
    python validate-phase-completion.py -f FILE --json
    python validate-phase-completion.py -f FILE --set-completed   # also flips phase status if gate passes
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

# Fields required on every completed task
REQUIRED_COMPLETION_FIELDS = ["started", "completed", "verified_by", "evidence"]


def extract_frontmatter_and_body(filepath: Path) -> Tuple[Optional[Dict[str, Any]], str]:
    """Extract YAML frontmatter and markdown body from a progress file."""
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error: Could not read {filepath}: {e}", file=sys.stderr)
        return None, ""

    if not content.strip().startswith("---"):
        print("Error: File does not contain YAML frontmatter", file=sys.stderr)
        return None, ""

    match = re.match(r"^---\n(.*?\n)---\n(.*)$", content, re.DOTALL)
    if not match:
        print("Error: Could not parse YAML frontmatter", file=sys.stderr)
        return None, ""

    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        print(f"Error: Invalid YAML in frontmatter: {e}", file=sys.stderr)
        return None, ""

    return frontmatter, match.group(2)


def _is_empty(value: Any) -> bool:
    """Return True when a field value is missing, None, or an empty collection."""
    if value is None:
        return True
    if isinstance(value, (list, dict)) and len(value) == 0:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def validate_tasks(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Inspect each completed task and return a list of violation records.

    Each record: {id, missing_fields: [str]}
    """
    violations = []
    for task in tasks:
        if task.get("status") != "completed":
            continue
        missing = [f for f in REQUIRED_COMPLETION_FIELDS if _is_empty(task.get(f))]
        if missing:
            violations.append({"id": task.get("id", "<unknown>"), "missing_fields": missing})
    return violations


def format_table_report(
    filepath: Path,
    phase_status: str,
    total_completed: int,
    violations: List[Dict[str, Any]],
) -> str:
    """Render a human-readable table report."""
    lines = [
        "=" * 70,
        "Phase Completion Gate Report",
        "=" * 70,
        f"File   : {filepath}",
        f"Phase status: {phase_status}",
        f"Completed tasks checked: {total_completed}",
        f"Violations: {len(violations)}",
        "=" * 70,
    ]
    if not violations:
        lines.append("✓ All completed tasks have required fields. Phase gate PASSED.")
    else:
        lines.append("✗ Gate FAILED — completed tasks missing required fields:\n")
        col_w = max(len(v["id"]) for v in violations) + 2
        lines.append(f"  {'Task ID':<{col_w}}  Missing fields")
        lines.append(f"  {'-' * col_w}  {'-' * 40}")
        for v in violations:
            lines.append(f"  {v['id']:<{col_w}}  {', '.join(v['missing_fields'])}")
        lines.append("")
        lines.append(
            "Fix: use update-status.py with --started, --completed, "
            "--evidence, --verified-by flags."
        )
    lines.append("=" * 70)
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate phase completion gate for a progress file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Check phase can be marked completed
  python validate-phase-completion.py -f .claude/progress/prd/phase-7-progress.md

  # Machine-readable output
  python validate-phase-completion.py -f FILE --json

Exit codes:
  0  All completed tasks pass the gate (or no completed tasks exist)
  1  One or more completed tasks are missing required fields
  2  File error (not found, invalid YAML, etc.)
        """,
    )
    parser.add_argument("--file", "-f", type=Path, required=True, help="Path to progress file")
    parser.add_argument("--json", action="store_true", help="Emit JSON report to stdout")
    args = parser.parse_args()

    if not args.file.exists():
        print(f"Error: File not found: {args.file}", file=sys.stderr)
        sys.exit(2)

    frontmatter, _body = extract_frontmatter_and_body(args.file)
    if frontmatter is None:
        sys.exit(2)

    tasks = frontmatter.get("tasks", [])
    if not isinstance(tasks, list):
        print("Error: 'tasks' in frontmatter is not a list", file=sys.stderr)
        sys.exit(2)

    phase_status = frontmatter.get("status", "unknown")
    completed_tasks = [t for t in tasks if t.get("status") == "completed"]
    violations = validate_tasks(tasks)

    if args.json:
        report = {
            "file": str(args.file),
            "phase_status": phase_status,
            "completed_tasks_checked": len(completed_tasks),
            "violations": violations,
            "gate_passed": len(violations) == 0,
        }
        print(json.dumps(report, indent=2))
    else:
        print(format_table_report(args.file, phase_status, len(completed_tasks), violations))

    sys.exit(0 if not violations else 1)


if __name__ == "__main__":
    main()
