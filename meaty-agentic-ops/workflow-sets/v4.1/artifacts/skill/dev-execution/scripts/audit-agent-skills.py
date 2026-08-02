#!/usr/bin/env python3
"""
audit-agent-skills.py — Agent skills frontmatter audit and drift detection.

Usage:
    python audit-agent-skills.py                  # CSV output to stdout
    python audit-agent-skills.py --json           # JSON output instead of CSV
    python audit-agent-skills.py --strict         # exit 1 if any agent drifts
    python audit-agent-skills.py --apply          # (placeholder) prints guidance

Spec authority: .claude/plans/workflow-capability-utilization-spec.md §2.6
    "Pre-Loaded Skills on Subagents (Underutilized Today)"

Audit table (§2.6) is encoded in RECOMMENDATIONS below.  This script is the
source of truth for required skills per agent going forward.  Edit RECOMMENDATIONS
here — not in the spec — when the audit table changes.

Status codes:
    OK      — declared skills exactly match recommendations
    MISSING — agent is missing one or more recommended skills
    EXTRA   — agent declares skills not in the recommendation list
    DRIFT   — both missing and extra skills detected

Exit codes:
    0  — audit passed (or --apply placeholder)
    1  — one or more agents have status != OK (only when --strict is set)

Python 3.9+ required (project standard).
"""

import csv
import glob
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# RECOMMENDATIONS — encode §2.6 audit table verbatim.
# Key: agent `name:` field in frontmatter.
# Value: list of skills that MUST appear in `skills:` frontmatter.
#        Empty list = agent intentionally has no skills (spec says "None currently"
#        or "review-focused skill — None concrete yet").
# ---------------------------------------------------------------------------
RECOMMENDATIONS: Dict[str, List[str]] = {
    "lead-architect": ["planning", "artifact-tracking"],
    "lead-pm": ["planning", "artifact-tracking", "meatycapture-capture"],
    "implementation-planner": ["planning"],
    "feature-sprint-executor": ["dev-execution", "artifact-tracking", "skillmeat-cli"],
    "task-completion-validator": ["dev-execution"],
    "karen": ["dev-execution", "artifact-tracking"],
    "ultrathink-debugger": ["debugging", "symbols"],
    "python-backend-engineer": [
        "skillmeat-cli",
        "artifact-tracking",
        "symbols",
        "postgresql-psql",
    ],
    "ui-engineer-enhanced": [
        "frontend-design",
        "aesthetic",
        "artifact-tracking",
        "symbols",
    ],
    # senior-code-reviewer: no concrete review-focused skill yet (§2.6 note).
    # Listed here so the script can confirm the agent exists but has no
    # required additions yet.  When a review skill is authored, add it here.
    "senior-code-reviewer": [],
}

# ---------------------------------------------------------------------------
# YAML frontmatter parsing
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
_NAME_RE = re.compile(r"^name:\s*(.+)", re.MULTILINE)
# Skills block: either inline list  `skills: [a, b]`  or multi-line block.
_SKILLS_INLINE_RE = re.compile(r"^skills:\s*\[([^\]]*)\]", re.MULTILINE)
_SKILLS_BLOCK_START_RE = re.compile(r"^skills:\s*$", re.MULTILINE)


def _parse_frontmatter(text: str) -> Optional[str]:
    """Return the raw YAML frontmatter block or None."""
    m = _FRONTMATTER_RE.match(text)
    return m.group(1) if m else None


def _extract_name(fm: str) -> Optional[str]:
    m = _NAME_RE.search(fm)
    if not m:
        return None
    return m.group(1).strip().strip('"').strip("'")


def _extract_skills(fm: str) -> List[str]:
    """Return list of declared skill names from YAML frontmatter."""
    # Try inline: skills: [a, b, c]
    m = _SKILLS_INLINE_RE.search(fm)
    if m:
        raw = m.group(1)
        return [s.strip().strip('"').strip("'") for s in raw.split(",") if s.strip()]

    # Try block:
    #   skills:
    #     - a
    #     - b
    m_start = _SKILLS_BLOCK_START_RE.search(fm)
    if m_start:
        start = m_start.end()
        skills: List[str] = []
        for line in fm[start:].splitlines():
            stripped = line.strip()
            if stripped.startswith("- "):
                skills.append(stripped[2:].strip().strip('"').strip("'"))
            elif stripped and not stripped.startswith("#"):
                # Non-empty, non-comment, non-list line — end of block
                break
        return skills

    return []


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def find_agent_files(base: Path) -> List[Path]:
    """Glob all .md files under .claude/agents/."""
    pattern = str(base / ".claude" / "agents" / "**" / "*.md")
    return [Path(p) for p in glob.glob(pattern, recursive=True)]


def parse_agent(path: Path) -> Tuple[Optional[str], List[str]]:
    """Return (name, declared_skills) from agent file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None, []

    fm = _parse_frontmatter(text)
    if fm is None:
        return None, []

    name = _extract_name(fm)
    skills = _extract_skills(fm)
    return name, skills


# ---------------------------------------------------------------------------
# Audit logic
# ---------------------------------------------------------------------------

def compute_status(declared: List[str], recommended: List[str]) -> Tuple[List[str], List[str], str]:
    """Return (missing, extra, status)."""
    declared_set = set(declared)
    recommended_set = set(recommended)
    missing = sorted(recommended_set - declared_set)
    extra = sorted(declared_set - recommended_set)

    if missing and extra:
        status = "DRIFT"
    elif missing:
        status = "MISSING"
    elif extra:
        status = "EXTRA"
    else:
        status = "OK"

    return missing, extra, status


def audit(base: Path) -> List[Dict]:
    """Run full audit; return list of result dicts."""
    files = find_agent_files(base)
    results = []

    for path in sorted(files):
        name, declared = parse_agent(path)
        if name is None:
            continue

        if name not in RECOMMENDATIONS:
            # Agent not in audit table — not our concern; skip silently.
            continue

        recommended = RECOMMENDATIONS[name]
        missing, extra, status = compute_status(declared, recommended)

        results.append(
            {
                "agent_name": name,
                "declared_skills": ",".join(sorted(declared)) if declared else "",
                "recommended_skills": ",".join(recommended),
                "missing": ",".join(missing),
                "extra": ",".join(extra),
                "status": status,
                "_path": str(path),
            }
        )

    # Report agents in RECOMMENDATIONS but not found in any file
    found_names = {r["agent_name"] for r in results}
    for name in RECOMMENDATIONS:
        if name not in found_names:
            results.append(
                {
                    "agent_name": name,
                    "declared_skills": "",
                    "recommended_skills": ",".join(RECOMMENDATIONS[name]),
                    "missing": ",".join(RECOMMENDATIONS[name]),
                    "extra": "",
                    "status": "MISSING" if RECOMMENDATIONS[name] else "OK",
                    "_path": "(file not found)",
                }
            )

    return sorted(results, key=lambda r: r["agent_name"])


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

_CSV_FIELDS = [
    "agent_name",
    "declared_skills",
    "recommended_skills",
    "missing",
    "extra",
    "status",
]


def output_csv(results: List[Dict]) -> None:
    writer = csv.DictWriter(
        sys.stdout, fieldnames=_CSV_FIELDS, extrasaction="ignore", lineterminator="\n"
    )
    writer.writeheader()
    writer.writerows(results)


def output_json(results: List[Dict]) -> None:
    public = [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]
    print(json.dumps(public, indent=2))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    args = sys.argv[1:]

    if "--apply" in args:
        print(
            "apply mode not implemented; edit agent files manually.\n"
            "Use audit output to identify drift, then edit the relevant\n"
            ".claude/agents/**/<agent>.md frontmatter `skills:` blocks.\n"
            "Re-run this script after edits to confirm status is OK."
        )
        return 0

    use_json = "--json" in args
    strict = "--strict" in args

    # Resolve repo root: two levels up from this script's location
    # (.claude/skills/dev-execution/scripts/audit-agent-skills.py)
    script_path = Path(__file__).resolve()
    base = script_path.parents[4]  # repo root

    results = audit(base)

    if use_json:
        output_json(results)
    else:
        output_csv(results)

    if strict:
        non_ok = [r for r in results if r["status"] != "OK"]
        if non_ok:
            names = ", ".join(r["agent_name"] for r in non_ok)
            print(
                f"\n[STRICT] {len(non_ok)} agent(s) with drift: {names}",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
