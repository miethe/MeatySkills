#!/usr/bin/env bash
# =============================================================================
# phase-complete-capsule.sh — Dev-Execution Phase Completion Capsule Hook
# =============================================================================
#
# PURPOSE:
#   Non-blocking PostToolUse hook that emits an HTML Capsule (run-card template)
#   whenever a dev-execution phase transitions to `completed` status.
#
# TRIGGER REGISTRATION:
#   Wire this hook in .claude/skills/dev-execution/modes/phase-execution.md
#   at the step where phase status moves to `completed` (after update-batch.py
#   or update-status.py transitions the phase). Also register in
#   .claude/skills/dev-execution/modes/quick-execution.md at the analogous
#   phase-completion step.
#
#   Suggested snippet for phase-execution.md:
#     # After marking phase completed:
#     PROGRESS_FILE=".claude/progress/${PRD}/phase-${PHASE_NUM}-progress.md" \
#     PHASE_NUM="${PHASE_NUM}" \
#     PRD="${PRD}" \
#     .claude/skills/dev-execution/hooks/phase-complete-capsule.sh
#
# ENVIRONMENT / ARGUMENTS:
#   The hook reads the following variables (set by the calling workflow):
#     PROGRESS_FILE  — path to the phase progress YAML/Markdown hybrid
#                      (e.g. .claude/progress/html-capsules/phase-4-progress.md)
#     PHASE_NUM      — integer phase number (e.g. 4)
#     PRD            — PRD/feature slug (e.g. html-capsules)
#
#   Guard variable (controlled by the user/CI):
#     SKILLMEAT_CAPSULES_ENABLED  — must be exactly "1" to enable emission;
#                                    any other value (including unset) is a no-op
#
# ERROR HANDLING:
#   All errors are logged to .claude/capsules/errors.log.
#   This hook always exits 0 — failures never propagate to the calling workflow.
#   See docs/emission-triggers.md §6 for the non-blocking contract.
#
# SPEC REFERENCE:
#   .claude/skills/html-capsules/docs/emission-triggers.md §3.1 (phase-complete)
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Guard: master switch — exit 0 immediately if capsules are disabled
# ---------------------------------------------------------------------------
if [ "${SKILLMEAT_CAPSULES_ENABLED:-}" != "1" ]; then
    exit 0
fi

# ---------------------------------------------------------------------------
# Defaults for required variables
# ---------------------------------------------------------------------------
PROGRESS_FILE="${PROGRESS_FILE:-}"
PHASE_NUM="${PHASE_NUM:-0}"
PRD="${PRD:-unknown}"

ERRORS_LOG=".claude/capsules/errors.log"

# ---------------------------------------------------------------------------
# Helper: append an error message to the errors log, then exit 0
# ---------------------------------------------------------------------------
_log_error() {
    local msg="$1"
    local timestamp
    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%SZ")"
    mkdir -p "$(dirname "${ERRORS_LOG}")" 2>/dev/null || true
    printf '\n[%s] phase-complete-capsule.sh failed\n  PRD=%s  PHASE_NUM=%s\n  PROGRESS_FILE=%s\n  error: %s\n' \
        "${timestamp}" "${PRD}" "${PHASE_NUM}" "${PROGRESS_FILE}" "${msg}" \
        >> "${ERRORS_LOG}" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Wrap everything in a subshell so any unexpected exit cannot leak
# ---------------------------------------------------------------------------
(
    # Build a JSON event payload for CapsuleEmitter
    # Fields per emission-triggers.md §3.1:
    #   tool="dev-execution"  (this hook is part of dev-execution workflow)
    #   intent="phase-complete"
    #   task="${PRD}-phase-${PHASE_NUM}"
    #   template="run-card"
    #   progress_file — path to the phase YAML for source_of_truth

    TASK_SLUG="${PRD}-phase-${PHASE_NUM}"
    INTENT="phase-complete"
    TOOL="dev-execution"
    TEMPLATE="run-card"

    # Prefer calling the meaty-capsule CLI if it exists on PATH or at the
    # canonical skill location.  Fall back to a Python one-liner that imports
    # CapsuleEmitter directly.
    CAPSULE_CLI=".claude/skills/html-capsules/cli/__main__.py"

    if command -v meaty-capsule >/dev/null 2>&1; then
        # CLI path — subprocess invocation (preferred: loose coupling)
        meaty-capsule capture-run \
            --tool    "${TOOL}" \
            --intent  "${INTENT}" \
            --task    "${TASK_SLUG}" \
            --template "${TEMPLATE}" \
            --progress-file "${PROGRESS_FILE}"

    elif [ -f "${CAPSULE_CLI}" ]; then
        # Fallback: call the CLI module as a Python script
        python "${CAPSULE_CLI}" capture-run \
            --tool    "${TOOL}" \
            --intent  "${INTENT}" \
            --task    "${TASK_SLUG}" \
            --template "${TEMPLATE}" \
            --progress-file "${PROGRESS_FILE}"

    else
        # Last resort: inline Python one-liner that imports CapsuleEmitter
        # This keeps coupling unidirectional — we import html-capsules code,
        # but html-capsules never imports dev-execution code.
        python - <<PYEOF
import sys, pathlib, os

_skill_lib = pathlib.Path(".claude/skills/html-capsules/lib")
if str(_skill_lib) not in sys.path:
    sys.path.insert(0, str(_skill_lib))

try:
    from emitter import CapsuleEmitter

    emitter = CapsuleEmitter()
    result = emitter.emit(
        event={
            "tool": "${TOOL}",
            "intent": "${INTENT}",
            "task": "${TASK_SLUG}",
            "phase_number": ${PHASE_NUM},
            "progress_file": "${PROGRESS_FILE}",
        },
        template="${TEMPLATE}",
    )
    if result:
        print("capsule emitted: " + str(result))
    else:
        print("capsule emission skipped or failed (see errors.log)")
except Exception as exc:
    print("capsule hook error: " + str(exc), file=sys.stderr)
    sys.exit(1)
PYEOF
    fi

) || {
    _log_error "subshell exited non-zero (see stderr above for details)"
}

# Always exit 0 — hook must never block the calling workflow
exit 0
