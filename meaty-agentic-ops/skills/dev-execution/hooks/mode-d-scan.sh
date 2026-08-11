#!/usr/bin/env bash
# =============================================================================
# mode-d-scan.sh — Delegated-Leg Mode-D Output Guard
# =============================================================================
#
# PURPOSE:
#   Fail a delegated leg whose PRODUCED OUTPUT crossed the Mode-D boundary —
#   generated key material, touched an auth/migration/deletion path, or rewrote
#   history — rather than trusting the leg's own report that it did not.
#
#   The pre-dispatch guards (hasHighRiskPaths / fixCycleModeDGuard /
#   fixTaskModeDGuard in the workflow scripts) read DECLARATIONS: files_affected,
#   task_class, prompt text. They stay, and they are necessary. They are also
#   blind to a leg that invents crypto AFTER it has been routed — which is
#   exactly what happened on 2026-08-06 (node_01KZC1AHEDYZ8FS9TAZSXQTTSB): an
#   ica-executor leg briefed "must not generate any signing key … STOP and return
#   mode_d" instead minted one with secrets.token_bytes(32).
#
#   This hook asks the question a declaration cannot: what did the leg WRITE?
#
#   The real work is in the co-located engine `mode_d_scan.py`; this wrapper owns
#   the master switch + binding guard + non-fatal contract, exactly mirroring
#   provision-artifacts.sh. Rule: .claude/rules/mode-d-enforcement.md.
#
# TRIGGER REGISTRATION:
#   After any delegated/offloaded leg returns, before its output is merged or
#   trusted — and at phase/plan close as a backstop:
#     MODE_D_SCAN_PROVIDER=ica MODE_D_SCAN_RANGE="${BASE_SHA}..HEAD" \
#       .claude/skills/dev-execution/hooks/mode-d-scan.sh
#   Over quarantined output that was never committed:
#     MODE_D_SCAN_PROVIDER=ica MODE_D_SCAN_PATHS="$CLAUDE_JOB_DIR/tmp/quarantine" \
#       .claude/skills/dev-execution/hooks/mode-d-scan.sh
#
# ENVIRONMENT:
#   AOS_MODE_D_SCAN       — ON BY DEFAULT. Only an explicit falsy value
#                           (0/false/no/off) disables. Mirrors AOS_ARTIFACT_PROVISION.
#   MODE_D_SCAN_PROVIDER  — producing lane: ica|bob|gemini|codex|claude. Decides
#                           whether a finding is a GATE or an advisory. Unset →
#                           advisory (a finding is reported, never fatal).
#   MODE_D_SCAN_RANGE     — git rev range to scan, e.g. "${BASE_SHA}..HEAD".
#   MODE_D_SCAN_DIFF      — path to a unified diff ("-" for stdin).
#   MODE_D_SCAN_PATHS     — space-separated files/dirs to scan whole.
#   MODE_D_SCAN_REPO      — repo root for RANGE. Default: cwd (".").
#   MODE_D_SCAN_ALLOW     — space-separated SIG_ID=reason waivers. A waiver with no
#                           reason is rejected, never defaulted.
#   MODE_D_SCAN_JSON      — "1" → emit the structured contract to stdout.
#
# EXIT CONTRACT (mirrors provision-artifacts.sh, with ONE correctness exception):
#   * Engine exit 2 (Mode-D signature produced by an OFFLOAD lane) is a CORRECTNESS
#     gate → propagated nonzero so the orchestrator halts and the output is not merged.
#   * Any OTHER nonzero (engine crash, python missing, bad range, infra) is INFRA →
#     logged and swallowed → exit 0. Guard infra never blocks a run.
#   * No source (no RANGE / DIFF / PATHS) → silent no-op, exit 0.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_MODE_D_SCAN:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HERE}/mode_d_scan.py"

# ---------------------------------------------------------------------------
# Guard: binding must exist. Nothing to scan → no-op. This is what keeps
# default-on silent in runs that delegated nothing.
# ---------------------------------------------------------------------------
if [ -z "${MODE_D_SCAN_RANGE:-}" ] && [ -z "${MODE_D_SCAN_DIFF:-}" ] \
    && [ -z "${MODE_D_SCAN_PATHS:-}" ]; then
    exit 0
fi

if [ ! -f "${ENGINE}" ]; then
    echo "[mode-d-scan] engine not found: ${ENGINE} — skipping (non-fatal)" >&2
    exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
    echo "[mode-d-scan] python3 not found — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Build engine args. Exactly one source; RANGE > DIFF > PATHS.
# ---------------------------------------------------------------------------
ARGS=("${ENGINE}")
if [ -n "${MODE_D_SCAN_RANGE:-}" ]; then
    ARGS+=("--range" "${MODE_D_SCAN_RANGE}" "--repo" "${MODE_D_SCAN_REPO:-.}")
elif [ -n "${MODE_D_SCAN_DIFF:-}" ]; then
    ARGS+=("--diff" "${MODE_D_SCAN_DIFF}")
else
    # Intentionally word-split: MODE_D_SCAN_PATHS is a space-separated list.
    # shellcheck disable=SC2206
    read -r -a _paths <<<"${MODE_D_SCAN_PATHS}"
    ARGS+=("--paths" "${_paths[@]}")
fi

[ -n "${MODE_D_SCAN_PROVIDER:-}" ] && ARGS+=("--provider" "${MODE_D_SCAN_PROVIDER}")
[ "${MODE_D_SCAN_JSON:-0}" = "1" ] && ARGS+=("--json")

if [ -n "${MODE_D_SCAN_ALLOW:-}" ]; then
    read -r -a _allow <<<"${MODE_D_SCAN_ALLOW}"
    for w in "${_allow[@]}"; do ARGS+=("--allow" "${w}"); done
fi

# ---------------------------------------------------------------------------
# Run the engine. rc==2 is the correctness gate (propagate); everything else
# nonzero is infra (swallow → exit 0).
# ---------------------------------------------------------------------------
set +e
python3 "${ARGS[@]}"
rc=$?
set -e

if [ "${rc}" -eq 0 ]; then
    exit 0
elif [ "${rc}" -eq 2 ]; then
    echo "[mode-d-scan] offload lane crossed the Mode-D boundary — halting; do not merge this output (exit 2)" >&2
    exit 2
else
    echo "[mode-d-scan] engine error (rc=${rc}) — non-fatal, continuing" >&2
    exit 0
fi
