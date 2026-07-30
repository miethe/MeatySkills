#!/usr/bin/env bash
# =============================================================================
# verify-writeback.sh — AOS Writeback Definition-of-Done gate (audit P3.9)
# =============================================================================
#
# PURPOSE:
#   A phase/feature is NOT "done" until its work landed back in the Agentic OS:
#   the bound IntentTree node is `completed`, its AAR was captured, and decisions
#   were ingested. This script is the *gate* the reviewer (Mode E) runs — it
#   turns that Definition-of-Done from decaying prose into a pass/fail check.
#
# CONTRACT (distinct from the best-effort sync hooks, which never block):
#   - PASS (exit 0): no AOS binding present  → writeback DoD is N/A (repos with
#                    no IntentTree presence are not blocked); OR the bound node
#                    resolves as `completed`.
#   - FAIL (exit 1): a binding EXISTS but the bound node is not `completed`
#                    (work not written back) or cannot be resolved while itt is
#                    available. The reviewer MUST withhold APPROVED on a FAIL.
#   - PASS-with-WARN (exit 0): itt CLI unavailable / node API unreachable — the
#                    gate cannot verify, so it does not block, but prints WARN so
#                    the reviewer records that writeback was unverified.
#
# USAGE:
#   ITT_NODE_ID=<node> .claude/skills/dev-execution/hooks/verify-writeback.sh
#   (ITT_NODE_ID / INTENTTREE_TREE resolve per .claude/rules/intenttree-integration.md.)
#
# The story-capture + decision-ingest checks are reviewer-confirmed (they are
# side effects of the Stop-event writeback hook and of `op story`); this script
# verifies the one machine-checkable signal — node completion — as the hard gate.
# =============================================================================

set -uo pipefail

NODE_ID="${ITT_NODE_ID:-}"

# No binding → writeback DoD does not apply. PASS (never block a non-AOS repo).
if [ -z "${NODE_ID}" ] && [ -z "${INTENTTREE_TREE:-}" ]; then
    echo "[writeback-dod] no AOS binding (ITT_NODE_ID/INTENTTREE_TREE unset) — N/A, PASS"
    exit 0
fi

if [ -z "${NODE_ID}" ]; then
    echo "[writeback-dod] WARN: INTENTTREE_TREE set but ITT_NODE_ID unset — cannot verify node completion; reviewer must confirm manually" >&2
    exit 0
fi

if ! command -v itt >/dev/null 2>&1; then
    echo "[writeback-dod] WARN: itt CLI not found — writeback UNVERIFIED (not blocking); reviewer must confirm the node completed" >&2
    exit 0
fi

# Resolve the bound node's status.
STATUS="$(itt --json node get "${NODE_ID}" 2>/dev/null \
    | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([a-z_]*\)".*/\1/p' | head -1)"

if [ -z "${STATUS}" ]; then
    echo "[writeback-dod] WARN: could not resolve node ${NODE_ID} (offline / not found) — UNVERIFIED, not blocking" >&2
    exit 0
fi

if [ "${STATUS}" = "completed" ]; then
    echo "[writeback-dod] PASS: node ${NODE_ID} is completed — work written back to IntentTree."
    exit 0
fi

echo "[writeback-dod] FAIL: node ${NODE_ID} is '${STATUS}', not 'completed'. The phase is NOT done —" >&2
echo "  complete the node (dev-execution §5.2a auto-completes it) and ensure the AAR/story was" >&2
echo "  captured + decisions ingested (the Stop-event writeback hook) before APPROVED." >&2
exit 1
