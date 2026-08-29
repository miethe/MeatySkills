#!/usr/bin/env bash
# =============================================================================
# verify-skillmeat-writeback.sh — SkillMeat save-after Definition-of-Done gate
# (aos-native-by-default P3-003; sibling gate to verify-writeback.sh's IntentTree
#  writeback DoD — audit P3.9)
# =============================================================================
#
# PURPOSE:
#   A phase that builds a new AI artifact (skill/agent/command/context) is NOT
#   "done" until that artifact is checked-for-reuse and registered/updated in
#   the SkillMeat enterprise instance (D6/D2: look-first is instruct-only —
#   see dev-execution/SKILL.md's executor contract — but save-after is a real
#   gate). This script is that gate; it mirrors verify-writeback.sh's exact
#   PASS/FAIL/WARN contract and shape so the reviewer runs both the same way.
#
# CONTRACT (mirrors verify-writeback.sh — never blocks on infra unavailability):
#   - PASS "N/A"   (exit 0): no new AI-artifact path appears in the phase's
#                  file list — the SkillMeat DoD does not apply to this phase.
#   - PASS-WARN    (exit 0): a new artifact path IS present, but the check
#                  cannot be verified — `skillmeat` CLI missing, SKILLMEAT_PROJECT
#                  unset (cannot resolve the project mapping), or the enterprise
#                  endpoint is unreachable/times out. Unverified, non-blocking;
#                  the reviewer records writeback as UNVERIFIED.
#   - FAIL         (exit 1): a new artifact path IS present, SKILLMEAT_PROJECT
#                  is set, the endpoint IS reachable, and `skillmeat show`
#                  reports the artifact does not exist. The reviewer MUST
#                  withhold APPROVED on a FAIL.
#   - PASS "FOUND" (exit 0): every new-artifact candidate resolves via
#                  `skillmeat show` — checked-for-reuse + saved.
#
# HEURISTIC (simplified from strict git-newness, documented deviation — see
#   the P3 execution report / OQ-5 triage note): any path in the phase's file
#   list that matches `.claude/{agents,skills,commands}/**` or `.agents/**` is
#   treated as an "artifact candidate" needing verification. This repo's
#   dev-execution flow only lists files a phase actually touched, so treating
#   every matching path as a candidate (rather than attempting a fragile
#   git-history "is it truly new" diff) is the safer, more portable heuristic:
#   a false positive costs one extra `skillmeat show` lookup; a false negative
#   would silently skip the DoD gate.
#
# USAGE:
#   PHASE_FILES=$'.claude/skills/foo/SKILL.md\nREADME.md' \
#   SKILLMEAT_PROJECT=agentic_meta_dev \
#       .claude/skills/dev-execution/hooks/verify-skillmeat-writeback.sh
#
#   .claude/skills/dev-execution/hooks/verify-skillmeat-writeback.sh \
#       --files-from .claude/progress/<feature>/phase-N-progress.md
#
#   (--files-from reads a `files_affected:` YAML list out of a progress/plan
#    file's frontmatter; PHASE_FILES takes precedence if both are given.)
# =============================================================================

set -uo pipefail

ARTIFACT_GLOB_RE='^(\.claude/(agents|skills|commands)/|\.agents/)'

FILES_FROM=""
while [ $# -gt 0 ]; do
    case "$1" in
        --files-from)
            FILES_FROM="${2:-}"
            shift 2
            ;;
        --files-from=*)
            FILES_FROM="${1#--files-from=}"
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Resolve the phase's file list: PHASE_FILES env var wins; else --files-from
# extracts a `files_affected:` YAML list from a progress/plan file.
# ---------------------------------------------------------------------------
RAW_FILES="${PHASE_FILES:-}"

if [ -z "${RAW_FILES}" ] && [ -n "${FILES_FROM}" ]; then
    if [ -f "${FILES_FROM}" ]; then
        # Indentation-aware YAML-list extractor (POSIX awk — no gawk extensions):
        # collects every `files_affected:` block's `- item` entries, whether the
        # key sits at the frontmatter top level (plan files) or nested under a
        # per-task list item (progress files' tasks[].files_affected).
        RAW_FILES="$(awk '
            function indent_of(s) {
                n = match(s, /[^ ]/)
                if (n == 0) return length(s)
                return n - 1
            }
            {
                line = $0
                if (infield) {
                    if (line ~ /^[[:space:]]*$/) { next }
                    cur = indent_of(line)
                    if (cur > key_indent && line ~ /^[[:space:]]*-[[:space:]]*/) {
                        item = line
                        sub(/^[[:space:]]*-[[:space:]]*/, "", item)
                        gsub(/^["'"'"']/, "", item)
                        gsub(/["'"'"']$/, "", item)
                        print item
                        next
                    } else {
                        infield = 0
                    }
                }
                if (line ~ /files_affected:[[:space:]]*$/) {
                    key_indent = indent_of(line)
                    infield = 1
                }
            }
        ' "${FILES_FROM}")"
    else
        echo "[skillmeat-dod] WARN: --files-from path not found: ${FILES_FROM} — treating as no files" >&2
    fi
fi

# ---------------------------------------------------------------------------
# Find artifact candidates among the phase's files.
# ---------------------------------------------------------------------------
CANDIDATES=()
if [ -n "${RAW_FILES}" ]; then
    while IFS= read -r f; do
        [ -z "${f}" ] && continue
        if printf '%s' "${f}" | grep -Eq "${ARTIFACT_GLOB_RE}"; then
            CANDIDATES+=("${f}")
        fi
    done <<< "${RAW_FILES}"
fi

if [ "${#CANDIDATES[@]}" -eq 0 ]; then
    echo "[skillmeat-dod] no new AI-artifact path in the phase's files — N/A, PASS"
    exit 0
fi

echo "[skillmeat-dod] artifact candidate(s) detected: ${CANDIDATES[*]}"

# ---------------------------------------------------------------------------
# Cannot verify without the CLI.
# ---------------------------------------------------------------------------
if ! command -v skillmeat >/dev/null 2>&1; then
    echo "[skillmeat-dod] WARN: skillmeat CLI not found — SkillMeat writeback UNVERIFIED (not blocking); reviewer must confirm manually" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Cannot verify without a resolved project mapping (defer-and-report, not FAIL).
# ---------------------------------------------------------------------------
if [ -z "${SKILLMEAT_PROJECT:-}" ]; then
    echo "[skillmeat-dod] WARN: SKILLMEAT_PROJECT unset — cannot resolve the project mapping; SkillMeat writeback UNVERIFIED (not blocking); reviewer must confirm manually" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Derive an artifact name from a candidate path (best-effort).
#   .claude/skills/<name>/SKILL.md   -> <name>  (type: skill)
#   .claude/agents/<...>/<name>.md   -> <name>  (type: agent)
#   .claude/commands/<...>/<name>.md -> <name>  (type: command)
#   .agents/skills/<name>/SKILL.md   -> <name>  (type: skill)
# ---------------------------------------------------------------------------
artifact_name_for() {
    local path="$1"
    local base
    base="$(basename "${path}")"
    if [ "${base}" = "SKILL.md" ]; then
        basename "$(dirname "${path}")"
    else
        echo "${base%.md}"
    fi
}

RUN() {
    if command -v timeout >/dev/null 2>&1; then
        timeout 15s "$@"
    else
        "$@"
    fi
}

UNREACHABLE_RE='(connection|timeout|timed out|refused|unreachable|network|could not connect|failed to (connect|resolve)|getaddrinfo|ECONNREFUSED|ETIMEDOUT)'
# Match ARTIFACT-absence specifically ("Artifact '<name>' not found"), NOT a generic
# "not found" — otherwise an unrelated error (e.g. a stray collection/path message)
# would be misclassified as a FAIL. Real `skillmeat show <missing>` prints
# "Artifact '<name>' not found".
NOT_FOUND_RE='(artifact[^a-z]*.*not found|no such artifact|does not exist)'

ANY_NOT_FOUND=0
ANY_UNREACHABLE=0
ANY_FOUND=0

for candidate in "${CANDIDATES[@]}"; do
    name="$(artifact_name_for "${candidate}")"
    if [ -z "${name}" ]; then
        continue
    fi

    # `skillmeat show <name>` resolves against the auth-configured instance (the node
    # enterprise per `skillmeat auth`). Do NOT pass `--collection "${SKILLMEAT_PROJECT}"`:
    # `--collection` is a LOCAL named-collection concept, not the enterprise project
    # association — passing a project slug there yields "Collection … not found" and
    # false-FAILs every real check. Existence is name-level (the CLI's `show` has no
    # project filter); SKILLMEAT_PROJECT stays advisory (its unset case WARNs above).
    OUTPUT="$(RUN skillmeat show "${name}" 2>&1)"
    RC=$?

    if [ "${RC}" -eq 0 ]; then
        echo "[skillmeat-dod]   FOUND: '${name}' (from ${candidate})"
        ANY_FOUND=1
        continue
    fi

    LOWER_OUTPUT="$(printf '%s' "${OUTPUT}" | tr '[:upper:]' '[:lower:]')"

    if [ "${RC}" -eq 124 ] || printf '%s' "${LOWER_OUTPUT}" | grep -Eq "${UNREACHABLE_RE}"; then
        echo "[skillmeat-dod]   UNREACHABLE checking '${name}': ${OUTPUT}" >&2
        ANY_UNREACHABLE=1
        continue
    fi

    if printf '%s' "${LOWER_OUTPUT}" | grep -Eq "${NOT_FOUND_RE}"; then
        echo "[skillmeat-dod]   NOT FOUND: '${name}' (from ${candidate}) — ${OUTPUT}" >&2
        ANY_NOT_FOUND=1
        continue
    fi

    # Unrecognized non-zero exit — ambiguous CLI/enterprise state. Prefer the
    # non-blocking WARN outcome over a false FAIL (never crash / never block
    # on infra ambiguity is the standing contract for this gate).
    echo "[skillmeat-dod]   WARN: unrecognized response checking '${name}': ${OUTPUT}" >&2
    ANY_UNREACHABLE=1
done

if [ "${ANY_UNREACHABLE}" -eq 1 ] && [ "${ANY_NOT_FOUND}" -eq 0 ]; then
    echo "[skillmeat-dod] WARN: enterprise endpoint unreachable/ambiguous for one or more candidates — SkillMeat writeback UNVERIFIED (not blocking)" >&2
    exit 0
fi

if [ "${ANY_NOT_FOUND}" -eq 1 ]; then
    echo "[skillmeat-dod] FAIL: one or more new AI artifacts are not registered in SkillMeat enterprise" >&2
    echo "  (name-level check via 'skillmeat show'; intended project '${SKILLMEAT_PROJECT}'). Run" >&2
    echo "  'skillmeat show <name>' / 'skillmeat add' to register the artifact before APPROVED." >&2
    exit 1
fi

echo "[skillmeat-dod] PASS: all ${#CANDIDATES[@]} new AI-artifact candidate(s) resolved in SkillMeat enterprise."
exit 0
