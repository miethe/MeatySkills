#!/usr/bin/env bash
# =============================================================================
# post-merge-evidence.sh — Dev-Execution Post-Merge Evidence Recorder Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking, best-effort hook that records typed IntentTree evidence at
#   merge time — Shipped Work Ledger M3 FR-8 (pr_refs/commit_refs as typed
#   ExternalLink + CompletionEvidence rows, plus a git_merge landing row) and
#   FR-9 (CCDash files-touched/tests-pass counts, consumed via `ccdash`, never
#   pushed anywhere). This is a RECORDER, not a gate — there is no correctness
#   hard-gate here, unlike provision-artifacts.sh's exit-2 carve-out.
#
#   Composes the co-located engine `post_merge_evidence.py`, which itself reuses
#   the M2/M3-L1 seams exclusively (`_itt_client.IttClient`, `_evidence_refs`,
#   `_slug_resolution`) — no HTTP/normalization logic lives in this wrapper.
#
# TRIGGER REGISTRATION:
#   Wired by the orchestrator at the post-merge step of the
#   git-worktree-pr-protocol (squash-merge-on-approval), e.g.:
#     POST_MERGE_PLAN_FILE="docs/.../feature-v1.md" ITT_NODE_ID="node_..." \
#     INTENTTREE_TREE="tree_..." \
#       .claude/skills/dev-execution/hooks/post-merge-evidence.sh
#
# ENVIRONMENT:
#   AOS_POST_MERGE_EVIDENCE   — ON BY DEFAULT. Only an explicit falsy value
#                               (0/false/no/off) disables. Mirrors
#                               INTENTTREE_SDLC_SYNC / AOS_ARTIFACT_PROVISION.
#   POST_MERGE_PLAN_FILE      — plan file to read commit_refs/pr_refs/
#                               merge_commit/feature_slug from. Its frontmatter
#                               carrying itt_node_id:/intenttree_tree:/
#                               feature_slug: is one binding signal.
#   ITT_NODE_ID / POST_MERGE_NODE_ID — explicit bound node id. Either counts as
#                               a binding signal.
#   INTENTTREE_TREE           — bound tree id (used only to resolve a node id
#                               via feature_slug when no explicit node id is
#                               given). Also a binding signal.
#   POST_MERGE_MERGE_COMMIT   — merge SHA/ref for the git_merge evidence row.
#                               Falls back to the plan's merge_commit: field,
#                               then a read-only `git rev-parse HEAD`.
#   POST_MERGE_DEFAULT_REPO   — repo name for bare refs (e.g. bare PR integers).
#   POST_MERGE_REPO_ROOT      — repo root for the git-HEAD fallback. Default ".".
#   POST_MERGE_APPLY          — "1" → write (passes --apply). Default: dry-run.
#   POST_MERGE_JSON           — "1" → machine-readable output (--json).
#   POST_MERGE_PYTHON         — override python3 interpreter path.
#
# ERROR HANDLING:
#   All errors are logged to stderr with a [post-merge-evidence] prefix. This
#   hook ALWAYS exits 0 — there is NO exit-2 carve-out (unlike
#   provision-artifacts.sh): it is a best-effort recorder, not a correctness
#   gate. A missing engine, missing python3, or an engine-reported error is
#   logged and swallowed.
#
# EXIT CONTRACT:
#   Always 0.
#
# SPEC REFERENCE:
#   .claude/worknotes/shipped-work-ledger/m3-contract.md §6 L2 (FR-8, FR-9)
#   PRD: docs/project_plans/PRDs/shipped-work-ledger-v1.md
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# bash 3.2-safe (macOS system bash): no `${var,,}` (bash 4+ only).
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_POST_MERGE_EVIDENCE:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

POST_MERGE_PLAN_FILE="${POST_MERGE_PLAN_FILE:-}"
POST_MERGE_NODE_ID="${POST_MERGE_NODE_ID:-${ITT_NODE_ID:-}}"
INTENTTREE_TREE="${INTENTTREE_TREE:-}"

# ---------------------------------------------------------------------------
# Guard: binding must exist. No node id / no tree / no plan-file binding
# frontmatter → silent no-op, ZERO HTTP calls. Keeps default-on noiseless in
# repos/runs with no IntentTree presence.
# ---------------------------------------------------------------------------
HAS_PLAN_BINDING=0
if [ -n "${POST_MERGE_PLAN_FILE}" ] && [ -f "${POST_MERGE_PLAN_FILE}" ] \
    && grep -qE '^(itt_node_id|intenttree_tree|feature_slug):' "${POST_MERGE_PLAN_FILE}" 2>/dev/null; then
    HAS_PLAN_BINDING=1
fi
if [ -z "${POST_MERGE_NODE_ID}" ] && [ -z "${INTENTTREE_TREE}" ] && [ "${HAS_PLAN_BINDING}" -eq 0 ]; then
    exit 0
fi

if [ -z "${POST_MERGE_PLAN_FILE}" ] || [ ! -f "${POST_MERGE_PLAN_FILE}" ]; then
    echo "[post-merge-evidence] POST_MERGE_PLAN_FILE not set or not found — skipping (non-fatal)" >&2
    exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="${HERE}/post_merge_evidence.py"
if [ ! -f "${ENGINE}" ]; then
    echo "[post-merge-evidence] engine not found: ${ENGINE} — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve a WORKING python3 — probe candidates and pick the first that can
# actually execute `import json,sys`, so PATH ordering / a broken interpreter
# never crashes this hook (mirrors infra/persona-hooks/persona_reconcile_nightly.sh's
# working-python3 resolver, commit 91137e6).
# ---------------------------------------------------------------------------
PY3=""
if [ -n "${POST_MERGE_PYTHON:-}" ] && "${POST_MERGE_PYTHON}" -c 'import json,sys' >/dev/null 2>&1; then
    PY3="${POST_MERGE_PYTHON}"
else
    for cand in python3 python3.12 python3.11 python3.10 .venv/bin/python python; do
        resolved="$(command -v "${cand}" 2>/dev/null || true)"
        if [ -n "${resolved}" ] && "${resolved}" -c 'import json,sys' >/dev/null 2>&1; then
            PY3="${resolved}"
            break
        fi
    done
fi
if [ -z "${PY3}" ]; then
    echo "[post-merge-evidence] no working python3 found — skipping (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Build engine args
# ---------------------------------------------------------------------------
ARGS=("${ENGINE}" "--plan-file" "${POST_MERGE_PLAN_FILE}")
[ -n "${POST_MERGE_NODE_ID}" ] && ARGS+=("--node-id" "${POST_MERGE_NODE_ID}")
[ -n "${INTENTTREE_TREE}" ] && ARGS+=("--tree" "${INTENTTREE_TREE}")
[ -n "${POST_MERGE_MERGE_COMMIT:-}" ] && ARGS+=("--merge-commit" "${POST_MERGE_MERGE_COMMIT}")
[ -n "${POST_MERGE_REPO_ROOT:-}" ] && ARGS+=("--repo-root" "${POST_MERGE_REPO_ROOT}")
[ -n "${POST_MERGE_DEFAULT_REPO:-}" ] && ARGS+=("--default-repo" "${POST_MERGE_DEFAULT_REPO}")
[ "${POST_MERGE_APPLY:-0}" = "1" ] && ARGS+=("--apply")
[ "${POST_MERGE_JSON:-0}" = "1" ] && ARGS+=("--json")

# ---------------------------------------------------------------------------
# Run the engine. ANY nonzero is non-fatal — there is no exit-2 carve-out for
# this hook (it is a best-effort recorder, not a correctness gate). Always
# exit 0.
# ---------------------------------------------------------------------------
set +e
"${PY3}" "${ARGS[@]}"
rc=$?
set -e

if [ "${rc}" -ne 0 ]; then
    echo "[post-merge-evidence] engine reported issues (rc=${rc}) — non-fatal, continuing" >&2
fi
exit 0
