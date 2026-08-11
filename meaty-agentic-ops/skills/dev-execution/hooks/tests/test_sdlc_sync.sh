#!/usr/bin/env bash
# Regression net for sdlc-sync.sh's run-session-link section (Live Work Observability G-1).
#
# The gate contract (master switch / binding / always-exit-0) matters, but the
# assertions that actually earn their keep are the REFUSALS. This section derives a
# filesystem path and a session id from the environment and hands both to a CLI whose
# writes end up rendered as an `href` in three React components. Every "refuses X"
# case below is the thing standing between a hostile or merely malformed value and a
# live link — delete the validation and those cases go red, which is the point.
#
# `itt` is stubbed on PATH and records its argv, so nothing here touches a live
# IntentTree node or the network.
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/sdlc-sync.sh"

# --- stub `itt`: append argv to $calls, emit a run id for `run start` --------------
#
# The stub REJECTS what the real CLI rejects. A fake more permissive than the real
# tool is a liability, not a convenience: PF-3 shipped a guardrail that rejected
# every link because `--json` sat after the subcommand, and the offline fake — which
# exited 0 for any argv — could not see it. The bug failed safe but failed ALWAYS,
# which is indistinguishable from a working guardrail. Two rejections are modelled,
# both observed live against `itt`:
#
#   1. GLOBAL-FLAG PLACEMENT. `--json`/`--actor`/`--workspace` are options of the
#      root group and must precede the subcommand group. Placed after, Click exits 2
#      with "Error: No such option '--json'".
#   2. `run start` SIGNATURE. `itt run start [OPTIONS] NODE_ID` — the node id is
#      POSITIONAL. Omit it (or lead with a flag) and Click exits 2 with the Usage
#      line. This is the exact drift the run-session-link follow-up recorded.
#
# Anything the real CLI accepts, the stub accepts. Keep it that way: loosen this and
# the suite silently regains the ability to pass with a broken caller.
bin="$tmpdir/bin"
mkdir -p "$bin"
calls="$tmpdir/calls.log"

# Emitted into every stub variant below, so no variant can drift looser than another.
_ITT_STUB_REJECTIONS='
# Reproduces Click`s real 4-line refusal, verified live 2026-08-02:
#   Usage: itt <group> <cmd> [OPTIONS] <ARG>
#   Try "itt <group> <cmd> --help" for help.
#   <blank>
#   Error: <reason>
# Emitting only one of those two lines would let a test grep for a string the real
# CLI does not produce — the same fake-vs-real divergence this guard exists to stop.
#
# Verified byte-identical to real `itt` for `node get … --json`, `run get … --json`,
# and bare `run start`. ONE known divergence, deliberately not modelled: Click appends
# a fuzzy suggestion for near-miss options, so real `node update … --actor` adds
# "(Did you mean one of: '\''--ac'\'', '\''--score'\''?)". That suffix depends on the option
# table of whichever subcommand was invoked and on Click'\''s version; reproducing it
# would couple this stub to both. Exit code and rejection behaviour match exactly,
# which is what any caller can observe.
_itt_refuse() { # $1 = "group cmd", $2 = ARG name, $3 = reason
  printf "Usage: itt %s [OPTIONS] %s\n" "$1" "$2" >&2
  printf "Try '\''itt %s --help'\'' for help.\n\n" "$1" >&2
  printf "Error: %s\n" "$3" >&2
  exit 2
}

# (1) a global flag after the subcommand group — Click sees an unknown option
_group="${1:-}"; _cmd="${2:-}"
for _a in "$@"; do
  case "$_a" in
    --json|--actor|--workspace)
      # The positional is named for the GROUP, not the verb: `itt node get` takes
      # NODE_ID, `itt run get` takes RUN_ID. Deriving it from the verb produced
      # "GET_ID" — a string the real CLI never prints, which is exactly the
      # fake-diverges-from-real failure this block is here to prevent.
      _itt_refuse "$_group $_cmd" "$(printf "%s" "$_group" | tr "[:lower:]" "[:upper:]")_ID" \
                  "No such option '\''$_a'\''." ;;
  esac
done

# (2) `run start` requires a positional NODE_ID
if [ "$_group" = "run" ] && [ "$_cmd" = "start" ]; then
  case "${3:-}" in
    ""|-*) _itt_refuse "run start" "NODE_ID" "Missing argument '\''NODE_ID'\''." ;;
  esac
fi
'

# Write an `itt` stub. $1 = the body evaluated after the rejection preamble.
write_itt_stub() {
  {
    printf '#!/usr/bin/env bash\n'
    printf 'printf "%%s\\n" "$*" >> "$ITT_CALLS"\n'
    # Globals are consumed BEFORE the group name on a real invocation, so strip the
    # leading ones the same way Click does before applying the rejections.
    printf 'while :; do case "${1:-}" in --json) shift ;; --actor|--workspace) shift 2 ;; *) break ;; esac; done\n'
    printf '%s\n' "$_ITT_STUB_REJECTIONS"
    printf '%s\n' "$1"
  } > "$bin/itt"
  chmod +x "$bin/itt"
}

# The default stub: succeeds, and emits a run id for `run start`.
_ITT_STUB_OK='
case "$1 ${2:-}" in
  "run start") echo "run_stub0000000000000000000001" ;;
esac
exit 0
'
write_itt_stub "$_ITT_STUB_OK"

# A fake HOME with a real transcript at the derived location. The hook mangles the
# absolute cwd (`/`, `.`, `_` -> `-`) into the project dir name, so build that name
# the same way and plant the file where derivation will look.
fake_home="$tmpdir/home"
SID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
NODE="node_01TESTTESTTESTTESTTESTTEST"
mangled="$(printf '%s' "$PWD" | tr '/._' '---')"
mkdir -p "$fake_home/.claude/projects/$mangled"
transcript="$fake_home/.claude/projects/$mangled/$SID.jsonl"
printf '{"type":"summary"}\n' > "$transcript"

pass=0
fail=0

# Run the hook with a clean slate: fresh call log, fresh sidecar dir, stub on PATH.
# SDLC_SYNC_FILE is deliberately unset — the sync half must not be reached, and the
# run-session-link half must still fire (it is gated independently).
run_hook() {
  : > "$calls"
  env -i \
    PATH="$bin:/usr/bin:/bin" \
    HOME="$fake_home" \
    ITT_CALLS="$calls" \
    AOS_RUN_SESSION_HOME="$sidecar_home" \
    INTENTTREE_SDLC_SYNC=auto \
    "$@" \
    bash "$hook" >/dev/null 2>&1
}

fresh_sidecar_home() { sidecar_home="$tmpdir/sidecars.$1"; rm -rf "$sidecar_home"; }

# exit-code assertion. Every row here expects 0 — that IS the contract: this hook may
# never fail a phase, whatever it decides about its inputs.
check_exit0() {
  name="$1"; shift
  "$@"
  actual=$?
  if [ "$actual" -eq 0 ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: hook must always exit 0, got %s\n' "$name" "$actual"
    fail=$((fail + 1))
  fi
}

# Count `itt` invocations matching a pattern ('' = all).
# NOTE: `grep -c` already prints 0 on no-match — it just exits 1. Do NOT add a
# `|| echo 0` fallback here; that emits a SECOND zero and every "expected 0" row
# then compares "0" against "0\n0" and fails.
count_calls() {
  local n
  if [ -z "${1:-}" ]; then n="$(grep -c . "$calls" 2>/dev/null)"
  else n="$(grep -c -- "$1" "$calls" 2>/dev/null)"
  fi
  printf '%s' "${n:-0}"
}

assert_calls() {
  name="$1" expected="$2" pattern="${3:-}"
  actual="$(count_calls "$pattern")"
  if [ "$expected" = "$actual" ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: expected %s matching itt call(s), got %s\n' "$name" "$expected" "$actual"
    [ -s "$calls" ] && sed 's/^/      itt /' "$calls"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  name="$1" needle="$2"
  if grep -q -- "$needle" "$calls" 2>/dev/null; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: no itt call contained %s\n' "$name" "$needle"
    [ -s "$calls" ] && sed 's/^/      itt /' "$calls"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# 1. Gate contract — no binding, or switched off, means ZERO itt calls.
#    A default-on hook that is not silent when unbound becomes noise in every
#    repo with no IntentTree presence, which is how default-on gets turned off.
# ---------------------------------------------------------------------------
fresh_sidecar_home gate

check_exit0 no-binding-at-all run_hook
assert_calls no-binding-at-all 0

check_exit0 node-without-session run_hook ITT_NODE_ID="$NODE"
assert_calls node-without-session 0

check_exit0 session-without-node run_hook CLAUDE_CODE_SESSION_ID="$SID"
assert_calls session-without-node 0

check_exit0 link-switch-off run_hook AOS_RUN_SESSION_LINK=0 \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls link-switch-off 0

check_exit0 link-switch-off-word run_hook AOS_RUN_SESSION_LINK=off \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls link-switch-off-word 0

check_exit0 master-switch-hard-off run_hook INTENTTREE_SDLC_SYNC=0 \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls master-switch-hard-off 0

# ---------------------------------------------------------------------------
# 2. Happy path — creates a run, links the CCDash-form id, passes harness_type.
# ---------------------------------------------------------------------------
fresh_sidecar_home happy
check_exit0 happy-path run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls happy-path 1 "run start"
# The CCDash-form id, not the bare UUID: the backend passes this value verbatim to
# CCDash's GET /api/sessions/{id}, where a bare UUID 404s (verified live 2026-08-02).
assert_contains happy-path-ccdash-form "S-$SID"
# harness_type populated is an explicit M1 exit criterion (design-spec Sec 10 clause 5).
assert_contains happy-path-harness-type "--harness-type"
assert_contains happy-path-transcript "$SID.jsonl"

if [ -f "$sidecar_home/$NODE.json" ]; then
  pass=$((pass + 1))
  # Both representations are recorded, never collapsed into one.
  for key in agent_run_id harness_session_id ccdash_session_id; do
    if grep -q "\"$key\"" "$sidecar_home/$NODE.json"; then
      pass=$((pass + 1))
    else
      printf 'FAIL sidecar missing key %s\n' "$key"
      fail=$((fail + 1))
    fi
  done
  # NG-6: no bare session_id key may appear in persisted state.
  if grep -qE '"session_id"[[:space:]]*:' "$sidecar_home/$NODE.json"; then
    printf 'FAIL sidecar introduced a bare "session_id" key (NG-6 / shepherd FK collision)\n'
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
else
  printf 'FAIL sidecar was not written to %s\n' "$sidecar_home/$NODE.json"
  fail=$((fail + 1))
fi

# ---------------------------------------------------------------------------
# 3. Idempotency — a second boundary in the SAME session refreshes, never
#    re-creates. A duplicate-run-per-phase bug would be invisible in normal use
#    and would quietly fill the run list with orphans.
# ---------------------------------------------------------------------------
check_exit0 second-boundary run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls second-boundary 0 "run start"
assert_calls second-boundary-refreshes 1 "run link-session"

# A DIFFERENT session against the same node is a genuinely new execution record
# (design-spec Sec 10: a resumed session gets a new session id against the same node).
SID2="ffffffff-1111-2222-3333-444444444444"
mkdir -p "$fake_home/.claude/projects/$mangled"
printf '{}\n' > "$fake_home/.claude/projects/$mangled/$SID2.jsonl"
check_exit0 new-session-same-node run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID2"
assert_calls new-session-same-node 1 "run start"

# ---------------------------------------------------------------------------
# 4. Refusals. Each of these is a validation boundary; if any starts passing an
#    `itt` call, a malformed or hostile value has reached the run API — and for
#    the transcript, ultimately an <a href>.
# ---------------------------------------------------------------------------
# shellcheck disable=SC2016  # the un-expanded $(...) IS the payload — expanding it here
# would test that bash evaluates command substitution, not that the hook refuses it.
for bad_sid in \
    "not-a-uuid" \
    "" \
    "aaaaaaaa-bbbb-cccc-dddd" \
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee;id' \
    '$(touch '"$tmpdir"'/pwned)-bbbb-cccc-dddd-eeeeeeeeeeee' \
    "../../../etc/passwd" ; do
  fresh_sidecar_home "badsid"
  check_exit0 "refuse-session-id[$bad_sid]" run_hook \
    ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$bad_sid"
  assert_calls "refuse-session-id[$bad_sid]" 0
done

# Command substitution in a session id must never have been evaluated.
if [ -e "$tmpdir/pwned" ]; then
  printf 'FAIL command substitution in CLAUDE_CODE_SESSION_ID was evaluated\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# shellcheck disable=SC2016  # literal, un-expanded metacharacters are the point
for bad_node in \
    'node_x;rm -rf /' \
    '$(whoami)' \
    'node with spaces' \
    '../../etc' ; do
  fresh_sidecar_home "badnode"
  check_exit0 "refuse-node-id[$bad_node]" run_hook \
    ITT_NODE_ID="$bad_node" CLAUDE_CODE_SESSION_ID="$SID"
  assert_calls "refuse-node-id[$bad_node]" 0
done

# A hostile prefix must fall back to no prefix rather than being concatenated into
# the id that becomes a URL query value.
fresh_sidecar_home prefix
# shellcheck disable=SC2016  # literal, un-expanded — see the note above
check_exit0 hostile-prefix run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID" \
  AOS_CCDASH_SESSION_PREFIX='S-$(whoami)/../'
if grep -q 'whoami' "$calls" 2>/dev/null; then
  printf 'FAIL hostile AOS_CCDASH_SESSION_PREFIX reached the itt argv\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# An explicitly EMPTY prefix means "no prefix" — this is why the hook uses
# ${VAR-default} and not ${VAR:-default}. Assert the distinction directly, because
# a silent revert to ${VAR:-} would still pass every other test here.
fresh_sidecar_home emptyprefix
check_exit0 empty-prefix-honoured run_hook ITT_NODE_ID="$NODE" \
  CLAUDE_CODE_SESSION_ID="$SID" AOS_CCDASH_SESSION_PREFIX=
if grep -q -- "--ccdash-session-id S-$SID" "$calls" 2>/dev/null; then
  printf 'FAIL empty AOS_CCDASH_SESSION_PREFIX was defaulted back to S-\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# ---------------------------------------------------------------------------
# 5. Transcript resolution degrades rather than blocking: no transcript on disk
#    still links the session (the id is the load-bearing half; the pointer is a
#    bonus), and a symlink escaping the projects root is refused outright.
# ---------------------------------------------------------------------------
fresh_sidecar_home notranscript
SID3="12345678-90ab-cdef-1234-567890abcdef"   # no .jsonl planted for this one
check_exit0 missing-transcript-still-links run_hook \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID3"
assert_calls missing-transcript-still-links 1 "run start"
if grep -q -- "--ccdash-transcript-path" "$calls" 2>/dev/null; then
  printf 'FAIL passed --ccdash-transcript-path for a transcript that does not exist\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

fresh_sidecar_home symlink
SID4="87654321-0987-6543-2109-876543210987"
printf 'secret\n' > "$tmpdir/outside.jsonl"
ln -sf "$tmpdir/outside.jsonl" "$fake_home/.claude/projects/$mangled/$SID4.jsonl"
check_exit0 symlink-escape-refused run_hook \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID4"
if grep -q -- "outside.jsonl" "$calls" 2>/dev/null; then
  printf 'FAIL a symlink resolving outside the projects root was sent\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# ---------------------------------------------------------------------------
# 6. Environment hostility — a missing `itt`, an unwritable sidecar dir, and a
#    non-zero `itt` all keep the exit-0 contract.
# ---------------------------------------------------------------------------
fresh_sidecar_home noitt
check_exit0 itt-absent env -i PATH="/usr/bin:/bin" HOME="$fake_home" \
  ITT_CALLS="$calls" AOS_RUN_SESSION_HOME="$sidecar_home" \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID" bash "$hook"

# Deliberately degenerate — this stub exists to BE a failing CLI, so it does not carry
# write_itt_stub's rejection preamble (same for install_hanging_itt below). Exempt on
# purpose: their permissiveness cannot hide a caller bug, because the hook already
# treats every exit from them as failure. Every stub that models a *working* CLI must
# go through write_itt_stub.
cat > "$bin/itt" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ITT_CALLS"
exit 9
STUB
chmod +x "$bin/itt"
fresh_sidecar_home ittfails
check_exit0 itt-nonzero run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"

unwritable="$tmpdir/unwritable"
mkdir -p "$unwritable"
chmod 500 "$unwritable"
sidecar_home="$unwritable/nested"
check_exit0 sidecar-unwritable run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
chmod 700 "$unwritable"

# ---------------------------------------------------------------------------
# 7. Sidecar trust (F4). The extraction is a permissive `sed`, so what it yields
#    must be shape-checked before it becomes argv. The nasty case is not a
#    corrupt id — it is a VALID-LOOKING OPTION: `"agent_run_id": "--help"` turns
#    the refresh into `itt run link-session --help ...`, which exits 0 without
#    linking, so the hook records success and the join silently never happens.
# ---------------------------------------------------------------------------
install_good_itt() { write_itt_stub "$_ITT_STUB_OK"; }
install_good_itt

write_sidecar() {
  mkdir -p "$sidecar_home"
  printf '%s\n' "$1" > "$sidecar_home/$NODE.json"
}

# An option-shaped run id must never reach argv, and the hook must recover by
# creating a fresh run rather than looping on the poisoned sidecar forever.
fresh_sidecar_home injection
write_sidecar '{"agent_run_id": "--help", "harness_session_id": "'"$SID"'"}'
check_exit0 sidecar-option-injection run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
if grep -q -- '--help' "$calls" 2>/dev/null; then
  printf 'FAIL an option-shaped agent_run_id from the sidecar reached itt argv\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi
assert_calls sidecar-option-injection-recovers 1 "run start"

# A leading dash is rejected even when the rest is boring — this is the check
# that a plain charset regex would miss.
fresh_sidecar_home dashid
write_sidecar '{"agent_run_id": "-run_abc", "harness_session_id": "'"$SID"'"}'
check_exit0 sidecar-leading-dash run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls sidecar-leading-dash-recovers 1 "run start"

for bad_sidecar in \
    '{"agent_run_id": "run with spaces", "harness_session_id": "'"$SID"'"}' \
    '{"agent_run_id": "run$(whoami)", "harness_session_id": "'"$SID"'"}' \
    '{"agent_run_id": "", "harness_session_id": "'"$SID"'"}' \
    'not json at all' \
    '{"agent_run_id": "run_ok1", "harness_session_id": "not-a-uuid"}' ; do
  fresh_sidecar_home badsidecar
  write_sidecar "$bad_sidecar"
  check_exit0 "malformed-sidecar-recovers" run_hook \
    ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
  # A malformed sidecar is treated as NO sidecar: create a fresh run.
  assert_calls "malformed-sidecar-recovers" 1 "run start"
  assert_calls "malformed-sidecar-no-refresh" 0 "run link-session"
done

# Command substitution inside a sidecar value must never be evaluated.
if [ -e "$tmpdir/pwned" ]; then
  printf 'FAIL command substitution in a sidecar value was evaluated\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# ---------------------------------------------------------------------------
# 8. Non-blocking, not merely non-failing (F5). `itt` is synchronous here and the
#    server's link path can make several CCDash calls; without a hook-owned
#    deadline a stuck or substituted binary blocks the phase forever. exit 0 is
#    necessary but insufficient — BOUNDED exit 0 is the contract.
#    macOS ships no `timeout`/`gtimeout`, so the watchdog is hand-rolled; these
#    rows are what keep it honest.
# ---------------------------------------------------------------------------
# The hanging stub records its GRANDCHILD's pid so the leak check can be exact.
# Deliberately NOT pgrep/pkill on a pattern: `pkill -f "sleep N"` also matches any
# shell whose own command line mentions that string, so a pattern-based check can
# kill the test runner (or the developer's shell) instead of the stub.
install_hanging_itt() {
  cat > "$bin/itt" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ITT_CALLS"
sleep 900 &
echo $! > "$ITT_SLEEP_PID"
wait
STUB
  chmod +x "$bin/itt"
}
sleep_pid_file="$tmpdir/sleep.pid"
install_hanging_itt

# The hanging stub needs ITT_SLEEP_PID in the hook's scrubbed env (`env -i`).
run_hook_hanging() {
  : > "$calls"
  env -i \
    PATH="$bin:/usr/bin:/bin" \
    HOME="$fake_home" \
    ITT_CALLS="$calls" \
    ITT_SLEEP_PID="$sleep_pid_file" \
    AOS_RUN_SESSION_HOME="$sidecar_home" \
    INTENTTREE_SDLC_SYNC=auto \
    "$@" \
    bash "$hook" >/dev/null 2>&1
}

# Reap whatever the hanging stub spawned, by pid.
reap_stub_sleep() {
  [ -f "$sleep_pid_file" ] || return 0
  local spid; spid="$(cat "$sleep_pid_file" 2>/dev/null || true)"
  [ -n "$spid" ] && kill -9 "$spid" 2>/dev/null || true
  rm -f "$sleep_pid_file"
}

fresh_sidecar_home hang
start_s=$(date +%s)
rm -f "$sleep_pid_file"
check_exit0 hanging-itt-is-killed run_hook_hanging AOS_RUN_SESSION_TIMEOUT=1 \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
elapsed=$(( $(date +%s) - start_s ))
# Generous ceiling: the watchdog polls in 1s slices and adds a 1s TERM->KILL
# grace, so ~3s is the floor. Anything near 300 means it did not fire at all.
if [ "$elapsed" -le 30 ]; then
  pass=$((pass + 1))
else
  printf 'FAIL hanging itt was not bounded: hook took %ss\n' "$elapsed"
  fail=$((fail + 1))
fi

# No orphaned grandchild may survive the hook. This is the assertion that forces
# the watchdog to kill the PROCESS GROUP rather than just the child it spawned:
# `itt` is itself a script, so the thing actually holding resources (and the
# inherited stdout) is its child, one level below the pid the watchdog knows.
# The settle is not cosmetic — SIGKILL delivery and reaping are asynchronous, so
# an immediate probe sees a pid that is already dying. A FIXED settle (`sleep 2`)
# is the wrong shape for that: it flaked ~1 run in 5 on a loaded machine, because
# "long enough" is a property of the machine, not of the code. Poll instead — exits
# as soon as the pid is gone, and only spends the full budget when something really
# did leak. A test that fails 20% of the time teaches people to re-run it, which is
# how a real leak gets waved through later.
leaked_pid="$(cat "$sleep_pid_file" 2>/dev/null || true)"
if [ -n "$leaked_pid" ]; then
  waited=0
  while [ "$waited" -lt 10 ] && kill -0 "$leaked_pid" 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
  done
fi
if [ -n "$leaked_pid" ] && kill -0 "$leaked_pid" 2>/dev/null; then
  printf 'FAIL watchdog leaked a grandchild (pid %s still alive)\n' "$leaked_pid"
  reap_stub_sleep
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi
reap_stub_sleep

# A hanging refresh is bounded too, not just the create path.
install_good_itt
fresh_sidecar_home hangrefresh
check_exit0 seed-for-hang-refresh run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
install_hanging_itt
rm -f "$sleep_pid_file"
start_s=$(date +%s)
check_exit0 hanging-refresh-is-killed run_hook_hanging AOS_RUN_SESSION_TIMEOUT=1 \
  ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
elapsed=$(( $(date +%s) - start_s ))
if [ "$elapsed" -le 30 ]; then
  pass=$((pass + 1))
else
  printf 'FAIL hanging refresh was not bounded: hook took %ss\n' "$elapsed"
  fail=$((fail + 1))
fi
reap_stub_sleep
install_good_itt

# ---------------------------------------------------------------------------
# 9. Ambiguous transcript fallback (F6). The fallback search is load-bearing — a
#    worktree cwd legitimately resolves to the repo-root project dir — but
#    first-match-wins would bind ANOTHER project's transcript, and every
#    containment check downstream would still pass. "UUIDs are unique" is an
#    observation, not authorization. Fail closed on >1 match.
# ---------------------------------------------------------------------------
fresh_sidecar_home ambiguous
SID_AMB="deadbeef-0000-1111-2222-333344445555"
# Two OTHER project dirs both hold this uuid; the derived dir (this cwd) does not.
mkdir -p "$fake_home/.claude/projects/-some-other-project" \
         "$fake_home/.claude/projects/-yet-another-project"
printf '{}\n' > "$fake_home/.claude/projects/-some-other-project/$SID_AMB.jsonl"
printf '{}\n' > "$fake_home/.claude/projects/-yet-another-project/$SID_AMB.jsonl"
check_exit0 ambiguous-fallback run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID_AMB"
# The session still links (the id is the load-bearing half)...
assert_calls ambiguous-fallback-still-links 1 "run start"
# ...but no transcript is guessed.
if grep -q -- "--ccdash-transcript-path" "$calls" 2>/dev/null; then
  printf 'FAIL an ambiguous transcript match was bound anyway\n'
  [ -s "$calls" ] && sed 's/^/      itt /' "$calls"
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# Exactly ONE match elsewhere is the legitimate worktree case and must still bind.
fresh_sidecar_home singlefallback
SID_ONE="feedface-0000-1111-2222-333344445555"
rm -f "$fake_home/.claude/projects/-yet-another-project/$SID_AMB.jsonl"
printf '{}\n' > "$fake_home/.claude/projects/-some-other-project/$SID_ONE.jsonl"
check_exit0 single-fallback run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID_ONE"
assert_contains single-fallback-binds "$SID_ONE.jsonl"

# ---------------------------------------------------------------------------
# 10. Canonical UUID shape (F8). The message says "canonical 8-4-4-4-12", so the
#     regex must mean it: a 36-char hyphen arrangement that is not a UUID has to
#     be refused, or code and message disagree.
# ---------------------------------------------------------------------------
for noncanonical in \
    "aaaaaaaaa-bbb-cccc-dddd-eeeeeeeeeeee" \
    "aaaaaaaa-bbbbb-ccc-dddd-eeeeeeeeeeee" \
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeeg" \
    "aaaaaaaabbbbccccdddddeeeeeeeeeeeeeee" ; do
  fresh_sidecar_home noncanon
  check_exit0 "refuse-noncanonical-uuid[$noncanonical]" run_hook \
    ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$noncanonical"
  assert_calls "refuse-noncanonical-uuid[$noncanonical]" 0
done

# ---------------------------------------------------------------------------
# 11. Create-path lock (local half of the concurrent-duplicate finding). Two
#     boundaries racing for the same (node, session) could both see no sidecar
#     and both create a run, orphaning one. This serialises them ON THIS
#     MACHINE only — it is not, and must not be mistaken for, the server-side
#     idempotency key that would fix the distributed case.
# ---------------------------------------------------------------------------
fresh_sidecar_home lockheld
mkdir -p "$sidecar_home/.lock.$NODE"
check_exit0 lock-held-skips-create run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls lock-held-skips-create 0 "run start"

# A crash mid-create must not disable the join for that node forever, so a lock
# older than the stale threshold is reclaimed exactly once.
fresh_sidecar_home lockstale
mkdir -p "$sidecar_home/.lock.$NODE"
touch -t 202001010000 "$sidecar_home/.lock.$NODE"
check_exit0 stale-lock-reclaimed run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
assert_calls stale-lock-reclaimed 1 "run start"

# The lock must not be left behind on the happy path, or the NEXT session on this
# node would be skipped forever.
fresh_sidecar_home lockreleased
check_exit0 lock-released run_hook ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID"
if [ -d "$sidecar_home/.lock.$NODE" ]; then
  printf 'FAIL create lock was not released\n'
  fail=$((fail + 1))
else
  pass=$((pass + 1))
fi

# Two boundaries in parallel must produce exactly ONE run start.
fresh_sidecar_home lockrace
run_hook_bg() {
  env -i PATH="$bin:/usr/bin:/bin" HOME="$fake_home" ITT_CALLS="$calls" \
    AOS_RUN_SESSION_HOME="$sidecar_home" INTENTTREE_SDLC_SYNC=auto \
    ITT_NODE_ID="$NODE" CLAUDE_CODE_SESSION_ID="$SID" \
    bash "$hook" >/dev/null 2>&1 &
}
: > "$calls"
run_hook_bg; run_hook_bg; run_hook_bg
wait
starts="$(grep -c "run start" "$calls" 2>/dev/null)"
if [ "${starts:-0}" -le 1 ]; then
  pass=$((pass + 1))
else
  printf 'FAIL %s concurrent boundaries created %s runs (expected at most 1)\n' 3 "$starts"
  fail=$((fail + 1))
fi

# ---------------------------------------------------------------------------
# 10. The stub is not more permissive than the real CLI (PF-3 follow-up guard).
#
#     These are INVERTED assertions: they test the test harness, not the hook. Both
#     model a rejection observed live against `itt`, and both would have caught a
#     shipped defect that the old exit-0-for-anything stub waved through. If either
#     starts passing the wrong argv, this suite has regained the ability to green-light
#     a caller that fails 100% of the time in production.
# ---------------------------------------------------------------------------
install_good_itt

assert_stub_rejects() {
  name="$1"; shift
  out="$(ITT_CALLS="$calls" "$bin/itt" "$@" 2>&1)"; rc=$?
  if [ "$rc" -eq 2 ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: stub accepted argv the real itt rejects (rc=%s): itt %s\n' "$name" "$rc" "$*"
    printf '      stub said: %s\n' "$out"
    fail=$((fail + 1))
  fi
}

assert_stub_accepts() {
  name="$1"; shift
  ITT_CALLS="$calls" "$bin/itt" "$@" >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq 0 ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: stub rejected argv the real itt accepts (rc=%s): itt %s\n' "$name" "$rc" "$*"
    fail=$((fail + 1))
  fi
}

# (1) global-flag placement — the PF-3 bug class, verbatim
assert_stub_rejects json-after-subcommand      node get "$NODE" --json
assert_stub_rejects json-after-run-get         run get run_x --json
assert_stub_rejects actor-after-subcommand     node update "$NODE" --actor agent:operator
# (2) `run start` signature drift — the run-session-link follow-up, verbatim
assert_stub_rejects run-start-without-node-id  run start
assert_stub_rejects run-start-flag-first       run start --harness-type claude_code

# …and the correct forms still work, so the guard is a discriminator and not a wall.
assert_stub_accepts json-before-subcommand     --json node get "$NODE"
assert_stub_accepts actor-before-subcommand    --actor agent:operator node update "$NODE"
assert_stub_accepts run-start-positional-node  run start "$NODE" --harness-type claude_code

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
