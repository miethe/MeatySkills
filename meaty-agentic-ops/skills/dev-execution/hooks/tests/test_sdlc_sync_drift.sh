#!/usr/bin/env bash
# Regression net for sdlc-sync.sh's SECTION 3 (M4, operator-p0-state-integrity —
# plan-node-drift.py wiring).
#
# The two properties that matter, both non-negotiable per the plan's rubric ("non-fatal
# means non-fatal... do not trap the drift signal"):
#
#   1. BINDING GATE — no node id resolvable (no ITT_NODE_ID, no itt_node_id frontmatter)
#      means ZERO plan-node-drift.py invocations. Same discipline as section 2's guard.
#   2. NON-FATAL, NOT SILENT-ON-DETECTION — the hook always exits 0, whatever the
#      checker found (clean / mismatch / an unreachable API), but a genuine mismatch's
#      reason text must still reach stderr. A hook that exits 0 by discarding the
#      checker's output would pass every test here for the wrong reason — this suite
#      greps stderr, it does not just assert the exit code.
#
# `itt` and `python3` are BOTH stubbed on PATH; nothing here touches a live IntentTree
# node or a live network. `plan-node-drift.py` itself already has an offline pytest
# suite (tests/test_plan_node_drift.py) — this file tests the BASH WIRING around it,
# not the comparison logic again.
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/sdlc-sync.sh"
repo_root="$(cd "$hooks/../../../.." && pwd)"

bin="$tmpdir/bin"
mkdir -p "$bin"

# --- stub `itt`: only used by section 1/2 here, and only to make them no-ops fast. ---
cat > "$bin/itt" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$bin/itt"

pass=0
fail=0

plan_file="$tmpdir/plan.md"
write_plan() {
  # $1 = status value
  cat > "$plan_file" <<EOF2
---
status: $1
feature_slug: drift-hook-fixture
itt_node_id: node_DRIFTTEST00000000000000001
---

body
EOF2
}

run_hook() {
  # $1 = mode: "no_python3" swaps python3 for a failing stub; anything else uses real python3.
  local mode="$1"; shift
  local path="$bin:/usr/bin:/bin"
  if [ "$mode" = "real_python3" ]; then
    # Real python3 is needed to exercise plan-node-drift.py itself (the unreachable-API
    # case below). Keep the system PATH so python3 resolves, but our stub `itt` still
    # shadows the real one for section 1/2, and plan-node-drift.py's OWN itt calls go
    # through its `_default_runner`, which shells out to whatever `itt` is on PATH —
    # our stub (exit 1, no stdout) is exactly "the API is unreachable" from its point
    # of view: itt runs, fails, IttError is raised, caught as an ERROR row.
    path="$bin:$(dirname "$(command -v python3)"):/usr/bin:/bin"
  fi
  env -i \
    PATH="$path" \
    HOME="$tmpdir/home" \
    SDLC_SYNC_FILE="$plan_file" \
    "$@" \
    bash "$hook" >"$tmpdir/out.log" 2>"$tmpdir/err.log"
  echo $?
}

check_exit0() {
  name="$1"; actual="$2"
  if [ "$actual" -eq 0 ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: hook must always exit 0, got %s\n' "$name" "$actual"
    fail=$((fail + 1))
  fi
}

assert_stderr_empty_of() {
  name="$1" needle="$2"
  if grep -q -- "$needle" "$tmpdir/err.log" 2>/dev/null; then
    printf 'FAIL %s: expected NO stderr mention of %q, got:\n' "$name" "$needle"
    sed 's/^/      /' "$tmpdir/err.log"
    fail=$((fail + 1))
  else
    pass=$((pass + 1))
  fi
}

assert_stderr_contains() {
  name="$1" needle="$2"
  if grep -q -- "$needle" "$tmpdir/err.log" 2>/dev/null; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: expected stderr to mention %q, got:\n' "$name" "$needle"
    sed 's/^/      /' "$tmpdir/err.log"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# 1. Binding gate — no node id resolvable anywhere -> section 3 never invokes the
#    engine at all (not even a "not found" message; true silence).
# ---------------------------------------------------------------------------
cat > "$plan_file" <<'EOF3'
---
status: completed
feature_slug: drift-hook-fixture-no-binding
---

body
EOF3
rc="$(run_hook stub_python3)"
check_exit0 no-node-id-no-op "$rc"
assert_stderr_empty_of no-node-id-no-op "plan-node-drift"
assert_stderr_empty_of no-node-id-no-op "plan/node status drift"

# ---------------------------------------------------------------------------
# 2. Master switch hard-off (AOS_PLAN_NODE_DRIFT=0) -> section 3 skipped even
#    though a node id IS resolvable from frontmatter.
# ---------------------------------------------------------------------------
write_plan completed
rc="$(run_hook real_python3 AOS_PLAN_NODE_DRIFT=0)"
check_exit0 drift-switch-off "$rc"
assert_stderr_empty_of drift-switch-off "plan-node-drift"

# ---------------------------------------------------------------------------
# 3. API unreachable (stub `itt` exits 1 with no stdout) -> the engine reports an
#    ERROR row (not a mismatch), and the HOOK still exits 0. This is the scenario
#    named explicitly in the M4 acceptance criteria.
# ---------------------------------------------------------------------------
write_plan completed
rc="$(run_hook real_python3)"
check_exit0 api-unreachable-still-exit0 "$rc"
# The engine ran (this is a real invocation, not a no-op) but found no MISMATCH to
# report — an unreachable API must not be indistinguishable from "gate skipped
# entirely" at the exit-code level, but it must also not manufacture a false
# "drift detected" line for a comparison it could not actually make.
assert_stderr_empty_of api-unreachable-no-false-mismatch "plan/node status drift detected"

# ---------------------------------------------------------------------------
# 4. A genuine mismatch (fake `itt` returns a real, disagreeing node) must be
#    ECHOED to stderr — never swallowed — while the hook STILL exits 0.
#    This is the one property the plan calls out by name: "do not trap the drift
#    signal."
# ---------------------------------------------------------------------------
cat > "$bin/itt" <<'EOF4'
#!/usr/bin/env bash
# args: --json node get <id>
if [ "$1 $2 $3" = "--json node get" ]; then
  printf '{"id": "%s", "status": "not_started"}\n' "$4"
  exit 0
fi
exit 1
EOF4
chmod +x "$bin/itt"
write_plan completed   # plan says completed; stubbed node says not_started -> MISMATCH
rc="$(run_hook real_python3)"
check_exit0 mismatch-still-exit0 "$rc"
assert_stderr_contains mismatch-is-reported "plan/node status drift detected"
assert_stderr_contains mismatch-reason-visible "MISMATCH"

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
