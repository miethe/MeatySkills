#!/usr/bin/env bash
# =============================================================================
# pre-commit-sdlc-sync.sh — IntentTree SDLC Drift-Sync Pre-Commit Hook
# =============================================================================
#
# PURPOSE:
#   Called by pre-commit for any staged file matching
#   ^(docs/project_plans/|\.claude/progress/).
#   When INTENTTREE_SDLC_SYNC is truthy (1 / true / yes), runs
#   `itt sync import <file> --apply` for each passed filename so that
#   bound IntentTree nodes stay consistent with the committed artifact.
#
# DESIGN INVARIANTS (FR-14 / TASK-7.1):
#   • ALWAYS exits 0 — never blocks a commit.
#   • Best-effort: offline, CLI-missing, or sync errors are warnings to
#     stderr only; the commit proceeds in all cases.
#   • INTENTTREE_SDLC_SYNC guard: any value that case-insensitively equals
#     "1", "true", or "yes" enables the sync; anything else is a no-op.
#
# USAGE (invoked by pre-commit):
#   Set INTENTTREE_SDLC_SYNC=1 in your shell or .env before committing.
#   The hook receives changed filenames as positional arguments.
#
# ENVIRONMENT:
#   INTENTTREE_SDLC_SYNC  — enable flag (1/true/yes); default: off.
#
# SPEC REFERENCE:
#   docs/project_plans/implementation_plans/awpr-v2-task-node-contract.md
#   Plan task: TASK-7.1 (FR-14, pre-commit drift-sync hook)
#   CLI source: client/src/intenttree_client/cli/commands/sync_cmd.py
#   Related:    .claude/skills/dev-execution/hooks/sdlc-sync.sh (workflow hook)
# =============================================================================

# ---------------------------------------------------------------------------
# Guard: master switch (case-insensitive: 1, true, yes)
# ---------------------------------------------------------------------------
_sync_enabled() {
    # NOTE: `${val,,}` (bash 4+ lowercasing) is deliberately NOT used here — macOS ships
    # /bin/bash 3.2 as the default `bash` on PATH, where `${val,,}` is a "bad substitution"
    # runtime error. That error does not merely fail this function: it aborts the enclosing
    # `if ! _sync_enabled; then exit 0; fi` statement entirely and execution falls through to
    # the rest of the script — silently converting this guard into an always-on no-op on any
    # box running the stock macOS bash, regardless of INTENTTREE_SDLC_SYNC. Measured
    # 2026-09-05, node_01M1S5J1V57K0232H2FDSQ5T2F. `tr` is portable to bash 3.2+.
    local val
    val="$(printf '%s' "${INTENTTREE_SDLC_SYNC:-}" | tr '[:upper:]' '[:lower:]')"
    case "$val" in
        1|true|yes) return 0 ;;
        *) return 1 ;;
    esac
}

if ! _sync_enabled; then
    # Sync is off — silently succeed so the commit is never blocked.
    exit 0
fi

# ---------------------------------------------------------------------------
# Verify the itt CLI is available
# ---------------------------------------------------------------------------
if ! command -v itt >/dev/null 2>&1; then
    echo "[sdlc-sync] WARNING: itt CLI not found — skipping SDLC drift sync (non-fatal)" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Iterate over the filenames passed by pre-commit
# ---------------------------------------------------------------------------
exit_code=0

for file in "$@"; do
    if [ ! -f "${file}" ]; then
        echo "[sdlc-sync] WARNING: file not found (deleted?): ${file} — skipping" >&2
        continue
    fi

    echo "[sdlc-sync] syncing: ${file}" >&2

    # Run itt sync import; capture output; treat errors as warnings only.
    if ! output=$(itt sync import "${file}" --apply 2>&1); then
        echo "[sdlc-sync] WARNING: sync failed for ${file} — non-fatal, commit continues" >&2
        if [ -n "${output}" ]; then
            echo "${output}" | head -20 >&2
        fi
    else
        if [ -n "${output}" ]; then
            echo "${output}" | head -5 >&2
        fi
        echo "[sdlc-sync] OK: ${file}" >&2
    fi
done

# Always exit 0 — hook must never block a commit.
exit 0
