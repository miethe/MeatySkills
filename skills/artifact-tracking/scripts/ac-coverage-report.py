#!/usr/bin/env python3
"""
AC coverage matrix: verify every Acceptance Criterion in an implementation plan
is referenced by at least one verification task in the progress files, and
every verification task cites at least one AC.

Also supports --dry mode to check that ACs with vague propagation language have
explicit target_surfaces (used at plan-approval time).

Usage:
    python ac-coverage-report.py --plan docs/project_plans/impl.md --progress .claude/progress/prd/phase-N-progress.md
    python ac-coverage-report.py --plan PLAN --progress P1 --progress P2 --json
    python ac-coverage-report.py --plan PLAN --dry
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml

# Words that trigger the --dry vague-language check
VAGUE_PROPAGATION_WORDS = re.compile(
    r"\b(across|everywhere|throughout|all\s+\w+|visible)\b", re.IGNORECASE
)

# Headings like: #### AC R3.4: some title
AC_HEADING_RE = re.compile(
    r"^#{1,6}\s+AC\s+([\w.\-]+)\s*[:—-]", re.MULTILINE
)

# YAML block starting after an AC heading, up to the next heading or end-of-section
# We parse the structured fields (target_surfaces, verified_by) out of the AC block.


def extract_frontmatter_and_body(filepath: Path) -> Tuple[Optional[Dict[str, Any]], str]:
    """Extract YAML frontmatter and markdown body; return (frontmatter, body)."""
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error: Could not read {filepath}: {e}", file=sys.stderr)
        return None, ""

    if not content.strip().startswith("---"):
        # No frontmatter — treat entire content as body
        return {}, content

    match = re.match(r"^---\n(.*?\n)---\n(.*)$", content, re.DOTALL)
    if not match:
        return {}, content

    try:
        frontmatter = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        frontmatter = {}

    return frontmatter, match.group(2)


# ---------------------------------------------------------------------------
# Plan parsing
# ---------------------------------------------------------------------------

def _parse_ac_block_fields(text_after_heading: str) -> Dict[str, Any]:
    """
    Extract YAML-like structured fields from the markdown lines immediately
    following an AC heading, until the next heading.

    Handles two shapes:
      1. A fenced ```yaml ... ``` block
      2. Bare indented YAML-ish lines (- field:\n    - value)
    """
    # Stop at next heading
    stop = re.search(r"^#{1,6}\s", text_after_heading, re.MULTILINE)
    block = text_after_heading[: stop.start()] if stop else text_after_heading

    # Try fenced YAML block first
    fenced = re.search(r"```(?:yaml)?\n(.*?)```", block, re.DOTALL)
    if fenced:
        try:
            data = yaml.safe_load(fenced.group(1))
            return data if isinstance(data, dict) else {}
        except yaml.YAMLError:
            pass

    # Try to parse as bare YAML (strip leading >-style blockquote markers first)
    clean = re.sub(r"^>\s?", "", block, flags=re.MULTILINE)
    try:
        data = yaml.safe_load(clean)
        if isinstance(data, dict):
            return data
    except yaml.YAMLError:
        pass

    # Fall back: extract verified_by lines manually
    fields: Dict[str, Any] = {}
    vb_matches = re.findall(r"verified_by\s*:\s*\[([^\]]*)\]", block)
    if vb_matches:
        raw = vb_matches[0]
        fields["verified_by"] = [s.strip().strip('"').strip("'") for s in raw.split(",") if s.strip()]
    ts_matches = re.findall(r"target_surfaces\s*:", block)
    if ts_matches:
        # Grab indented list items following the key
        ts_section = block[block.find("target_surfaces"):]
        items = re.findall(r"^\s+-\s+(.+)$", ts_section, re.MULTILINE)
        if items:
            fields["target_surfaces"] = [i.strip() for i in items]
    return fields


def parse_plan_acs(plan_path: Path) -> List[Dict[str, Any]]:
    """
    Return a list of AC records from an implementation plan.

    Each record:
      {
        "id": "R3.4",
        "text": "full heading text",
        "verified_by": ["P16-003", ...],      # from structured block
        "target_surfaces": [...] | None,
        "has_vague_language": bool,
        "body_snippet": "first 200 chars after heading",
      }
    """
    _fm, body = extract_frontmatter_and_body(plan_path)
    acs = []
    for m in AC_HEADING_RE.finditer(body):
        ac_id = m.group(1)
        heading_end = m.end()
        remaining = body[heading_end:]
        fields = _parse_ac_block_fields(remaining)

        # Grab a text snippet for vague-language check
        stop = re.search(r"^#{1,6}\s", remaining, re.MULTILINE)
        snippet = remaining[: stop.start()] if stop else remaining
        snippet_clean = re.sub(r"[`\-_*#]", " ", snippet)

        acs.append({
            "id": ac_id,
            "text": m.group(0).strip(),
            "verified_by": fields.get("verified_by") or [],
            "target_surfaces": fields.get("target_surfaces"),
            "has_vague_language": bool(VAGUE_PROPAGATION_WORDS.search(snippet_clean)),
            "body_snippet": snippet_clean[:200].strip(),
        })
    return acs


# ---------------------------------------------------------------------------
# Progress file parsing
# ---------------------------------------------------------------------------

def parse_progress_tasks(progress_path: Path) -> List[Dict[str, Any]]:
    """
    Return task records from a progress file's frontmatter.

    Each record mirrors the YAML task dict; we ensure 'verified_by' and
    'evidence' are always lists.
    """
    frontmatter, _body = extract_frontmatter_and_body(progress_path)
    if not frontmatter:
        return []
    tasks = frontmatter.get("tasks", [])
    if not isinstance(tasks, list):
        return []
    result = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        vb = t.get("verified_by", [])
        if not isinstance(vb, list):
            vb = [vb] if vb else []
        ev = t.get("evidence", [])
        if not isinstance(ev, list):
            ev = [ev] if ev else []
        result.append({
            "id": t.get("id", "<unknown>"),
            "status": t.get("status", "pending"),
            "verified_by": vb,
            "evidence": ev,
            "source_file": str(progress_path),
        })
    return result


# ---------------------------------------------------------------------------
# Coverage matrix
# ---------------------------------------------------------------------------

def build_coverage_matrix(
    acs: List[Dict[str, Any]],
    tasks: List[Dict[str, Any]],
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    """
    Build two-way mapping:
      ac_to_tasks  : ac_id  → [task_ids that reference this AC in their verified_by]
      task_to_acs  : task_id → [ac_ids this task is cited as verified_by in the plan]

    A task references an AC when:
      - The AC's verified_by list in the plan includes the task_id, OR
      - The task's verified_by list includes the AC id
    """
    # Index AC → [task_ids cited in plan]
    ac_to_tasks: Dict[str, List[str]] = {ac["id"]: list(ac["verified_by"]) for ac in acs}

    # Also index task verified_by lists (tasks can also self-report their ACs)
    task_id_to_ac_refs: Dict[str, List[str]] = {}
    ac_ids: Set[str] = {ac["id"] for ac in acs}
    for task in tasks:
        # A task's verified_by might list AC ids (if naming convention overlaps)
        # More typically, we check the plan's AC verified_by for task ids.
        task_id_to_ac_refs[task["id"]] = []

    # Invert: for each AC, add its referenced tasks; for each task, record which ACs reference it
    task_to_acs: Dict[str, List[str]] = {t["id"]: [] for t in tasks}
    for ac_id, task_refs in ac_to_tasks.items():
        for t_id in task_refs:
            if t_id in task_to_acs:
                if ac_id not in task_to_acs[t_id]:
                    task_to_acs[t_id].append(ac_id)
            else:
                # Referenced task not in progress files — still record
                task_to_acs[t_id] = [ac_id]

    return ac_to_tasks, task_to_acs


def find_coverage_violations(
    ac_to_tasks: Dict[str, List[str]],
    task_to_acs: Dict[str, List[str]],
    all_task_ids: Set[str],
) -> Tuple[List[str], List[str]]:
    """
    Returns:
      uncovered_acs   : AC ids with zero task references
      uncovered_tasks : verification task ids (those cited by any AC) with zero AC references
    """
    uncovered_acs = [ac_id for ac_id, tasks in ac_to_tasks.items() if not tasks]

    # "Verification tasks" = tasks cited in at least one AC's verified_by
    cited_task_ids: Set[str] = set()
    for tasks in ac_to_tasks.values():
        cited_task_ids.update(tasks)

    uncovered_tasks = [
        t_id for t_id in cited_task_ids
        if not task_to_acs.get(t_id)
    ]
    return uncovered_acs, uncovered_tasks


# ---------------------------------------------------------------------------
# --dry mode
# ---------------------------------------------------------------------------

def dry_check_vague_acs(acs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Return ACs that have vague propagation language but no target_surfaces.
    """
    return [
        ac for ac in acs
        if ac["has_vague_language"] and not ac.get("target_surfaces")
    ]


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def format_table_report(
    plan_path: Path,
    progress_paths: List[Path],
    acs: List[Dict[str, Any]],
    ac_to_tasks: Dict[str, List[str]],
    task_to_acs: Dict[str, List[str]],
    uncovered_acs: List[str],
    uncovered_tasks: List[str],
) -> str:
    lines = [
        "=" * 72,
        "AC Coverage Matrix Report",
        "=" * 72,
        f"Plan     : {plan_path}",
    ]
    for p in progress_paths:
        lines.append(f"Progress : {p}")
    lines += [
        f"ACs parsed : {len(acs)}",
        f"Uncovered ACs (no verified_by tasks) : {len(uncovered_acs)}",
        f"Uncovered verification tasks (no AC refs) : {len(uncovered_tasks)}",
        "=" * 72,
        "",
        "AC → Tasks Matrix",
        "-" * 72,
    ]
    col = max((len(ac["id"]) for ac in acs), default=6) + 2
    lines.append(f"  {'AC ID':<{col}}  Tasks")
    lines.append(f"  {'-' * col}  {'-' * 40}")
    for ac in acs:
        task_list = ", ".join(ac_to_tasks.get(ac["id"], [])) or "(none)"
        marker = "✗" if not ac_to_tasks.get(ac["id"]) else "✓"
        lines.append(f"  {marker} {ac['id']:<{col - 2}}  {task_list}")

    lines += ["", "Task → ACs Matrix", "-" * 72]
    cited_tasks = {t for tasks in ac_to_tasks.values() for t in tasks}
    if cited_tasks:
        col2 = max(len(t) for t in cited_tasks) + 2
        lines.append(f"  {'Task ID':<{col2}}  ACs")
        lines.append(f"  {'-' * col2}  {'-' * 40}")
        for t_id in sorted(cited_tasks):
            ac_list = ", ".join(task_to_acs.get(t_id, [])) or "(none)"
            marker = "✗" if not task_to_acs.get(t_id) else "✓"
            lines.append(f"  {marker} {t_id:<{col2 - 2}}  {ac_list}")
    else:
        lines.append("  (no tasks cited in AC verified_by lists)")

    if uncovered_acs or uncovered_tasks:
        lines += ["", "VIOLATIONS", "-" * 72]
        for ac_id in uncovered_acs:
            lines.append(f"  ✗ AC {ac_id} has no verified_by task references")
        for t_id in uncovered_tasks:
            lines.append(f"  ✗ Verification task {t_id} cites no ACs")

    lines += ["", "=" * 72]
    return "\n".join(lines)


def format_dry_report(vague_acs: List[Dict[str, Any]], plan_path: Path) -> str:
    lines = [
        "=" * 72,
        "AC Dry-Check: Vague Propagation Language",
        "=" * 72,
        f"Plan : {plan_path}",
        f"ACs with vague language and missing target_surfaces: {len(vague_acs)}",
        "=" * 72,
    ]
    if not vague_acs:
        lines.append("✓ No vague ACs detected. Plan is ready for approval.")
    else:
        lines.append("✗ The following ACs must add target_surfaces:\n")
        for ac in vague_acs:
            lines.append(f"  {ac['id']}: {ac['text']}")
            lines.append(f"    Snippet: {ac['body_snippet'][:120]}")
            lines.append("")
    lines.append("=" * 72)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="AC ↔ verification task coverage matrix for implementation plans.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full coverage check
  python ac-coverage-report.py \\
      --plan docs/project_plans/implementation_plans/enhancements/my-plan.md \\
      --progress .claude/progress/my-prd/phase-13-progress.md \\
      --progress .claude/progress/my-prd/phase-16-progress.md

  # Machine-readable
  python ac-coverage-report.py --plan PLAN --progress P1 --json

  # Plan approval gate: check for vague ACs
  python ac-coverage-report.py --plan PLAN --dry

Exit codes:
  0  No violations
  1  Coverage violations found (or vague ACs in --dry mode)
  2  File/parse error
        """,
    )
    parser.add_argument("--plan", type=Path, required=True, help="Implementation plan markdown file")
    parser.add_argument(
        "--progress", type=Path, action="append", default=[],
        metavar="PROGRESS_FILE",
        help="Progress file (repeatable)",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON report")
    parser.add_argument(
        "--dry", action="store_true",
        help="Dry-check only: verify ACs with vague language have target_surfaces. "
             "Does not require --progress.",
    )
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"Error: Plan file not found: {args.plan}", file=sys.stderr)
        sys.exit(2)

    acs = parse_plan_acs(args.plan)

    # --dry mode -----------------------------------------------------------
    if args.dry:
        vague_acs = dry_check_vague_acs(acs)
        if args.json:
            print(json.dumps({
                "plan": str(args.plan),
                "mode": "dry",
                "acs_checked": len(acs),
                "vague_acs": [
                    {"id": a["id"], "text": a["text"], "snippet": a["body_snippet"][:120]}
                    for a in vague_acs
                ],
                "gate_passed": len(vague_acs) == 0,
            }, indent=2))
        else:
            print(format_dry_report(vague_acs, args.plan))
        sys.exit(0 if not vague_acs else 1)

    # Full coverage mode ---------------------------------------------------
    if not args.progress:
        print("Error: --progress is required unless --dry is set.", file=sys.stderr)
        sys.exit(2)

    for p in args.progress:
        if not p.exists():
            print(f"Error: Progress file not found: {p}", file=sys.stderr)
            sys.exit(2)

    all_tasks: List[Dict[str, Any]] = []
    for p in args.progress:
        all_tasks.extend(parse_progress_tasks(p))

    ac_to_tasks, task_to_acs = build_coverage_matrix(acs, all_tasks)
    all_task_ids: Set[str] = {t["id"] for t in all_tasks}
    uncovered_acs, uncovered_tasks = find_coverage_violations(ac_to_tasks, task_to_acs, all_task_ids)

    gate_passed = not uncovered_acs and not uncovered_tasks

    if args.json:
        print(json.dumps({
            "plan": str(args.plan),
            "progress_files": [str(p) for p in args.progress],
            "acs_parsed": len(acs),
            "ac_to_tasks": ac_to_tasks,
            "task_to_acs": task_to_acs,
            "uncovered_acs": uncovered_acs,
            "uncovered_verification_tasks": uncovered_tasks,
            "gate_passed": gate_passed,
        }, indent=2))
    else:
        print(format_table_report(
            args.plan, args.progress, acs,
            ac_to_tasks, task_to_acs,
            uncovered_acs, uncovered_tasks,
        ))

    sys.exit(0 if gate_passed else 1)


if __name__ == "__main__":
    main()
