#!/usr/bin/env bash
# codex-run.sh — the codex write-lane dispatch path: PREFLIGHT, LOG, then run.
#
# CODEX-WRITE-PREFLIGHT marker (the codex skill's mandatory pre-flight; SKILL.md greps this name).
#
# WHY THIS EXISTS
#   2026-08-18, node_01M0BCYZXQ2MNVRWAJZCHV9Y6X: `codex exec resume --last` silently DROPPED
#   `--sandbox workspace-write`, contrary to the skill doc's inheritance claim. The resumed turn
#   self-reported "the continuation environment is read-only", burned 5.66M input tokens and wrote
#   ZERO files at exit 0 — indistinguishable from a derail until the diff was checked. A fresh
#   dispatch with an explicit `--sandbox` against the same on-disk state completed cleanly.
#   The 2026-08-16 Idea-A derail has the identical shape and its cause can NEVER be confirmed,
#   because the invocation was never written to disk. Both halves are closed here: refuse the
#   unsafe shape, and log every invocation (argv AND the piped prompt) before running it.
#
# USAGE
#   codex-run.sh [--task-class write|read] [--check-only] -- codex exec [args...]
#
#   --task-class write   this dispatch is expected to EDIT files. A write task in a read-only or
#                        absent sandbox is REFUSED (exit 2).
#   --check-only         run the preflight + log, print the verdict, do NOT run codex.
#   AOS_CODEX_TASK_CLASS supplies --task-class when the flag is absent.
#   AOS_CODEX_CALLER     free-text provenance recorded in the log line.
#
# EXIT CODES
#   0    preflight passed with --check-only; otherwise codex's own exit code is propagated
#   2    PREFLIGHT REFUSAL — the invocation was not run. Fix the flags, do not retry verbatim.
#   64   usage error (deliberately NOT 2, so a misparsed flag never reads as a breach)
#
# LOGGING
#   One JSON line per invocation to $CODEX_INVOCATION_LOG, default
#   ${CODEX_SESSION_LOG_DIR:-~/.codex/exec-logs}/invocations.jsonl (0600). A piped prompt is
#   tee'd to a sibling <ts>-<pid>.prompt file so the prompt text survives the run. Logging is
#   best-effort: an unwritable log directory WARNS and continues (a broken log must not block a
#   dispatch), but it never suppresses a refusal.

set -uo pipefail

TASK_CLASS="${AOS_CODEX_TASK_CLASS:-}"
CHECK_ONLY=0

while [ $# -gt 0 ]; do
    case "$1" in
        --task-class)
            if [ $# -lt 2 ]; then echo "codex-run: --task-class needs a value" >&2; exit 64; fi
            TASK_CLASS="$2"; shift 2 ;;
        --task-class=*) TASK_CLASS="${1#*=}"; shift ;;
        --check-only) CHECK_ONLY=1; shift ;;
        --) shift; break ;;
        -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
        *) echo "codex-run: unknown option '$1' (codex args go after --)" >&2; exit 64 ;;
    esac
done

if [ $# -eq 0 ]; then
    echo "codex-run: no command after -- (usage: codex-run.sh [--task-class write] -- codex exec ...)" >&2
    exit 64
fi

case "${TASK_CLASS:-}" in
    write|read) ;;
    "") TASK_CLASS="undeclared" ;;
    *) echo "codex-run: --task-class must be 'write' or 'read' (got '$TASK_CLASS')" >&2; exit 64 ;;
esac

# ---- parse the intended invocation -----------------------------------------------------------
CMD=("$@")
SANDBOX=""
SANDBOX_EXPLICIT=0
IS_RESUME=0
BYPASS=0
MODEL=""
EFFORT=""
REPO_C=""
i=0
n=${#CMD[@]}
while [ "$i" -lt "$n" ]; do
    a="${CMD[$i]}"
    case "$a" in
        --sandbox)
            SANDBOX="${CMD[$((i+1))]:-}"; SANDBOX_EXPLICIT=1; i=$((i+2)); continue ;;
        --sandbox=*)
            SANDBOX="${a#*=}"; SANDBOX_EXPLICIT=1; i=$((i+1)); continue ;;
        resume) IS_RESUME=1 ;;
        --dangerously-bypass-approvals-and-sandbox) BYPASS=1 ;;
        -m|--model)
            MODEL="${CMD[$((i+1))]:-}"; i=$((i+2)); continue ;;
        --model=*) MODEL="${a#*=}" ;;
        -C|--cd)
            REPO_C="${CMD[$((i+1))]:-}"; i=$((i+2)); continue ;;
        --config)
            case "${CMD[$((i+1))]:-}" in
                model_reasoning_effort=*) EFFORT="${CMD[$((i+1))]#model_reasoning_effort=}" ;;
            esac
            i=$((i+2)); continue ;;
        --config=*)
            case "${a#*=}" in
                model_reasoning_effort=*) EFFORT="${a#*=model_reasoning_effort=}" ;;
            esac ;;
    esac
    i=$((i+1))
done
# strip any quoting codex tolerates on the effort value
EFFORT="${EFFORT%\"}"
EFFORT="${EFFORT#\"}"

WRITE_CAPABLE=0
case "$SANDBOX" in
    workspace-write|danger-full-access) WRITE_CAPABLE=1 ;;
esac
if [ "$BYPASS" -eq 1 ]; then WRITE_CAPABLE=1; fi

# ---- the two refusals ------------------------------------------------------------------------
VERDICT="allow"
REASON=""

# R1 (the measured defect): resume does NOT inherit the sandbox. Never let it be implicit.
# Checked FIRST on purpose: a `--task-class write` resume with no --sandbox also trips R2, but
# R2's message would blame a missing flag when the operator's actual mistake was trusting
# inheritance. The refusal that names the real cause is the one worth printing.
if [ "$IS_RESUME" -eq 1 ] && [ "$SANDBOX_EXPLICIT" -eq 0 ] && [ "$BYPASS" -eq 0 ]; then
    VERDICT="refuse"
    REASON="'resume' with no explicit --sandbox: inheritance from the original session is FALSIFIED (node_01M0BCYZXQ2MNVRWAJZCHV9Y6X — a resumed turn ran read-only, burned 5.66M tokens, wrote nothing). Re-pass --sandbox explicitly on every resume."
fi

# R2: a declared write task must actually be able to write.
if [ "$VERDICT" = "allow" ] && [ "$TASK_CLASS" = "write" ] && [ "$WRITE_CAPABLE" -eq 0 ]; then
    VERDICT="refuse"
    if [ "$SANDBOX_EXPLICIT" -eq 0 ]; then
        REASON="write task with NO explicit --sandbox: codex would fall back to a sandbox this invocation does not control. Pass --sandbox workspace-write."
    else
        REASON="write task in --sandbox '$SANDBOX': a read-only sandbox produces exit 0 with zero edits, which is indistinguishable from a derail. Pass --sandbox workspace-write."
    fi
fi

# ---- log the invocation ----------------------------------------------------------------------
LOGDIR="${CODEX_SESSION_LOG_DIR:-$HOME/.codex/exec-logs}"
INVLOG="${CODEX_INVOCATION_LOG:-$LOGDIR/invocations.jsonl}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PROMPT_FILE=""
LOG_OK=0
if mkdir -p "$(dirname "$INVLOG")" 2>/dev/null; then
    PROMPT_FILE="$(dirname "$INVLOG")/$(date -u +%Y%m%dT%H%M%SZ)-$$.prompt"
    LOG_OK=1
else
    echo "[CODEX-WRITE-PREFLIGHT] cannot create $(dirname "$INVLOG") — invocation NOT logged (non-fatal)" >&2
fi

if [ "$LOG_OK" -eq 1 ]; then
    if TS="$TS" VERDICT="$VERDICT" REASON="$REASON" TASK_CLASS="$TASK_CLASS" \
       SANDBOX="$SANDBOX" SANDBOX_EXPLICIT="$SANDBOX_EXPLICIT" IS_RESUME="$IS_RESUME" \
       BYPASS="$BYPASS" MODEL="$MODEL" EFFORT="$EFFORT" REPO_C="$REPO_C" \
       CALLER="${AOS_CODEX_CALLER:-}" PROMPT_FILE="$PROMPT_FILE" CHECK_ONLY="$CHECK_ONLY" \
       python3 -c '
import json, os, sys
rec = {
    "ts": os.environ["TS"],
    "verdict": os.environ["VERDICT"],
    "refusal_reason": os.environ["REASON"] or None,
    "task_class": os.environ["TASK_CLASS"],
    "sandbox": os.environ["SANDBOX"] or None,
    "sandbox_explicit": os.environ["SANDBOX_EXPLICIT"] == "1",
    "resume": os.environ["IS_RESUME"] == "1",
    "bypass_flag": os.environ["BYPASS"] == "1",
    "model": os.environ["MODEL"] or None,
    "reasoning_effort": os.environ["EFFORT"] or None,
    "repo": os.environ["REPO_C"] or None,
    "cwd": os.getcwd(),
    "caller": os.environ["CALLER"] or None,
    "check_only": os.environ["CHECK_ONLY"] == "1",
    "prompt_file": os.environ["PROMPT_FILE"] or None,
    "argv": sys.argv[1:],
}
sys.stdout.write(json.dumps(rec, ensure_ascii=False) + "\n")
' "$@" >> "$INVLOG" 2>/dev/null
    then
        chmod 600 "$INVLOG" 2>/dev/null || true
    else
        # python3 absent or JSON build failed: degrade to a flat line rather than losing the record.
        printf '%s verdict=%s task_class=%s sandbox=%s explicit=%s resume=%s argv=%s\n' \
            "$TS" "$VERDICT" "$TASK_CLASS" "${SANDBOX:-none}" "$SANDBOX_EXPLICIT" "$IS_RESUME" "$*" \
            >> "$INVLOG" 2>/dev/null \
            || echo "[CODEX-WRITE-PREFLIGHT] invocation log write FAILED: $INVLOG (non-fatal)" >&2
    fi
fi

# ---- act on the verdict ----------------------------------------------------------------------
if [ "$VERDICT" = "refuse" ]; then
    echo "[CODEX-WRITE-PREFLIGHT] REFUSED — $REASON" >&2
    echo "[CODEX-WRITE-PREFLIGHT] not run: $*" >&2
    exit 2
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "[CODEX-WRITE-PREFLIGHT] ok (task_class=$TASK_CLASS sandbox=${SANDBOX:-none} resume=$IS_RESUME)"
    exit 0
fi

# Preserve the piped prompt so a future post-mortem has the text Idea-A's never had.
# stdin passes through untouched when it is a terminal or the tee cannot be set up.
if [ "$LOG_OK" -eq 1 ] && [ ! -t 0 ]; then
    if : > "$PROMPT_FILE" 2>/dev/null; then
        chmod 600 "$PROMPT_FILE" 2>/dev/null || true
        tee "$PROMPT_FILE" | "${CMD[@]}"
        exit "${PIPESTATUS[1]}"
    fi
fi
exec "${CMD[@]}"
