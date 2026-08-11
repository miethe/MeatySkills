#!/usr/bin/env bash
# =============================================================================
# update-dossier.sh — Dev-Execution Delivery-Dossier Regeneration Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking hook that re-renders + re-validates a feature's living
#   `delivery-report` dossier (route `dossier`) at a phase boundary. The
#   phase-closing agent authors the stage narrative / outcome / decisions / open
#   questions / evidence into the dossier MANIFEST (the canonical accreting
#   record) as part of writing the phase completion note; this hook then does
#   the deterministic, offline render + validate. No model call is on the render
#   path (AOS constraint 4); the manifest is canonical, the HTML is derived
#   (constraint 2).
#
#   This hook NEVER authors content and NEVER gates a phase. Like the forward
#   delivery-report routes, the dossier is recommended / non-blocking — the
#   enforced end-of-feature artifact remains the `feature` route DoD report
#   (verify-delivery-report.sh). See:
#   docs/skill-development/delivery-dossier/spec.md §A.6.
#
# TRIGGER REGISTRATION:
#   Called from phase-execution.md §5.2a (phase done), and plan-execution.md
#   §3c-sync (inter-wave) / §5-6 (plan done) — the SAME phase-boundary points
#   the sdlc-sync hook occupies. Suggested snippet (inline):
#     DELIVERY_DOSSIER_MANIFEST=".claude/reports/dossier/${feature_slug}/report.json" \
#     .claude/skills/dev-execution/hooks/update-dossier.sh
#
# ENVIRONMENT:
#   AOS_DELIVERY_DOSSIER      — ON BY DEFAULT. Any unset / "1" / "true" / "auto"
#                               value enables; only an explicit falsy value
#                               ("0" / "false" / "no" / "off") disables. Mirrors
#                               the sdlc-sync default-on contract: automatic, not
#                               opt-in prose that decays — and a safe no-op when
#                               no dossier is bound (see the binding guard).
#   DELIVERY_DOSSIER_MANIFEST — path to the dossier manifest. Its EXISTENCE is
#                               the "binding exists" signal: if unset or the file
#                               is absent, this hook is a silent no-op (exit 0,
#                               zero work). Default-on stays noiseless in repos
#                               with no dossier.
#   DELIVERY_DOSSIER_HTML     — output HTML path. Default: index.html beside the
#                               manifest.
#   DELIVERY_DOSSIER_ASSET_ROOT — asset root for media resolution. Default: the
#                               manifest's directory.
#   DELIVERY_REPORT_SKILL_DIR — override the delivery-report skill dir.
#   DELIVERY_REPORT_PYTHON    — override the Python interpreter.
#
# ERROR HANDLING:
#   All errors are logged to stderr with an [update-dossier] prefix. This hook
#   always exits 0 — failures (missing CLI, render/validate errors, offline)
#   never propagate to the calling workflow. A validation failure is LOGGED
#   (so the human sees the dossier needs attention) but never blocks the phase.
#
# SPEC REFERENCE:
#   docs/skill-development/delivery-dossier/spec.md (Phase A, §A.6 integration)
#   Env-resolution sibling contract: .claude/rules/intenttree-integration.md
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_DELIVERY_DOSSIER:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Guard: binding must exist. The dossier manifest's existence IS the binding.
# Default-on is a no-op unless a dossier has been seeded for this feature.
# ---------------------------------------------------------------------------
MANIFEST="${DELIVERY_DOSSIER_MANIFEST:-}"
if [ -z "${MANIFEST}" ] || [ ! -f "${MANIFEST}" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the delivery-report CLI + Python (repo → global → agents mirror).
# ---------------------------------------------------------------------------
SKILL_DIR="${DELIVERY_REPORT_SKILL_DIR:-}"
if [ -z "${SKILL_DIR}" ] || [ ! -f "${SKILL_DIR}/scripts/delivery_report.py" ]; then
    for cand in \
        ".claude/skills/delivery-report" \
        "${HOME}/.claude/skills/delivery-report" \
        "${HOME}/.agents/skills/delivery-report"; do
        if [ -f "${cand}/scripts/delivery_report.py" ]; then
            SKILL_DIR="${cand}"
            break
        fi
    done
fi
if [ -z "${SKILL_DIR}" ] || [ ! -f "${SKILL_DIR}/scripts/delivery_report.py" ]; then
    echo "[update-dossier] delivery_report.py not found — skipping (non-fatal)" >&2
    exit 0
fi
CLI="${SKILL_DIR}/scripts/delivery_report.py"

PY="${DELIVERY_REPORT_PYTHON:-}"
if [ -z "${PY}" ] || [ ! -x "${PY}" ]; then
    if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"; else PY="python3"; fi
fi

# ---------------------------------------------------------------------------
# Resolve output + asset root (defaults derived from the manifest location).
# ---------------------------------------------------------------------------
MANIFEST_DIR="$(dirname "${MANIFEST}")"
HTML_OUT="${DELIVERY_DOSSIER_HTML:-${MANIFEST_DIR}/index.html}"
ASSET_ROOT="${DELIVERY_DOSSIER_ASSET_ROOT:-${MANIFEST_DIR}}"

# ---------------------------------------------------------------------------
# Render, then validate. Both errors are warnings — never block the phase.
# ---------------------------------------------------------------------------
if ! "${PY}" "${CLI}" render --manifest "${MANIFEST}" --asset-root "${ASSET_ROOT}" --out "${HTML_OUT}" >/dev/null 2>&1; then
    echo "[update-dossier] render failed for ${MANIFEST} — non-fatal, continuing" >&2
    exit 0
fi

if ! "${PY}" "${CLI}" validate --manifest "${MANIFEST}" --asset-root "${ASSET_ROOT}" --html "${HTML_OUT}" --expect-route dossier >/dev/null 2>&1; then
    echo "[update-dossier] dossier VALIDATION failed for ${MANIFEST} — the record has issues (non-fatal); run 'delivery_report.py validate' to inspect" >&2
    exit 0
fi

echo "[update-dossier] dossier regenerated: ${HTML_OUT}" >&2
exit 0
