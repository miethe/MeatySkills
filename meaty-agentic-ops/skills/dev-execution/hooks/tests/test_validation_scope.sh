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
repo_root="$(cd "$hooks/../../../.." && pwd)"
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

echo ""
printf 'validation-scope: %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
