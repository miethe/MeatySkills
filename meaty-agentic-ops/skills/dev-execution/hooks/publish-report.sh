#!/usr/bin/env bash
# =============================================================================
# publish-report.sh — Phase/Plan-Close Delivery-Report Publish+Link Hook
# =============================================================================
#
# PURPOSE:
#   Non-fatal wrapper that composes M1's `delivery_report.py export --target atlas`
#   (envelope + instance_key/link_identity, D1/D2) with M2's `publish_report.py`
#   (atlas ingest -> scope resolution -> R1 guardrail -> `itt link report`) at a
#   plan/phase close. This hook owns the whole non-fatal contract (D3): the real
#   logic — including the D4 dossier-deference redirect and the D1 instance_key
#   derivation — lives in the co-located engine `publish_report_hook.py`; this
#   wrapper owns the master-switch, the binding guard, the CLI/interpreter
#   resolution ladder, and exit-0 discipline, mirroring `seed-dossier.sh` /
#   `seed_dossier.py` and `update-dossier.sh`.
#
#   This hook NEVER renders HTML — it publishes what a prior render step already
#   produced (`update-dossier.sh` for the dossier route; the plan/phase author's
#   own render step for the other routes). Publishing before the HTML exists
#   would host a stale artifact, so the manifest's rendered HTML is part of the
#   binding: an unrendered report is a local, non-fatal skip, not an error.
#
# TRIGGER REGISTRATION:
#   Called from plan-execution.md §8 (after the §7 dossier render — route
#   `dossier`) and from phase-execution.md §5.2a (IntentTree SDLC Sync — Phase
#   Done, route `phase`, where `ITT_NODE_ID` and `PHASE_NUM` are already in
#   scope). Suggested snippet (inline):
#     DELIVERY_REPORT_MANIFEST=".claude/reports/dossier/${feature_slug}/report.json" \
#       .claude/skills/dev-execution/hooks/publish-report.sh
#
# ENVIRONMENT:
#   AOS_DELIVERY_REPORT_PUBLISH — ON BY DEFAULT. Only an explicit falsy value
#                            ("0"/"false"/"no"/"off") disables.
#   DELIVERY_REPORT_MANIFEST — the report manifest (report.json) to publish. Its
#                            EXISTENCE is half the binding signal: unset or
#                            absent -> silent no-op (exit 0, zero work).
#   ITT_NODE_ID / INTENTTREE_TREE — the other half of the binding signal, per
#                            `.claude/rules/intenttree-integration.md`. Neither
#                            set (and no frontmatter match in
#                            DELIVERY_REPORT_PLAN_FILE, if given) -> silent no-op.
#                            `ITT_NODE_ID` also supplies the publish anchor
#                            (`publish_report.py --anchor-node-id`); its absence
#                            with only `INTENTTREE_TREE` bound is a logged,
#                            non-fatal skip (no anchor to publish against).
#   DELIVERY_REPORT_PLAN_FILE — optional plan/progress file whose frontmatter is
#                            checked for `itt_node_id:`/`intenttree_tree:`/
#                            `source_artifact_id:` (same binding contract
#                            `sdlc-sync.sh` uses).
#   DELIVERY_REPORT_HTML     — override the rendered HTML path. Default:
#                            index.html beside the manifest.
#   DELIVERY_REPORT_INSTANCE_KEY — explicit D1 instance key. If unset, derived
#                            per route (never falls back to subject or a bare
#                            timestamp — D1):
#                              phase      -> $PHASE_NUM, else $PHASE_ID
#                              program    -> $MILESTONE_ID
#                              readiness  -> $READINESS_DECISION_DATE, else $DECISION_DATE
#                            feature/dossier ignore this — those routes collapse
#                            on (route, subject) by design (D1).
#   DELIVERY_REPORT_PROJECT — atlas project slug, passed through.
#   DELIVERY_REPORT_SKILL_DIR / DELIVERY_REPORT_PYTHON — override the resolved
#                            delivery-report skill dir / interpreter.
#   ATLAS_REPO / ITT_BIN     — passed through to publish_report.py unchanged
#                            (it already reads these itself; not re-plumbed here).
#
# EXIT CONTRACT:
#   ALWAYS exits 0. The engine's exit code is translated into a logged outcome:
#     0  published                       -> info log
#     1  guardrail rejected (R1)          -> LOUD log (real signal, still non-fatal)
#     2  export/atlas/resolution failure  -> logged non-fatal skip
#     3  `itt link report` verb unavailable (D5) -> benign, quiet skip
#     4  local skip (no html/instance-key/manifest) -> logged non-fatal skip
#     *  anything else                    -> logged non-fatal skip
#
# SPEC REFERENCE:
#   .claude/worknotes/delivery-report-hosting-and-linking/implementation-notes.md
#   (design contract D1-D5, binding on M1/M2/M3)
#   Env-resolution sibling contract: .claude/rules/intenttree-integration.md
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_DELIVERY_REPORT_PUBLISH:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Guard: binding — a manifest AND an IntentTree binding must both exist.
# Unbound is the common, correct outcome: silent no-op, zero calls, no warning.
# ---------------------------------------------------------------------------
MANIFEST="${DELIVERY_REPORT_MANIFEST:-}"
if [ -z "${MANIFEST}" ] || [ ! -f "${MANIFEST}" ]; then
    exit 0
fi

PLAN_FILE="${DELIVERY_REPORT_PLAN_FILE:-}"
if [ -z "${ITT_NODE_ID:-}" ] && [ -z "${INTENTTREE_TREE:-}" ] \
    && ! grep -qE '^(intenttree_tree|itt_node_id|source_artifact_id):' "${PLAN_FILE:-/dev/null}" 2>/dev/null; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Guard: an anchor node id is required to call publish_report.py. Bound-by-tree
# only (no ITT_NODE_ID) is a real, loggable skip — not silent, since a binding
# genuinely exists but this hook cannot act on it.
# ---------------------------------------------------------------------------
ANCHOR="${ITT_NODE_ID:-}"
if [ -z "${ANCHOR}" ]; then
    echo "[publish-report] bound to a tree but no ITT_NODE_ID anchor set — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the engine (co-located) and a Python interpreter.
# ---------------------------------------------------------------------------
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HOOK_DIR}/publish_report_hook.py"
if [ ! -f "${ENGINE}" ]; then
    echo "[publish-report] publish_report_hook.py not found beside the hook — skipping (non-fatal)" >&2
    exit 0
fi

PY="${DELIVERY_REPORT_PYTHON:-}"
if [ -z "${PY}" ] || ! command -v "${PY}" >/dev/null 2>&1; then
    if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"; else PY="python3"; fi
fi

# ---------------------------------------------------------------------------
# Resolve the delivery-report skill dir (repo -> global -> agents mirror).
# ---------------------------------------------------------------------------
SKILL_DIR="${DELIVERY_REPORT_SKILL_DIR:-}"
if [ -n "${SKILL_DIR}" ]; then
    # An explicit override is authoritative: skip on an incomplete deploy rather
    # than falling through and concealing the operator's configuration mistake.
    if [ ! -f "${SKILL_DIR}/scripts/delivery_report.py" ] \
        || [ ! -f "${SKILL_DIR}/scripts/publish_report.py" ]; then
        echo "[publish-report] delivery-report skill at ${SKILL_DIR} is incomplete (requires scripts/delivery_report.py and scripts/publish_report.py; possible stale deploy) — skipping (non-fatal)" >&2
        exit 0
    fi
else
    INCOMPLETE_SKILL_DIR=""
    for cand in \
        ".claude/skills/delivery-report" \
        "${HOME}/.claude/skills/delivery-report" \
        "${HOME}/.agents/skills/delivery-report"; do
        if [ -f "${cand}/scripts/delivery_report.py" ] \
            && [ -f "${cand}/scripts/publish_report.py" ]; then
            SKILL_DIR="${cand}"
            break
        elif [ -d "${cand}" ] && [ -z "${INCOMPLETE_SKILL_DIR}" ]; then
            INCOMPLETE_SKILL_DIR="${cand}"
        fi
    done
fi
if [ -z "${SKILL_DIR}" ]; then
    if [ -n "${INCOMPLETE_SKILL_DIR:-}" ]; then
        echo "[publish-report] delivery-report skill at ${INCOMPLETE_SKILL_DIR} is incomplete (requires scripts/delivery_report.py and scripts/publish_report.py; possible stale deploy) — skipping (non-fatal)" >&2
        exit 0
    fi
    echo "[publish-report] delivery-report skill (export/publish scripts) not found — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve output HTML + the D1 instance_key (route-aware; never subject/timestamp).
# ---------------------------------------------------------------------------
MANIFEST_DIR="$(dirname "${MANIFEST}")"
HTML="${DELIVERY_REPORT_HTML:-${MANIFEST_DIR}/index.html}"

ROUTE="$("${PY}" -c '
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    print((data.get("report") or {}).get("route") or "")
except Exception:
    print("")
' "${MANIFEST}" 2>/dev/null)"

case "${ROUTE}" in
    phase)     DERIVED_KEY="${PHASE_NUM:-${PHASE_ID:-}}" ;;
    program)   DERIVED_KEY="${MILESTONE_ID:-}" ;;
    readiness) DERIVED_KEY="${READINESS_DECISION_DATE:-${DECISION_DATE:-}}" ;;
    *)         DERIVED_KEY="" ;;
esac
INSTANCE_KEY="${DELIVERY_REPORT_INSTANCE_KEY:-${DERIVED_KEY}}"

# ---------------------------------------------------------------------------
# Build + run the engine invocation. It never renders, never crashes past
# here in a way that matters — every exit code below still ends at exit 0.
# ---------------------------------------------------------------------------
ARGS=(--manifest "${MANIFEST}" --html "${HTML}" --anchor-node-id "${ANCHOR}"
      --skill-dir "${SKILL_DIR}" --python "${PY}")
[ -n "${INSTANCE_KEY}" ] && ARGS+=(--instance-key "${INSTANCE_KEY}")
[ -n "${DELIVERY_REPORT_PROJECT:-}" ] && ARGS+=(--project "${DELIVERY_REPORT_PROJECT}")

RESULT="$("${PY}" "${ENGINE}" "${ARGS[@]}" 2>&1)"
STATUS=$?

MESSAGE="$(printf '%s' "${RESULT}" | sed -n 's/.*"reason": "\([^"]*\)".*/\1/p' | head -1)"
ROUTE_OUT="$(printf '%s' "${RESULT}" | sed -n 's/.*"route": "\([^"]*\)".*/\1/p' | head -1)"

case "${STATUS}" in
    0)
        echo "[publish-report] published route=${ROUTE_OUT:-${ROUTE}} instance_key=${INSTANCE_KEY:-<none>}" >&2
        ;;
    1)
        echo "[publish-report] GUARDRAIL REJECTED (R1 — scope misattribution): ${RESULT}" >&2
        ;;
    3)
        echo "[publish-report] itt link report unavailable on the installed CLI — skipping (D5, non-fatal)" >&2
        ;;
    4)
        echo "[publish-report] skipped: ${MESSAGE:-nothing to publish}" >&2
        ;;
    *)
        echo "[publish-report] publish failed (non-fatal): ${MESSAGE:-${RESULT}}" >&2
        ;;
esac

exit 0
