#!/usr/bin/env bash
# =============================================================================
# finding-sweep.sh — Close-Time Finding Reconciliation Backstop
# =============================================================================
#
# PURPOSE:
#   Non-blocking hook that reconciles findings NAMED in a run's artifacts against
#   IntentTree nodes actually FILED for them, and reports the gap at phase/plan
#   close.
#
#   This is a BACKSTOP, not the mechanism. The mechanism is behavioral and lives
#   in `.claude/rules/finding-capture.md`: an agent that detects a deferral / bug
#   / gap files a node for it AT DETECTION TIME — ungated, straight into the
#   target tree, without asking. That is the only moment the agent still holds
#   the context that makes the node worth reading.
#
#   The sweep exists because behavioral defaults decay silently, and the decay is
#   invisible: a deferral with a file path and no node reads exactly like a
#   deferral that was properly tracked. An item surfacing HERE means the rule was
#   already missed — the sweep's value is making that visible rather than letting
#   it disappear with the session.
#
#     detect  ->  file the node          (the rule — in-session, ungated)
#     close   ->  finding-sweep.sh       (this hook — did we actually?)
#
#   Two failure modes, both checked:
#     1. OMISSION    — the entry names no node at all (the original loophole).
#     2. FABRICATION — the entry names an id that does not exist. Observed for
#                      real while building this hook: a node id was written into
#                      a rules file from memory before the node existed. This is
#                      worse than omission, because it reads as satisfied.
#
#   DETERMINISTIC — no model call (AOS constraint 4). The omission pass is pure
#   text reconciliation and needs no network; only id verification touches the
#   server, and it degrades to a note when unreachable.
#
# TRIGGER REGISTRATION:
#   Phase close (modes/phase-execution.md §5.2c) and plan close
#   (modes/plan-execution.md §9):
#     FINDING_SWEEP_FINDINGS_DOC="${findings_doc}" \
#       FINDING_SWEEP_PLAN_FILE="${plan_file}" \
#       .claude/skills/dev-execution/hooks/finding-sweep.sh
#
#   Either variable alone is enough; both is better. FEATURE_SLUG alone also
#   works — the findings doc path is conventional.
#
# ENVIRONMENT:
#   AOS_FINDING_SWEEP          — ON BY DEFAULT. Only an explicit falsy value
#                                ("0"/"false"/"no"/"off") disables.
#   FINDING_SWEEP_FINDINGS_DOC — findings doc to sweep. Default, when unset:
#                                .claude/findings/${FEATURE_SLUG}-findings.md
#   FINDING_SWEEP_PLAN_FILE    — plan file whose DOC-006 deferred-items triage
#                                table gets swept.
#   FEATURE_SLUG               — used to infer the findings doc path.
#   FINDING_SWEEP_NO_VERIFY    — "1" -> skip the node-existence check (offline,
#                                or when the omission pass is all you want).
#   FINDING_SWEEP_JSON         — "1" -> machine-readable output.
#   FINDING_SWEEP_PYTHON       — python interpreter (default: python3).
#   FINDING_SWEEP_ITT          — itt binary used for id verification (default:
#                                itt). Exists so the suite can exercise the
#                                CLI-absent branch without mutating PATH.
#
# BINDING GATE:
#   A true no-op — exit 0, zero output, zero work — unless at least one artifact
#   to sweep actually EXISTS on disk. This is what makes default-on safe: a repo
#   with no findings doc and no plan file never hears from this hook. Mirrors
#   sdlc-sync.sh's binding guard and seed-dossier.sh's manifest guard.
#
# EXIT CONTRACT:
#   ALWAYS exits 0. Every failure mode (missing python, engine crash, server
#   unreachable, malformed artifact) is logged to stderr with a [finding-sweep]
#   prefix and swallowed. Reporting an unfiled finding is INFORMATION, not a
#   gate: this hook never fails a task, phase, plan, or merge. There is
#   deliberately no strict mode — a hook that can block on bookkeeping is a hook
#   that gets disabled, and a disabled sweep catches nothing.
#
# SPEC REFERENCE:
#   .claude/rules/finding-capture.md (the rule this backstops)
#   .claude/skills/planning/references/deferred-items-and-findings.md (§2 Step 0)
#   Tracker: node_01KZ44HGEBGN3V4A823472CACP
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_FINDING_SWEEP:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HOOK_DIR}/finding_sweep.py"
PYTHON="${FINDING_SWEEP_PYTHON:-python3}"

# ---------------------------------------------------------------------------
# Resolve the artifacts to sweep. The findings-doc path is conventional
# (planning skill §2 Step 1), so FEATURE_SLUG alone is a sufficient binding.
# ---------------------------------------------------------------------------
FINDINGS_DOC="${FINDING_SWEEP_FINDINGS_DOC:-}"
if [ -z "${FINDINGS_DOC}" ] && [ -n "${FEATURE_SLUG:-}" ]; then
    FINDINGS_DOC=".claude/findings/${FEATURE_SLUG}-findings.md"
fi
PLAN_FILE="${FINDING_SWEEP_PLAN_FILE:-}"

# ---------------------------------------------------------------------------
# Guard: binding must exist. Default-on is a no-op unless there is at least one
# real artifact to reconcile. Keeps default-on silent in repos that carry no
# findings doc and no plan — the same discipline as sdlc-sync.sh:624-632.
# ---------------------------------------------------------------------------
ARGS=()
[ -n "${FINDINGS_DOC}" ] && [ -f "${FINDINGS_DOC}" ] && ARGS+=(--findings-doc "${FINDINGS_DOC}")
[ -n "${PLAN_FILE}" ] && [ -f "${PLAN_FILE}" ] && ARGS+=(--plan-file "${PLAN_FILE}")
if [ ${#ARGS[@]} -eq 0 ]; then
    exit 0
fi

[ "${FINDING_SWEEP_NO_VERIFY:-0}" = "1" ] && ARGS+=(--no-verify)
[ "${FINDING_SWEEP_JSON:-0}" = "1" ] && ARGS+=(--json)

# ---------------------------------------------------------------------------
# Engine must exist and python must run — both are warnings, never failures.
# ---------------------------------------------------------------------------
if [ ! -r "${ENGINE}" ]; then
    echo "[finding-sweep] engine not found at ${ENGINE} — skipping (non-fatal)" >&2
    exit 0
fi
if ! command -v "${PYTHON}" >/dev/null 2>&1; then
    echo "[finding-sweep] ${PYTHON} not found — skipping (non-fatal)" >&2
    exit 0
fi

"${PYTHON}" "${ENGINE}" "${ARGS[@]}" || {
    echo "[finding-sweep] sweep failed — non-fatal, continuing" >&2
}

# Always exit 0 — this hook reports, it never blocks the calling workflow.
exit 0
