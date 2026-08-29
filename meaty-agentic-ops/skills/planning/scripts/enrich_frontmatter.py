#!/usr/bin/env python3
"""Gated write-back of agent-inferred structural fields into a plan's FRONTMATTER (P3, DI-134).

The capture pipeline can only forward what already lives in a plan's frontmatter. Body-only fields
(``open_questions``, ``decisions``, ``planning_maturity``, ``origin``, ``meta_plan_refs``) are
inferred by a planning agent (``/plan:enrich-frontmatter``) and written back *here* — into the
canonical markdown frontmatter — so the deterministic capture path then surfaces them with no agent
in the loop (proves D3).

Safety (P3.3 / P3.5):
- **dry-run by default** — ``--apply`` is required to write;
- **never overwrites** — only keys that are absent/empty in the current frontmatter are added;
- **allowlisted** — only the enrichment fields below may be written (no arbitrary edits);
- **format-preserving** — existing frontmatter and the body are kept verbatim; new keys are
  inserted textually just before the closing ``---`` (no full re-serialize that churns the file).

Usage:
  enrich_frontmatter.py <plan.md> --proposal proposal.json [--apply]
  enrich_frontmatter.py <plan.md> --proposal-json '{"open_questions": ["..."]}' [--apply]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("enrich_frontmatter: PyYAML required (pip install pyyaml)\n")
    sys.exit(2)

# The only frontmatter keys this tool may write — the §5 SHOULD fields an agent can infer from
# body prose (see .claude/skills/planning/references/plan-frontmatter-schema.md). Widened in P6-001
# beyond the original 6 to cover agent-context + acceptance/success criteria; widened again in
# DI-159 to cover the leaf-inheritable container fields (tags/priority/effort/exec-mode/target-date)
# so an enriched plan/phase carries something for the capture inherit pass (DI-152) to cascade.
ENRICH_FIELDS = {
    "open_questions",
    "decisions",
    "decision_gates",
    "planning_maturity",
    "origin",
    "meta_plan_refs",
    "agent_title",
    "agent_summary",
    "agent_context",
    "acceptance_criteria",
    "success_metrics",
    "definition_of_done",
    # DI-159 — leaf-inheritable container fields (cascade to tasks via DI-152 inherit pass).
    "tags",
    "priority",
    "execution_mode",
    "target_date",
    "effort_size",
    "points",
}

_EMPTY = (None, "", [], {}, ())


def _frontmatter_bounds(text: str) -> int | None:
    """Index of the newline preceding the closing ``---``, or ``None`` if no frontmatter block."""
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    return end if end != -1 else None


def parse_frontmatter(text: str) -> dict[str, Any]:
    end = _frontmatter_bounds(text)
    if end is None:
        return {}
    try:
        data = yaml.safe_load(text[3:end])
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def compute_additions(
    frontmatter: dict[str, Any], proposal: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """Split a proposal into (additions, skipped-because-present, rejected-non-allowlisted)."""
    rejected = sorted(k for k in proposal if k not in ENRICH_FIELDS)
    additions: dict[str, Any] = {}
    skipped: dict[str, Any] = {}
    for key, value in proposal.items():
        if key not in ENRICH_FIELDS or value in _EMPTY:
            continue
        if frontmatter.get(key) in _EMPTY:
            additions[key] = value
        else:
            skipped[key] = frontmatter.get(key)
    return additions, skipped, rejected


def render_snippet(additions: dict[str, Any]) -> str:
    return yaml.safe_dump(
        additions, sort_keys=False, allow_unicode=True, default_flow_style=False, width=1000
    ).rstrip("\n")


def apply_additions(text: str, additions: dict[str, Any]) -> str:
    """Insert *additions* as YAML just before the closing ``---`` (format-preserving)."""
    end = _frontmatter_bounds(text)
    if end is None:
        raise ValueError("file has no YAML frontmatter block to enrich")
    return text[:end] + "\n" + render_snippet(additions) + text[end:]


def _load_proposal(args: argparse.Namespace) -> dict[str, Any]:
    if args.proposal_json:
        raw = json.loads(args.proposal_json)
    elif args.proposal:
        raw = json.loads(Path(args.proposal).read_text(encoding="utf-8"))
    else:
        raise SystemExit("error: one of --proposal or --proposal-json is required")
    if not isinstance(raw, dict):
        raise SystemExit("error: proposal must be a JSON object of {field: value}")
    return raw


def main() -> int:
    ap = argparse.ArgumentParser(description="Gated frontmatter enrichment write-back (P3)")
    ap.add_argument("path", help="plan markdown file to enrich")
    ap.add_argument("--proposal", help="path to a JSON file of {field: value} to add")
    ap.add_argument("--proposal-json", help="inline JSON of {field: value} to add")
    ap.add_argument("--apply", action="store_true", help="write the additions (default: dry-run)")
    args = ap.parse_args()

    path = Path(args.path)
    if not path.is_file():
        sys.stderr.write(f"error: not a file: {path}\n")
        return 2
    text = path.read_text(encoding="utf-8")
    if _frontmatter_bounds(text) is None:
        sys.stderr.write(f"error: {path} has no YAML frontmatter block\n")
        return 2

    proposal = _load_proposal(args)
    frontmatter = parse_frontmatter(text)
    additions, skipped, rejected = compute_additions(frontmatter, proposal)

    print(f"ENRICH {path}")
    if rejected:
        print(f"  rejected (not in allowlist): {rejected}")
    for key in skipped:
        print(f"  skip   {key}: already present (not overwriting)")
    for key in additions:
        print(f"  add    {key}")
    if not additions:
        print("  nothing to add (all proposed fields already present or empty).")
        return 0

    snippet = render_snippet(additions)
    if args.apply:
        path.write_text(apply_additions(text, additions), encoding="utf-8")
        print(f"  APPLIED — inserted {len(additions)} key(s) into frontmatter.")
    else:
        print("  DRY-RUN — would insert:\n" + "\n".join("    " + ln for ln in snippet.splitlines()))
        print("  re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
