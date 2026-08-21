#!/usr/bin/env bash
# Behavioural tests for codex-run.sh — the codex write-lane preflight + invocation log.
#
# CASE 1 is the LITERAL measured breach (`resume --last` with no explicit --sandbox). If it ever
# stops being refused, the guard is decoration — do not "fix" the test.
#
# Run: bash .claude/skills/codex/scripts/tests/test_codex_run.sh

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../codex-run.sh"
PASS=0
FAIL=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CODEX_INVOCATION_LOG="$TMP/invocations.jsonl"
# A stub "codex" that records that it ran and exits with a distinctive code.
STUB="$TMP/bin"
mkdir -p "$STUB"
printf '#!/bin/sh\ncat >/dev/null 2>&1 || true\necho "STUB-CODEX-RAN $*" >> "%s/ran.log"\nexit 7\n' "$TMP" > "$STUB/codex"
chmod +x "$STUB/codex"
PATH="$STUB:$PATH"
export PATH

ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check(){ # check <desc> <expected_rc> <actual_rc>
    if [ "$2" = "$3" ]; then ok "$1 (rc=$3)"; else bad "$1 — expected rc=$2 got rc=$3"; fi
}

run() { # run <args...> ; sets RC and OUT
    OUT="$(bash "$SCRIPT" "$@" 2>&1 </dev/null)"
    RC=$?
}

echo "== R1: resume must carry an explicit --sandbox (the measured breach) =="

# CASE 1 — the literal 2026-08-18 breach shape.
run --task-class write -- codex exec --ignore-user-config --skip-git-repo-check resume --last
check "CASE 1: write + resume --last, no --sandbox => REFUSED" 2 "$RC"
case "$OUT" in *"inheritance from the original session is FALSIFIED"*) ok "CASE 1 names the falsified inheritance claim" ;;
    *) bad "CASE 1 refusal message did not name the inheritance claim: $OUT" ;;
esac

# Same shape without a declared task class: still refused — R1 needs no declaration.
run -- codex exec --skip-git-repo-check resume --last
check "R1: undeclared + resume, no --sandbox => REFUSED" 2 "$RC"

# resume WITH an explicit sandbox is fine.
run -- codex exec --sandbox workspace-write --skip-git-repo-check resume --last
check "R1: resume WITH explicit --sandbox => allowed (codex stub rc)" 7 "$RC"

echo "== R2: a declared write task must be able to write =="

run --task-class write -- codex exec --sandbox read-only -C /tmp -m gpt-5.6-terra
check "R2: write task in read-only sandbox => REFUSED" 2 "$RC"
case "$OUT" in *"read-only sandbox produces exit 0 with zero edits"*) ok "R2 names the zero-edit failure shape" ;;
    *) bad "R2 refusal message unexpected: $OUT" ;;
esac

run --task-class write -- codex exec -C /tmp -m gpt-5.6-terra
check "R2: write task with NO --sandbox at all => REFUSED" 2 "$RC"

run --task-class write -- codex exec --sandbox workspace-write -C /tmp
check "R2: write task in workspace-write => allowed" 7 "$RC"

run --task-class write -- codex exec --sandbox=danger-full-access -C /tmp
check "R2: --sandbox=danger-full-access (equals form) => allowed" 7 "$RC"

run --task-class write -- codex exec --dangerously-bypass-approvals-and-sandbox -C /tmp
check "R2: bypass flag counts as write-capable => allowed" 7 "$RC"

# A read task in a read-only sandbox is the normal case and must never be refused.
run --task-class read -- codex exec --sandbox read-only -C /tmp
check "R2: read task in read-only => allowed" 7 "$RC"

# AOS_CODEX_TASK_CLASS is an equivalent declaration channel.
OUT="$(AOS_CODEX_TASK_CLASS=write bash "$SCRIPT" -- codex exec --sandbox read-only 2>&1 </dev/null)"; RC=$?
check "R2: AOS_CODEX_TASK_CLASS=write honoured => REFUSED" 2 "$RC"

echo "== usage errors exit 64, never 2 (a misparse must not read as a breach) =="

run --task-class bogus -- codex exec --sandbox read-only
check "usage: bad --task-class => 64" 64 "$RC"
run --nonsense -- codex exec
check "usage: unknown option => 64" 64 "$RC"
OUT="$(bash "$SCRIPT" --task-class write 2>&1 </dev/null)"; RC=$?
check "usage: nothing after -- => 64" 64 "$RC"

echo "== --check-only runs the preflight and does NOT run codex =="

rm -f "$TMP/ran.log"
run --task-class write --check-only -- codex exec --sandbox workspace-write -C /tmp
check "check-only: pass => 0" 0 "$RC"
if [ -f "$TMP/ran.log" ]; then bad "check-only: codex was RUN"; else ok "check-only: codex was not run"; fi

run --task-class write --check-only -- codex exec --sandbox read-only -C /tmp
check "check-only: refusal still => 2" 2 "$RC"

echo "== the invocation log =="

if [ -s "$CODEX_INVOCATION_LOG" ]; then ok "invocation log exists and is non-empty"
else bad "invocation log missing: $CODEX_INVOCATION_LOG"; fi

python3 - "$CODEX_INVOCATION_LOG" <<'PY'
import json, sys
rows = []
with open(sys.argv[1]) as fh:
    for line in fh:
        line = line.strip()
        if line:
            rows.append(json.loads(line))   # raises on a malformed line — that IS the assertion
print(f"  ok   every log line is valid JSON ({len(rows)} rows)")

fails = 0
refused = [r for r in rows if r["verdict"] == "refuse"]
if not refused:
    print("  FAIL no refusal was logged"); fails += 1
else:
    print(f"  ok   refusals are logged, not only printed ({len(refused)} rows)")
if not any(r["verdict"] == "allow" for r in rows):
    print("  FAIL no allowed invocation was logged"); fails += 1
else:
    print("  ok   allowed invocations are logged too")
if not all(r["refusal_reason"] for r in refused):
    print("  FAIL a refusal row carries no reason"); fails += 1
else:
    print("  ok   every refusal row carries its reason")
# The full argv is the whole point of AC2 — Idea-A's was never preserved.
if not all(isinstance(r["argv"], list) and r["argv"] for r in rows):
    print("  FAIL a row is missing its argv"); fails += 1
else:
    print("  ok   every row records the full argv")
sample = [r for r in rows if r.get("model") == "gpt-5.6-terra"]
if not sample:
    print("  FAIL model was never parsed out of the argv"); fails += 1
else:
    print("  ok   model is parsed out of the argv")
sys.exit(1 if fails else 0)
PY
if [ $? -eq 0 ]; then PASS=$((PASS+6)); else FAIL=$((FAIL+1)); fi

echo "== the piped prompt is preserved to disk =="
printf 'THE-PROMPT-TEXT-THAT-MUST-SURVIVE\n' \
  | bash "$SCRIPT" --task-class write -- codex exec --sandbox workspace-write -C /tmp >/dev/null 2>&1
if grep -rq 'THE-PROMPT-TEXT-THAT-MUST-SURVIVE' "$TMP"/*.prompt 2>/dev/null; then
    ok "piped prompt was tee'd to a .prompt file"
else
    bad "piped prompt was NOT preserved (the exact gap that made Idea-A unprovable)"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
