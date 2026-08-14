#!/usr/bin/env bash
# Regression net for the reviewer-gate symbol-scoped test-scope resolver.
#
# The load-bearing case is CASE 3: a synthetic two-tree pair where a symbol's
# BEHAVIOUR changes inside `lib/widget.py` and a test file that references that
# symbol by name is never touched by the diff at all -- the exact shape that let
# the reviewer gate approve skillmeat PR #299 over a stale, untouched test file
# (docs/project_plans/reviewer-gate-validation-scope-hardening-v1.md §2/§3.4). If
# that case ever stops finding the untouched test file, the resolver is decoration.
#
# Four contracts are tested, and they are not the same thing:
#
# The WRAPPER contract (CASE 1/2): master switch, binding guard, non-fatal
# infra handling -- mirrors test_mode_d_scan.sh's CASE 12.
#
# The RESOLUTION contract (CASE 3/4): the symbol-scoped selection itself, run
# via the wrapper AND via the python module directly (per the sibling
# convention of testing both call surfaces).
#
# The DISCLOSURE contract (CASE 5-8): every bound field (symbols_dropped,
# scope_truncated/omitted_files, budget_exhausted/budget_exhausted_files) must
# be PRESENT on the JSON blob even when the bound never trips (false/[]), and
# must be present AND populated when a bound is deliberately forced to trip via
# a tightened override.
#
# The LOUDNESS contract (CASE 9/10): a non-Python diff and an unchanged tree
# must never read as a silently-empty scope -- scope_status names which case
# it is.
#
# Offline and deterministic: no network, no model, no real git repo required
# (the resolver operates on plain directory trees).
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/validation-scope.sh"
engine="$hooks/validation_scope.py"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-python3}"

pass=0
fail=0
check() { # check <label> <expected_rc> <actual_rc>
    if [ "$2" = "$3" ]; then
        printf '  ok    %s (rc=%s)\n' "$1" "$3"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s (expected rc=%s, got rc=%s)\n' "$1" "$2" "$3"
        fail=$((fail + 1))
    fi
}
contains() { # contains <label> <haystack-file> <needle>
    if grep -qF -- "$3" "$2"; then
        printf '  ok    %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s — output did not contain %q\n' "$1" "$3"
        fail=$((fail + 1))
    fi
}
json_field() { # json_field <label> <json-file> <python expr over d> <expected-repr>
    got="$("$python_bin" - "$2" <<PY
import json, sys
d = json.load(open(sys.argv[1]))
print($3)
PY
)"
    if [ "$got" = "$4" ]; then
        printf '  ok    %s (%s)\n' "$1" "$got"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s — expected %s, got %s\n' "$1" "$4" "$got"
        fail=$((fail + 1))
    fi
}

# ── synthetic two-tree fixture: the PR #299 shape in miniature ───────────────
# base/lib/widget.py defines `def compute(x): return x + 1`.
# head/lib/widget.py changes compute()'s BODY only (`return x + 2`).
# base+head/tests/test_widget_behavior.py is BYTE-IDENTICAL in both trees and
# imports+calls `compute` -- it must be pulled into scope purely by symbol
# reference, exactly like test_enterprise_artifact_upstream.py in the AC-4 fixture.
mkbase() {
    root="$1"
    mkdir -p "$root/lib" "$root/tests"
    cat > "$root/lib/widget.py" <<'PY'
def compute(x):
    return x + 1


def unrelated():
    return "noop"
PY
    cat > "$root/tests/test_widget_behavior.py" <<'PY'
from lib.widget import compute


def test_compute_adds_one():
    assert compute(1) == 2
PY
}

base="$tmpdir/base"
head="$tmpdir/head"
mkbase "$base"
mkbase "$head"
# only lib/widget.py changes at head; the test file is untouched, byte-identical.
cat > "$head/lib/widget.py" <<'PY'
def compute(x):
    return x + 2


def unrelated():
    return "noop"
PY

echo "== CASE 1: wrapper — master switch off => silent no-op =="
AOS_VALIDATION_SCOPE=off VALIDATION_SCOPE_BASE_DIR="$base" VALIDATION_SCOPE_HEAD_DIR="$head" \
    "$hook" >/dev/null 2>&1
check "switch off => exit 0" 0 "$?"

echo "== CASE 2: wrapper — no binding => silent no-op =="
"$hook" >/dev/null 2>&1
check "no BASE_DIR/BASE_REF => exit 0" 0 "$?"

echo "== CASE 2b: wrapper — infra failure (bad base ref, no git repo) swallowed =="
VALIDATION_SCOPE_BASE_REF="not-a-real-ref" VALIDATION_SCOPE_REPO="$tmpdir" "$hook" >/dev/null 2>&1
check "bad ref / not a git repo => exit 0 (non-fatal)" 0 "$?"

echo "== CASE 3: wrapper — resolves the untouched-but-referencing test file =="
out="$tmpdir/c3.json"
VALIDATION_SCOPE_BASE_DIR="$base" VALIDATION_SCOPE_HEAD_DIR="$head" VALIDATION_SCOPE_JSON=1 \
    "$hook" >"$out" 2>&1
check "resolve via wrapper => exit 0" 0 "$?"
json_field "scope_status is ok" "$out" 'd["scope_status"]' "ok"
json_field "untouched test file pulled into scope" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"
json_field "justified by the changed symbol compute" "$out" \
    '"compute" in d["matched_symbols"].get("tests/test_widget_behavior.py", [])' "True"

echo "== CASE 4: python module direct — same resolution, called without the wrapper =="
out="$tmpdir/c4.json"
"$python_bin" "$engine" resolve --base-dir "$base" --head-dir "$head" --json >"$out" 2>&1
check "direct engine call => exit 0" 0 "$?"
json_field "direct call: untouched test file in scope" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"

echo "== CASE 5: disclosure fields present-but-false when no bound trips =="
json_field "scope_truncated is false, not absent" "$out" 'd["scope_truncated"]' "False"
json_field "omitted_files is empty, not absent" "$out" 'd["omitted_files"]' "[]"
json_field "budget_exhausted is false, not absent" "$out" 'd["budget_exhausted"]' "False"
json_field "budget_exhausted_files is empty, not absent" "$out" 'd["budget_exhausted_files"]' "[]"
json_field "symbols_dropped is a list (may be non-empty: short/dunder names)" "$out" \
    'isinstance(d["symbols_dropped"], list)' "True"
json_field "resolution_command is recorded (auditability)" "$out" \
    'len(d["resolution_command"]) > 0' "True"

echo "== CASE 6: file cap bound trips and discloses when tightened =="
out="$tmpdir/c6.json"
"$python_bin" "$engine" resolve --base-dir "$base" --head-dir "$head" \
    --max-test-files 0 --json >"$out" 2>&1
check "tightened file cap => exit 0 (disclosure, not a hard gate)" 0 "$?"
json_field "scope_truncated flips true" "$out" 'd["scope_truncated"]' "True"
json_field "omitted_files names the omitted file" "$out" \
    '"tests/test_widget_behavior.py" in d["omitted_files"]' "True"

echo "== CASE 7: fanout bound trips and discloses when tightened to 0 =="
out="$tmpdir/c7.json"
"$python_bin" "$engine" resolve --base-dir "$base" --head-dir "$head" \
    --max-fanout 0 --json >"$out" 2>&1
check "tightened fanout => exit 0" 0 "$?"
json_field "compute is dropped for fanout" "$out" \
    'any(s["symbol"] == "compute" and s["reason"] == "fanout" for s in d["symbols_dropped"])' "True"

echo "== CASE 8: wall-clock budget trips and discloses when tightened to 0 =="
out="$tmpdir/c8.json"
"$python_bin" "$engine" resolve --base-dir "$base" --head-dir "$head" \
    --max-seconds 0 --json >"$out" 2>&1
check "tightened budget => exit 0" 0 "$?"
json_field "budget_exhausted flips true" "$out" 'd["budget_exhausted"]' "True"

echo "== CASE 9: non-Python diff is reported LOUD, never a silently-empty scope =="
nonpy_base="$tmpdir/nonpy_base"
nonpy_head="$tmpdir/nonpy_head"
mkdir -p "$nonpy_base" "$nonpy_head"
echo "old" > "$nonpy_base/README.md"
echo "new" > "$nonpy_head/README.md"
out="$tmpdir/c9.json"
"$python_bin" "$engine" resolve --base-dir "$nonpy_base" --head-dir "$nonpy_head" --json >"$out" 2>&1
check "non-python-only diff => exit 0" 0 "$?"
json_field "scope_status names it, not silently empty" "$out" \
    'd["scope_status"]' "unsupported_language"
json_field "the non-py file is named" "$out" '"README.md" in d["diff_files"]' "True"

echo "== CASE 10: identical trees => no_changes, not a false positive scope =="
out="$tmpdir/c10.json"
"$python_bin" "$engine" resolve --base-dir "$base" --head-dir "$base" --json >"$out" 2>&1
check "identical trees => exit 0" 0 "$?"
json_field "scope_status is no_changes" "$out" 'd["scope_status"]' "no_changes"
json_field "test_scope is empty" "$out" 'd["test_scope"]' "[]"

echo "== CASE 11: usage/engine errors from the wrapper are swallowed, never propagated =="
VALIDATION_SCOPE_BASE_DIR="/does/not/exist" VALIDATION_SCOPE_HEAD_DIR="$head" "$hook" >/dev/null 2>&1
check "nonexistent base dir => exit 0 (non-fatal; empty tree, not a crash)" 0 "$?"

# =============================================================================
# PHASE 2 -- measure_file() / `measure` subcommand (§3.2, AC-2). Reuses the
# real AC-4 fixture for the mutation proof (that fixture IS the mutation --
# base = pre-fix behaviour, head = post-fix), and small synthetic trees for
# the fail-closed contracts (measurement_failure / import-shadow / cleanup).
# =============================================================================
# `cd -P`, not a bare `cd`: bash's cd is LOGICAL by default, so invoked through the
# global symlink (~/.claude/skills/dev-execution -> the repo) the four ..'s unwind the
# SYMLINK path textually and land on $HOME instead of the repo root. ac4 then points at
# $HOME/tests/fixtures/..., which does not exist, the engine never launches pytest, and
# CASE 12's three assertions fail closed (91/3 via the symlink vs 94/0 via the repo path).
# `pwd -P` is NOT a substitute -- it canonicalises AFTER cd has already resolved `..`
# textually, so it still returns $HOME. Measured 2026-08-13.
# $hooks itself is deliberately left as-invoked: the suite should exercise the hook copy
# the caller actually reached. Only repo_root, which locates repo-side FIXTURE data, is
# resolved physically.
repo_root="$(cd -P "$hooks/../../../.." && pwd)"
ac4="$repo_root/tests/fixtures/reviewer-gate-scope/ac4-drift-twin"

echo "== CASE 12: mutation proof -- delta flips with the fix, never constant =="
out="$tmpdir/c12_fix.json"
"$python_bin" "$engine" measure --base-dir "$ac4/base" --head-dir "$ac4/head" \
    --file tests/test_enterprise_artifact_upstream.py --json >"$out" 2>&1
check "measure base-vs-head (fix present) => exit 0" 0 "$?"
json_field "fix present: delta.failed is +3" "$out" 'd["delta"]["failed"]' "3"
json_field "fix present: 3 newly_failing node ids" "$out" 'len(d["newly_failing_node_ids"])' "3"

out="$tmpdir/c12_nofix.json"
"$python_bin" "$engine" measure --base-dir "$ac4/base" --head-dir "$ac4/base" \
    --file tests/test_enterprise_artifact_upstream.py --json >"$out" 2>&1
check "measure base-vs-base (fix reverted / no-op) => exit 0" 0 "$?"
json_field "fix reverted: delta.failed is 0" "$out" 'd["delta"]["failed"]' "0"
json_field "fix reverted: no newly_failing node ids" "$out" 'len(d["newly_failing_node_ids"])' "0"
# The tautological-gate failure mode this proof exists to catch: a delta
# computation that reports the same answer whether or not the fix is
# present. Assert the two runs above actually differ from one another.
fix_delta="$("$python_bin" - "$tmpdir/c12_fix.json" <<PY
import json, sys
print(json.load(open(sys.argv[1]))["delta"]["failed"])
PY
)"
nofix_delta="$("$python_bin" - "$tmpdir/c12_nofix.json" <<PY
import json, sys
print(json.load(open(sys.argv[1]))["delta"]["failed"])
PY
)"
if [ "$fix_delta" != "$nofix_delta" ]; then
    printf '  ok    mutation proof: delta differs with/without the fix (%s vs %s)\n' "$fix_delta" "$nofix_delta"
    pass=$((pass + 1))
else
    printf '  FAIL  mutation proof: delta IDENTICAL with/without the fix (%s) -- tautological gate\n' "$fix_delta"
    fail=$((fail + 1))
fi

echo "== CASE 13: collected==0 is measurement_failure, NEVER '0 failed' =="
zero_base="$tmpdir/zero_base"
zero_head="$tmpdir/zero_head"
mkdir -p "$zero_base" "$zero_head"
# Neither tree has the requested file at all -- pytest exits nonzero with
# "file or directory not found" and prints NO summary line, so collected
# stays 0. This is exactly the R2 shape ("no matches found" / a multi-path
# invocation that silently collects nothing) the plan calls out: it must
# read as measurement_failure, never as a clean "0 failed".
out="$tmpdir/c13.json"
"$python_bin" "$engine" measure --base-dir "$zero_base" --head-dir "$zero_head" \
    --file tests/test_does_not_exist.py --json >"$out" 2>&1
check "measure over trees lacking the requested file => exit 0" 0 "$?"
json_field "measurement_failure is true, not silently '0 failed'" "$out" 'd["measurement_failure"]' "True"
json_field "base.failed stays 0 (never fabricated)" "$out" 'd["base"]["failed"]' "0"
json_field "failure_reason is non-empty" "$out" 'len(d["failure_reason"]) > 0' "True"

echo "== CASE 14: import-shadow assertion fires on a package resolving OUTSIDE the tree =="
shadow_tree="$tmpdir/shadow_tree"
shadow_external="$tmpdir/shadow_external"
mkdir -p "$shadow_tree/tests" "$shadow_external/shadowpkg"
cat > "$shadow_external/shadowpkg/__init__.py" <<'PY'
VALUE = "external"
PY
# shadow_tree/shadowpkg is a SYMLINK to a package OUTSIDE shadow_tree -- it
# passes the "(tree_dir / name).is_dir()" locally-shadowable check (symlinks
# resolve as directories) but Path(...).resolve() on its __file__ reveals the
# real location is outside the tree. This is the deterministic, no-real-repo
# way to exercise "a package the tree measurement is pinned to actually
# resolves somewhere else" (plan risk R1) without depending on a real
# editable install being present on this machine.
ln -s "$shadow_external/shadowpkg" "$shadow_tree/shadowpkg"
cat > "$shadow_tree/tests/test_shadow.py" <<'PY'
import shadowpkg


def test_it():
    assert shadowpkg.VALUE == "external"
PY
out="$tmpdir/c14.json"
"$python_bin" - "$shadow_tree" "tests/test_shadow.py" "$python_bin" <<PY >"$out" 2>&1
import sys
sys.path.insert(0, "$hooks")
import validation_scope as vs
from pathlib import Path
ok, msg = vs._assert_import_shadow(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
print("OK" if ok else "SHADOW_DETECTED: " + msg)
PY
check "import-shadow preflight ran" 0 "$?"
contains "import-shadow assertion catches the symlinked-outside package" "$out" "SHADOW_DETECTED"

echo "== CASE 15: cleanup guard refuses a dirty worktree and non-confined paths =="
cleanup_repo="$tmpdir/cleanup_repo"
mkdir -p "$cleanup_repo"
git -C "$cleanup_repo" init -q
git -C "$cleanup_repo" config user.email test@example.com
git -C "$cleanup_repo" config user.name test
echo "x" > "$cleanup_repo/f.txt"
git -C "$cleanup_repo" add f.txt
git -C "$cleanup_repo" commit -q -m init
sha="$(git -C "$cleanup_repo" rev-parse HEAD)"
confined_wt="$cleanup_repo/.claude/worktrees/gate-baseline-${sha:0:12}"
git -C "$cleanup_repo" worktree add --detach "$confined_wt" "$sha" >/dev/null 2>&1
echo "dirty" > "$confined_wt/untracked.txt"

out="$tmpdir/c15_dirty.json"
"$python_bin" - "$cleanup_repo" "$confined_wt" <<PY >"$out" 2>&1
import sys
sys.path.insert(0, "$hooks")
import validation_scope as vs
from pathlib import Path
removed, msg = vs._cleanup_baseline_worktree(Path(sys.argv[1]), Path(sys.argv[2]))
print("REMOVED" if removed else "REFUSED: " + msg)
PY
check "cleanup-guard probe ran (dirty worktree)" 0 "$?"
contains "dirty worktree => refused (R6 guard 2), no --force widening" "$out" "REFUSED"

out="$tmpdir/c15_root.json"
"$python_bin" - "$cleanup_repo" "$cleanup_repo" <<PY >"$out" 2>&1
import sys
sys.path.insert(0, "$hooks")
import validation_scope as vs
from pathlib import Path
removed, msg = vs._cleanup_baseline_worktree(Path(sys.argv[1]), Path(sys.argv[2]))
print("REMOVED" if removed else "REFUSED: " + msg)
PY
check "cleanup-guard probe ran (repo root as target)" 0 "$?"
contains "repo root as cleanup target => refused (R6 guard 3)" "$out" "REFUSED"

rm -f "$confined_wt/untracked.txt"
out="$tmpdir/c15_clean.json"
"$python_bin" - "$cleanup_repo" "$confined_wt" <<PY >"$out" 2>&1
import sys
sys.path.insert(0, "$hooks")
import validation_scope as vs
from pathlib import Path
removed, msg = vs._cleanup_baseline_worktree(Path(sys.argv[1]), Path(sys.argv[2]))
print("REMOVED" if removed else "REFUSED: " + msg)
PY
check "cleanup-guard probe ran (clean, confined worktree)" 0 "$?"
contains "clean confined worktree => actually removed" "$out" "REMOVED"

echo "== CASE 16: pytest-timeout availability is RECORDED, never assumed (§6) =="
out="$tmpdir/c16.json"
"$python_bin" "$engine" measure --base-dir "$ac4/base" --head-dir "$ac4/head" \
    --file tests/test_enterprise_artifact_upstream.py --json >"$out" 2>&1
check "measure ran for the timeout-recording check" 0 "$?"
json_field "pytest_timeout_available key is present and boolean" "$out" \
    'isinstance(d["pytest_timeout_available"], bool)' "True"

echo "== CASE 17: measure usage error exits 1, never 2 =="
"$python_bin" "$engine" measure >/dev/null 2>&1
check "missing --file => exit 1 (not argparse's default 2)" 1 "$?"
"$python_bin" "$engine" measure --help >/dev/null 2>&1
check "measure --help => exit 0" 0 "$?"

echo "== CASE 18: a head-side collection ERROR fails closed, never '0 failed' =="
# The third door onto the R1/R2 fail-open class, found by probe 2026-08-10.
# `collected == 0` structurally CANNOT catch this: pytest's summary for a
# collection error is "1 error in 0.01s", so collected == sum(outcomes) == 1.
# The import-shadow preflight cannot catch it either -- it only covers packages
# that the test file imports AND that exist locally under the tree, and the
# failing import here is a third-party module that exists nowhere.
# Pre-fix behaviour was: measurement_failure=False, newly_failing=[],
# delta_failed=0 -- two tests stopped running entirely and it read as CLEAN.
ce="$tmpdir/collerr"
mkdir -p "$ce/base/tests" "$ce/head/tests"
printf 'def test_a(): assert 1 == 1\ndef test_b(): assert 2 == 2\n' >"$ce/base/tests/test_thing.py"
printf 'import a_third_party_module_not_installed\ndef test_a(): assert 1 == 1\ndef test_b(): assert 2 == 2\n' \
    >"$ce/head/tests/test_thing.py"
out="$tmpdir/c18.json"
"$python_bin" "$engine" measure --base-dir "$ce/base" --head-dir "$ce/head" \
    --file tests/test_thing.py --json >"$out" 2>&1
json_field "head collection error => measurement_failure (not '0 failed')" "$out" \
    'd["measurement_failure"]' "True"
contains "failure_reason names the error as 'did not RUN'" "$out" "did not RUN"

echo "== CASE 19: tests that VANISH at head are disclosed, not netted out =="
# base 3 collected / head 1 collected, zero failures either side. On counts
# alone delta_failed == 0, i.e. indistinguishable from clean -- yet two tests
# stopped running and can no longer evidence any AC. Deleting a test is
# legitimate, so this DISCLOSES rather than fails closed; silence is the bug.
van="$tmpdir/vanish"
mkdir -p "$van/base/tests" "$van/head/tests"
printf 'def test_a(): assert 1 == 1\ndef test_b(): assert 2 == 2\ndef test_c(): assert 3 == 3\n' \
    >"$van/base/tests/test_thing.py"
printf 'def test_a(): assert 1 == 1\n' >"$van/head/tests/test_thing.py"
out="$tmpdir/c19.json"
"$python_bin" "$engine" measure --base-dir "$van/base" --head-dir "$van/head" \
    --file tests/test_thing.py --json >"$out" 2>&1
check "measure ran for the vanished-test check" 0 "$?"
json_field "delta failed is 0 -- clean on counts alone" "$out" 'd["delta"]["failed"]' "0"
json_field "collected_regression is nonetheless True" "$out" 'd["collected_regression"]' "True"
json_field "both vanished node ids are named" "$out" \
    'len(d["disappeared_node_ids"]) == 2 and all("test_thing.py::test_" in n for n in d["disappeared_node_ids"])' \
    "True"
json_field "delta.collected reports the -2" "$out" 'd["delta"]["collected"]' "-2"

echo "== CASE 20: _SKIP_DIR matches both .claude/worktrees and .worktrees path shapes =="
out="$tmpdir/c20.txt"
"$python_bin" - <<PY >"$out" 2>&1
import sys
sys.path.insert(0, "$hooks")
from validation_scope import _SKIP_DIR
checks = [
    (".claude/worktrees/exec-foo/skillmeat/foo.py", True),
    (".worktrees/exec-foo/bar.py", True),
    ("skillmeat/core/foo.py", False),
    (".git/aos-validation-scope/validation-scope-abc123", True),
]
ok = all(bool(_SKIP_DIR.search(p)) == expect for p, expect in checks)
print("OK" if ok else "MISMATCH: " + repr(checks))
PY
contains "_SKIP_DIR skips both nested-worktree path shapes (unit-level)" "$out" "OK"

echo "== CASE 21: real git repo, from-inside-a-worktree lane (AC1-AC4) =="
# The default lane for execute-plan/autopilot/execute-contract runs the gate
# from INSIDE a linked worktree (VALIDATION_SCOPE_REPO="."), which is exactly
# the shape that produced the 1806-file / budget_exhausted=true failure this
# fix exists for. Two-sided probe: resolve the SAME base/head pair once from
# the main checkout and once from inside a linked worktree, and assert they
# agree and stay small.
nest_repo="$tmpdir/nest_repo"
mkdir -p "$nest_repo/lib" "$nest_repo/tests"
git -C "$nest_repo" init -q
git -C "$nest_repo" config user.email test@example.com
git -C "$nest_repo" config user.name test
cat > "$nest_repo/lib/widget.py" <<'PY'
def compute(x):
    return x + 1


def unrelated():
    return "noop"
PY
cat > "$nest_repo/tests/test_widget_behavior.py" <<'PY'
from lib.widget import compute


def test_compute_adds_one():
    assert compute(1) == 2
PY
git -C "$nest_repo" add -A
git -C "$nest_repo" commit -q -m base
nest_base_sha="$(git -C "$nest_repo" rev-parse HEAD)"

# Head commit: a SMALL, known change -- one symbol body edit + one new file.
cat > "$nest_repo/lib/widget.py" <<'PY'
def compute(x):
    return x + 2


def unrelated():
    return "noop"
PY
cat > "$nest_repo/lib/extra.py" <<'PY'
def helper():
    return 1
PY
git -C "$nest_repo" add -A
git -C "$nest_repo" commit -q -m head

# Probe 1: resolve from the MAIN checkout.
out_main="$tmpdir/c21_main.json"
( cd "$nest_repo" && VALIDATION_SCOPE_BASE_REF="$nest_base_sha" VALIDATION_SCOPE_JSON=1 "$hook" ) \
    >"$out_main" 2>"$tmpdir/c21_main.err"
check "CASE21: resolve from main checkout => exit 0" 0 "$?"

# Probe 2: add a linked worktree (mirrors execute-plan/autopilot's own
# .claude/worktrees/<name> convention) and resolve the SAME thing from inside it.
nest_wt="$nest_repo/.claude/worktrees/exec-foo"
mkdir -p "$(dirname "$nest_wt")"
git -C "$nest_repo" worktree add --detach "$nest_wt" head >/dev/null 2>&1
out_wt="$tmpdir/c21_wt.json"
( cd "$nest_wt" && VALIDATION_SCOPE_BASE_REF="$nest_base_sha" VALIDATION_SCOPE_JSON=1 "$hook" ) \
    >"$out_wt" 2>"$tmpdir/c21_wt.err"
check "CASE21: resolve from inside a linked worktree => exit 0" 0 "$?"

# AC1: identical test_scope regardless of which tree the gate happened to run from.
cmp_out="$("$python_bin" - "$out_main" "$out_wt" <<PY
import json, sys
a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
print("MATCH" if a["test_scope"] == b["test_scope"] else "MISMATCH: %r vs %r" % (a["test_scope"], b["test_scope"]))
PY
)"
if [ "$cmp_out" = "MATCH" ]; then
    printf '  ok    AC1: test_scope identical, main checkout vs inside-worktree\n'
    pass=$((pass + 1))
else
    printf '  FAIL  AC1: %s\n' "$cmp_out"
    fail=$((fail + 1))
fi

# AC2: no diff_files entry names the nested-worktree/materialized-base path shape.
ac2_out="$("$python_bin" - "$out_wt" <<PY
import json, sys
d = json.load(open(sys.argv[1]))
bad = [f for f in d["diff_files"]
       if f.startswith(".claude/worktrees") or f.startswith(".worktrees") or "validation-scope-" in f]
print("CLEAN" if not bad else "POLLUTED: " + ",".join(bad[:5]))
PY
)"
if [ "$ac2_out" = "CLEAN" ]; then
    printf '  ok    AC2: diff_files contains no nested-worktree/materialized-base entries\n'
    pass=$((pass + 1))
else
    printf '  FAIL  AC2: %s\n' "$ac2_out"
    fail=$((fail + 1))
fi

# AC3: scope stays small and complete -- a real upper bound, not just "> 0".
json_field "AC3: diff_files count is small (<=10), not a whole-repo scope" "$out_wt" \
    'len(d["diff_files"]) <= 10' "True"
json_field "AC3: diff_files matches the known 2-file change" "$out_wt" \
    'sorted(d["diff_files"])' "['lib/extra.py', 'lib/widget.py']"
json_field "AC3: budget_exhausted is false" "$out_wt" 'd["budget_exhausted"]' "False"

# AC4: the worktree this run materialized is gone -- neither registered with
# git nor present on disk -- after the process exits.
wt_list_count="$(git -C "$nest_repo" worktree list 2>/dev/null | grep -c 'validation-scope-')"
check "AC4: no validation-scope-* worktree remains registered with git" 0 "$wt_list_count"

default_workdir="$("$python_bin" - "$nest_repo" <<PY
import sys
sys.path.insert(0, "$hooks")
from validation_scope import _default_workdir
from pathlib import Path
print(_default_workdir(Path(sys.argv[1])))
PY
)"
leftover_count="$(find "$default_workdir" -mindepth 1 -maxdepth 1 -type d -name 'validation-scope-*' 2>/dev/null | wc -l | tr -d ' ')"
check "AC4: no validation-scope-<sha> directory remains on disk" 0 "$leftover_count"

# =============================================================================
# PHASE 3 -- ARGV contract (§ the flag form is the PRIMARY invocation). All
# three real call sites (reviewer-gate.js:736, execute-plan.js:1311,
# execute-contract.js:1026) invoke the wrapper as
#   validation-scope.sh --json --base-ref <sha>
# and the pre-fix wrapper had ZERO argv handling: every flag was discarded, the
# binding guard then fired, and it exited 0 having printed nothing -- the
# reviewer gate's self-measurement was a silent no-op on every lane. Each case
# below fails against that pre-fix wrapper.
# =============================================================================

echo "== CASE 22: flag form ALONE (no VALIDATION_SCOPE_* env at all) resolves =="
out="$tmpdir/c22.json"
err="$tmpdir/c22.err"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF -u VALIDATION_SCOPE_HEAD_DIR \
    -u VALIDATION_SCOPE_JSON -u VALIDATION_SCOPE_REPO \
    "$hook" --json --base-dir "$base" --head-dir "$head" >"$out" 2>"$err"
check "flag-form-only invocation => exit 0" 0 "$?"
if [ -s "$out" ]; then
    printf '  ok    flag form produced NONEMPTY stdout (pre-fix: silently empty)\n'
    pass=$((pass + 1))
else
    printf '  FAIL  flag form produced EMPTY stdout -- argv discarded, silent no-op\n'
    fail=$((fail + 1))
fi
json_field "flag form: stdout is parseable JSON with scope_status" "$out" 'd["scope_status"]' "ok"
json_field "flag form: untouched test file pulled into scope" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"

echo "== CASE 23: the EXACT call-site form '--json --base-ref <sha>' on a real repo =="
# Byte-for-byte the invocation reviewer-gate.js / execute-plan.js /
# execute-contract.js emit, run from inside the repo with no env binding.
out="$tmpdir/c23.json"
err="$tmpdir/c23.err"
( cd "$nest_repo" && env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF \
    -u VALIDATION_SCOPE_JSON -u VALIDATION_SCOPE_REPO \
    "$hook" --json --base-ref "$nest_base_sha" ) >"$out" 2>"$err"
check "call-site form => exit 0" 0 "$?"
if [ -s "$out" ]; then
    printf '  ok    call-site form produced NONEMPTY stdout\n'
    pass=$((pass + 1))
else
    printf '  FAIL  call-site form produced EMPTY stdout -- the gate self-measurement is a no-op\n'
    fail=$((fail + 1))
fi
json_field "call-site form: diff_files matches the known 2-file change" "$out" \
    'sorted(d["diff_files"])' "['lib/extra.py', 'lib/widget.py']"

echo "== CASE 23b: --flag=value shape is accepted too =="
out="$tmpdir/c23b.json"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF -u VALIDATION_SCOPE_HEAD_DIR \
    -u VALIDATION_SCOPE_JSON \
    "$hook" --json "--base-dir=$base" "--head-dir=$head" >"$out" 2>/dev/null
check "--flag=value form => exit 0" 0 "$?"
json_field "--flag=value form resolves identically" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"

echo "== CASE 24: argv supplied but carrying NO binding => LOUD on stderr, rc=0 =="
out="$tmpdir/c24.out"
err="$tmpdir/c24.err"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF -u VALIDATION_SCOPE_JSON \
    "$hook" --json >"$out" 2>"$err"
check "argv-without-binding => still exit 0 (non-fatal contract)" 0 "$?"
if [ -s "$err" ]; then
    printf '  ok    argv-without-binding wrote to stderr (no-op is DISTINGUISHABLE)\n'
    pass=$((pass + 1))
else
    printf '  FAIL  argv-without-binding was SILENT -- indistinguishable from a real run\n'
    fail=$((fail + 1))
fi
contains "stderr names it as a validation-scope no-op" "$err" "[validation-scope]"
contains "stderr names the missing binding" "$err" "--base-ref"

echo "== CASE 24b: NO argv and NO env binding stays SILENT (default-on discipline) =="
out="$tmpdir/c24b.out"
err="$tmpdir/c24b.err"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF "$hook" >"$out" 2>"$err"
check "bare invocation => exit 0" 0 "$?"
if [ ! -s "$err" ] && [ ! -s "$out" ]; then
    printf '  ok    bare invocation emitted nothing at all (no noise in unrelated runs)\n'
    pass=$((pass + 1))
else
    printf '  FAIL  bare invocation emitted output -- default-on silence broken\n'
    fail=$((fail + 1))
fi

echo "== CASE 25: an explicit flag OVERRIDES a conflicting env var (argv wins) =="
# env points the base at a nonexistent tree (which resolves as an empty tree);
# the flag points it at the real fixture base. If env won, scope_status would
# not be "ok" with the untouched test file in scope.
out="$tmpdir/c25.json"
VALIDATION_SCOPE_BASE_DIR="/does/not/exist" VALIDATION_SCOPE_HEAD_DIR="$head" \
    "$hook" --json --base-dir "$base" >"$out" 2>/dev/null
check "conflicting flag+env => exit 0" 0 "$?"
json_field "flag base-dir won over env base-dir (scope_status ok)" "$out" 'd["scope_status"]' "ok"
json_field "flag base-dir won: diff is the single changed file, not a whole-tree add" "$out" \
    'sorted(d["diff_files"])' "['lib/widget.py']"

echo "== CASE 25b: env-only invocation still behaves exactly as before (no regression) =="
out="$tmpdir/c25b.json"
VALIDATION_SCOPE_BASE_DIR="$base" VALIDATION_SCOPE_HEAD_DIR="$head" VALIDATION_SCOPE_JSON=1 \
    "$hook" >"$out" 2>/dev/null
check "env-only form => exit 0" 0 "$?"
json_field "env-only form still resolves the untouched test file" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"

echo "== CASE 26: unknown flag => stderr warning, rc=0, measurement STILL emitted =="
out="$tmpdir/c26.json"
err="$tmpdir/c26.err"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF -u VALIDATION_SCOPE_HEAD_DIR \
    -u VALIDATION_SCOPE_JSON \
    "$hook" --json --base-dir "$base" --head-dir "$head" --not-a-real-flag >"$out" 2>"$err"
check "unknown flag => exit 0 (warn-and-continue, never an error)" 0 "$?"
contains "unknown flag is named on stderr" "$err" "--not-a-real-flag"
json_field "a valid measurement is STILL emitted alongside the warning" "$out" \
    '"tests/test_widget_behavior.py" in d["test_scope"]' "True"

echo "== CASE 26b: value flag with a missing value => warned, not crashed =="
err="$tmpdir/c26b.err"
env -u VALIDATION_SCOPE_BASE_DIR -u VALIDATION_SCOPE_BASE_REF "$hook" --base-ref >/dev/null 2>"$err"
check "dangling value flag => exit 0" 0 "$?"
contains "dangling value flag warned on stderr" "$err" "no value"

echo ""
printf 'validation-scope: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
