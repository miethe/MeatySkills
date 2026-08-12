#!/usr/bin/env bash
# =============================================================================
# validation-scope.sh — Reviewer-Gate Symbol-Scoped Test-Scope Resolver
# =============================================================================
#
# PURPOSE:
#   Compute the SYMBOL-scoped (not diff-scoped) set of test files the reviewer
#   gate must run/inspect before approving a change — the mechanism the gate
#   lacked when it approved skillmeat PR #299 over a stale test file that was
#   never touched by the diff but exercised the changed symbol
#   (`_dto_to_response()`) directly. See
#   docs/project_plans/reviewer-gate-validation-scope-hardening-v1.md §3.1.
#
#   The real work is in the co-located engine `validation_scope.py`; this
#   wrapper owns the master switch + binding guard + non-fatal contract,
#   exactly mirroring mode-d-scan.sh / provision-artifacts.sh.
#
# TRIGGER REGISTRATION:
#   Run by the caller (phase-owner / executor / execute-plan's validate stage)
#   before dispatching the reviewer gate, result threaded in as
#   args.validation_evidence:
#     VALIDATION_SCOPE_REPO="." VALIDATION_SCOPE_BASE_REF="${BASE_SHA}" \
#       .claude/skills/dev-execution/hooks/validation-scope.sh
#   Over an already-materialized base/head tree pair (e.g. the AC-4 fixture, or
#   a caller that already checked out both sides itself):
#     VALIDATION_SCOPE_BASE_DIR="base/" VALIDATION_SCOPE_HEAD_DIR="head/" \
#       .claude/skills/dev-execution/hooks/validation-scope.sh
#
# ENVIRONMENT:
#   AOS_VALIDATION_SCOPE     — ON BY DEFAULT. Only an explicit falsy value
#                              (0/false/no/off) disables. Mirrors AOS_MODE_D_SCAN.
#   VALIDATION_SCOPE_BASE_DIR — base tree directory (fixture / pre-checked-out mode).
#   VALIDATION_SCOPE_HEAD_DIR — head tree directory. Default: VALIDATION_SCOPE_REPO.
#   VALIDATION_SCOPE_BASE_REF — git ref to materialize as the base tree (real-repo mode).
#   VALIDATION_SCOPE_REPO     — repo root, used with BASE_REF. Default: cwd (".").
#   VALIDATION_SCOPE_WORKDIR  — where BASE_REF worktrees are materialized.
#                              Default: .claude/worktrees.
#   VALIDATION_SCOPE_MAX_FANOUT     — override MAX_FANOUT_PER_SYMBOL (default 40).
#   VALIDATION_SCOPE_MAX_TEST_FILES — override MAX_TEST_FILES (default 25).
#   VALIDATION_SCOPE_MAX_SECONDS    — override MAX_SCOPE_SECONDS (default 900).
#   VALIDATION_SCOPE_JSON     — "1" → emit the structured contract to stdout.
#
# SUBCOMMANDS (engine-level; this wrapper only drives `resolve` today):
#   resolve — AC-1: compute the symbol-scoped test scope. Implemented.
#   measure — AC-2: base/head pytest delta per file. Phase 2, NOT YET WIRED —
#             adding it here is additive (a new VALIDATION_SCOPE_MEASURE=1
#             branch calling `validation_scope.py measure`), never a rewrite
#             of the branch below.
#
# EXIT CONTRACT (mirrors mode-d-scan.sh's non-fatal discipline):
#   * No binding (neither BASE_DIR nor BASE_REF given) → silent no-op, exit 0.
#   * Engine crash / missing python3 / bad ref (infra) → logged and swallowed,
#     exit 0. A resolver-infra failure never blocks a run.
#   * Engine usage error (rc=1) → swallowed, exit 0 (same infra treatment).
#   * This phase defines no correctness hard-gate of its own (that lands with
#     the enforcement seam in reviewer-gate.js, §3.3/§4) — a clean engine run
#     (rc=0) always exits 0 here, scope truncation/budget-exhaustion are
#     disclosed IN the JSON, not via exit code.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_VALIDATION_SCOPE:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HERE}/validation_scope.py"

# ---------------------------------------------------------------------------
# Guard: binding must exist. Nothing to resolve against → no-op. This is what
# keeps default-on silent in runs that never asked for scope resolution.
# ---------------------------------------------------------------------------
if [ -z "${VALIDATION_SCOPE_BASE_DIR:-}" ] && [ -z "${VALIDATION_SCOPE_BASE_REF:-}" ]; then
    exit 0
fi

if [ ! -f "${ENGINE}" ]; then
    echo "[validation-scope] engine not found: ${ENGINE} — skipping (non-fatal)" >&2
    exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "[validation-scope] python3 not found — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Build engine args. Exactly one tree source; BASE_DIR > BASE_REF.
# ---------------------------------------------------------------------------
ARGS=("${ENGINE}" "resolve")
if [ -n "${VALIDATION_SCOPE_BASE_DIR:-}" ]; then
    ARGS+=("--base-dir" "${VALIDATION_SCOPE_BASE_DIR}")
else
    ARGS+=("--base-ref" "${VALIDATION_SCOPE_BASE_REF}" --repo "${VALIDATION_SCOPE_REPO:-.}")
fi

[ -n "${VALIDATION_SCOPE_HEAD_DIR:-}" ] && ARGS+=("--head-dir" "${VALIDATION_SCOPE_HEAD_DIR}")
[ -n "${VALIDATION_SCOPE_WORKDIR:-}" ] && ARGS+=("--workdir" "${VALIDATION_SCOPE_WORKDIR}")
[ -n "${VALIDATION_SCOPE_MAX_FANOUT:-}" ] && ARGS+=("--max-fanout" "${VALIDATION_SCOPE_MAX_FANOUT}")
[ -n "${VALIDATION_SCOPE_MAX_TEST_FILES:-}" ] && ARGS+=("--max-test-files" "${VALIDATION_SCOPE_MAX_TEST_FILES}")
[ -n "${VALIDATION_SCOPE_MAX_SECONDS:-}" ] && ARGS+=("--max-seconds" "${VALIDATION_SCOPE_MAX_SECONDS}")
[ "${VALIDATION_SCOPE_JSON:-0}" = "1" ] && ARGS+=("--json")

# ---------------------------------------------------------------------------
# Run the engine. This phase has no correctness hard-gate of its own — any
# nonzero engine exit is treated as infra and swallowed. (Contrast
# mode-d-scan.sh, whose rc=2 is a real correctness gate; this resolver only
# computes and discloses, it does not yet enforce — enforcement is §3.3/§4's
# job in reviewer-gate.js.)
# ---------------------------------------------------------------------------
set +e
python3 "${ARGS[@]}"
rc=$?
set -e

if [ "${rc}" -ne 0 ]; then
    echo "[validation-scope] engine exited nonzero (rc=${rc}) — non-fatal, continuing" >&2
fi
exit 0
