#!/usr/bin/env bash
# =============================================================================
# sdlc-sync.sh — Dev-Execution IntentTree SDLC Status Sync Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking hook with TWO independently-gated sections:
#
#   1. RUN-SESSION LINK (G-1) — binds the executing harness session to an
#      IntentTree `AgentRun` so `AgentRun.ccdash_session_id` (and the transcript
#      pointer in `aos_native_aliases`) populate with ZERO manual id entry.
#      Writes AgentRun columns via the run API only — **zero node-`meta`
#      PATCHes** (design-spec §10 clause 6: CF-F's `bind_manifest` remains the
#      only writer of node `meta`).
#
#   2. STATUS SYNC — re-runs `itt sync import <progress-or-plan-file> --apply
#      --tree <tree>` at status hook points (task start, task done, phase done,
#      inter-wave merge) to propagate current status to bound IntentTree nodes.
#
#   The two sections share only the master switch. Section 2's early exits
#   (missing SDLC_SYNC_FILE, unresolvable tree) do not suppress section 1.
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
#   -- section 3 (plan/node status drift check, M4 operator-p0-state-integrity) only --
#   AOS_PLAN_NODE_DRIFT   — ON BY DEFAULT. Only an explicit falsy value ("0"/"false"/"no"/
#                           "off") disables. Independent of INTENTTREE_SDLC_SYNC except for
#                           the shared master hard-off check at the top of this file.
#   AOS_PLAN_NODE_DRIFT_PYTHON — python interpreter override (default: python3).
#
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
#                           Also one half of section 1's binding gate.
#
#   -- section 1 (run-session link) only --
#   AOS_RUN_SESSION_LINK  — ON BY DEFAULT; only an explicit falsy value
#                           ("0"/"false"/"no"/"off") disables. Independent of
#                           INTENTTREE_SDLC_SYNC except for the master hard-off.
#   CLAUDE_CODE_SESSION_ID— the harness session id, exported into the hook's
#                           environment by Claude Code. The other half of the
#                           binding gate: section 1 is a true no-op (zero `itt`
#                           calls) unless BOTH this and ITT_NODE_ID are set.
#                           Must match a canonical 8-4-4-4-12 UUID or it is
#                           refused.
#   AOS_RUN_SESSION_HOME  — sidecar directory. Default
#                           `$HOME/.operator/run_sessions`; the per-node record
#                           is `<dir>/<ITT_NODE_ID>.json` and carries
#                           `agent_run_id` + `harness_session_id` +
#                           `transcript_ref` + `harness_type`. Deliberately NOT
#                           cwd-relative (OP_HOME defaults to `./.operator/runs`,
#                           which would place state inside a git worktree) and
#                           deliberately NOT under CF-F's `node_bindings/`
#                           namespace — a different concern, disjoint writers.
#   AOS_RUN_SESSION_AGENT_ID — optional `--agent` override for `itt run start`.
#                           Unset, the CLI resolves an agent from the workspace.
#   AOS_CCDASH_SESSION_PREFIX — CCDash's session-id prefix. Default `S-`; set to
#                           the empty string for no prefix (uses `${VAR-default}`
#                           so empty is honoured). See the derivation block below.
#   AOS_CCDASH_UI_URL     — read by the `itt` CLI (not this hook) to build the
#                           `log_ref_url` deep link. Node value:
#                           `http://10.42.10.76:3010`. Unset/empty => the session
#                           still links but no log link is written.
#   AOS_RUN_SESSION_TIMEOUT — per-`itt`-call watchdog, seconds (default 20). The
#                           hook must be non-BLOCKING as well as non-failing: the
#                           CLI's own HTTP timeout is 30s and the server's link
#                           path can make several CCDash calls, so a stuck or
#                           substituted `itt` would otherwise stall the phase.
#                           On expiry the child's whole process group is killed
#                           and the call reports 124; the hook still exits 0.
#
#   CONCURRENCY: two layers, and they cover DIFFERENT failures. Keep both.
#     (a) SERVER (authoritative, IntentTree migration 0041): a partial unique
#         index on `agent_runs (node_id, ccdash_session_id)`. One harness session
#         belongs to at most one run per node, across hosts. A second claimant is
#         refused; `run start`'s auto-link records `ccdash_metrics.status =
#         "duplicate_session"` on the loser and still starts it.
#     (b) LOCAL (this lock): an atomic `mkdir` at `<sidecar dir>/.lock.<ITT_NODE_ID>`
#         (stale locks >1min are reclaimed), serialising the create path on THIS
#         machine.
#     Why (b) survives (a): the server key is on the SESSION LINK, and the CLI
#     creates the AgentRun *before* it has a session id to link (`run start` =
#     POST create, then POST /start --ccdash-session-id). So the index stops two
#     runs from owning one session; it cannot stop two runs from being CREATED.
#     Drop this lock and concurrent boundaries would still mint a second run —
#     it would just lose the session-link race and sit there unlinked, which is
#     the same orphan with a tidier database. (a) makes the data correct; (b)
#     keeps the churn down. The original finding is closed.
#
#   TWO REPRESENTATIONS OF ONE SESSION — never conflated (see the block below):
#     `harness_session_id` = the bare UUID Claude Code assigns (also the
#     transcript filename); `ccdash_session_id` = `S-<uuid>`, how CCDash keys the
#     same session and therefore what `AgentRun.ccdash_session_id` must hold.
#
#   TWO POINTERS TO ONE TRANSCRIPT — different jobs:
#     the raw path is the DURABLE pointer (sidecar +
#     `aos_native_aliases.ccdash_transcript_path`); `log_ref_url` is the
#     REACHABLE pointer (a CCDash SessionInspector deep link the operator
#     clicks). A `file://` href cannot satisfy that — browsers block http(s) ->
#     file:// navigation — so the CLI writes the deep link instead.
#
#   TRANSCRIPT PATH is DERIVED, never read from the environment:
#     $HOME/.claude/projects/<cwd with '/', '.', '_' -> '-'>/<session>.jsonl
#   with a depth-2 fallback search inside that root when the session was opened
#   from a different cwd. The resolved path must stay under
#   `$HOME/.claude/projects/`, contain no `..`, use only `[A-Za-z0-9._/-]`, and
#   be an existing regular file — otherwise the transcript is simply omitted
#   (the session id still links). Both values are passed as argv array elements
#   and are never interpolated into a shell string.
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
#   docs/project_plans/implementation_plans/awpr-v2-task-node-contract.md
#   (§writeback policy, §idempotency invariants)
#   Plan task: TASK-6.2 (FR-11, dev-execution skill wiring)
#   CLI source: client/src/intenttree_client/cli/commands/sync_cmd.py
#
#   Section 1 (run-session link): FR-1 of
#   docs/project_plans/PRDs/live-work-observability-v1.md; the binding identity
#   contract is docs/project_plans/design-specs/live-work-observability-handoff.md
#   §10 (three identities, mandatory namespacing, single-writer invariant).
#   CLI source: client/src/intenttree_client/cli/commands/run_cmd.py
#   (`run link-session`, `run start --ccdash-session-id`).
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${INTENTTREE_SDLC_SYNC:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) exit 0 ;;
esac

# ===========================================================================
# SECTION 1 (additive, independently gated) — harness session -> AgentRun join
#
# Populates AgentRun.ccdash_session_id (and aos_native_aliases.
# ccdash_transcript_path) for the harness session that is executing this run,
# so "an agent is running" reaches its transcript with zero manual id entry.
#
# Runs BEFORE the `itt sync import` section below and is gated only by its own
# guards — the sync section's early exits (no SDLC_SYNC_FILE, no tree) must not
# suppress the join, and vice versa. Writes AgentRun columns via the run API
# only; issues ZERO node-`meta` PATCHes (design-spec §10 clause 6 — CF-F's
# `bind_manifest` is the sole node-`meta` writer, forever).
#
# Identity discipline (design-spec §10 clauses 2+4): there are THREE distinct
# identities and this section never aliases them —
#   `op` run id        (launchpad run record)   — not used here
#   AgentRun.id        (intenttree exec record) — `agent_run_id` below
#   harness session id (Claude Code session)    — `harness_session_id` below
# No bare `session_id` identifier is introduced anywhere. `--session-id` on the
# `itt` subcommand is the server's existing wire field name, not a new one.
# ===========================================================================

# Canonical UUID: 8-4-4-4-12 hex. A looser 36-char/hyphen shape admits values
# that are not UUIDs while the rejection message claims otherwise, so code and
# message would disagree — and this id is also a filename component.
_HARNESS_SESSION_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
# Shared shape for ids that become argv elements. The leading-dash rejection is
# separate and explicit: a value like `--help` matches this charset yet would be
# parsed as an OPTION by the CLI, which can exit 0 without doing the work.
_RSL_ID_RE='^[A-Za-z0-9_-]{1,128}$'
_RSL_TRANSCRIPT_ROOT="${HOME:-}/.claude/projects"
# Hook-owned deadline for each `itt` call (seconds). The CLI's own HTTP timeout is
# 30s and the server's link path can make several CCDash calls, so without this a
# stuck or substituted `itt` blocks the phase indefinitely: non-failing is not the
# same as non-blocking.
_RSL_ITT_TIMEOUT="${AOS_RUN_SESSION_TIMEOUT:-20}"

_rsl_log() { echo "[sdlc-sync] run-session-link: $*" >&2; }

# Reject ids that are shape-valid but would be read as an option. Applied to
# anything that reaches `itt` argv, including values read back from the sidecar.
_rsl_is_safe_id() {
    case "${1:-}" in
        -*) return 1 ;;
    esac
    [[ "${1:-}" =~ $_RSL_ID_RE ]]
}

# Run `itt` under a hook-owned watchdog, with stdout redirected to $1 (a FILE,
# never a pipe — see below). Returns the child's exit status, or 124 on timeout
# (GNU `timeout`'s convention).
#
# Portable by necessity: macOS ships neither `timeout` nor `gtimeout`, so this is
# a background child + bounded poll + kill rather than coreutils.
#
# Two mechanics are load-bearing, and BOTH are needed — each fixes a different
# failure that the other does not:
#
#   1. stdout goes to a FILE. With `x="$(_rsl_itt …)"` the child inherits the
#      command-substitution pipe; a grandchild that outlives the child (`itt` is
#      itself a script, so `sleep`/python under it is a grandchild) keeps that
#      pipe open and `$( )` blocks forever WAITING FOR EOF even after we killed
#      the child. The watchdog would fire and the hook would still hang. Writing
#      to a file removes the pipe from the picture entirely.
#   2. `set -m` puts the child in its own PROCESS GROUP so `kill -- -$pid`
#      reaches its descendants. Killing only the direct child leaves the
#      grandchild running — a leaked process per boundary, and the thing actually
#      holding resources open.
#
# `set -m` makes bash print an async "Terminated" job notification to stderr when
# the group is killed. That only happens on the timeout path, where callers key
# off rc=124 and do not read the captured stderr, so it is noise rather than a
# problem. Every `kill` is `|| true`: the child may exit between the liveness
# poll and the signal, and a failed kill must never abort the hook.
_rsl_itt() {
    local outfile="$1"; shift
    local deadline="$_RSL_ITT_TIMEOUT" waited=0 pid status
    set -m
    itt "$@" >"$outfile" &
    pid=$!
    set +m
    # Poll in 1s slices. `kill -0` is the liveness probe.
    while kill -0 "$pid" 2>/dev/null; do
        if [ "$waited" -ge "$deadline" ]; then
            kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
            return 124
        fi
        sleep 1
        waited=$((waited + 1))
    done
    wait "$pid" 2>/dev/null
    status=$?
    return "$status"
}

# ---------------------------------------------------------------------------
# ONE session, TWO representations. Do not "simplify" these into one.
#
#   harness_session_id  — the bare UUID Claude Code assigns
#                         (e.g. 36d0bf49-23d6-4837-a9a3-8dfb78d327d8).
#                         Owner: the harness. Also the transcript filename.
#   ccdash_session_id   — the same session as CCDash keys it, `S-<uuid>`.
#                         Owner: CCDash. This is what IntentTree stores in
#                         AgentRun.ccdash_session_id, because the backend passes
#                         that value VERBATIM to CCDash's
#                         `GET /api/sessions/{id}` (ccdash_client.py:152).
#
# Both names are namespaced (design-spec §10 clause 2/4); neither is ever a bare
# `session_id`. Writing the harness form into `ccdash_session_id` 404s the
# metrics pull, so the run links but CCDashMetricsPanel shows no numbers.
#
# ⚠️ The `S-` prefix is an OBSERVED CCDash CONVENTION, verified against the live
# node instance (10.42.10.76:8090) — it is NOT a published contract and CCDash
# is free to change it. Hence the env override rather than a hardcoded literal:
# a scheme change should be a config edit, not a code hunt.
#
# `AOS_CCDASH_SESSION_PREFIX` uses `${VAR-default}` (not `${VAR:-default}`) so
# that setting it to the empty string genuinely means "no prefix", while leaving
# it unset means `S-`.
#
# Deliberately NOT resolved by querying CCDash: design-spec §5 keeps CCDash a
# read-only provider that IntentTree pulls from, so the launchpad hook must not
# acquire a CCDash HTTP dependency.
# ---------------------------------------------------------------------------
_rsl_ccdash_session_id() {
    local harness_session_id="$1"
    local prefix="${AOS_CCDASH_SESSION_PREFIX-S-}"
    # Keep the prefix boring: it is concatenated into an id that becomes a URL
    # path segment server-side.
    case "$prefix" in
        *[!A-Za-z0-9_.:-]*)
            _rsl_log "AOS_CCDASH_SESSION_PREFIX has unexpected characters — using no prefix"
            prefix=""
            ;;
    esac
    printf '%s%s' "$prefix" "$harness_session_id"
}

# Derive the harness transcript path for an already-validated session id.
#
# Convention (verified empirically 2026-08-01 against a live session):
#   $HOME/.claude/projects/<mangled-cwd>/<harness_session_id>.jsonl
# where <mangled-cwd> is the absolute cwd with each of '/', '.' and '_'
# replaced by '-' (case preserved) — i.e. `tr '/._' '---'`.
#
# Deriving beats accepting a path from the environment (untrusted-input lens).
# Prints nothing unless a real, contained, boring-charset regular file exists.
_rsl_derive_transcript() {
    local sid="$1" dir cand resolved resolved_root
    [ -n "${HOME:-}" ] || return 0

    dir="$(printf '%s' "$PWD" | tr '/._' '---')"
    cand="${_RSL_TRANSCRIPT_ROOT}/${dir}/${sid}.jsonl"

    if [ ! -f "$cand" ]; then
        # The session may have been opened from a different cwd than the hook
        # runs in (e.g. the session started at the repo root, the hook runs
        # inside a worktree) — that case is real and this fallback is what
        # covers it. But "session ids are observed to be globally unique" is an
        # observation, not authorization: if the derived path is absent and two
        # project dirs both hold this uuid, picking the first would silently bind
        # ANOTHER project's transcript, and every containment check downstream
        # would still pass. So: prefer the derived path (handled above), and
        # FAIL CLOSED on ambiguity rather than guessing.
        local matches count
        matches="$(find "$_RSL_TRANSCRIPT_ROOT" -maxdepth 2 -type f -name "${sid}.jsonl" 2>/dev/null || true)"
        if [ -z "$matches" ]; then
            return 0
        fi
        count="$(printf '%s\n' "$matches" | grep -c .)"
        if [ "$count" -ne 1 ]; then
            _rsl_log "transcript for this session matched ${count} project dirs — ambiguous, refusing to guess"
            return 0
        fi
        cand="$matches"
    fi
    [ -n "$cand" ] || return 0

    # Resolve symlinks, then re-assert every property on the RESOLVED path.
    # The ROOT is resolved too: comparing a resolved path against an unresolved
    # prefix false-negatives whenever $HOME (or any ancestor) is itself a
    # symlink — e.g. macOS /var -> /private/var.
    resolved="$(realpath "$cand" 2>/dev/null || true)"
    resolved_root="$(realpath "$_RSL_TRANSCRIPT_ROOT" 2>/dev/null || true)"
    [ -n "$resolved" ] || return 0
    [ -n "$resolved_root" ] || return 0

    case "$resolved" in
        "${resolved_root}"/*) : ;;
        *) _rsl_log "transcript escaped ${resolved_root} — refusing"; return 0 ;;
    esac
    case "$resolved" in
        *..*) _rsl_log "transcript path contains '..' — refusing"; return 0 ;;
    esac
    # Boring-charset only. Keeps the value safe as a JSON string value and as an
    # argv element regardless of what the enclosing cwd happened to contain.
    case "$resolved" in
        *[!A-Za-z0-9._/-]*) _rsl_log "transcript path has unexpected characters — refusing"; return 0 ;;
    esac
    [ -f "$resolved" ] || return 0

    printf '%s' "$resolved"
}

_rsl_link_run_session() {
    # -- own gate: ON BY DEFAULT; only an explicit falsy value disables --------
    case "$(printf '%s' "${AOS_RUN_SESSION_LINK:-auto}" | tr '[:upper:]' '[:lower:]')" in
        0 | false | no | off) return 0 ;;
    esac

    # -- binding gate: both halves of the join must be present ----------------
    local node_id="${ITT_NODE_ID:-}"
    local harness_session_id="${CLAUDE_CODE_SESSION_ID:-}"
    [ -n "$node_id" ] || return 0
    [ -n "$harness_session_id" ] || return 0

    # -- validate BEFORE any value can reach the API or the filesystem --------
    if ! [[ "$harness_session_id" =~ $_HARNESS_SESSION_RE ]]; then
        _rsl_log "CLAUDE_CODE_SESSION_ID is not a canonical 8-4-4-4-12 UUID — refusing to link"
        return 0
    fi
    if ! _rsl_is_safe_id "$node_id"; then
        _rsl_log "ITT_NODE_ID has unexpected characters or a leading dash — refusing to link"
        return 0
    fi

    if ! command -v itt >/dev/null 2>&1; then
        _rsl_log "itt CLI not found — skipping (non-fatal)"
        return 0
    fi

    # Derive CCDash's representation only AFTER the bare UUID has been validated
    # above. The prefixed form is never itself validated as a UUID.
    local ccdash_session_id
    ccdash_session_id="$(_rsl_ccdash_session_id "$harness_session_id")"

    local sidecar_dir="${AOS_RUN_SESSION_HOME:-${HOME:-.}/.operator/run_sessions}"
    local sidecar="${sidecar_dir}/${node_id}.json"
    local transcript recorded_harness_session_id agent_run_id
    transcript="$(_rsl_derive_transcript "$harness_session_id")"

    # -- resolve-or-create (run API only) ------------------------------------
    # The sidecar makes creation idempotent per (node, harness session): a
    # repeat boundary in the same session refreshes the existing link and never
    # creates a second AgentRun.
    if _rsl_read_sidecar "$sidecar"; then
        recorded_harness_session_id="$_RSL_SC_SESSION"
        agent_run_id="$_RSL_SC_RUN"
    else
        recorded_harness_session_id=""
        agent_run_id=""
    fi

    if [ -n "$agent_run_id" ] && [ "$recorded_harness_session_id" = "$harness_session_id" ]; then
        _rsl_refresh_link "$agent_run_id" "$ccdash_session_id" "$transcript"
        return 0
    fi

    # -- create path: serialise it -------------------------------------------
    # Two boundaries firing concurrently for the same (node, session) could both
    # see no sidecar, both create a run, and both race to write the sidecar —
    # leaving one orphaned run. A mkdir lock is atomic, so only one proceeds.
    #
    # This serialises boundaries on THIS machine only. The distributed case is now
    # closed server-side — IntentTree migration 0041 added a partial unique index on
    # `agent_runs (node_id, ccdash_session_id)`, so two hosts cannot both own one
    # session. This lock is still worth keeping (see the CONCURRENCY note in the
    # header): the server key guards the session LINK, while the run row is created
    # a step earlier, before any session id exists to conflict on. Without the lock
    # a concurrent boundary still mints a second run — it just ends up unlinked
    # instead of double-linked.
    local lock="${sidecar_dir}/.lock.${node_id}"
    if ! _rsl_lock_acquire "$lock"; then
        _rsl_log "another boundary holds the create lock for ${node_id} — skipping create this pass"
        return 0
    fi

    # Double-check under the lock: the holder we waited behind may have just
    # written the sidecar, in which case this boundary is a refresh after all.
    if _rsl_read_sidecar "$sidecar" \
        && [ -n "$_RSL_SC_RUN" ] \
        && [ "$_RSL_SC_SESSION" = "$harness_session_id" ]; then
        agent_run_id="$_RSL_SC_RUN"
        _rsl_lock_release "$lock"
        _rsl_refresh_link "$agent_run_id" "$ccdash_session_id" "$transcript"
        return 0
    fi

    _rsl_create_run "$node_id" "$ccdash_session_id" "$harness_session_id" \
        "$transcript" "$sidecar_dir" "$sidecar"
    _rsl_lock_release "$lock"
    return 0
}

# Read `agent_run_id` / `harness_session_id` out of a sidecar into
# $_RSL_SC_RUN / $_RSL_SC_SESSION. Returns 1 (and leaves both empty) when the
# file is absent or its ids are unusable.
#
# The extraction is a permissive `sed`, so it MUST be followed by shape
# validation: a hand-edited or truncated sidecar carrying
# `"agent_run_id": "--help"` would otherwise become
# `itt run link-session --help …`, which exits 0 without linking and is then
# indistinguishable from success. A malformed sidecar is treated as no sidecar,
# so the caller creates a fresh run instead of retrying a broken one forever.
_RSL_SC_RUN=""
_RSL_SC_SESSION=""
_rsl_read_sidecar() {
    local sidecar="$1" run session
    _RSL_SC_RUN=""
    _RSL_SC_SESSION=""
    [ -f "$sidecar" ] || return 1

    run="$(sed -n 's/.*"agent_run_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sidecar" 2>/dev/null | head -1 || true)"
    session="$(sed -n 's/.*"harness_session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$sidecar" 2>/dev/null | head -1 || true)"

    if [ -z "$run" ] || ! _rsl_is_safe_id "$run"; then
        _rsl_log "sidecar ${sidecar} has a missing or malformed agent_run_id — ignoring it and creating a fresh run"
        return 1
    fi
    if [ -n "$session" ] && ! [[ "$session" =~ $_HARNESS_SESSION_RE ]]; then
        _rsl_log "sidecar ${sidecar} has a malformed harness_session_id — ignoring it and creating a fresh run"
        return 1
    fi
    _RSL_SC_RUN="$run"
    _RSL_SC_SESSION="$session"
    return 0
}

# Refresh an existing link. Idempotent server-side; re-pulls the (now larger)
# CCDash metric subset.
_rsl_refresh_link() {
    local agent_run_id="$1" ccdash_session_id="$2" transcript="$3"
    local -a itt_args=("run" "link-session" "$agent_run_id" "--session-id" "$ccdash_session_id")
    if [ -n "$transcript" ]; then
        itt_args+=("--transcript-path" "$transcript")
    fi
    local rc=0
    _rsl_itt /dev/null "${itt_args[@]}" 2>/dev/null || rc=$?
    if [ "$rc" -eq 124 ]; then
        _rsl_log "link refresh for run ${agent_run_id} exceeded ${_RSL_ITT_TIMEOUT}s and was killed — non-fatal, continuing"
    elif [ "$rc" -ne 0 ]; then
        # The CLI performs two writes (link-session, then the log_ref_url PATCH),
        # so a non-zero exit may mean either failed — the session may well still
        # be linked. Either way the next boundary retries.
        _rsl_log "link refresh incomplete for run ${agent_run_id} — non-fatal, continuing"
    fi
    return 0
}

# Atomic per-node lock. `mkdir` either creates or fails; there is no race.
# A lock older than the stale threshold is presumed abandoned (the holder was
# killed mid-create) and is reclaimed once — otherwise a single crash would
# disable the join for that node permanently.
_rsl_lock_acquire() {
    local lock="$1"
    mkdir -p "$(dirname "$lock")" 2>/dev/null || return 1
    if mkdir "$lock" 2>/dev/null; then
        return 0
    fi
    # `find -mmin +1` is portable across BSD and GNU find; `-maxdepth 0` scopes
    # it to the lock dir itself.
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null || true)" ]; then
        _rsl_log "reclaiming stale create lock ${lock}"
        rmdir "$lock" 2>/dev/null || true
        mkdir "$lock" 2>/dev/null && return 0
    fi
    return 1
}

_rsl_lock_release() {
    rmdir "$1" 2>/dev/null || true
}

# Create+start+link a run and persist the sidecar. Called under the lock.
_rsl_create_run() {
    local node_id="$1" ccdash_session_id="$2" harness_session_id="$3"
    local transcript="$4" sidecar_dir="$5" sidecar="$6"
    local -a itt_args

    # First boundary for this (node, session): one create+start+link round trip.
    # `--external` keeps the internal worker from auto-advancing a run that a
    # real harness owns; `--harness-type claude_code` satisfies §10 clause 5.
    itt_args=(
        "run" "start" "$node_id"
        "--harness-type" "claude_code"
        "--external"
        "--ccdash-session-id" "$ccdash_session_id"
    )
    if [ -n "$transcript" ]; then
        itt_args+=("--ccdash-transcript-path" "$transcript")
    fi
    # `run start` needs an agent. Either name one explicitly, or give the CLI a
    # workspace to resolve one from (GET /agents?workspace_id=…) — with NEITHER it
    # exits "no workspace configured" and the join silently never happens. Verified
    # live 2026-08-02: this was the actual first-run failure.
    if [ -n "${AOS_RUN_SESSION_AGENT_ID:-}" ]; then
        itt_args+=("--agent" "$AOS_RUN_SESSION_AGENT_ID")
    fi
    if [ -n "${INTENTTREE_WORKSPACE:-}" ]; then
        itt_args+=("--workspace" "$INTENTTREE_WORKSPACE")
    fi

    local started start_err start_out start_rc=0
    start_err="$(mktemp)"
    start_out="$(mktemp)"
    # File-based stdout, not $( ): a grandchild of a hung `itt` would hold a
    # command-substitution pipe open and hang the hook even after the watchdog
    # killed the child. See _rsl_itt's header.
    _rsl_itt "$start_out" "${itt_args[@]}" 2>"$start_err" || start_rc=$?
    started="$(tail -1 "$start_out" 2>/dev/null | tr -d '[:space:]' || true)"
    rm -f "$start_out"
    if ! _rsl_is_safe_id "$started"; then
        # Name the fix rather than just the symptom — an operator reading
        # "could not obtain an AgentRun id" has no idea which knob is missing,
        # which is the same cognitive load this milestone exists to remove.
        if [ "$start_rc" -eq 124 ]; then
            _rsl_log "itt run start exceeded ${_RSL_ITT_TIMEOUT}s and was killed — non-fatal, continuing"
        elif grep -qi 'no workspace configured' "$start_err" 2>/dev/null; then
            _rsl_log "no agent could be resolved for node ${node_id} — set AOS_RUN_SESSION_AGENT_ID=<agt_…> or INTENTTREE_WORKSPACE=<ws_…> (non-fatal, continuing)"
        else
            _rsl_log "could not obtain an AgentRun id for node ${node_id} — non-fatal, continuing"
            [ -s "$start_err" ] && _rsl_log "itt run start said: $(head -1 "$start_err")"
        fi
        rm -f "$start_err"
        return 0
    fi
    rm -f "$start_err"

    # -- persist the sidecar (atomic temp + mv), so the next boundary refreshes
    if ! mkdir -p "$sidecar_dir" 2>/dev/null; then
        _rsl_log "could not create ${sidecar_dir} — non-fatal, continuing"
        return 0
    fi
    local tmp="${sidecar}.tmp.$$" transcript_json="null"
    if [ -n "$transcript" ]; then
        transcript_json="\"${transcript}\""
    fi
    if {
        printf '{\n'
        printf '  "intenttree_node_id": "%s",\n' "$node_id"
        printf '  "agent_run_id": "%s",\n' "$started"
        printf '  "harness_session_id": "%s",\n' "$harness_session_id"
        printf '  "ccdash_session_id": "%s",\n' "$ccdash_session_id"
        printf '  "harness_type": "claude_code",\n'
        printf '  "transcript_ref": %s,\n' "$transcript_json"
        printf '  "linked_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '}\n'
    } >"$tmp" 2>/dev/null && mv -f "$tmp" "$sidecar" 2>/dev/null; then
        :
    else
        rm -f "$tmp" 2>/dev/null || true
        _rsl_log "could not write sidecar ${sidecar} — non-fatal, continuing"
    fi
    return 0
}

_rsl_link_run_session || _rsl_log "aborted unexpectedly — non-fatal, continuing"

# ===========================================================================
# SECTION 2 — `itt sync import` status propagation (pre-existing behaviour)
# ===========================================================================

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

# ===========================================================================
# SECTION 3 (M4, operator-p0-state-integrity) — plan-status vs node-status drift check
#
# Report-only (plan decision OQ-3 — never writes to a node or a file). Runs
# `plan-node-drift.py` on the SAME (file, node) pair section 2 just synced against, so a
# plan whose frontmatter `status` disagrees with its bound node's live status is surfaced
# right where the sync itself just ran — the exact silent-drift class named in tracker
# node_01KZ9B4KJ1CJPMVN78ZFE9AT1A.
#
# Guard: own master switch (AOS_PLAN_NODE_DRIFT, default on) + its own binding gate — a
# node id, not just a tree, since the comparison is one plan vs one node. `ITT_NODE_ID`
# wins when set (matches section 1/2's env-over-frontmatter precedence); otherwise this
# reads the file's own `itt_node_id:` frontmatter directly (mirrors the `TREE` derivation
# a few lines above). No node id resolvable from either source -> silent no-op, zero
# `plan-node-drift.py` invocations — the check has nothing to compare against a tree.
#
# ⚠️ Non-fatal means non-fatal, NOT silent-on-detection: a swallowed detection is the
# failure this milestone exists to end (a blanket `trap 'exit 0' ERR` once ate a guard's
# own exit code — see .claude/rules/shared-checkout-safety.md). So this section ALWAYS
# exits 0 regardless of the checker's own exit code (0 clean / 1 usage error / 2 mismatch
# found) — but a mismatch's reason lines are always echoed to stderr first. Never
# `2>/dev/null` this block.
# ===========================================================================
DRIFT_NODE_ID="${ITT_NODE_ID:-}"
if [ -z "${DRIFT_NODE_ID}" ]; then
    DRIFT_NODE_ID="$(sed -n 's/^itt_node_id:[[:space:]]*//p' "${SDLC_SYNC_FILE}" 2>/dev/null | head -1 | tr -d '"'\''[:space:]' || true)"
fi

case "$(printf '%s' "${AOS_PLAN_NODE_DRIFT:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off) : ;;  # hard off — skip section 3 entirely, fall through to exit 0
    *)
        if [ -n "${DRIFT_NODE_ID}" ]; then
            DRIFT_ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../artifact-tracking/scripts" && pwd)"
            DRIFT_ENGINE="${DRIFT_ENGINE_DIR}/plan-node-drift.py"
            DRIFT_PYTHON="${AOS_PLAN_NODE_DRIFT_PYTHON:-python3}"
            if [ ! -r "${DRIFT_ENGINE}" ]; then
                echo "[sdlc-sync] plan-node-drift engine not found at ${DRIFT_ENGINE} — skipping (non-fatal)" >&2
            elif ! command -v "${DRIFT_PYTHON}" >/dev/null 2>&1; then
                echo "[sdlc-sync] ${DRIFT_PYTHON} not found — skipping plan-node-drift check (non-fatal)" >&2
            else
                # set +e / set -e around the capture: this script runs under `set -e`, and
                # `var=$(cmd)` propagates cmd's exit status to the assignment itself — under
                # errexit that ends the script BEFORE the `DRIFT_RC=$?` line below ever runs,
                # for any nonzero rc (mismatch=2 included). That is precisely the "swallowed
                # detection" failure mode named in this section's header comment, just via
                # `errexit` instead of a `trap ERR` — same bug, different mechanism. Verified
                # to reproduce with a real `set -e` script before this guard was added.
                set +e
                DRIFT_OUT="$("${DRIFT_PYTHON}" "${DRIFT_ENGINE}" \
                    --repo-root "$(pwd)" \
                    --binding "${SDLC_SYNC_FILE}:${DRIFT_NODE_ID}" 2>&1)"
                DRIFT_RC=$?
                set -e
                if [ "${DRIFT_RC}" -eq 2 ]; then
                    # rc==2 = an actionable finding: a status MISMATCH, or a binding error (plan
                    # file absent / no status frontmatter / unrecognized status on either side).
                    # Both must be surfaced — this is the detection the check exists for.
                    echo "[sdlc-sync] plan/node drift or binding error for ${SDLC_SYNC_FILE} (node ${DRIFT_NODE_ID}) — reported, not corrected:" >&2
                    printf '%s\n' "${DRIFT_OUT}" >&2
                elif [ "${DRIFT_RC}" -ne 0 ]; then
                    echo "[sdlc-sync] plan-node-drift check could not complete (rc=${DRIFT_RC}) — non-fatal, continuing" >&2
                    printf '%s\n' "${DRIFT_OUT}" >&2
                fi
                # rc==0: clean, or an UNREACHABLE-class error only (node API/CLI down) — quiet,
                # matching the sibling hooks' happy-path silence. Only a transient-reachability
                # failure is silent now; an actionable binding error forces rc==2 above.
            fi
        fi
        ;;
esac

# Always exit 0 — hook must never block the calling workflow
exit 0
