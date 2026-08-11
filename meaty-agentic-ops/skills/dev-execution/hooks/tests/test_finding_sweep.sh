#!/usr/bin/env bash
# Regression net for the close-time finding-reconciliation backstop.
#
# Two things are worth testing here, and they are not the same thing.
#
# The GATE contract (master switch / binding / always-exit-0) is what makes
# default-on safe: a repo with no findings doc must never hear from this hook, and
# no failure mode may ever block a phase close. There is deliberately no strict
# mode to test — a hook that can block on bookkeeping gets disabled, and a
# disabled sweep catches nothing.
#
# The DETECTION contract is what makes it worth running. The sweep must find the
# two shapes of missed filing (an entry with no id; an id that does not exist) and
# must NOT cry wolf on the three shapes that are fine (a real id, a reviewed
# `N/A — rationale`, an unfilled template bullet). A sweep with false positives is
# noise, and noise is how the previous generation of prose-only rules died.
#
# Node-existence verification is disabled in every case that does not specifically
# exercise it, so the suite stays offline and deterministic (tests/CLAUDE.md).
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/finding-sweep.sh"
engine="$hooks/finding_sweep.py"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-python3}"

# A findings doc carrying one of each shape the sweep must classify.
findings="$tmpdir/widget-sync-findings.md"
cat > "$findings" <<'DOC'
---
doc_type: report
report_category: finding
---

## Phase 1 Findings

### Discoveries
- Filed properly at src/a.py:12 — node_01AAAAAAAAAAAAAAAAAAAAAAAA
- Never filed: the loader ignores src/b.py:44
- [What was found, where, why it matters]

### Bugs / Gotchas
- N/A — nothing surfaced this phase

## Notes
- A bullet outside a findings subsection is prose, not a finding.
DOC

# A plan whose triage table has a filed row, an empty row, and a reviewed N/A row.
plan="$tmpdir/plan.md"
cat > "$plan" <<'PLAN'
# Deferred Items

| Item ID | Category | Reason Deferred | Trigger for Promotion | Target Spec Path | Tracker Node |
|---------|----------|-----------------|-----------------------|-----------------|--------------|
| DF-010 | research | needs a spike | spike lands | docs/x.md | node_01BBBBBBBBBBBBBBBBBBBBBBBB |
| DF-011 | design | no consensus | ADR approved | docs/y.md |  |
| DF-012 | policy | explicitly dropped | — | N/A | N/A — will not be worked |
PLAN

# A findings doc with nothing missing — the "quiet when clean" case.
clean="$tmpdir/clean-findings.md"
cat > "$clean" <<'DOC'
### Discoveries
- All accounted for at src/z.py:1 — node_01CCCCCCCCCCCCCCCCCCCCCCCC
DOC

pass=0
fail=0
check() {
  name="$1" expected="$2"
  shift 2
  set +e
  "$@" >/dev/null 2>&1
  actual=$?
  set -e
  if [ "$actual" -eq "$expected" ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: expected exit %s got %s\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

# Runs the hook and returns its stderr, so we can assert on what it REPORTED
# rather than only on its (always-zero) exit code.
report() {
  env FINDING_SWEEP_NO_VERIFY=1 "$@" "$hook" 2>&1
}

assert_contains() {
  name="$1" needle="$2" haystack="$3"
  case "$haystack" in
    *"$needle"*) pass=$((pass + 1)) ;;
    *) printf 'FAIL %s: expected output to contain %s\n' "$name" "$needle"; fail=$((fail + 1)) ;;
  esac
}

assert_lacks() {
  name="$1" needle="$2" haystack="$3"
  case "$haystack" in
    *"$needle"*) printf 'FAIL %s: output should not mention %s\n' "$name" "$needle"; fail=$((fail + 1)) ;;
    *) pass=$((pass + 1)) ;;
  esac
}

# --- gate contract: every path exits 0, and no-binding says nothing ----------
check no-binding 0 env -u FINDING_SWEEP_FINDINGS_DOC -u FINDING_SWEEP_PLAN_FILE -u FEATURE_SLUG "$hook"
check missing-artifact 0 env FINDING_SWEEP_FINDINGS_DOC="$tmpdir/nope.md" "$hook"
check switch-off 0 env AOS_FINDING_SWEEP=0 FINDING_SWEEP_FINDINGS_DOC="$findings" "$hook"
check unfiled-still-exits-zero 0 env FINDING_SWEEP_NO_VERIFY=1 \
  FINDING_SWEEP_FINDINGS_DOC="$findings" FINDING_SWEEP_PLAN_FILE="$plan" "$hook"
check bad-python-is-nonfatal 0 env FINDING_SWEEP_PYTHON=definitely-not-a-python \
  FINDING_SWEEP_FINDINGS_DOC="$findings" "$hook"

silent="$(env -u FINDING_SWEEP_FINDINGS_DOC -u FINDING_SWEEP_PLAN_FILE -u FEATURE_SLUG "$hook" 2>&1)"
if [ -z "$silent" ]; then
  pass=$((pass + 1))
else
  printf 'FAIL no-binding emitted output: %s\n' "$silent"; fail=$((fail + 1))
fi

off="$(env AOS_FINDING_SWEEP=0 FINDING_SWEEP_FINDINGS_DOC="$findings" "$hook" 2>&1)"
if [ -z "$off" ]; then
  pass=$((pass + 1))
else
  printf 'FAIL switch-off emitted output: %s\n' "$off"; fail=$((fail + 1))
fi

# --- detection contract: finds the misses, stays quiet about the rest --------
out="$(report FINDING_SWEEP_FINDINGS_DOC="$findings" FINDING_SWEEP_PLAN_FILE="$plan")"
assert_contains reports-unfiled-finding "the loader ignores src/b.py:44" "$out"
assert_contains reports-unfiled-triage-row "deferred item DF-011" "$out"
assert_lacks ignores-filed-finding "src/a.py:12" "$out"
assert_lacks ignores-filed-triage-row "DF-010" "$out"
assert_lacks honors-reviewed-na "nothing surfaced this phase" "$out"
assert_lacks ignores-template-bullet "What was found, where" "$out"
assert_lacks ignores-prose-outside-sections "outside a findings subsection" "$out"

# FEATURE_SLUG alone is a sufficient binding — the findings-doc path is conventional.
mkdir -p "$tmpdir/repo/.claude/findings"
cp "$findings" "$tmpdir/repo/.claude/findings/widget-sync-findings.md"
slug_out="$(cd "$tmpdir/repo" && env FINDING_SWEEP_NO_VERIFY=1 FEATURE_SLUG=widget-sync "$hook" 2>&1)"
assert_contains feature-slug-infers-doc "src/b.py:44" "$slug_out"

# Clean run says so explicitly rather than going quiet — silence would be
# indistinguishable from the hook never having run.
clean_out="$(report FINDING_SWEEP_FINDINGS_DOC="$clean")"
assert_contains clean-run-is-explicit "all have a tracker node" "$clean_out"

# --- engine: JSON shape + the fabricated-id pass ----------------------------
check engine-json 0 "$python_bin" "$engine" --findings-doc "$findings" --no-verify --json
json="$("$python_bin" "$engine" --findings-doc "$findings" --plan-file "$plan" --no-verify --json 2>&1)"
unfiled_count="$("$python_bin" - <<PY
import json
d = json.loads('''$json''')
print(len(d["unfiled"]))
PY
)"
if [ "$unfiled_count" = "2" ]; then
  pass=$((pass + 1))
else
  printf 'FAIL engine-json-unfiled-count: expected 2 got %s\n' "$unfiled_count"
  fail=$((fail + 1))
fi

# Verification is opt-out, and its absence must be VISIBLE — a silent skip would let a
# fabricated id pass as verified. Exercised via FINDING_SWEEP_ITT rather than by mutating
# PATH: stripping PATH also strips the interpreter, and on a pyenv shim it strips `bash` too
# (both were tried; both exited 127, which is why the override exists).
noitt="$(env FINDING_SWEEP_ITT=definitely-not-itt "$python_bin" "$engine" --findings-doc "$clean" 2>&1)"
assert_contains missing-itt-is-noted "not verified" "$noitt"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
