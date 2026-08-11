#!/usr/bin/env bash
# test_verify_skillmeat_writeback.sh
#
# Smoke test for verify-skillmeat-writeback.sh (aos-native-by-default P3-003).
# Exercises the three non-trivial gate outcomes:
#   1. PASS  "N/A"          — no new AI-artifact path in the phase's files
#   2. WARN  "unreachable"  — a new artifact path is present but the
#                             SkillMeat CLI/enterprise endpoint can't verify it
#   3. FAIL                 — a new artifact path is present, SkillMeat is
#                             reachable, and the artifact is not registered
#
# Stubs `skillmeat` on PATH per case rather than depending on the real CLI or
# a live enterprise endpoint (mirrors html-capsules' test_cross_project_smoke.sh
# self-contained, portable style).
#
# Usage:
#   bash test_verify_skillmeat_writeback.sh
#   ./test_verify_skillmeat_writeback.sh

set -uo pipefail

fail() {
    echo "SMOKE TEST FAILED: $1" >&2
    exit 1
}

assert_exit() {
    local label="$1"
    local expected="$2"
    shift 2
    local output
    output="$("$@" 2>&1)"
    local actual=$?
    if [ "${actual}" -ne "${expected}" ]; then
        echo "----- output -----" >&2
        echo "${output}" >&2
        echo "-------------------" >&2
        fail "${label} — expected exit ${expected}, got ${actual}"
    fi
    printf '%s\n' "${output}"
}

# ---------------------------------------------------------------------------
# Resolve the hook under test.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
HOOKS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK="${HOOKS_DIR}/verify-skillmeat-writeback.sh"

[ -x "${HOOK}" ] || fail "hook not found or not executable at ${HOOK}"

TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_ROOT}"' EXIT

# ===========================================================================
# Case 1: PASS "N/A" — no artifact-glob path in PHASE_FILES.
# ===========================================================================
OUT="$(assert_exit "case1-na" 0 env -i PATH="${PATH}" \
    PHASE_FILES=$'README.md\ndocs/notes.md' \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "N/A" \
    || fail "case1-na: expected N/A message in output, got: ${OUT}"
echo "PASS: case 1 (N/A — no artifact path) — exit 0"

# ===========================================================================
# Case 2: WARN — artifact path present, skillmeat CLI missing from PATH.
# ===========================================================================
STRIPPED_PATH="/usr/bin:/bin"
OUT="$(assert_exit "case2-cli-missing" 0 env -i PATH="${STRIPPED_PATH}" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "WARN" \
    || fail "case2-cli-missing: expected WARN in output, got: ${OUT}"
echo "PASS: case 2 (WARN — skillmeat CLI missing) — exit 0"

# ===========================================================================
# Case 2b: WARN — artifact path present, SKILLMEAT_PROJECT unset.
# ===========================================================================
STUB_UNRESOLVED="${TMPDIR_ROOT}/stub-unresolved"
mkdir -p "${STUB_UNRESOLVED}"
cat > "${STUB_UNRESOLVED}/skillmeat" <<'STUB'
#!/usr/bin/env bash
echo "name: example-thing"
exit 0
STUB
chmod +x "${STUB_UNRESOLVED}/skillmeat"

OUT="$(assert_exit "case2b-project-unset" 0 env -i PATH="${STUB_UNRESOLVED}:/usr/bin:/bin" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "SKILLMEAT_PROJECT unset" \
    || fail "case2b-project-unset: expected SKILLMEAT_PROJECT-unset WARN, got: ${OUT}"
echo "PASS: case 2b (WARN — SKILLMEAT_PROJECT unset) — exit 0"

# ===========================================================================
# Case 2c: WARN — artifact path present, enterprise endpoint unreachable.
# ===========================================================================
STUB_UNREACHABLE="${TMPDIR_ROOT}/stub-unreachable"
mkdir -p "${STUB_UNREACHABLE}"
cat > "${STUB_UNREACHABLE}/skillmeat" <<'STUB'
#!/usr/bin/env bash
echo "Error: could not connect to enterprise endpoint (connection refused)" >&2
exit 2
STUB
chmod +x "${STUB_UNREACHABLE}/skillmeat"

OUT="$(assert_exit "case2c-unreachable" 0 env -i PATH="${STUB_UNREACHABLE}:/usr/bin:/bin" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    SKILLMEAT_PROJECT=agentic_meta_dev \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "UNREACHABLE\|WARN" \
    || fail "case2c-unreachable: expected UNREACHABLE/WARN in output, got: ${OUT}"
echo "PASS: case 2c (WARN — enterprise unreachable) — exit 0"

# ===========================================================================
# Case 3: FAIL — artifact path present, SkillMeat reachable, no entry found.
# ===========================================================================
STUB_NOTFOUND="${TMPDIR_ROOT}/stub-notfound"
mkdir -p "${STUB_NOTFOUND}"
cat > "${STUB_NOTFOUND}/skillmeat" <<'STUB'
#!/usr/bin/env bash
echo "Artifact 'example-thing' not found" >&2
exit 1
STUB
chmod +x "${STUB_NOTFOUND}/skillmeat"

OUT="$(assert_exit "case3-fail" 1 env -i PATH="${STUB_NOTFOUND}:/usr/bin:/bin" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    SKILLMEAT_PROJECT=agentic_meta_dev \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "FAIL" \
    || fail "case3-fail: expected FAIL in output, got: ${OUT}"
echo "PASS: case 3 (FAIL — new artifact, no SkillMeat entry) — exit 1"

# ===========================================================================
# Case 4 (bonus): PASS "FOUND" — artifact path present, SkillMeat resolves it.
# ===========================================================================
STUB_FOUND="${TMPDIR_ROOT}/stub-found"
mkdir -p "${STUB_FOUND}"
cat > "${STUB_FOUND}/skillmeat" <<'STUB'
#!/usr/bin/env bash
echo "name: example-thing"
exit 0
STUB
chmod +x "${STUB_FOUND}/skillmeat"

OUT="$(assert_exit "case4-found" 0 env -i PATH="${STUB_FOUND}:/usr/bin:/bin" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    SKILLMEAT_PROJECT=agentic_meta_dev \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "PASS" \
    || fail "case4-found: expected PASS in output, got: ${OUT}"
echo "PASS: case 4 (PASS — artifact found in SkillMeat) — exit 0"

# ===========================================================================
# Case 4b (regression, aos-native-by-default final review): a non-ARTIFACT
# "not found" message (e.g. a collection/path error, as the buggy
# `show --collection <project>` produced) must NOT be misclassified as
# artifact-absence → FAIL. The tightened NOT_FOUND_RE + dropped --collection
# make this a WARN (unrecognized/ambiguous), never exit 1.
# ===========================================================================
STUB_COLL="${TMPDIR_ROOT}/stub-collerr"
mkdir -p "${STUB_COLL}"
cat > "${STUB_COLL}/skillmeat" <<'STUB'
#!/usr/bin/env bash
echo "Collection 'agentic_meta_dev' not found at /home/x/.skillmeat/collections/agentic_meta_dev" >&2
exit 1
STUB
chmod +x "${STUB_COLL}/skillmeat"

assert_exit "case4b-collerr-not-fail" 0 env -i PATH="${STUB_COLL}:/usr/bin:/bin" \
    PHASE_FILES='.claude/skills/example-thing/SKILL.md' \
    SKILLMEAT_PROJECT=agentic_meta_dev \
    bash "${HOOK}" >/dev/null
echo "PASS: case 4b (regression — collection-error 'not found' WARNs, not FAIL) — exit 0"

# ===========================================================================
# Case 5 (bonus): --files-from parses a progress file's nested
# tasks[].files_affected lists (indentation-aware YAML extraction).
# ===========================================================================
FIXTURE="${TMPDIR_ROOT}/fixture-progress.md"
cat > "${FIXTURE}" <<'FIXTURE_EOF'
---
tasks:
  - id: "T-1"
    files_affected:
      - ".claude/skills/example-thing/SKILL.md"
    status: pending
---
FIXTURE_EOF

OUT="$(assert_exit "case5-files-from" 0 env -i PATH="/usr/bin:/bin" \
    bash "${HOOK}" --files-from "${FIXTURE}")"
printf '%s\n' "${OUT}" | grep -q "example-thing/SKILL.md" \
    || fail "case5-files-from: expected the fixture's artifact path to be detected, got: ${OUT}"
echo "PASS: case 5 (--files-from nested files_affected extraction)"

echo
echo "SMOKE TEST PASSED: all verify-skillmeat-writeback.sh gate paths behave per contract."
exit 0
