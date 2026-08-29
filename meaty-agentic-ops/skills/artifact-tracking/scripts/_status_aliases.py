#!/usr/bin/env python3
"""Shared status vocabulary for the artifact-tracking plan-status tools.

Single source of truth for:

- ``NODE_STATUSES`` — the ratified 15-value IntentTree ``NodeStatus`` enum
  (``docs/agentic-operator/contracts/frontmatter-schema.md`` §4, OQ-2). This is the
  cross-app canonical ``status`` value space; the launchpad does NOT invent its own enum.
- ``STATUS_ALIASES`` — the ratified + claude-decided alias map: legacy / CCDash / synonym
  spellings → their canonical ``NodeStatus`` (and, where the spelling also implies a planning
  lifecycle, a ``planning_maturity`` to add *only when absent*).
- ``HAND_REVIEW_VALUES`` — spellings that MUST NEVER be auto-mapped (ambiguous placeholders /
  reconcile artifacts). Functionally, hand-review = any value that is neither a ``NodeStatus``
  nor an alias; these three are listed explicitly so tooling can name them distinctly.

Both ``validate-plan-frontmatter.py`` (the linter) and ``manage-plan-status.py`` import this
module rather than duplicating the vocabulary. Edit the maps HERE — they are the config.

Stdlib-only, Python 3.10+ floor (must import on the node's 3.11 — no 3.12-only syntax).
"""

from __future__ import annotations

# --------------------------------------------------------------------------------------------
# Canonical enum — the ratified 15-value IntentTree NodeStatus (frontmatter-schema.md §4).
# Order mirrors the contract; membership is what matters.
# --------------------------------------------------------------------------------------------
NODE_STATUSES: frozenset[str] = frozenset(
    {
        "not_started",
        "ready",
        "in_progress",
        "blocked",
        "waiting_review",
        "completed",
        "deferred",
        "archived",
        "inbox",
        "backlog",
        "side_quest",
        "active",
        "running",
        "waiting_human",
        "reviewing",
    }
)

# --------------------------------------------------------------------------------------------
# ALIAS MAP (config — trivially editable). Each entry maps a non-canonical spelling to its
# canonical NodeStatus, plus an OPTIONAL ``planning_maturity`` that is added ONLY when the file
# lacks one (additive; never overwrites a present value).
#
# Ruling source: the "Shipped Work Ledger" M1 OQ-1 resolution (ratified + claude-decided).
#   done-synonyms                              -> completed (+ planning_maturity: shipped if absent)
#   implementation_complete_pending_human_gate -> waiting_human   (NOT completed)
#   in-progress                                -> in_progress
#   pending                                    -> not_started      (CCDash up-map, schema §4)
#   review                                     -> waiting_review   (CCDash up-map, schema §4)
#   draft / planning                           -> not_started (+ planning_maturity: draft)
#   proposed                                   -> not_started (+ planning_maturity: proposed)
#   accepted                                   -> ready       (+ planning_maturity: accepted)
#
# Keys are compared after normalization (strip surrounding whitespace/quotes, lowercase), so
# "completed   ", '"draft"', and "Draft" all resolve. A value already in NODE_STATUSES is NOT
# an alias and is left untouched (no planning_maturity is ever added to it).
# --------------------------------------------------------------------------------------------
STATUS_ALIASES: dict[str, dict[str, str]] = {
    # done-synonyms → completed (+ planning_maturity: shipped when absent)
    "complete": {"status": "completed", "planning_maturity": "shipped"},
    "finalized": {"status": "completed", "planning_maturity": "shipped"},
    "concluded": {"status": "completed", "planning_maturity": "shipped"},
    "shipped": {"status": "completed", "planning_maturity": "shipped"},
    "graduated": {"status": "completed", "planning_maturity": "shipped"},
    # human-gate — explicitly NOT completed
    "implementation_complete_pending_human_gate": {"status": "waiting_human"},
    # spelling normalization
    "in-progress": {"status": "in_progress"},
    # CCDash → NodeStatus up-map (schema §4)
    "pending": {"status": "not_started"},
    "review": {"status": "waiting_review"},
    # maturity-carrying planning states (no NodeStatus equivalent — split status/maturity)
    "draft": {"status": "not_started", "planning_maturity": "draft"},
    "planning": {"status": "not_started", "planning_maturity": "draft"},
    "proposed": {"status": "not_started", "planning_maturity": "proposed"},
    "accepted": {"status": "ready", "planning_maturity": "accepted"},
}

# --------------------------------------------------------------------------------------------
# HAND-REVIEW — spellings that MUST NEVER be auto-mapped. Listed explicitly so tools can name
# them distinctly ("known placeholder"), but note: ANY value that is neither a NodeStatus nor an
# alias is treated as hand-review by classify() below. These three are just the known ones.
# --------------------------------------------------------------------------------------------
HAND_REVIEW_VALUES: frozenset[str] = frozenset(
    {
        "reconciled-for-planning",
        "handoff-for-planning",
        "active | paused | blocked",  # the "active | paused | blocked" placeholder
    }
)

# Classification categories.
VALID = "valid"
ALIAS = "alias"
HAND_REVIEW = "hand_review"


def normalize_token(raw: str) -> str:
    """Normalize a raw status value for lookup: strip surrounding whitespace and quotes, lowercase.

    Does NOT strip YAML comments — callers that read a raw frontmatter *line* must split the
    comment off first (the linter does). This operates on a bare value token.
    """
    token = raw.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in ("'", '"'):
        token = token[1:-1].strip()
    return token.lower()


def classify(raw: str) -> str:
    """Return one of VALID / ALIAS / HAND_REVIEW for a raw status value."""
    token = normalize_token(raw)
    if token in NODE_STATUSES:
        return VALID
    if token in STATUS_ALIASES:
        return ALIAS
    return HAND_REVIEW


def resolve(raw: str) -> tuple[str | None, str | None, str]:
    """Resolve a raw status value.

    Returns ``(canonical_status, planning_maturity, category)``:
      - VALID       → (normalized_value, None, "valid")
      - ALIAS       → (target_status, planning_maturity_or_None, "alias")
      - HAND_REVIEW → (None, None, "hand_review")
    """
    token = normalize_token(raw)
    if token in NODE_STATUSES:
        return token, None, VALID
    spec = STATUS_ALIASES.get(token)
    if spec is not None:
        return spec["status"], spec.get("planning_maturity"), ALIAS
    return None, None, HAND_REVIEW


def is_acceptable(raw: str) -> bool:
    """True when the value is a valid NodeStatus OR a losslessly-resolvable alias.

    Hand-review / unknown values return False — these drive the linter's non-zero exit.
    """
    return classify(raw) != HAND_REVIEW
