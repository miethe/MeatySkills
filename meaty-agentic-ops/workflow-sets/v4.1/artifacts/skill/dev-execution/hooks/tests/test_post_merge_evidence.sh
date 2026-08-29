#!/usr/bin/env bash
# test_post_merge_evidence.sh
#
# Smoke test for post-merge-evidence.sh (Shipped Work Ledger M3 L2, FR-8/FR-9).
# Exercises the hook's non-fatal contract:
#   1. disabled by AOS_POST_MERGE_EVIDENCE=0        -> exit 0, ZERO calls
#   2. no binding at all (no node/tree/frontmatter)  -> exit 0, ZERO calls
#   3. plan file missing/unset                       -> exit 0, warning only
#   4. python3 missing from PATH                     -> exit 0, warning only
#   5. engine reports an error (bad node resolution)  -> exit 0, warning only
#
# Every case is fully offline: no network, no live server, no real IntentTree
# client construction — case 5's "engine error" is an unresolvable-node usage
# error the engine can detect BEFORE constructing an HTTP client (no --tree
# given), so even that case never opens a socket.
#
# Usage:
#   bash test_post_merge_evidence.sh

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
HOOK="${HOOKS_DIR}/post-merge-evidence.sh"

[ -x "${HOOK}" ] || fail "hook not found or not executable at ${HOOK}"

TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_ROOT}"' EXIT

PLAN_BOUND="${TMPDIR_ROOT}/bound-plan.md"
cat > "${PLAN_BOUND}" <<'EOF'
---
feature_slug: example-feature
itt_node_id: node_EXAMPLE123
commit_refs:
  - b9b4613
pr_refs:
  - "agentic_meta_dev#33"
---
# Example plan
EOF

PLAN_UNBOUND="${TMPDIR_ROOT}/unbound-plan.md"
cat > "${PLAN_UNBOUND}" <<'EOF'
---
title: "no join key here"
---
# Example plan with no binding frontmatter
EOF

# ===========================================================================
# Case 1: disabled by AOS_POST_MERGE_EVIDENCE=0 — exit 0, no calls attempted.
# Uses a stripped PATH so any real `itt`/python3 network calls would fail loud
# if they were ever reached — they must not be.
# ===========================================================================
OUT="$(assert_exit "case1-disabled" 0 env -i PATH="/usr/bin:/bin" \
    AOS_POST_MERGE_EVIDENCE=0 \
    POST_MERGE_PLAN_FILE="${PLAN_BOUND}" \
    ITT_NODE_ID="node_EXAMPLE123" \
    bash "${HOOK}")"
[ -z "${OUT}" ] || fail "case1-disabled: expected NO output, got: ${OUT}"
echo "PASS: case 1 (disabled via env) — exit 0, silent"

# Also cover the other falsy spellings + bash 3.2-safe case-matching.
for val in false NO Off 0; do
    assert_exit "case1b-disabled-${val}" 0 env -i PATH="/usr/bin:/bin" \
        AOS_POST_MERGE_EVIDENCE="${val}" \
        POST_MERGE_PLAN_FILE="${PLAN_BOUND}" \
        ITT_NODE_ID="node_EXAMPLE123" \
        bash "${HOOK}" >/dev/null
done
echo "PASS: case 1b (disabled — all falsy spellings, case-insensitive)"

# ===========================================================================
# Case 2: no binding at all — no ITT_NODE_ID/INTENTTREE_TREE, and the plan
# file carries no itt_node_id:/intenttree_tree:/feature_slug: frontmatter.
# exit 0, ZERO calls (stripped PATH would fail loud if anything ran).
# ===========================================================================
OUT="$(assert_exit "case2-no-binding" 0 env -i PATH="/usr/bin:/bin" \
    POST_MERGE_PLAN_FILE="${PLAN_UNBOUND}" \
    bash "${HOOK}")"
[ -z "${OUT}" ] || fail "case2-no-binding: expected NO output, got: ${OUT}"
echo "PASS: case 2 (no binding) — exit 0, silent"

# ===========================================================================
# Case 3: plan file unset/missing, even though a node id IS bound — exit 0
# with a warning (the file itself is the required input the engine reads).
# ===========================================================================
OUT="$(assert_exit "case3-no-plan-file" 0 env -i PATH="/usr/bin:/bin" \
    ITT_NODE_ID="node_EXAMPLE123" \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "POST_MERGE_PLAN_FILE not set or not found" \
    || fail "case3-no-plan-file: expected a POST_MERGE_PLAN_FILE warning, got: ${OUT}"
echo "PASS: case 3 (plan file missing) — exit 0, warning"

# ===========================================================================
# Case 4: python3 missing from PATH — exit 0 with a warning. Binding present
# (bound plan file) so the hook proceeds past the binding guard.
# ===========================================================================
NO_PYTHON_BIN="${TMPDIR_ROOT}/no-python-bin"
mkdir -p "${NO_PYTHON_BIN}"
for tool in bash dirname tr grep cat mkdir env dd expr; do
    real="$(command -v "${tool}" 2>/dev/null || true)"
    [ -n "${real}" ] && ln -sf "${real}" "${NO_PYTHON_BIN}/${tool}"
done
OUT="$(assert_exit "case4-no-python3" 0 env -i PATH="${NO_PYTHON_BIN}" \
    POST_MERGE_PLAN_FILE="${PLAN_BOUND}" \
    ITT_NODE_ID="node_EXAMPLE123" \
    bash "${HOOK}")"
printf '%s\n' "${OUT}" | grep -q "no working python3 found" \
    || fail "case4-no-python3: expected a 'no working python3 found' warning, got: ${OUT}"
echo "PASS: case 4 (python3 missing) — exit 0, warning"

# ===========================================================================
# Case 5: engine reports an error (unresolvable node — no --node-id, no
# itt_node_id in the plan, no --tree given) — exit 0, warning logged, NOT
# propagated as a hook failure.
# ===========================================================================
PLAN_NO_NODE="${TMPDIR_ROOT}/no-node-plan.md"
cat > "${PLAN_NO_NODE}" <<'EOF'
---
feature_slug: example-feature-2
---
# Plan with a feature_slug binding but no resolvable node (no tree given)
EOF

REAL_PATH="/usr/bin:/bin"
command -v python3 >/dev/null 2>&1 && REAL_PATH="$(dirname "$(command -v python3)"):${REAL_PATH}"

OUT="$(assert_exit "case5-engine-error" 0 env -i PATH="${REAL_PATH}" HOME="${HOME}" \
    POST_MERGE_PLAN_FILE="${PLAN_NO_NODE}" \
    ITT_NODE_ID="" \
    INTENTTREE_TREE="" \
    bash "${HOOK}")"
# This case has no binding (feature_slug alone with no ITT_NODE_ID/INTENTTREE_TREE IS a
# binding per the contract's frontmatter check) — it DOES bind via feature_slug: frontmatter,
# so the engine runs and fails to resolve a node (no --tree). Expect the wrapper's
# non-fatal "engine reported issues" warning.
printf '%s\n' "${OUT}" | grep -q "engine reported issues" \
    || fail "case5-engine-error: expected 'engine reported issues' warning, got: ${OUT}"
echo "PASS: case 5 (engine reports an unresolvable-node error) — exit 0, warning"

echo
echo "SMOKE TEST PASSED: all post-merge-evidence.sh gate paths behave per contract."
exit 0
