#!/usr/bin/env bash
# =============================================================================
# itt-claim.sh — atomic IntentTree node claim for execution lanes
# =============================================================================
#
# PURPOSE:
#   Make "this node is being worked by someone" a FACT a second session can read,
#   instead of a convention each session re-derives. `POST /nodes/{id}/claim` is
#   atomic and row-locked, but until now no execution lane called it: `/itt:run`
#   said "do not pre-claim", `/dev:autopilot` stamped `node update --status
#   in_progress --meta autopilot_run=1` (not a claim, and it happily overwrites
#   one), and the result was node_01KZP8EVS63MEEF12YK6Z70C5N implemented TWICE on
#   2026-08-10 by two sessions touching the same two files.
#
#   Origin: node_01KZPHD6SV77SSS523BKAJYBBK. Prose telling lanes to claim is what
#   already failed, so this is a mechanism (same reasoning as
#   `.claude/rules/mode-d-enforcement.md`: the boundary is a mechanism, not a
#   sentence in a brief).
#
# VERBS:
#   acquire <node_id>   take the claim. THE gate — see EXIT CODES.
#   status  <node_id>   print claim state + resolved holder. Never mutates.
#   reap                release claims held past the TTL (workspace-wide sweep).
#   actor               print this session's claim actor id.
#   renew   <node_id>   refresh the claim you hold (the liveness half). See
#                       EXIT CODES (renew) below — a 409 here is exit 7, not a
#                       bare non-zero: it means your guard was withdrawn MID-RUN.
#   renew-daemon <node_id> [--interval S] [--max-minutes M]
#                       arm a bounded background cadence so a long lane keeps
#                       proving liveness. Started automatically by `acquire`
#                       unless ITT_CLAIM_RENEW=0.
#   renew-stop <node_id>   stop that cadence (does NOT release the claim).
#   release <node_id>   hand the claim back (see THE RELEASE PRIMITIVE). Never
#                       fails the caller; degrades loudly to the reap TTL.
#
# EXIT CODES (acquire):
#   0  claim HELD by this session — proceed.
#   3  CONFLICT: another actor holds it. The holder is named and resolved against
#      Claude Code's session registry. HARD — route to `report`, do not execute.
#   4  NOT CLAIMABLE: terminal status (completed/archived/deferred). HARD.
#   5  SUSPECT: unclaimed `in_progress` atomic node — a prior run may have crashed
#      OR may be live-but-unclaimed. HARD: the caller owes an evidence pass
#      (`/itt:run` Action 4c) before it may re-attempt with --adopt.
#
#   ⚠️ 3 SHADOWS 4. The server tests claim-ownership BEFORE status, so a terminal
#   node still carrying a stale claim reports CONFLICT (3), not terminal (4) —
#   observed on an archived node holding a claim that `complete` never cleared.
#   Benign in practice only because `/itt:run` Action 4 routes `completed` to
#   `report` before the claim step ever runs. Do not read a 3 as proof the node is
#   runnable-but-taken; read the status line it prints.
#   1  usage error. Deliberately 1, NOT 2 — a guard that reports a breach when it
#      merely misparsed a flag is one people learn to wave through
#      (mode-d-enforcement.md's argparse-collision precedent).
#   0  + a LOUD stderr warning on INFRA failure (no token, no network, no curl,
#      no derivable actor id — no OP_RUN_ID and no session id). Fail-open,
#      deliberately: see FAILURE POSTURE.
#   6  ITT_CLAIM_REQUIRE_ACTOR is set and no actor id could be derived. NEW.
#      Deliberately NOT 2, for the same reason usage errors above are 1 and not
#      2 (mode-d-enforcement.md's argparse-collision precedent): reusing another
#      guard's exit code trains people to wave this one through as "the usual
#      thing" too. And deliberately NOT the same as the fail-open 0 above — this
#      is the one knob that turns that fail-open into a hard failure, so it must
#      be visibly distinct from both. The warning names which of ITT_CLAIM_ACTOR /
#      OP_RUN_ID / CLAUDE_CODE_SESSION_ID would have satisfied it.
#
# FAILURE POSTURE (why infra failure is fail-open but conflict is not):
#   Mirrors `infra/git-guard/git_guard_preflight.sh`. An internal/infra error must
#   never wedge a session — off-LAN, the node API is simply unreachable and work
#   must still proceed exactly as it did before this script existed. But a
#   DETECTED conflict is never downgraded to silence: degrading a detected failure
#   into a clean exit is the false-assurance class this script exists to end.
#   Concretely: unreachable API => exit 0 + warning; holder found => exit 3.
#   The one exception is actor DERIVATION, not API reachability: an underivable
#   actor is fail-open (exit 0 + warning) by default, same posture as always —
#   but `ITT_CLAIM_REQUIRE_ACTOR` flips that specific case to a hard exit 6. That
#   is a caller opting IN to strictness for its own unit of work, not a change to
#   the default posture for anyone who never sets it.
#
# THE ACTOR ID IS SCOPED TO THE UNIT OF WORK, AND THAT IS LOAD-BEARING:
#   `claim_node` is IDEMPOTENT for the same actor id — re-claiming a node you
#   already hold returns 200 (verified against the live API 2026-08-10). So a
#   SHARED actor id defeats the mutex completely: two concurrent units both
#   claiming as `agent:operator` would BOTH get 200. The id must therefore be
#   UNIQUE per concurrent unit of work and STABLE across every hop of the SAME
#   unit — a per-invocation id would claim once and then be unable to re-acquire
#   its own node, converting the mutex into a self-wedge.
#
#   For an interactive Claude Code session, the unit of work IS the session, so
#   the id is derived from CLAUDE_CODE_SESSION_ID (matching `aos-git`'s session
#   key so `aos-git who` and a claim holder are cross-referenceable).
#
#   For `op hop` — the planned stateless multi-process runner, where a "unit of
#   work" spans MANY hops and EACH HOP IS A NEW PROCESS with no Claude session id
#   at all (node_01KZPNWVS71K40246WBRHF7FC1) — CLAUDE_CODE_SESSION_ID is either
#   absent or belongs to whatever unrelated session happens to be dispatching the
#   hop, not to the unit of work. Un-derivable, the script fell into the fail-open
#   branch and took NO CLAIM AT ALL while every wire-up above it looked correct.
#   The obvious "fix" — derive per-process from whatever session id IS present —
#   is actively worse: hop N claims under session id S1, hop N returns a
#   non-terminal `continue` envelope, hop N+1 runs as a different process (S2 or
#   none), derives a DIFFERENT actor, and 409-conflicts against ITS OWN
#   PREDECESSOR. A per-node release (see THE RELEASE PRIMITIVE) does not rescue
#   this: hop N+1 is not the holder, so it gets a 409, and that self-conflict
#   wedges the unit of work for the full 30-minute reap TTL — a worse failure
#   than the one being fixed.
#
#   So for a hop, the actor is derived from OP_RUN_ID — the op run-record id,
#   which IS the unit of work, minted once and threaded unchanged through every
#   hop's process — as `agent:hop-<first 16 hex chars of sha256(OP_RUN_ID)>`.
#
#   WHY A HASH AND NOT A PREFIX — do not "simplify" this, it is the whole
#   correctness argument. `new_run_id()` (`src/operator_core/core/runrecord.py`)
#   mints `f"op_run_{now:%Y%m%d_%H%M%S}_{slugify(request, max_len=24)}"`, so a
#   real id looks like `op_run_20260810_085528_reconcile-persona-memory` — up to
#   47 chars, with a CONSTANT 7-char `op_run_` prefix and its only sub-second
#   differentiator (the slug) at the TAIL. A left-truncating derivation
#   (`cut -c1-8`-shaped) therefore yields `op_run_2` for EVERY run ever minted,
#   which collapses every concurrent unit onto one actor id — and because
#   `claim_node` is idempotent for that id, hands BOTH racing units a 200 and
#   deletes the mutex entirely while looking wired. A hash is uniform over the
#   WHOLE id, makes no assumption about the id's shape, and survives a future
#   run-id format change; see `sha256_hex16()` below and the anti-truncation
#   regression test (`test_itt_claim_protocol.py`) that pins exactly this.
#
#   WHY OP_RUN_ID IS CHECKED *BEFORE* THE SESSION ID: if a hop happens to run
#   inside a Claude Code session, the unit-of-work scope is STILL the run, not
#   the session — otherwise hop N+1, running in a different process/session,
#   409s against hop N exactly as in the "obvious fix" paragraph above. This
#   implies a boundary: exactly ONE claimer per unit of work. A session that
#   dispatches `op hop` must not ALSO claim the node itself; if it needs to, it
#   exports ITT_CLAIM_ACTOR so both sides derive the same id (ITT_CLAIM_ACTOR
#   still wins over everything — unchanged).
#
#   Portability: the node is Fedora, the laptop is macOS — `sha256_hex16()`
#   tries `sha256sum`, then `shasum -a 256`, then a `python3` fallback (python3
#   is already a hard dependency of this script elsewhere), and asserts exactly
#   16 hex chars came back. An empty or short hash must NOT silently become a
#   short — and therefore more collision-prone — actor id.
#
#   ⚠️ Hermes claims as the fixed `agent:hermes` and is therefore NOT protected by
#   this mutex against its own concurrent wakes (filed upstream).
#
# THE RELEASE PRIMITIVE (upstream intenttree 2151c3e1 — closes THE RELEASE GAP):
#   `POST /nodes/{id}/release` with {"claimed_by_actor_id": <actor>} clears the
#   claim for the HOLDING actor and, when the claim was what moved the node
#   ready -> in_progress, returns it to `ready`. Idempotent when unclaimed; 409
#   when held by a different actor. `release` uses it.
#
#   The three facts that made this a gap are all still true, and are why the
#   fallback path below must never "improvise" a release:
#     - `NodeUpdate` has no `claimed_by_actor_id` field, so `itt node update
#       --status ready` leaves the claim SET. `/dev:autopilot`'s documented
#       release did exactly this, which wedged the node against every other
#       session while looking like a release.
#     - `itt node complete` does NOT clear the claim either.
#     - `POST /nodes/reap-stale-claims` clears it workspace-wide, TTL>=1min.
#   So `acquire` still reaps FIRST (precedent: hermes-loop-preclaim.sh step 3),
#   which makes an abandoned claim self-heal within the TTL rather than wedge
#   forever — the primitive is the fast path, not a replacement for the backstop.
#   ⚠️ Do NOT reach for a short TTL to "release" your own claim: the sweep is
#   workspace-wide and collateral. One `ttl_minutes=1` call during this node's
#   investigation reported `reverted: 2`. Release the specific node instead.
#   ⚠️ A deployment that predates 2151c3e1 answers 404. That is expected and
#   non-fatal: `release` says so and leaves the TTL as the backstop.
#
# ENVIRONMENT:
#   AOS_ITT_CLAIM        ON BY DEFAULT. Only an explicit falsy value
#                        ("0"/"false"/"no"/"off") disables; unset/"1"/"true"/
#                        "auto" all enable. Disabled => exit 0 + a notice, so the
#                        caller proceeds exactly as it did pre-fix.
#   ITT_CLAIM_ACTOR      override the derived actor id (<=40 chars, DB column).
#                        Wins over everything, including OP_RUN_ID.
#   OP_RUN_ID            the op run-record id — the unit of work for `op hop`.
#                        When set (and ITT_CLAIM_ACTOR is not), the actor is
#                        `agent:hop-<16-hex sha256 prefix of OP_RUN_ID>`, checked
#                        BEFORE the session id (see THE ACTOR ID section above).
#   ITT_CLAIM_REQUIRE_ACTOR
#                        truthy => an underivable actor is a HARD failure (exit
#                        6), not the default fail-open. Intended for `op hop`: a
#                        unit of work that forgot to export OP_RUN_ID must fail
#                        loudly rather than run unguarded. Does NOT override
#                        AOS_ITT_CLAIM=0 — the master switch is checked first and
#                        still wins (an explicit global off is not a
#                        require-actor breach).
#   OP_HOME              consulted only by `status`'s holder resolution for an
#                        `agent:hop-*` actor, to scan run-record directories
#                        (`./.operator/runs` and `~/.operator/runs` when unset).
#                        Never required for `acquire`/`claim` itself.
#   ITT_CLAIM_REAP_TTL   reap TTL in minutes for `acquire`/`reap` (default 30 —
#                        the server's own documented default).
#   ITT_CLAIM_RENEW      ON BY DEFAULT. Only an explicit falsy value
#                        ("0"/"false"/"no"/"off") stops `acquire` from arming the
#                        renew cadence. The cadence is what makes a long lane's
#                        liveness a FACT rather than an inference, so turning it
#                        off restores the age-only reap exposure for that run.
#   ITT_CLAIM_RENEW_INTERVAL
#                        seconds between renewals (default 600 — three renewals
#                        per 30-minute TTL window, so one lost renewal is not
#                        fatal; minimum 30).
#   ITT_CLAIM_RENEW_MAX_MINUTES
#                        absolute cadence lifetime (default 1440, matching the
#                        server's own _DEFAULT_MAX_CLAIM_HOLD_MINUTES). This is
#                        the ONLY bound on a heartbeating claim — see the ceiling
#                        note above `do_renew_daemon`.
#   AOS_ITT_RENEW_DIR    cadence state dir (default ~/.cache/aos/itt-renew).
#   ITT_CLAIM_ADOPT      truthy => permit acquiring an unclaimed `in_progress`
#                        node (the exit-5 SUSPECT case). Set only AFTER the
#                        evidence pass; it is an acknowledgement, not a bypass.
#   INTENTTREE_API_URL / INTENTTREE_API_TOKEN
#                        override; otherwise resolved from the `itt` CLI's own
#                        precedence via `itt --json config list` (ONE derivation
#                        site — this script never re-implements that precedence).
#
# SECURITY:
#   The bearer token is never echoed, never passed on a visible argv (curl reads
#   it from a header file on stdin-free fd), and never written to a temp file that
#   outlives the call. Note that `itt --json config list` itself prints the token
#   UNMASKED in its `file` block; this script captures that stream and never
#   re-emits it.
#
# OFFLINE/TEST: ITT_CLAIM_CURL lets the test suite substitute a stub transport.
# =============================================================================

set -uo pipefail

PROG="$(basename "$0")"

# ---- output helpers ----------------------------------------------------------
warn()  { printf '[itt-claim] %s\n' "$*" >&2; }
note()  { printf '[itt-claim] %s\n' "$*"; }

usage() {
    cat >&2 <<EOF
usage: $PROG acquire <node_id>   take the claim (exit 0 held / 3 conflict / 4 terminal / 5 suspect)
       $PROG status  <node_id>   print claim state + resolved holder (read-only)
       $PROG renew   <node_id>   refresh the claim (exit 0 renewed / 7 CLAIM LOST / 4 no node)
       $PROG renew-daemon <node_id> [--interval S] [--max-minutes M]
                                 arm a bounded background renew cadence
       $PROG renew-stop <node_id>   stop the cadence (does NOT release the claim)
       $PROG release <node_id>   hand the claim back (falls back to the reap TTL)
       $PROG reap [--ttl <min>]  release claims older than the TTL (workspace-wide)
       $PROG actor               print this session's claim actor id
EOF
    exit 1
}

# ---- master switch -----------------------------------------------------------
case "${AOS_ITT_CLAIM:-1}" in
    0|false|FALSE|no|NO|off|OFF)
        note "disabled by AOS_ITT_CLAIM — no claim taken, caller proceeds unguarded"
        exit 0
        ;;
esac

# ---- actor id ----------------------------------------------------------------
# Stability across every hop of one unit of work is the requirement. A
# per-invocation id would claim once and then be unable to re-acquire its own
# node, converting the mutex into a self-wedge. See "THE ACTOR ID IS SCOPED TO
# THE UNIT OF WORK" above for why OP_RUN_ID is hashed, and why it is checked
# before the session id.

# sha256_hex16 <input> -> first 16 hex chars of sha256(<input>) on stdout, or
# non-zero if fewer than 16 hex chars could be produced. Uniform over the WHOLE
# input deliberately — never truncate the input itself before hashing.
sha256_hex16() {
    local input="$1" raw=""
    if command -v sha256sum >/dev/null 2>&1; then
        raw="$(printf '%s' "$input" | sha256sum 2>/dev/null)"
    elif command -v shasum >/dev/null 2>&1; then
        raw="$(printf '%s' "$input" | shasum -a 256 2>/dev/null)"
    elif command -v python3 >/dev/null 2>&1; then
        raw="$(printf '%s' "$input" | python3 -c '
import hashlib, sys
sys.stdout.write(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())
' 2>/dev/null)"
    else
        return 1
    fi
    # Strip everything but hex digits — sha256sum/shasum append "  -" (the
    # stdin filename marker) after the digest; the digest itself is untouched
    # by this filter since none of its characters are non-hex.
    local hex; hex="$(printf '%s' "$raw" | tr -cd '[:xdigit:]' | cut -c1-16)"
    [ "${#hex}" -eq 16 ] || return 1
    printf '%s' "$hex"
}

derive_actor() {
    if [ -n "${ITT_CLAIM_ACTOR:-}" ]; then printf '%s' "$ITT_CLAIM_ACTOR"; return 0; fi
    if [ -n "${OP_RUN_ID:-}" ]; then
        local h
        h="$(sha256_hex16 "$OP_RUN_ID")" || return 1
        printf 'agent:hop-%s' "$h"
        return 0
    fi
    local sid="${CLAUDE_CODE_SESSION_ID:-${AOS_GIT_SESSION:-}}"
    [ -n "$sid" ] || return 1
    printf 'agent:cc-%s' "$(printf '%s' "$sid" | tr -cd '[:alnum:]-' | cut -c1-8)"
}

ACTOR="$(derive_actor || true)"
if [ -z "$ACTOR" ]; then
    case "${ITT_CLAIM_REQUIRE_ACTOR:-}" in
        1|true|TRUE|yes|YES|on|ON)
            # A caller opted IN to strictness for its own unit of work: an
            # underivable actor here means a hop forgot to export its unit id,
            # and running unguarded would be silent, not safe. Loud + hard.
            warn "ITT_CLAIM_REQUIRE_ACTOR is set and no actor id could be derived."
            warn "One of ITT_CLAIM_ACTOR / OP_RUN_ID / CLAUDE_CODE_SESSION_ID (or"
            warn "AOS_GIT_SESSION) would have satisfied it. Refusing to run unguarded."
            exit 6
            ;;
    esac
    # Fail-open (default posture, unchanged): no OP_RUN_ID and no session id
    # means we cannot mint a STABLE id, and an unstable one is worse than none
    # (it would wedge the node against its own unit of work).
    warn "no ITT_CLAIM_ACTOR / OP_RUN_ID / CLAUDE_CODE_SESSION_ID / AOS_GIT_SESSION —"
    warn "cannot mint a stable actor id, so NO CLAIM WAS TAKEN. Concurrent execution"
    warn "of this node is UNGUARDED."
    exit 0
fi
if [ "${#ACTOR}" -gt 40 ]; then
    warn "actor id '${ACTOR}' exceeds the 40-char DB column; truncating"
    ACTOR="$(printf '%s' "$ACTOR" | cut -c1-40)"
fi

# ---- API resolution (single derivation site: the itt CLI's own precedence) ----
API_URL=""
API_TOKEN=""
resolve_api() {
    API_URL="${INTENTTREE_API_URL:-}"
    API_TOKEN="${INTENTTREE_API_TOKEN:-}"
    if [ -n "$API_URL" ] && [ -n "$API_TOKEN" ]; then return 0; fi
    command -v itt >/dev/null 2>&1 || return 1
    local cfg
    cfg="$(itt --json config list 2>/dev/null)" || return 1
    [ -n "$cfg" ] || return 1
    # Parsed in python, not sed: the token must not traverse a shell word split
    # and must not land in a temp file.
    local parsed
    parsed="$(printf '%s' "$cfg" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
r=d.get("resolved") or {}; f=d.get("file") or {}
url=r.get("api_url") or f.get("api_url") or ""
tok=f.get("api_token") or ""
if (r.get("api_token") or "") not in ("","***"): tok=r["api_token"]
if not url or not tok: sys.exit(1)
print(url); print(tok)
' 2>/dev/null)" || return 1
    [ -n "$parsed" ] || return 1
    [ -n "$API_URL" ]   || API_URL="$(printf '%s' "$parsed"   | sed -n 1p)"
    [ -n "$API_TOKEN" ] || API_TOKEN="$(printf '%s' "$parsed" | sed -n 2p)"
    [ -n "$API_URL" ] && [ -n "$API_TOKEN" ]
}

CURL="${ITT_CLAIM_CURL:-curl}"

# api <method> <path> [json-body] -> prints "<http_code>\n<body>"; non-zero on transport failure.
api() {
    local method="$1" path="$2" body="${3:-}"
    command -v "$CURL" >/dev/null 2>&1 || return 1
    local args=(-sS --max-time 20 -o /dev/stdout -w '\n%{http_code}'
                -X "$method" "${API_URL}${path}"
                -H "Authorization: Bearer ${API_TOKEN}")
    if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' -d "$body"); fi
    "$CURL" "${args[@]}" 2>/dev/null
}

# Split the api() output into $HTTP_CODE / $HTTP_BODY.
call() {
    local raw
    raw="$(api "$@")" || return 1
    HTTP_CODE="$(printf '%s' "$raw" | tail -n1)"
    HTTP_BODY="$(printf '%s' "$raw" | sed '$d')"
    case "$HTTP_CODE" in [0-9][0-9][0-9]) : ;; *) return 1 ;; esac
}

api_message() {
    printf '%s' "${HTTP_BODY:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(""); sys.exit(0)
e=d.get("error")
print((e or {}).get("message","") if isinstance(e,dict) else "")
' 2>/dev/null
}

node_field() {
    printf '%s' "${HTTP_BODY:-}" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
print(d.get(sys.argv[1]) if d.get(sys.argv[1]) is not None else "")
' "$1" 2>/dev/null
}

# ---- holder resolution -------------------------------------------------------
# AC2 wants the holder NAMED, which means resolvable to something actionable.
# `agent:cc-<8 hex>` is a prefix of a Claude Code sessionId, and Claude Code
# registers every live session as ~/.claude/sessions/<pid>.json.
resolve_holder() {
    local holder="$1"
    printf '  holder: %s\n' "$holder"
    case "$holder" in
        agent:cc-*)  resolve_holder_cc  "${holder#agent:cc-}" ;;
        agent:hop-*) resolve_holder_hop "${holder#agent:hop-}" ;;
        *)  printf '  (not a Claude Code session actor — Hermes, another machine, or a service)\n'
            return 0 ;;
    esac
}

resolve_holder_cc() {
    local prefix="$1"
    python3 - "$prefix" <<'PY'
import glob, json, os, sys
prefix = sys.argv[1]
found = False
for p in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try:
        with open(p) as fh: d = json.load(fh)
    except Exception:
        continue
    if not str(d.get("sessionId", "")).startswith(prefix):
        continue
    found = True
    pid = d.get("pid")
    alive = "unknown"
    if isinstance(pid, int):
        try:
            os.kill(pid, 0); alive = "ALIVE"
        except ProcessLookupError:
            alive = "DEAD"
        except PermissionError:
            alive = "ALIVE"
    print(f"  resolved: pid={pid} [{alive}] name={d.get('name')!r} status={d.get('status')!r}")
    print(f"            cwd={d.get('cwd')}")
    print(f"            sessionId={d.get('sessionId')}")
if not found:
    # UNMEASURED is not "nobody" — same fail-open reading as `aos-git who`.
    print("  resolved: NOT FOUND in this machine's session registry.")
    print("            That means UNMEASURED, not 'nobody holds it' — the holder may be")
    print("            on another machine, a Hermes/Codex leg, or an exited session whose")
    print("            claim has not yet aged past the reap TTL.")
PY
}

# `agent:hop-<16 hex>` is the hop actor's hash, not a reversible id — there is no
# registry of live OP_RUN_IDs to look up, so the only way to NAME the holder is
# to re-hash every run-record directory name found under the same roots
# `sha256_hex16` would have hashed and look for a match. Pure local file read —
# no network, no model (AOS constraint 4).
resolve_holder_hop() {
    local hash="$1"
    local -a roots
    if [ -n "${OP_HOME:-}" ]; then
        roots=("$OP_HOME")
    else
        roots=("./.operator/runs" "${HOME}/.operator/runs")
    fi
    python3 - "$hash" "${roots[@]}" <<'PY'
import datetime, hashlib, json, os, sys

target = sys.argv[1]
roots = sys.argv[2:]
found = False
unreadable = []
for root in roots:
    root = os.path.expanduser(root)
    if not os.path.isdir(root):
        continue
    # isdir() proves existence, NOT readability. An existing-but-unreadable root must
    # degrade to the UNMEASURED message below, never to a traceback: this whole branch
    # is a best-effort diagnostic, and a crash dump here would be the one path in the
    # script that fails loudly-and-uselessly instead of loudly-and-clearly.
    try:
        entries = sorted(os.listdir(root))
    except OSError as exc:
        unreadable.append(f"{root} ({type(exc).__name__})")
        continue
    for entry in entries:
        run_dir = os.path.join(root, entry)
        if not os.path.isdir(run_dir):
            continue
        if hashlib.sha256(entry.encode()).hexdigest()[:16] != target:
            continue
        found = True
        print(f"  resolved: run_id={entry}")
        print(f"            root={root}")
        run_json = os.path.join(run_dir, "run.json")
        if not os.path.isfile(run_json):
            print("            (no run.json under this run dir)")
            continue
        # getmtime lives INSIDE this try on purpose: a file that vanishes or turns
        # unreadable between the open() and the stat() would otherwise raise here,
        # outside any guard. Tight window, but the cost of losing the race is a
        # traceback in place of a diagnostic.
        try:
            with open(run_json) as fh:
                d = json.load(fh)
            mtime = datetime.datetime.fromtimestamp(
                os.path.getmtime(run_json)
            ).isoformat(timespec="seconds")
        except Exception:
            print("            (run.json present but unreadable or unparsable)")
            continue
        print(f"            status={d.get('status')!r} node={d.get('intenttree_node')!r} mtime={mtime}")
if not found:
    # NOT FOUND is UNMEASURED, not "nobody holds it" — same reading as the cc branch
    # and `aos-git who`: the run record may live under a different OP_HOME, on
    # another host, or the holder may be an exited unit whose claim has not yet
    # aged past the reap TTL.
    if unreadable:
        # "I could not look" must never be reported as "I looked and found nothing".
        print(f"  resolved: COULD NOT SCAN {', '.join(unreadable)} — permission or IO error.")
    print("  resolved: NOT FOUND under this host's op run-record roots.")
    print("            That means UNMEASURED, not 'nobody holds it' — the run record may")
    print("            live under a different OP_HOME, on another host, or the holder may")
    print("            be an exited unit whose claim has not yet aged past the reap TTL.")
PY
}

# ---- verbs -------------------------------------------------------------------
do_reap() {
    local ttl="${1:-${ITT_CLAIM_REAP_TTL:-30}}"
    if ! call POST "/api/v1/nodes/reap-stale-claims?ttl_minutes=${ttl}"; then
        warn "reap: transport failure — skipped (non-fatal)"; return 0
    fi
    case "$HTTP_CODE" in
        200) note "reap(ttl=${ttl}m): $(printf '%s' "$HTTP_BODY" | tr -d '\n')" ;;
        *)   warn "reap: HTTP $HTTP_CODE — skipped (non-fatal)" ;;
    esac
    return 0
}

do_status() {
    local node="$1"
    if ! call GET "/api/v1/nodes/${node}"; then
        warn "status: API unreachable — claim state UNKNOWN (not 'unclaimed')"; return 0
    fi
    if [ "$HTTP_CODE" != "200" ]; then
        warn "status: HTTP $HTTP_CODE — $(api_message)"; return 0
    fi
    local st ty cb
    st="$(node_field status)"; ty="$(node_field type)"; cb="$(node_field claimed_by_actor_id)"
    printf 'node   : %s\nstatus : %s\ntype   : %s\nclaim  : %s\nme     : %s\n' \
        "$node" "$st" "$ty" "${cb:-<unclaimed>}" "$ACTOR"
    [ -n "$cb" ] && resolve_holder "$cb"
    return 0
}

# _arm_renew_cadence <node_id> — called on every successful `acquire`.
# Default-on for the same reason the claim itself is a script and not a paragraph:
# a cadence each lane has to remember to start is a cadence that does not run.
# Non-fatal always — failing to arm liveness must never fail the claim that
# already succeeded.
_arm_renew_cadence() {
    case "${ITT_CLAIM_RENEW:-1}" in
        0|false|FALSE|no|NO|off|OFF)
            warn "renew cadence DISABLED by ITT_CLAIM_RENEW — this claim now ages out on the"
            warn "  server TTL (default 30m) even while this run is still working."
            return 0
            ;;
    esac
    do_renew_daemon "$1" >/dev/null 2>&1 || {
        warn "could not arm the renew cadence (non-fatal) — the claim is HELD but its liveness"
        warn "  is unproven, so a run longer than the reap TTL may lose it. \`${PROG} renew ${1}\`"
        warn "  refreshes it by hand; \`${PROG} renew-daemon ${1}\` retries the cadence."
        return 0
    }
    note "renew cadence armed (every ${ITT_CLAIM_RENEW_INTERVAL:-600}s) — liveness is now a fact, not an inference"
    return 0
}

do_acquire() {
    local node="$1"

    resolve_api || {
        warn "cannot resolve the IntentTree API (no token/url, or \`itt\` absent) — NO CLAIM TAKEN."
        warn "Concurrent execution of ${node} is UNGUARDED. This is the pre-fix behaviour, not a pass."
        return 0
    }

    # 1. Reap first, so an abandoned claim self-heals instead of wedging. A crashed
    #    session never reaches `release`, so the TTL sweep stays the only cleaner
    #    for the abandoned case even now that a per-node release exists.
    do_reap >/dev/null || true

    # 2. Attempt the claim AS-IS before touching status. Ordering is load-bearing:
    #    promoting to `ready` first would flip a node ANOTHER session currently
    #    holds from in_progress to ready before we ever discover it is held.
    local body
    body="$(printf '{"claimed_by_actor_id":"%s"}' "$ACTOR")"
    if ! call POST "/api/v1/nodes/${node}/claim" "$body"; then
        warn "claim: transport failure — NO CLAIM TAKEN, execution of ${node} is UNGUARDED"
        return 0
    fi

    case "$HTTP_CODE" in
        200)
            note "claim HELD on ${node} by ${ACTOR}"
            _arm_renew_cadence "$node"
            return 0
            ;;
        404)
            warn "claim: node ${node} not found — check the id"
            return 4
            ;;
        409) : ;;
        *)
            warn "claim: unexpected HTTP $HTTP_CODE ($(api_message)) — NO CLAIM TAKEN, UNGUARDED"
            return 0
            ;;
    esac

    # 3. Two very different 409s. Only one of them is a conflict.
    local msg; msg="$(api_message)"
    case "$msg" in
        *"already claimed by"*)
            warn "CONFLICT: ${node} is already claimed."
            resolve_holder "$(printf '%s' "$msg" | sed -n "s/.*already claimed by '\([^']*\)'.*/\1/p")" >&2
            warn "Route to the 'report' lane. Do NOT execute; do NOT destroy the holder's branch or worktree."
            return 3
            ;;
        *"not claimable"*) : ;;
        *)
            warn "claim: unrecognised 409 (${msg}) — NO CLAIM TAKEN, UNGUARDED"
            return 0
            ;;
    esac

    # 4. Not-claimable-by-status. `claim_node` only accepts `ready`, and almost
    #    every real node is `not_started`, so a promote-then-retry is required for
    #    the claim to be reachable at all.
    local cur; cur="$(printf '%s' "$msg" | sed -n "s/.*status is '\([^']*\)'.*/\1/p")"
    case "$cur" in
        completed|archived|deferred)
            warn "${node} is '${cur}' — terminal, not claimable. Nothing to run."
            return 4
            ;;
        in_progress)
            # Unclaimed + in_progress. Measured 2026-08-10: 38 atomic_task nodes sit
            # like this with ZERO claims (35 at progress 0.0), so this is common and
            # usually a stale `--status in_progress` stamp — but it is also exactly
            # what a crashed or live-but-unclaimed run looks like. Indistinguishable
            # from here, so the caller owes an evidence pass.
            case "${ITT_CLAIM_ADOPT:-}" in
                1|true|TRUE|yes|YES|on|ON)
                    warn "adopting unclaimed in_progress ${node} (ITT_CLAIM_ADOPT set)"
                    ;;
                *)
                    warn "SUSPECT: ${node} is 'in_progress' but UNCLAIMED."
                    warn "That is what a crashed run looks like AND what a live-but-unclaimed run"
                    warn "looks like. Run the evidence pass (/itt:run Action 4c) — branches,"
                    warn "worktrees, open PRs, agent_runs, aos-git who — then re-run with"
                    warn "ITT_CLAIM_ADOPT=1 if nothing landed. Never destroy work you did not find."
                    return 5
                    ;;
            esac
            ;;
    esac

    # 5. Promote to `ready` (a truthful assertion here: the caller has already
    #    resolved blockers live and confirmed the ACs are not already met), then
    #    retry the claim ONCE. The claim, not the promote, is the mutex — a racing
    #    session still gets exactly one 200 and one 409.
    if ! command -v itt >/dev/null 2>&1; then
        warn "claim: node is '${cur}' and \`itt\` is absent to promote it — UNGUARDED"
        return 0
    fi
    itt node update "$node" --status ready >/dev/null 2>&1 || {
        warn "claim: could not promote ${node} from '${cur}' to 'ready' — UNGUARDED"
        return 0
    }
    if ! call POST "/api/v1/nodes/${node}/claim" "$body"; then
        warn "claim: transport failure on retry — UNGUARDED"
        return 0
    fi
    case "$HTTP_CODE" in
        200)
            note "claim HELD on ${node} by ${ACTOR} (promoted '${cur}' -> ready)"
            _arm_renew_cadence "$node"
            return 0
            ;;
        409)
            msg="$(api_message)"
            warn "CONFLICT on retry: ${node} was claimed by another session in the race window."
            resolve_holder "$(printf '%s' "$msg" | sed -n "s/.*already claimed by '\([^']*\)'.*/\1/p")" >&2
            warn "Losing this race is the correct outcome. Route to 'report'."
            return 3
            ;;
        *)
            warn "claim: retry returned HTTP $HTTP_CODE ($(api_message)) — UNGUARDED"
            return 0
            ;;
    esac
}

# Hand the node back. `POST /nodes/{id}/release` (upstream intenttree 2151c3e1)
# clears claimed_by_actor_id for the HOLDING actor and, when the claim was what
# moved the node ready -> in_progress, returns it to `ready`.
#
# Never fails the caller (dispatch still exits 0): a release is a courtesy on the
# failure path, and a hook that aborts a cleanup handler is worse than one that
# leaves a claim to age out. Every non-200 degrades to the pre-primitive
# behaviour — the claim stays put and the reap TTL remains the backstop.
do_release() {
    local node="$1"

    # The legacy note, still correct and still the fallback whenever the endpoint
    # is unreachable. `node update --status ready` is NOT a release (it leaves
    # claimed_by_actor_id set and wedges the node) and that mistake is exactly
    # what shipped in autopilot's §5 — do not "recover" by reaching for it.
    _release_fallback_note() {
        warn "Leaving the claim in place. It ages out after ITT_CLAIM_REAP_TTL (default 30m),"
        warn "and a retry from THIS session re-acquires immediately (idempotent for the same actor)."
        warn "Do NOT substitute \`node update --status ready\` — it leaves the claim SET and wedges"
        warn "the node against every other session while looking like a release."
    }

    resolve_api || {
        warn "cannot resolve the IntentTree API (no token/url, or \`itt\` absent) — NOT RELEASED."
        _release_fallback_note
        return 0
    }

    call POST "/api/v1/nodes/${node}/release" \
        "$(printf '{"claimed_by_actor_id":"%s"}' "$ACTOR")" || {
        warn "release: transport failure talking to the API — NOT RELEASED."
        _release_fallback_note
        return 0
    }

    case "$HTTP_CODE" in
        200)
            # Idempotent upstream: an already-unclaimed node also returns 200, so
            # this means "not held by us any more", not "we cleared a live claim".
            note "released ${node} (actor ${ACTOR}); status now $(node_field status)"
            # Stop our own cadence: heartbeating a claim we just handed back would
            # report CLAIM LOST on the next tick as though something had broken.
            do_renew_stop "$node" >/dev/null 2>&1 || true
            return 0
            ;;
        404)
            # Either the node id is wrong, or this deployment predates the release
            # primitive. Both are non-fatal; the second is expected on any node
            # not yet redeployed past intenttree 2151c3e1.
            warn "release: HTTP 404 for ${node} — unknown node, or this deployment"
            warn "  predates the per-node release primitive (upstream 2151c3e1). NOT RELEASED."
            _release_fallback_note
            return 0
            ;;
        409)
            warn "release: ${node} is held by a DIFFERENT actor, not ${ACTOR} ($(api_message))."
            warn "Refusing to release another session's claim — that is the correct outcome."
            do_status "$node" || true
            return 0
            ;;
        *)
            warn "release: HTTP $HTTP_CODE ($(api_message)) — NOT RELEASED."
            _release_fallback_note
            return 0
            ;;
    esac
}

# ---- renew (the liveness half) -----------------------------------------------
# `acquire` proves nobody else is working this node; `renew` proves WE STILL ARE.
# Without it the only staleness signal the server has for a laptop session is AGE,
# and age is not liveness — which is how a legitimate 100-minute /redeploy silently
# lost its claim to the 30-minute sweep (node_01KZQBZF9PYZDVKTJR9TD28G0Z, fixed
# server-side in intenttree #54) while the holder kept working believing the
# duplicate-work guard was still in place.
#
# WHY THE SERVER'S LIVENESS INFERENCE IS NOT ENOUGH, AND THIS IS THE RESIDUE:
#   `reap_stale_claims` now spares a claim when it can SEE liveness — a non-dead
#   AgentRun on the node, or a node_history write by the holder inside the TTL.
#   A lane that arms NEITHER (no `/itt:run` Action 5a run link, and no node writes
#   during a long build) is still reaped on age at 30 minutes. Those two signals
#   cover the observed case; the heartbeat covers the rest, which is why the server
#   half shipped without this and this is not redundant with it.
#
# A HEARTBEAT IS NOT BOUNDED BY THE SERVER'S CEILING — THE CLIENT MUST BOUND ITSELF.
#   `reap_stale_claims(max_hold_minutes=1440)` is an absolute ceiling, but it only
#   overrides LIVENESS EVIDENCE: it is applied to nodes that are already reap
#   CANDIDATES (`claimed_at < cutoff`). A heartbeat refreshes `claimed_at`, so a
#   heartbeating holder never becomes a candidate and the ceiling is never consulted
#   at all. A runaway renew loop therefore holds a claim FOREVER — trading a guard
#   that let go too eagerly for one that never lets go, which is precisely what the
#   upstream fix was careful not to ship. Hence the two bounds in `do_renew_daemon`:
#   an ANCHOR (the holding session must still be alive) and an absolute CAP,
#   defaulting to the server's own 1440-minute ceiling.
#
# EXIT CODES (renew):
#   0  renewed — claim refreshed, keep working.
#   7  CLAIM LOST. HARD, and deliberately its own code rather than reusing 3: a
#      conflict at `acquire` means "someone else got there first, never start"; a
#      409 here means "you were RUNNING and your guard was withdrawn underneath
#      you" — a different situation needing a different response. Reusing another
#      guard's exit code trains people to wave this one through as "the usual
#      thing" (the same reasoning that keeps usage errors at 1 and require-actor
#      at 6, recorded in the EXIT CODES block at the top of this file).
#   4  node not found (the id is wrong) — same meaning as `acquire`'s 4.
#   0  + a LOUD warning when the ROUTE is absent (a deployment predating the
#      heartbeat) or the transport failed. Fail-open, matching FAILURE POSTURE.
#
# 404 IS TWO DIFFERENT ANSWERS AND THEY MUST NOT BE CONFLATED (measured against the
#   live API 2026-08-11). An unrouted path and a missing node BOTH return 404 inside
#   the SAME error envelope — the app's exception handler normalises Starlette's
#   default, so envelope shape does not discriminate:
#     unrouted : {"error":{"code":"not_found","message":"Not Found"}}
#     no node  : {"error":{"code":"not_found","message":"Node 'node_X' not found"}}
#   Discriminating on that message text would be a guess about someone else's
#   phrasing. So `_renew_route_absent` asks the definitive question instead: GET the
#   node. If the node IS there, the ROUTE is what is missing. Conflating the two
#   would make an un-redeployed server report "claim lost, re-acquire" over a claim
#   that is perfectly intact — a false alarm on the one message that has to be
#   trusted when it fires.
#
#   As of 2026-08-11 the live node (10.42.10.76:8032) serves /claim and /release but
#   NOT /claim/heartbeat: the endpoint is merged on origin/main and not yet deployed.
#   So this branch is the CURRENT behaviour on that host, not a legacy path — it
#   stops being reached after the next `/redeploy`.

# _renew_route_absent <node_id> -> 0 when the node exists (=> the ROUTE is what is
# missing), 1 otherwise (=> the node is genuinely gone). Only ever called on a 404,
# so the extra round trip costs nothing on the hot path. Restores HTTP_CODE/BODY so
# the caller's `case` still sees the heartbeat's response, not this probe's.
_renew_route_absent() {
    local node="$1" saved_code="${HTTP_CODE:-}" saved_body="${HTTP_BODY:-}" rc=1
    if call GET "/api/v1/nodes/${node}" && [ "$HTTP_CODE" = "200" ]; then rc=0; fi
    HTTP_CODE="$saved_code"; HTTP_BODY="$saved_body"
    return "$rc"
}

do_renew() {
    local node="$1"

    resolve_api || {
        warn "renew: cannot resolve the IntentTree API — claim NOT renewed (liveness UNPROVEN)."
        warn "  The claim now ages out on the server's TTL as if this run were dead."
        return 0
    }

    if ! call POST "/api/v1/nodes/${node}/claim/heartbeat" \
            "$(printf '{"claimed_by_actor_id":"%s"}' "$ACTOR")"; then
        warn "renew: transport failure — claim NOT renewed (liveness UNPROVEN, non-fatal)."
        return 0
    fi

    case "$HTTP_CODE" in
        200)
            note "renewed claim on ${node} by ${ACTOR}"
            return 0
            ;;
        409)
            # AC2. The one message in this script that must never be a bare non-zero
            # exit: the holder is MID-RUN and has just been told its duplicate-work
            # guard is gone. Say what happened, why, and the exact next action — a
            # silent rc=1 here reads as a transient blip and gets retried past.
            warn "=============================================================="
            warn "CLAIM LOST on ${node} — you are no longer the holder."
            warn "  actor       : ${ACTOR}"
            warn "  server says : $(api_message)"
            warn ""
            warn "This is NOT a transient failure. Either the TTL sweep reaped this"
            warn "claim (no liveness evidence inside the window), or another actor"
            warn "holds it now. Either way the duplicate-work guard is WITHDRAWN:"
            warn "a second session may already be editing the same files."
            warn ""
            warn "RE-ACQUIRE DELIBERATELY before continuing:"
            warn "    ${PROG} acquire ${node}"
            warn "  * exit 0 => you hold it again; carry on."
            warn "  * exit 3 => someone else does. STOP, and do not destroy their work."
            warn "=============================================================="
            return 7
            ;;
        404)
            if _renew_route_absent "$node"; then
                warn "renew: this deployment has no /claim/heartbeat route (the node exists,"
                warn "  the endpoint does not) — claim NOT renewed, and NOT lost. Upstream"
                warn "  intenttree ships it; this host predates that deploy. Redeploy to close"
                warn "  the gap: until then the claim ages out on the TTL as if this run were dead."
                return 0
            fi
            warn "renew: node ${node} not found — check the id ($(api_message))"
            return 4
            ;;
        *)
            warn "renew: unexpected HTTP $HTTP_CODE ($(api_message)) — NOT renewed (non-fatal)."
            return 0
            ;;
    esac
}

# ---- renew daemon (the cadence) ----------------------------------------------
# AC3 wants a long lane renewing on a cadence shorter than the TTL. Per-lane prose
# is EXACTLY what failed for the claim itself (`/itt:run` said "do not pre-claim"
# and every lane obeyed it into a double-implementation), so the cadence lives in
# the `acquire` path and every lane inherits it without a line of its own.
# `/redeploy` settles the argument: its 100-minute core runs ON THE NODE over ssh
# (`infra/agentic-node/redeploy-run.sh`) and never sees a node id, so a per-lane
# renew call there could only ever be an instruction to a human.
#
# Bounds, both mandatory (see the ceiling note above — the server cannot bound a
# heartbeating holder, so an unbounded loop here would be a WORSE bug than the one
# being fixed):
#   ANCHOR — the holding Claude Code session's pid, resolved from the same registry
#            `resolve_holder_cc` reads. A Bash tool call is its own short-lived
#            process, so the PARENT pid is useless as an anchor; the session is the
#            unit that is actually still working. When no anchor is derivable (an
#            `agent:hop-*` actor has no session pid), the cap alone bounds it — and
#            that is STATED in the log rather than silently assumed.
#   CAP    — absolute lifetime, default 1440 minutes to match the server's own
#            `_DEFAULT_MAX_CLAIM_HOLD_MINUTES`, so the client can never retain a
#            claim the server would itself have broken.

RENEW_DIR="${AOS_ITT_RENEW_DIR:-${HOME:-/tmp}/.cache/aos/itt-renew}"

# One state file per (node, actor): a second session renewing the same node is a
# different daemon and must not stop or adopt ours.
_renew_state() {
    local node="$1" tag
    tag="$(printf '%s' "$ACTOR" | tr -cd '[:alnum:]-')"
    printf '%s/%s.%s' "$RENEW_DIR" "$node" "$tag"
}

# The pid of the Claude Code session this actor belongs to, or empty.
_renew_anchor_pid() {
    case "$ACTOR" in agent:cc-*) : ;; *) return 1 ;; esac
    python3 - "${ACTOR#agent:cc-}" <<'ANCHOR_PY' 2>/dev/null
import glob, json, os, sys
prefix = sys.argv[1]
for p in glob.glob(os.path.expanduser("~/.claude/sessions/*.json")):
    try:
        with open(p) as fh:
            d = json.load(fh)
    except Exception:
        continue
    if str(d.get("sessionId", "")).startswith(prefix) and isinstance(d.get("pid"), int):
        print(d["pid"])
        break
ANCHOR_PY
}

do_renew_daemon() {
    local node="$1" interval="${2:-${ITT_CLAIM_RENEW_INTERVAL:-600}}"
    local cap="${3:-${ITT_CLAIM_RENEW_MAX_MINUTES:-1440}}"

    case "$interval" in ''|*[!0-9]*) warn "renew-daemon: bad interval '${interval}'"; return 1 ;; esac
    case "$cap"      in ''|*[!0-9]*) warn "renew-daemon: bad cap '${cap}'";           return 1 ;; esac
    # A floor, not a policy. The default is 600s; an explicit --interval is a caller
    # opting in, so this only has to stop the pathological case — `--interval 0`, which
    # is a busy loop hammering the API, and the kind of thing a typo produces. 5s is
    # still 360x tighter than the 30-minute TTL, so nothing legitimate is excluded.
    [ "$interval" -ge 5 ] || { warn "renew-daemon: interval must be >= 5s (got '${interval}')"; return 1; }

    mkdir -p "$RENEW_DIR" 2>/dev/null || {
        warn "renew-daemon: cannot create ${RENEW_DIR} — no cadence armed (non-fatal)"; return 0; }

    local state; state="$(_renew_state "$node")"
    local pidf="${state}.pid" stopf="${state}.stop" logf="${state}.log"

    # Already running for this (node, actor)? Idempotent, exactly as `acquire` is for
    # the same actor — a lane that re-arms must not stack a second loop.
    if [ -f "$pidf" ]; then
        local old; old="$(cat "$pidf" 2>/dev/null || true)"
        if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
            note "renew cadence already running for ${node} (pid ${old}, every ${interval}s)"
            return 0
        fi
    fi
    rm -f "$stopf" 2>/dev/null || true

    local anchor; anchor="$(_renew_anchor_pid || true)"

    # `nohup ... &` so the loop outlives the short-lived shell that armed it. It is
    # deliberately orphaned: the ANCHOR, not the process tree, decides when it stops.
    nohup bash -c '
        set -uo pipefail
        self="$0"; node="$1"; interval="$2"; cap="$3"; anchor="$4"; stopf="$5"; pidf="$6"
        deadline=$(( $(date +%s) + cap * 60 ))
        trap "rm -f \"$pidf\"" EXIT
        if [ -n "$anchor" ]; then
            echo "[renew] armed for $node every ${interval}s, cap ${cap}m, anchor pid ${anchor}"
        else
            echo "[renew] armed for $node every ${interval}s, cap ${cap}m, NO ANCHOR (actor has no session pid) — the cap is the only bound"
        fi
        while :; do
            sleep "$interval"
            if [ -f "$stopf" ]; then echo "[renew] stop requested — exiting"; exit 0; fi
            if [ "$(date +%s)" -ge "$deadline" ]; then
                echo "[renew] absolute cap of ${cap}m reached — exiting. The claim now ages out on the"
                echo "[renew] server TTL, which IS the intended bound: a heartbeat must not make a claim immortal."
                exit 0
            fi
            if [ -n "$anchor" ] && ! kill -0 "$anchor" 2>/dev/null; then
                echo "[renew] anchor pid ${anchor} is gone (session ended) — exiting, claim left to the TTL"
                exit 0
            fi
            out="$("$self" renew "$node" 2>&1)"; rc=$?
            printf "%s\n" "$out"
            case "$rc" in
                0) : ;;
                7) echo "[renew] CLAIM LOST — stopping the cadence (see above)"; exit 7 ;;
                4) echo "[renew] node not found — stopping the cadence"; exit 4 ;;
                *) echo "[renew] renew exited ${rc} — stopping the cadence"; exit "$rc" ;;
            esac
            # A route-absent server will never start renewing, so do not spin against it
            # for hours: the message is emitted once and the cadence retires.
            case "$out" in
                *"no /claim/heartbeat route"*)
                    echo "[renew] endpoint absent on this deployment — retiring the cadence (no point looping)"
                    exit 0 ;;
            esac
        done
    ' "$0" "$node" "$interval" "$cap" "${anchor:-}" "$stopf" "$pidf" >>"$logf" 2>&1 &

    local child=$!
    printf '%s\n' "$child" > "$pidf"
    if [ -n "$anchor" ]; then
        note "renew cadence armed for ${node}: every ${interval}s, cap ${cap}m, anchor pid ${anchor} (pid ${child})"
    else
        note "renew cadence armed for ${node}: every ${interval}s, cap ${cap}m, NO ANCHOR (pid ${child})"
    fi
    note "  log: ${logf} · stop: ${PROG} renew-stop ${node}"
    return 0
}

do_renew_stop() {
    local node="$1" state; state="$(_renew_state "$node")"
    local pidf="${state}.pid" stopf="${state}.stop"
    : > "$stopf" 2>/dev/null || true
    local pid; pid="$(cat "$pidf" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        rm -f "$pidf" 2>/dev/null || true
        note "renew cadence stopped for ${node} (pid ${pid})"
    else
        note "no renew cadence running for ${node} (actor ${ACTOR})"
    fi
    # Stopping the cadence is NOT releasing the claim. A caller that conflates the two
    # would leave a held claim with no liveness proof, which is worse than either.
    note "  (the claim itself is untouched — use \`${PROG} release ${node}\` to hand it back)"
    return 0
}

# ---- dispatch ----------------------------------------------------------------
[ $# -ge 1 ] || usage
VERB="$1"; shift

case "$VERB" in
    actor)   printf '%s\n' "$ACTOR"; exit 0 ;;
    acquire) [ $# -eq 1 ] || usage; do_acquire "$1"; exit $? ;;
    status)  [ $# -eq 1 ] || usage; resolve_api || { warn "API unresolved — claim state UNKNOWN"; exit 0; }; do_status "$1"; exit 0 ;;
    renew)   [ $# -eq 1 ] || usage; do_renew "$1"; exit $? ;;
    renew-daemon)
        [ $# -ge 1 ] || usage
        rd_node="$1"; shift
        rd_interval="${ITT_CLAIM_RENEW_INTERVAL:-600}"
        rd_cap="${ITT_CLAIM_RENEW_MAX_MINUTES:-1440}"
        while [ $# -gt 0 ]; do
            case "$1" in
                --interval)    [ $# -ge 2 ] || usage; rd_interval="$2"; shift 2 ;;
                --max-minutes) [ $# -ge 2 ] || usage; rd_cap="$2";      shift 2 ;;
                *) usage ;;
            esac
        done
        do_renew_daemon "$rd_node" "$rd_interval" "$rd_cap"; exit $? ;;
    renew-stop) [ $# -eq 1 ] || usage; do_renew_stop "$1"; exit 0 ;;
    release) [ $# -eq 1 ] || usage; do_release "$1"; exit 0 ;;
    reap)
        ttl="${ITT_CLAIM_REAP_TTL:-30}"
        while [ $# -gt 0 ]; do
            case "$1" in
                --ttl) [ $# -ge 2 ] || usage; ttl="$2"; shift 2 ;;
                *) usage ;;
            esac
        done
        case "$ttl" in ''|*[!0-9]*) usage ;; esac
        resolve_api || { warn "API unresolved — reap skipped"; exit 0; }
        do_reap "$ttl"; exit 0 ;;
    *) usage ;;
esac
