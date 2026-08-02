#!/usr/bin/env bash
# =============================================================================
# bundle-drift-check.sh — Dev-Execution Deployed-Artifact Drift Detector
# =============================================================================
#
# PURPOSE:
#   Non-blocking WARN-only check that compares every deployed skill under a
#   project's .claude/skills/ against the canonical upstream location recorded
#   in docs/ARTIFACT-UPSTREAM-REGISTRY.md, and separately reports whether each
#   artifact resolves globally (~/.claude/skills/<name>) as an always-current
#   SYMLINK or a real directory that can silently go stale.
#
#   Real incident this guards against: in the knitwit repo, one session
#   resolved `dev-execution` to the always-current global symlink while
#   `artifact-tracking` resolved to a stale project-local copy — split-brain
#   artifact resolution inside a single session, invisible unless a human
#   reads the "Base directory for this skill" line each skill prints on load.
#   This hook surfaces that split-brain hazard mechanically, up front.
#
#   Deliberately mirrors the non-fatal posture of provision-artifacts.sh: a
#   master-switch env var (default ON), a binding guard (silent no-op when
#   there's nothing to check), and an always-exit-0 contract. Unlike
#   provision-artifacts.sh, drift here is NEVER a correctness gate — it is
#   pure warn-and-continue, because staleness is a maintenance signal, not a
#   thing that should halt a run.
#
# TRIGGER REGISTRATION:
#   Best invoked as an early pre-flight step of /dev:execute-{plan,contract,phase}
#   (informational, alongside provision-artifacts.sh), or ad hoc:
#     DRIFT_PROJECT="." DRIFT_REGISTRY="docs/ARTIFACT-UPSTREAM-REGISTRY.md" \
#       .claude/skills/dev-execution/hooks/bundle-drift-check.sh
#
# ENVIRONMENT:
#   AOS_BUNDLE_DRIFT_CHECK — ON BY DEFAULT. Only an explicit falsy value
#                            (0/false/no/off) disables. Mirrors
#                            AOS_ARTIFACT_PROVISION / INTENTTREE_SDLC_SYNC.
#   DRIFT_PROJECT          — project root to scan for deployed skills.
#                            Default: "." (cwd).
#   DRIFT_REGISTRY          — path to ARTIFACT-UPSTREAM-REGISTRY.md. Required
#                            for any resolution; without it every artifact
#                            reports UNMAPPED (still non-fatal).
#   DRIFT_SCOPE             — free-form label echoed into log lines, e.g.
#                            "plan:<slug>". Optional.
#   DRIFT_ARTIFACTS         — optional comma-separated subset of artifact
#                            names to check. Default: every directory found
#                            under "$DRIFT_PROJECT/.claude/skills/".
#
# RESOLUTION HEURISTIC (best-effort, warn-only — see docs/ARTIFACT-UPSTREAM-
#   REGISTRY.md §2 for the table this reads):
#   * Find the first registry table row whose Artifact column contains the
#     backtick-quoted artifact name, and pull the backtick-quoted path token
#     from that row's Upstream/Lives-at column at the SAME comma-position as
#     the name (so multi-artifact rows like `codex`, `codex-executor` still
#     resolve each name to its own path).
#   * A bare `.claude/...`, `src/...`, `docs/...`, `templates/...`, or
#     `infra/...` path resolves inside the registry's own repo (the
#     "launchpad", i.e. this repo).
#   * A `<reponame>/...` path resolves as a sibling checkout next to the
#     launchpad (`<launchpad>/../<reponame>/...`) when that directory exists.
#   * Anything else (no row found, no backtick path, unresolvable prefix) is
#     UNMAPPED — reported and skipped, never fatal.
#
# EXIT CONTRACT:
#   * ALWAYS exits 0. This hook must never block execution — drift is a
#     warning, not a gate. Findings go to stdout as clearly-marked WARN
#     lines plus a summary table and a one-line verdict.
#   * No .claude/skills/ directory under DRIFT_PROJECT (and no
#     DRIFT_ARTIFACTS override) → silent no-op, exit 0.
#
# PORTABILITY:
#   Written for macOS bash 3.2 — no associative arrays, no mapfile/readarray,
#   no setsid. Positional splitting uses only sed/grep/cut/wc, matching the
#   constructs already used by provision-artifacts.sh / sdlc-sync.sh.
# =============================================================================

set -uo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — ON BY DEFAULT; only an explicit falsy value disables.
# ---------------------------------------------------------------------------
case "$(printf '%s' "${AOS_BUNDLE_DRIFT_CHECK:-auto}" | tr '[:upper:]' '[:lower:]')" in
    0 | false | no | off)
        exit 0
        ;;
esac

DRIFT_PROJECT="${DRIFT_PROJECT:-.}"
DRIFT_REGISTRY="${DRIFT_REGISTRY:-}"
DRIFT_SCOPE="${DRIFT_SCOPE:-}"
DRIFT_ARTIFACTS="${DRIFT_ARTIFACTS:-}"

SKILLS_DIR="${DRIFT_PROJECT}/.claude/skills"
LOG_PREFIX="[bundle-drift-check]"
[ -n "${DRIFT_SCOPE}" ] && LOG_PREFIX="[bundle-drift-check:${DRIFT_SCOPE}]"

# ---------------------------------------------------------------------------
# Guard: binding must exist. No deployed skills dir AND no explicit artifact
# list → nothing to check → silent no-op (keeps default-on quiet in repos
# with no local .claude/skills/ at all).
# ---------------------------------------------------------------------------
if [ ! -d "${SKILLS_DIR}" ] && [ -z "${DRIFT_ARTIFACTS}" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the list of artifacts to check.
# ---------------------------------------------------------------------------
NAMES_FILE="$(mktemp -t bundle-drift-names 2>/dev/null || mktemp)"
trap 'rm -f "${NAMES_FILE}"' EXIT

if [ -n "${DRIFT_ARTIFACTS}" ]; then
    # NOTE: trailing \n is required — without it, the final entry (or the
    # only entry, for a single-item list) has no terminating newline, and
    # the `while read` loop below silently drops it: `read` returns failure
    # at EOF-without-newline, so the while CONDITION fails before the body
    # (which already has the value) ever runs.
    printf '%s\n' "${DRIFT_ARTIFACTS}" | tr ',' '\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' > "${NAMES_FILE}"
elif [ -d "${SKILLS_DIR}" ]; then
    for d in "${SKILLS_DIR}"/*/; do
        [ -d "${d}" ] || continue
        basename "${d%/}" >> "${NAMES_FILE}"
    done
fi

if [ ! -s "${NAMES_FILE}" ]; then
    echo "${LOG_PREFIX} no artifacts to check — no-op" >&2
    exit 0
fi

if [ -z "${DRIFT_REGISTRY}" ] || [ ! -f "${DRIFT_REGISTRY}" ]; then
    echo "${LOG_PREFIX} registry not found (DRIFT_REGISTRY=${DRIFT_REGISTRY:-<unset>}) — every artifact will report UNMAPPED (non-fatal)" >&2
fi

# ---------------------------------------------------------------------------
# Resolve LAUNCHPAD_ROOT / SIBLINGS_ROOT for path resolution, only if we have
# a registry to anchor against.
# ---------------------------------------------------------------------------
LAUNCHPAD_ROOT=""
SIBLINGS_ROOT=""
if [ -n "${DRIFT_REGISTRY}" ] && [ -f "${DRIFT_REGISTRY}" ]; then
    REGISTRY_DIR="$(cd "$(dirname "${DRIFT_REGISTRY}")" 2>/dev/null && pwd)"
    if [ -n "${REGISTRY_DIR}" ]; then
        LAUNCHPAD_ROOT="$(cd "${REGISTRY_DIR}/.." 2>/dev/null && pwd)"
        [ -n "${LAUNCHPAD_ROOT}" ] && SIBLINGS_ROOT="$(cd "${LAUNCHPAD_ROOT}/.." 2>/dev/null && pwd)"
    fi
fi

# DRIFT_SIBLINGS_ROOT pins the directory that holds sibling checkouts, skipping the
# per-path search in find_siblings_root() below.
[ -n "${DRIFT_SIBLINGS_ROOT:-}" ] && SIBLINGS_ROOT="${DRIFT_SIBLINGS_ROOT}"

# ---------------------------------------------------------------------------
# Helper: locate the directory holding a named sibling checkout.
#
# A sibling-repo path in the registry (e.g. `MeatySkills/…/skills/x/`) resolves
# against the directory that CONTAINS the launchpad checkout. That is normally
# LAUNCHPAD_ROOT's parent — but when this hook runs from a git worktree
# (`<repo>/.claude/worktrees/<name>`) the parent is `.claude/worktrees`, where no
# sibling repo lives, and every sibling-owned artifact silently reports UNMAPPED.
#
# Rather than guess which ancestor is "the development root" (a worktree's .git is
# a FILE, so repo-shaped heuristics misfire on exactly this layout), search upward
# for the first ancestor that actually contains the requested sibling by name.
# Prints the containing directory, or nothing. Capped at 8 hops.
# ---------------------------------------------------------------------------
find_siblings_root() {
    _want="$1"
    [ -z "${_want}" ] && return 0
    if [ -n "${SIBLINGS_ROOT}" ] && [ -d "${SIBLINGS_ROOT}/${_want}" ]; then
        printf '%s' "${SIBLINGS_ROOT}"
        return 0
    fi
    _probe="${SIBLINGS_ROOT:-${LAUNCHPAD_ROOT}}"
    _hops=0
    while [ -n "${_probe}" ] && [ "${_probe}" != "/" ] && [ "${_hops}" -lt 8 ]; do
        if [ -d "${_probe}/${_want}" ]; then
            printf '%s' "${_probe}"
            return 0
        fi
        _probe="$(cd "${_probe}/.." 2>/dev/null && pwd)"
        _hops=$((_hops + 1))
    done
    return 0
}

# ---------------------------------------------------------------------------
# Helper: extract backtick-quoted tokens from a string, one per line.
# ---------------------------------------------------------------------------
backtick_tokens() {
    printf '%s\n' "$1" | grep -oE '`[^`]+`' | sed -e 's/`//g'
}

# ---------------------------------------------------------------------------
# Helper: resolve an artifact name to its upstream directory (best-effort).
# Prints the resolved absolute path on stdout, or nothing if unresolvable.
# ---------------------------------------------------------------------------
resolve_upstream() {
    _name="$1"
    [ -z "${DRIFT_REGISTRY}" ] && return 0
    [ ! -f "${DRIFT_REGISTRY}" ] && return 0

    # Match ONLY against the Artifact column (col 2), not the whole row —
    # a plain substring/whole-line grep would also hit prose in the Notes
    # column that happens to mention the name in backticks (e.g. the
    # dev-execution row's Notes mentions `planning`; the delivery-report
    # row's Notes mentions `plan-status`), resolving the wrong upstream.
    _row=""
    while IFS= read -r _line; do
        _candidate_names_col="$(printf '%s' "${_line}" | awk -F'|' '{print $2}')"
        if backtick_tokens "${_candidate_names_col}" | grep -qFx "${_name}"; then
            _row="${_line}"
            break
        fi
    done < <(grep '^|' "${DRIFT_REGISTRY}" 2>/dev/null)
    [ -z "${_row}" ] && return 0

    _names_col="$(printf '%s' "${_row}" | awk -F'|' '{print $2}')"
    _path_col="$(printf '%s' "${_row}" | awk -F'|' '{print $3}')"

    _idx="$(backtick_tokens "${_names_col}" | grep -nFx "${_name}" | head -1 | cut -d: -f1)"
    _path=""
    if [ -n "${_idx}" ]; then
        _path="$(backtick_tokens "${_path_col}" | sed -n "${_idx}p")"
    fi
    if [ -z "${_path}" ]; then
        _path="$(backtick_tokens "${_path_col}" | head -1)"
    fi
    [ -z "${_path}" ] && return 0

    case "${_path}" in
        .claude/* | src/* | docs/* | templates/* | infra/*)
            if [ -n "${LAUNCHPAD_ROOT}" ]; then
                printf '%s/%s' "${LAUNCHPAD_ROOT}" "${_path}"
            fi
            ;;
        */*)
            _first_seg="${_path%%/*}"
            _root="$(find_siblings_root "${_first_seg}")"
            if [ -n "${_root}" ]; then
                printf '%s/%s' "${_root}" "${_path}"
            fi
            ;;
        *)
            : # single-segment, non-prefixed token — not a resolvable path
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
TOTAL=0
DRIFTED=0
UNMAPPED=0
MISSING=0
INSYNC=0

SUMMARY_FILE="$(mktemp -t bundle-drift-summary 2>/dev/null || mktemp)"
trap 'rm -f "${NAMES_FILE}" "${SUMMARY_FILE}"' EXIT

printf '%-28s %-16s %-8s %-30s\n' "ARTIFACT" "STATUS" "#DIFF" "GLOBAL-RESOLUTION" > "${SUMMARY_FILE}"
printf '%-28s %-16s %-8s %-30s\n' "--------" "------" "-----" "-----------------" >> "${SUMMARY_FILE}"

while IFS= read -r NAME; do
    [ -z "${NAME}" ] && continue

    LOCAL_DIR="${SKILLS_DIR}/${NAME}"
    if [ ! -d "${LOCAL_DIR}" ]; then
        echo "${LOG_PREFIX} WARN: ${NAME} — not deployed under ${SKILLS_DIR} (skipping)" >&2
        continue
    fi

    TOTAL=$((TOTAL + 1))

    # --- global-resolution: symlink (always-current) vs real copy (can drift)
    GLOBAL_PATH="${HOME}/.claude/skills/${NAME}"
    if [ -L "${GLOBAL_PATH}" ]; then
        GLOBAL_RES="SYMLINK (always-current)"
    elif [ -d "${GLOBAL_PATH}" ]; then
        GLOBAL_RES="COPY (can drift)"
    else
        GLOBAL_RES="ABSENT"
    fi

    UPSTREAM_DIR="$(resolve_upstream "${NAME}")"

    if [ -z "${UPSTREAM_DIR}" ]; then
        STATUS="UNMAPPED"
        DIFFCOUNT="-"
        UNMAPPED=$((UNMAPPED + 1))
        echo "${LOG_PREFIX} WARN: ${NAME} — could not resolve an upstream from the registry" >&2
    elif [ ! -d "${UPSTREAM_DIR}" ]; then
        STATUS="MISSING-UPSTREAM"
        DIFFCOUNT="-"
        MISSING=$((MISSING + 1))
        echo "${LOG_PREFIX} WARN: ${NAME} — resolved upstream does not exist: ${UPSTREAM_DIR}" >&2
    else
        # Build artifacts are not drift. Without these exclusions a single stale
        # __pycache__ reports as "10 differing files" and buries the one real
        # source-file difference the hook exists to surface.
        DIFF_OUT="$(diff -rq \
            -x '__pycache__' -x '*.pyc' -x '*.pyo' \
            -x '.DS_Store' -x 'node_modules' -x '.pytest_cache' \
            "${LOCAL_DIR}" "${UPSTREAM_DIR}" 2>/dev/null)"
        if [ -z "${DIFF_OUT}" ]; then
            STATUS="IN-SYNC"
            DIFFCOUNT="0"
            INSYNC=$((INSYNC + 1))
        else
            STATUS="DRIFTED"
            DIFFCOUNT="$(printf '%s\n' "${DIFF_OUT}" | grep -c .)"
            DRIFTED=$((DRIFTED + 1))
            EXAMPLES="$(printf '%s\n' "${DIFF_OUT}" | head -5)"
            echo "${LOG_PREFIX} WARN: ${NAME} — DRIFTED (${DIFFCOUNT} differing file(s)) vs ${UPSTREAM_DIR}" >&2
            printf '%s\n' "${EXAMPLES}" | while IFS= read -r line; do
                [ -n "${line}" ] && echo "${LOG_PREFIX}     ${line}" >&2
            done
        fi
    fi

    printf '%-28s %-16s %-8s %-30s\n' "${NAME}" "${STATUS}" "${DIFFCOUNT}" "${GLOBAL_RES}" >> "${SUMMARY_FILE}"
done < "${NAMES_FILE}"

echo ""
echo "${LOG_PREFIX} summary:"
cat "${SUMMARY_FILE}"
echo ""
echo "bundle-drift-check: ${TOTAL} checked · ${DRIFTED} drifted · ${UNMAPPED} unmapped · ${MISSING} missing-upstream · ${INSYNC} in-sync (warn-only, non-blocking)"

exit 0
