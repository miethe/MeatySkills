#!/usr/bin/env python3
"""complete-task — update one task's status inside a frontmatter `tasks:` list (DI-135).

OPT-IN, comment-preserving, line-based. Finds the `- id: <task-id>` block in a file's frontmatter
`tasks:` list and rewrites its `status:` (inserting one if absent), preserving indentation and inline
comments. Dry-run by default; `--apply` writes.

Compatibility: for `.claude/progress/*` files the canonical, completion-gate-enforced tool remains
`.claude/skills/artifact-tracking/scripts/update-status.py` (it requires timestamps/evidence on
`completed`). This hook is the lighter companion for keeping an embedded plan-file `tasks[]` status
current so the IntentTree plan-lens does not show stale task state; it does NOT enforce the
completion gate.

Usage:
    complete-task.py FILE --task P1-001 --status completed          # dry-run
    complete-task.py FILE --task P1-001 --status completed --apply
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def split_frontmatter(text: str) -> tuple[str, list[str], str] | None:
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    head_nl = text.find("\n")
    if head_nl == -1:
        return None
    return text[: head_nl + 1], text[head_nl + 1 : end].splitlines(), text[end + 1 :]


def _is_top_level_key(line: str) -> bool:
    return bool(re.match(r"^[^\s#-][\w-]*:", line))


def update_task_status(
    fm_lines: list[str], task_id: str, new_status: str
) -> tuple[list[str], str | None, bool]:
    """Return (new_lines, old_status, changed). old_status is None if task/status not found."""
    id_pat = re.compile(rf"^(\s*)-\s*id:\s*[\"']?{re.escape(task_id)}[\"']?\s*(#.*)?$")
    found = next(((i, m) for i, ln in enumerate(fm_lines) if (m := id_pat.match(ln))), None)
    if found is None:
        return fm_lines, None, False
    start, id_match = found

    base_indent = id_match.group(1)
    # Block extends until the next sibling `- id:` (same indent) or a top-level key.
    end = len(fm_lines)
    for j in range(start + 1, len(fm_lines)):
        ln = fm_lines[j]
        if re.match(rf"^{re.escape(base_indent)}-\s", ln) or _is_top_level_key(ln):
            end = j
            break

    status_pat = re.compile(r"^(\s*)status:\s*([^#\n]*?)\s*(#.*)?$")
    out = list(fm_lines)
    for k in range(start + 1, end):
        m = status_pat.match(fm_lines[k])
        if m:
            old = m.group(2).strip().strip("\"'") or None
            comment = f" {m.group(3)}" if m.group(3) else ""
            out[k] = f"{m.group(1)}status: {new_status}{comment}"
            return out, old, old != new_status
    # No status line in the block — insert one right after the id line, indented under it.
    item_indent = base_indent + "  "
    out.insert(start + 1, f"{item_indent}status: {new_status}")
    return out, None, True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path, help="plan/progress file with a frontmatter tasks: list")
    parser.add_argument("--task", required=True, help="task id (e.g. P1-001)")
    parser.add_argument("--status", default="completed", help="new status (default: completed)")
    parser.add_argument("--apply", action="store_true", help="write the change (default: dry-run)")
    args = parser.parse_args(argv)

    try:
        text = args.file.read_text(encoding="utf-8")
    except OSError as exc:
        sys.stderr.write(f"complete-task: cannot read {args.file}: {exc}\n")
        return 2

    split = split_frontmatter(text)
    if split is None:
        sys.stderr.write(f"complete-task: no parseable frontmatter in {args.file}\n")
        return 2
    prefix, fm_lines, suffix = split

    new_lines, old_status, changed = update_task_status(fm_lines, args.task, args.status)
    if old_status is None and not changed:
        sys.stderr.write(f"complete-task: task {args.task!r} not found in {args.file}\n")
        return 1

    print(f"{'[apply]' if args.apply else '[dry-run]'} {args.file} :: {args.task}")
    print(f"  status: {old_status!r} -> {args.status!r}" + ("" if changed else "  (no change)"))

    if args.apply and changed:
        args.file.write_text(prefix + "\n".join(new_lines) + "\n" + suffix, encoding="utf-8")
        print("  written.")
    elif not args.apply:
        print("  (dry-run — pass --apply to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
