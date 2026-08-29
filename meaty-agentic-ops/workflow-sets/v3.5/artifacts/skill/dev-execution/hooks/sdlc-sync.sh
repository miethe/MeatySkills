#!/usr/bin/env bash
# =============================================================================
# sdlc-sync.sh — Dev-Execution IntentTree SDLC Status Sync Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking hook that re-runs `itt sync import <progress-or-plan-file>
#   --apply --tree <tree>` at status hook points (task start, task done,
#   phase done, inter-wave merge) to propagate current status to bound
#   IntentTree nodes.
#
# TRIGGER REGISTRATION:
#   Called from phase-execution.md at §2.3a (task start), §2.5a (task done),
#   §5.2a (phase done) and from plan-execution.md at §3c-sync (inter-wave).
#
#   Suggested snippet (inline):
#     SDLC_SYNC_FILE=".claude/progress/${PRD}/phase-${PHASE_NUM}-progress.md" \
#     INTENTTREE_TREE="<tree-id>" \
#     .claude/skills/dev-execution/hooks/sdlc-sync.sh
#
# ENVIRONMENT:
#   INTENTTREE_SDLC_SYNC  — ON BY DEFAULT (P1.2). Any unset / "1" / "true" /
#                           "auto" value enables; only an explicit falsy value
#                           ("0" / "false" / "no" / "off") disables. Rationale:
#                           integration must be automatic, not opt-in prose that
#                           decays (AOS integration-remediation P1.2). The sync
#                           still no-ops safely when there is nothing to bind to
#                           (see the binding guard below), so default-on is a
#                           no-op in repos without a tree — never noise.
#   SDLC_SYNC_FILE        — path to the progress or plan file to sync. Required.
#   INTENTTREE_TREE       — target tree ID (passed to --tree). Optional: omit to
#                           let the CLI infer from the artifact's
#                           `intenttree_tree` frontmatter field.
#   ITT_NODE_ID           — bound node id. Presence (with INTENTTREE_TREE) is the
#                           "binding exists" signal that makes default-on fire.
#
# TARGET: sync targets whatever `itt` resolves as its API — with
#   `aos-target set node` that is the node instance (10.42.10.76:8032), the
#   standing default for all AOS work. No separate URL wiring here.
#
# RESOLUTION CONTRACT: env resolution (INTENTTREE_SDLC_SYNC default, ITT_NODE_ID,
#   INTENTTREE_TREE, INTENTTREE_ACTOR) is defined once in
#   `.claude/rules/intenttree-integration.md`.
#
# ERROR HANDLING:
#   All errors are logged to stderr with a [sdlc-sync] prefix.
#   This hook always exits 0 — failures never propagate to the calling workflow.
#
# SPEC REFERENCE:
#   docs/project_plans/implementation_plans/features/awpr-v2-task-node-contract.md
#   (§writeback policy, §idempotency invariants)
#   Plan task: TASK-6.2 (FR-11, dev-execution skill wiring)
#   CLI source: client/src/intenttree_client/cli/commands/sync_cmd.py
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${INTENTTREE_SDLC_SYNC:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

# ---------------------------------------------------------------------------
# Guard: binding must exist. Default-on is a no-op unless the run is bound to a
# tree (INTENTTREE_TREE / ITT_NODE_ID set, or the file carries intenttree
# frontmatter). Keeps default-on silent in repos with no IntentTree binding.
# ---------------------------------------------------------------------------
if [ -z "${INTENTTREE_TREE:-}" ] && [ -z "${ITT_NODE_ID:-}" ] \
    && ! grep -qE '^(intenttree_tree|itt_node_id|source_artifact_id):' "${SDLC_SYNC_FILE:-/dev/null}" 2>/dev/null; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Validate required inputs
# ---------------------------------------------------------------------------
SDLC_SYNC_FILE="${SDLC_SYNC_FILE:-}"
INTENTTREE_TREE="${INTENTTREE_TREE:-}"

if [ -z "${SDLC_SYNC_FILE}" ]; then
    echo "[sdlc-sync] SDLC_SYNC_FILE not set — skipping (non-fatal)" >&2
    exit 0
fi

if [ ! -f "${SDLC_SYNC_FILE}" ]; then
    echo "[sdlc-sync] file not found: ${SDLC_SYNC_FILE} — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the target tree. `itt sync import --apply` REQUIRES --tree (it does
# not infer from frontmatter), so when INTENTTREE_TREE is unset we read the
# file's `intenttree_tree:` frontmatter ourselves and pass it explicitly.
# ---------------------------------------------------------------------------
TREE="${INTENTTREE_TREE}"
if [ -z "${TREE}" ]; then
    # `|| true`: under `set -o pipefail`, `head -1` closing the pipe early can surface a SIGPIPE
    # (141) from sed on a multi-match file and abort the script before the safety net below.
    TREE="$(sed -n 's/^intenttree_tree:[[:space:]]*//p' "${SDLC_SYNC_FILE}" 2>/dev/null | head -1 | tr -d '"'\''[:space:]' || true)"
fi

# ---------------------------------------------------------------------------
# Build the itt sync command
# ---------------------------------------------------------------------------
ITT_ARGS=("sync" "import" "${SDLC_SYNC_FILE}" "--apply")
if [ -n "${TREE}" ]; then
    ITT_ARGS+=("--tree" "${TREE}")
fi

# ---------------------------------------------------------------------------
# Run itt sync — capture output; treat all errors as warnings
# ---------------------------------------------------------------------------
(
    if command -v itt >/dev/null 2>&1; then
        itt "${ITT_ARGS[@]}" 2>&1 | head -10
    else
        echo "[sdlc-sync] itt CLI not found — skipping (non-fatal)" >&2
        exit 1
    fi
) || {
    echo "[sdlc-sync] itt sync failed for ${SDLC_SYNC_FILE} — non-fatal, continuing" >&2
}

# Always exit 0 — hook must never block the calling workflow
exit 0
