#!/usr/bin/env bash
# =============================================================================
# seed-dossier.sh — Plan-Time Delivery-Dossier Seed Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking hook that CREATES a feature's living `delivery-report` dossier
#   manifest at PLAN time, from the implementation plan itself. This is the
#   missing first link in the dossier lifecycle (spec Sec A.1 step 1): without
#   it, the phase-boundary regeneration hook (update-dossier.sh) stays dormant
#   forever, because its binding guard is "a manifest exists".
#
#     plan  ->  seed-dossier.sh   (this hook — creates the manifest)
#     phase ->  update-dossier.sh (renders + validates the accreting manifest)
#
#   The seed is DETERMINISTIC — no model call (AOS constraint 4). Stages come
#   from the plan's wave_plan.phases[] / phase headings; open questions and
#   decisions from the plan's frontmatter. The real work is in the co-located
#   engine `seed_dossier.py`; this wrapper owns the master-switch + binding
#   guard + tier gate + non-fatal contract, mirroring sdlc-sync.sh and
#   provision-artifacts.sh.
#
#   This hook NEVER authors narrative and NEVER gates planning. The dossier is
#   recommended / non-blocking; the enforced end-of-feature artifact remains the
#   `feature` route DoD report (verify-delivery-report.sh).
#
# TRIGGER REGISTRATION:
#   Called from the planning skill at the end of Workflow 2 (implementation plan
#   written) and from /plan:plan-feature for Tier 2/3:
#     DOSSIER_PLAN_FILE="docs/project_plans/implementation_plans/foo-v1.md" \
#       .claude/skills/dev-execution/hooks/seed-dossier.sh
#   Tier 0/1 (or any explicit request) opts in:
#     DOSSIER_PLAN_FILE="<plan.md>" DOSSIER_SEED_FORCE=1 \
#       .claude/skills/dev-execution/hooks/seed-dossier.sh
#
# ENVIRONMENT:
#   AOS_DELIVERY_DOSSIER   — ON BY DEFAULT. Only an explicit falsy value
#                            ("0"/"false"/"no"/"off") disables. Same master
#                            switch as update-dossier.sh: one env var governs the
#                            whole dossier lifecycle.
#   DOSSIER_PLAN_FILE      — the implementation plan to seed from. Its EXISTENCE
#                            is the "binding exists" signal: unset or absent ->
#                            silent no-op (exit 0, zero work).
#   DOSSIER_SEED_FORCE     — "1" -> ignore the Tier 2/3 gate (OD-4: Tier 0/1 seed
#                            on explicit request only).
#   DOSSIER_SEED_RESEED    — "1" -> re-seed OVER an existing manifest. Off by
#                            default: the dossier is an accreting record and a
#                            re-seed discards phase narratives authored so far.
#   DELIVERY_DOSSIER_MANIFEST — explicit manifest path. Default:
#                            .claude/reports/dossier/<feature_slug>/report.json
#   DOSSIER_SEED_MIN_TIER  — override the auto-seed tier floor (default 2).
#   DELIVERY_REPORT_SKILL_DIR / DELIVERY_REPORT_PYTHON — passed through.
#
# EXIT CONTRACT:
#   ALWAYS exits 0. Every failure mode (missing plan, missing CLI, below tier,
#   already seeded, engine crash) is logged to stderr with a [seed-dossier]
#   prefix and swallowed. A seeding failure never fails a planning pass.
#
# SPEC REFERENCE:
#   docs/skill-development/delivery-dossier/spec.md (Sec A.1 lifecycle, Sec A.6)
#   Env-resolution sibling contract: .claude/rules/intenttree-integration.md
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_DELIVERY_DOSSIER:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Guard: binding must exist. The plan file IS the binding at seed time.
# ---------------------------------------------------------------------------
PLAN="${DOSSIER_PLAN_FILE:-}"
if [ -z "${PLAN}" ] || [ ! -f "${PLAN}" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the engine (co-located) and a Python interpreter.
# ---------------------------------------------------------------------------
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HOOK_DIR}/seed_dossier.py"
if [ ! -f "${ENGINE}" ]; then
    echo "[seed-dossier] seed_dossier.py not found beside the hook — skipping (non-fatal)" >&2
    exit 0
fi

PY="${DELIVERY_REPORT_PYTHON:-}"
if [ -z "${PY}" ] || ! command -v "${PY}" >/dev/null 2>&1; then
    if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"; else PY="python3"; fi
fi

# ---------------------------------------------------------------------------
# Build the engine invocation.
# ---------------------------------------------------------------------------
ARGS=(--plan "${PLAN}" --json)
[ -n "${DELIVERY_DOSSIER_MANIFEST:-}" ] && ARGS+=(--out "${DELIVERY_DOSSIER_MANIFEST}")
if [ "${DOSSIER_SEED_FORCE:-0}" = "1" ]; then
    ARGS+=(--min-tier 0)
else
    ARGS+=(--min-tier "${DOSSIER_SEED_MIN_TIER:-2}")
fi
[ "${DOSSIER_SEED_RESEED:-0}" = "1" ] && ARGS+=(--force)

RESULT="$("${PY}" "${ENGINE}" "${ARGS[@]}" 2>&1)"
STATUS=$?

MANIFEST="$(printf '%s' "${RESULT}" | sed -n 's/.*"manifest": "\([^"]*\)".*/\1/p' | head -1)"

case "${STATUS}" in
    0)
        echo "[seed-dossier] $(printf '%s' "${RESULT}" | sed -n 's/.*"message": "\([^"]*\)".*/\1/p' | head -1)" >&2
        ;;
    3)
        echo "[seed-dossier] dossier already seeded — leaving the accreting record untouched" >&2
        exit 0
        ;;
    4)
        # Below the Tier 2/3 auto-seed floor (OD-4). Silent: this is the common,
        # correct outcome for a Tier 0/1 feature, not a problem to report.
        exit 0
        ;;
    *)
        echo "[seed-dossier] seed failed (non-fatal): ${RESULT}" >&2
        exit 0
        ;;
esac

# ---------------------------------------------------------------------------
# Render + validate the fresh manifest by chaining the SAME path the phase
# boundary uses — one renderer, one validator, no duplicated invocation.
# ---------------------------------------------------------------------------
if [ -n "${MANIFEST}" ] && [ -f "${HOOK_DIR}/update-dossier.sh" ]; then
    DELIVERY_DOSSIER_MANIFEST="${MANIFEST}" "${HOOK_DIR}/update-dossier.sh" || true
fi

exit 0
