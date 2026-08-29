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
#   args.validation_evidence. The FLAG FORM is the primary invocation — it is
#   what reviewer-gate.js, execute-plan.js and execute-contract.js all use:
#     .claude/skills/dev-execution/hooks/validation-scope.sh --json --base-ref "${BASE_SHA}"
#   Over an already-materialized base/head tree pair (e.g. the AC-4 fixture, or
#   a caller that already checked out both sides itself):
#     .claude/skills/dev-execution/hooks/validation-scope.sh --json \
#       --base-dir base/ --head-dir head/
#
#   The VALIDATION_SCOPE_* environment form remains a fully-supported alias for
#   every flag (ambient configuration, e.g. a wrapper script exporting a repo
#   default). Both forms may be mixed; see PRECEDENCE below.
#     VALIDATION_SCOPE_REPO="." VALIDATION_SCOPE_BASE_REF="${BASE_SHA}" \
#       .claude/skills/dev-execution/hooks/validation-scope.sh
#
# ARGV (primary form; each flag accepts `--flag value` or `--flag=value`):
#   --json                 — boolean; emit the structured contract to stdout.
#   --base-ref REF         — git ref to materialize as the base tree.
#   --base-dir DIR         — base tree directory (fixture / pre-checked-out mode).
#   --head-dir DIR         — head tree directory.
#   --repo DIR             — repo root, used with --base-ref.
#   --workdir DIR          — where --base-ref worktrees are materialized.
#   --max-fanout N         — override MAX_FANOUT_PER_SYMBOL.
#   --max-test-files N     — override MAX_TEST_FILES.
#   --max-seconds N        — override MAX_SCOPE_SECONDS.
#   Unknown flags and positional junk are WARNED about on stderr and otherwise
#   ignored — argv parsing never turns a resolver run into a hard failure.
#
# PRECEDENCE:
#   An explicitly-passed flag ALWAYS WINS over the corresponding
#   VALIDATION_SCOPE_* env var (an explicit call site beats ambient config).
#   A flag that is not passed falls back to its env var, so an env-only
#   invocation behaves exactly as it did before argv support existed.
#   The binding guard is satisfied by a binding from EITHER source, and
#   BASE_DIR still outranks BASE_REF when both resolve to a value.
#
# ENVIRONMENT:
#   AOS_VALIDATION_SCOPE     — ON BY DEFAULT. Only an explicit falsy value
#                              (0/false/no/off) disables. Mirrors AOS_MODE_D_SCAN.
#   VALIDATION_SCOPE_BASE_DIR — base tree directory (fixture / pre-checked-out mode).
#   VALIDATION_SCOPE_HEAD_DIR — head tree directory. Default: VALIDATION_SCOPE_REPO.
#   VALIDATION_SCOPE_BASE_REF — git ref to materialize as the base tree (real-repo mode).
#   VALIDATION_SCOPE_REPO     — repo root, used with BASE_REF. Default: cwd (".").
#   VALIDATION_SCOPE_WORKDIR  — where BASE_REF worktrees are materialized.
#                              Default: <git-common-dir>/aos-validation-scope
#                              (the engine resolves this via
#                              `git rev-parse --git-common-dir`, which is
#                              ANCHORED OUTSIDE any linked worktree -- so a
#                              gate run from inside .claude/worktrees/<name>,
#                              the default lane for execute-plan/autopilot/
#                              execute-contract, never nests the base
#                              checkout inside the head tree being diffed).
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
#   * No binding (neither BASE_DIR nor BASE_REF given, from EITHER source) and
#     NO argv at all → silent no-op, exit 0. That silence is deliberate: the
#     resolver is default-on, so unrelated runs must stay quiet.
#   * No binding but the caller DID pass argv (or passed an unknown/valueless
#     flag) → a `[validation-scope]` line on stderr naming what was
#     discarded/missing, then exit 0. A no-op is never invisible to a caller
#     that actually asked for a measurement.
#   * A binding present → the engine always runs and always says something;
#     empty engine stdout is itself reported on stderr.
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
# Parse argv FIRST — before the binding guard, so a flag-form binding satisfies
# it. Each value flag accepts `--flag value` and `--flag=value`. Nothing here
# can fail the run: unknown flags and missing values are recorded as warnings
# and execution continues (see the non-fatal contract in the header).
# ---------------------------------------------------------------------------
ARGV_COUNT=$#
ARGV_WARNINGS=()
ARG_JSON=""
ARG_BASE_DIR=""
ARG_BASE_REF=""
ARG_HEAD_DIR=""
ARG_REPO=""
ARG_WORKDIR=""
ARG_MAX_FANOUT=""
ARG_MAX_TEST_FILES=""
ARG_MAX_SECONDS=""

# Every value flag resolves through the same three shapes, so the loop body
# below computes `_VAL` (the value, empty when there was none to take) and
# `_CONSUMED` (whether the NEXT argv entry was eaten) once, in-place — never in
# a command substitution, which would discard the warnings and the shift count.
while [ "$#" -gt 0 ]; do
    raw="$1"
    flag="${raw%%=*}"
    if [ "${raw}" != "${flag}" ]; then
        had_inline=1
        inline="${raw#*=}"
    else
        had_inline=0
        inline=""
    fi
    shift

    _VAL=""
    _CONSUMED=0
    case "${flag}" in
        --base-dir | --base-ref | --head-dir | --repo | --workdir | --max-fanout | --max-test-files | --max-seconds)
            if [ "${had_inline}" = "1" ]; then
                _VAL="${inline}"
                [ -n "${_VAL}" ] || ARGV_WARNINGS+=("${flag} given an empty value — ignored")
            elif [ "$#" -eq 0 ]; then
                ARGV_WARNINGS+=("${flag} passed with no value — ignored")
            else
                case "$1" in
                    --*) ARGV_WARNINGS+=("${flag} passed with no value — ignored") ;;
                    *)
                        _VAL="$1"
                        _CONSUMED=1
                        ;;
                esac
            fi
            ;;
    esac

    case "${flag}" in
        --json)
            ARG_JSON=1
            [ "${had_inline}" = "0" ] || ARGV_WARNINGS+=("--json takes no value; ignoring '=${inline}'")
            ;;
        --base-dir) [ -z "${_VAL}" ] || ARG_BASE_DIR="${_VAL}" ;;
        --base-ref) [ -z "${_VAL}" ] || ARG_BASE_REF="${_VAL}" ;;
        --head-dir) [ -z "${_VAL}" ] || ARG_HEAD_DIR="${_VAL}" ;;
        --repo) [ -z "${_VAL}" ] || ARG_REPO="${_VAL}" ;;
        --workdir) [ -z "${_VAL}" ] || ARG_WORKDIR="${_VAL}" ;;
        --max-fanout) [ -z "${_VAL}" ] || ARG_MAX_FANOUT="${_VAL}" ;;
        --max-test-files) [ -z "${_VAL}" ] || ARG_MAX_TEST_FILES="${_VAL}" ;;
        --max-seconds) [ -z "${_VAL}" ] || ARG_MAX_SECONDS="${_VAL}" ;;
        *) ARGV_WARNINGS+=("unknown argument ${raw} — ignored (non-fatal)") ;;
    esac

    [ "${_CONSUMED}" = "0" ] || shift
done

if [ "${#ARGV_WARNINGS[@]}" -gt 0 ]; then
    for w in "${ARGV_WARNINGS[@]}"; do
        echo "[validation-scope] ${w}" >&2
    done
fi

# ---------------------------------------------------------------------------
# Resolve effective settings: an explicit flag WINS over the env alias.
# ---------------------------------------------------------------------------
BASE_DIR="${ARG_BASE_DIR:-${VALIDATION_SCOPE_BASE_DIR:-}}"
BASE_REF="${ARG_BASE_REF:-${VALIDATION_SCOPE_BASE_REF:-}}"
HEAD_DIR="${ARG_HEAD_DIR:-${VALIDATION_SCOPE_HEAD_DIR:-}}"
REPO="${ARG_REPO:-${VALIDATION_SCOPE_REPO:-.}}"
WORKDIR="${ARG_WORKDIR:-${VALIDATION_SCOPE_WORKDIR:-}}"
MAX_FANOUT="${ARG_MAX_FANOUT:-${VALIDATION_SCOPE_MAX_FANOUT:-}}"
MAX_TEST_FILES="${ARG_MAX_TEST_FILES:-${VALIDATION_SCOPE_MAX_TEST_FILES:-}}"
MAX_SECONDS="${ARG_MAX_SECONDS:-${VALIDATION_SCOPE_MAX_SECONDS:-}}"
if [ -n "${ARG_JSON}" ] || [ "${VALIDATION_SCOPE_JSON:-0}" = "1" ]; then
    WANT_JSON=1
else
    WANT_JSON=0
fi

# ---------------------------------------------------------------------------
# Guard: binding must exist. Nothing to resolve against → no-op. This is what
# keeps default-on silent in runs that never asked for scope resolution — but
# a caller that DID pass argv gets told, on stderr, that its request was a
# no-op. A silent no-op on an explicit invocation is the defect this guards.
# ---------------------------------------------------------------------------
if [ -z "${BASE_DIR}" ] && [ -z "${BASE_REF}" ]; then
    if [ "${ARGV_COUNT}" -gt 0 ]; then
        echo "[validation-scope] no base binding resolved (need --base-dir or --base-ref, or the" \
            "VALIDATION_SCOPE_BASE_DIR / VALIDATION_SCOPE_BASE_REF env alias);" \
            "${ARGV_COUNT} argument(s) were supplied but produced no measurement — skipping (non-fatal)" >&2
    fi
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
if [ -n "${BASE_DIR}" ]; then
    ARGS+=("--base-dir" "${BASE_DIR}")
else
    ARGS+=("--base-ref" "${BASE_REF}" --repo "${REPO}")
fi

[ -n "${HEAD_DIR}" ] && ARGS+=("--head-dir" "${HEAD_DIR}")
[ -n "${WORKDIR}" ] && ARGS+=("--workdir" "${WORKDIR}")
[ -n "${MAX_FANOUT}" ] && ARGS+=("--max-fanout" "${MAX_FANOUT}")
[ -n "${MAX_TEST_FILES}" ] && ARGS+=("--max-test-files" "${MAX_TEST_FILES}")
[ -n "${MAX_SECONDS}" ] && ARGS+=("--max-seconds" "${MAX_SECONDS}")
[ "${WANT_JSON}" = "1" ] && ARGS+=("--json")

# ---------------------------------------------------------------------------
# Run the engine. This phase has no correctness hard-gate of its own — any
# nonzero engine exit is treated as infra and swallowed. (Contrast
# mode-d-scan.sh, whose rc=2 is a real correctness gate; this resolver only
# computes and discloses, it does not yet enforce — enforcement is §3.3/§4's
# job in reviewer-gate.js.)
# ---------------------------------------------------------------------------
ENGINE_OUT="$(mktemp -t validation-scope-out.XXXXXX)"
trap 'rm -f "${ENGINE_OUT}"' EXIT

set +e
python3 "${ARGS[@]}" >"${ENGINE_OUT}"
rc=$?
set -e

cat "${ENGINE_OUT}"

if [ "${rc}" -ne 0 ]; then
    echo "[validation-scope] engine exited nonzero (rc=${rc}) — non-fatal, continuing" >&2
elif [ ! -s "${ENGINE_OUT}" ]; then
    # A binding WAS bound, so this run was an explicit request for a
    # measurement. Producing nothing is never allowed to look like success.
    echo "[validation-scope] engine produced NO output despite a base binding" \
        "(base-dir='${BASE_DIR}' base-ref='${BASE_REF}' json=${WANT_JSON}) — non-fatal, continuing" >&2
fi
exit 0
