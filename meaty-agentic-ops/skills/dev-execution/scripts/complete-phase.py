#!/usr/bin/env python3
"""complete-phase — keep plan frontmatter status current when a phase/feature ships (DI-135).

OPT-IN, comment-preserving. Rewrites `status` and `planning_maturity` in a plan file's frontmatter
so the IntentTree plan-lens stops showing stale `not_started`/`in_progress` on shipped work. Markdown
stays canonical — re-running `intenttree_capture.py --apply` after this hook picks up the new status
with no agent involvement.

Behavior:
  * dry-run by DEFAULT — prints the proposed diff, writes nothing;
  * `--apply` writes the change;
  * idempotent — a plan already at the target `status` (and maturity) is a no-op (exit 0);
  * never mutates anything other than the two named frontmatter keys.

Usage:
    complete-phase.py PLAN.md                       # dry-run: status->completed, maturity->shipped
    complete-phase.py PLAN.md --apply
    complete-phase.py PLAN.md --status completed --maturity shipped --apply
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("complete-phase: PyYAML required (pip install pyyaml)\n")
    raise SystemExit(2)

# status -> planning_maturity derivation (mirrors work_item_sync.derive_planning_maturity intent).
_MATURITY_FOR_STATUS = {
    "completed": "shipped",
    "done": "shipped",
    "shipped": "shipped",
    "in-progress": "in_progress",
    "in_progress": "in_progress",
    "review": "in_progress",
}


def split_frontmatter(text: str) -> tuple[str, list[str], str] | None:
    """Return (prefix_incl_open_fence, fm_lines, suffix_incl_close_fence) or None."""
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    # fm body is text[4:end] (after "---\n"); keep it line-oriented.
    head_nl = text.find("\n")
    if head_nl == -1:
        return None
    fm_body = text[head_nl + 1 : end]
    prefix = text[: head_nl + 1]  # "---\n"
    suffix = text[end + 1 :]  # starts at the closing "---"
    return prefix, fm_body.splitlines(), suffix


def get_field(fm_lines: list[str], key: str) -> str | None:
    fm_text = "\n".join(fm_lines)
    try:
        data = yaml.safe_load(fm_text)
    except yaml.YAMLError:
        data = None
    if isinstance(data, dict) and key in data:
        val = data[key]
        return None if val is None else str(val)
    return None


def set_field(fm_lines: list[str], key: str, value: str) -> list[str]:
    """Replace the top-level `key:` line preserving any inline comment; insert if absent."""
    pat = re.compile(rf"^({re.escape(key)}):\s*([^#\n]*?)\s*(#.*)?$")
    out: list[str] = []
    replaced = False
    for line in fm_lines:
        m = pat.match(line)
        if m and not replaced:
            comment = f" {m.group(3)}" if m.group(3) else ""
            out.append(f"{key}: {value}{comment}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"{key}: {value}")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("plan", type=Path, help="plan/PRD file to update")
    parser.add_argument("--status", default="completed", help="target status (default: completed)")
    parser.add_argument("--maturity", default=None, help="target planning_maturity (default: derived)")
    parser.add_argument("--apply", action="store_true", help="write the change (default: dry-run)")
    args = parser.parse_args(argv)

    try:
        text = args.plan.read_text(encoding="utf-8")
    except OSError as exc:
        sys.stderr.write(f"complete-phase: cannot read {args.plan}: {exc}\n")
        return 2

    split = split_frontmatter(text)
    if split is None:
        sys.stderr.write(f"complete-phase: no parseable frontmatter in {args.plan}\n")
        return 2
    prefix, fm_lines, suffix = split

    target_status = args.status
    target_maturity = args.maturity or _MATURITY_FOR_STATUS.get(target_status, "shipped")

    cur_status = get_field(fm_lines, "status")
    cur_maturity = get_field(fm_lines, "planning_maturity")

    if cur_status == target_status and cur_maturity == target_maturity:
        print(f"[no-op] {args.plan}: already status={cur_status}, planning_maturity={cur_maturity}")
        return 0

    new_lines = set_field(fm_lines, "status", target_status)
    new_lines = set_field(new_lines, "planning_maturity", target_maturity)

    print(f"{'[apply]' if args.apply else '[dry-run]'} {args.plan}")
    print(f"  status:            {cur_status!r} -> {target_status!r}")
    print(f"  planning_maturity: {cur_maturity!r} -> {target_maturity!r}")

    if args.apply:
        new_text = prefix + "\n".join(new_lines) + "\n" + suffix
        args.plan.write_text(new_text, encoding="utf-8")
        print("  written. Re-run intenttree_capture.py --apply to propagate to the node.")
    else:
        print("  (dry-run — pass --apply to write)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
