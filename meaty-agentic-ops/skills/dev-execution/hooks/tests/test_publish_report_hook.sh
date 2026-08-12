#!/usr/bin/env bash
# Regression net for the M3 phase/plan-close publish+link hook (D1-D5, PF-3).
#
# Fully offline: a fake `delivery-report` skill dir stands in for the real M1/M2
# scripts so exit codes are deterministic. Covers the wrapper's non-fatal
# contract (master switch / binding / anchor guard / always-exit-0) AND the M3
# headline AC — no-collapse identity per recurring-route instance, with
# idempotent reuse on re-run of the SAME instance.
set -u

tmpdir="$(mktemp -d)"
dossier_slug="publish-hook-test-widget-sync-$$"
dossier_dir=".claude/reports/dossier/${dossier_slug}"
trap 'rm -rf "$tmpdir" "$dossier_dir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/publish-report.sh"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-python3}"

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

assert() {
  name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass=$((pass + 1))
  else
    printf 'FAIL %s: expected [%s] got [%s]\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Fake delivery-report skill: fake export records its --instance-key arg (so
# we can assert the no-collapse AC); fake publish exits whatever
# FAKE_PUBLISH_EXIT says, and records every invocation.
# ---------------------------------------------------------------------------
skill_dir="$tmpdir/fake-skill"
scripts_dir="$skill_dir/scripts"
mkdir -p "$scripts_dir"
export_log="$tmpdir/export-calls.log"
publish_log="$tmpdir/publish-calls.log"
: > "$export_log"
: > "$publish_log"

cat > "$scripts_dir/delivery_report.py" <<'PY'
import argparse, json, os, sys

p = argparse.ArgumentParser()
p.add_argument("command")
p.add_argument("--manifest", required=True)
p.add_argument("--target", required=True)
p.add_argument("--html", required=True)
p.add_argument("--out", required=True)
p.add_argument("--instance-key", default=None)
args = p.parse_args()

with open(os.environ["FAKE_EXPORT_LOG"], "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"manifest": args.manifest, "instance_key": args.instance_key}) + "\n")

manifest = json.load(open(args.manifest, encoding="utf-8"))
report = manifest.get("report") or {}
route = report.get("route")
subject = report.get("subject") or report.get("project")
link_identity = f"report:{route}:{subject}"
if args.instance_key:
    link_identity += f":{args.instance_key}"

envelope = {
    "route": route, "subject": subject, "instance_key": args.instance_key,
    "link_identity": link_identity, "html_path": args.html,
}
with open(args.out, "w", encoding="utf-8") as fh:
    json.dump(envelope, fh)
sys.exit(int(os.environ.get("FAKE_EXPORT_EXIT", "0")))
PY

cat > "$scripts_dir/publish_report.py" <<'PY'
import json, os, sys

with open(os.environ["FAKE_PUBLISH_LOG"], "a", encoding="utf-8") as fh:
    fh.write(" ".join(sys.argv[1:]) + "\n")

code = int(os.environ.get("FAKE_PUBLISH_EXIT", "0"))
msg = os.environ.get("FAKE_PUBLISH_MSG", "fake publish")
sys.stdout.write(json.dumps({"ok": code == 0, "status": msg}) + "\n")
sys.exit(code)
PY

export FAKE_EXPORT_LOG="$export_log"
export FAKE_PUBLISH_LOG="$publish_log"

# A manifest + rendered HTML for a `phase` report (the recurring-route AC).
phase_dir="$tmpdir/phase-report"
mkdir -p "$phase_dir"
cat > "$phase_dir/report.json" <<JSON
{"report": {"route": "phase", "subject": "${dossier_slug}"}}
JSON
printf '<!doctype html>\n' > "$phase_dir/index.html"

run_hook() {
  env DELIVERY_REPORT_SKILL_DIR="$skill_dir" DELIVERY_REPORT_PYTHON="$python_bin" \
      FAKE_EXPORT_LOG="$export_log" FAKE_PUBLISH_LOG="$publish_log" \
      "$@" "$hook"
}

# Run outside the launchpad so the HOME-relative candidates control the ladder.
ladder_cwd="$tmpdir/ladder-cwd"
ladder_home="$tmpdir/ladder-home"
mkdir -p "$ladder_cwd" "$ladder_home/.claude/skills/delivery-report/scripts" \
  "$ladder_home/.agents/skills"
cp "$scripts_dir/delivery_report.py" \
  "$ladder_home/.claude/skills/delivery-report/scripts/delivery_report.py"
cp -R "$skill_dir" "$ladder_home/.agents/skills/delivery-report"

run_ladder_hook() {
  (
    cd "$ladder_cwd" || exit 1
    env -u DELIVERY_REPORT_SKILL_DIR HOME="$ladder_home" DELIVERY_REPORT_PYTHON="$python_bin" \
        FAKE_EXPORT_LOG="$export_log" FAKE_PUBLISH_LOG="$publish_log" \
        "$@" "$hook"
  )
}

# --- master switch -----------------------------------------------------------
: > "$export_log"; : > "$publish_log"
check switch-off 0 run_hook env AOS_DELIVERY_REPORT_PUBLISH=0 \
  DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" ITT_NODE_ID=node_1 PHASE_NUM=P1
assert switch-off-zero-calls "0" "$(wc -l < "$export_log" | tr -d ' ')"

# --- unbound: silent no-op ----------------------------------------------------
: > "$export_log"; : > "$publish_log"
check unbound 0 run_hook env -u ITT_NODE_ID -u INTENTTREE_TREE \
  DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" PHASE_NUM=P1
assert unbound-zero-calls "0" "$(wc -l < "$export_log" | tr -d ' ')"

# --- no manifest: silent no-op ------------------------------------------------
: > "$export_log"; : > "$publish_log"
check no-manifest 0 run_hook env -u DELIVERY_REPORT_MANIFEST ITT_NODE_ID=node_1
assert no-manifest-zero-calls "0" "$(wc -l < "$export_log" | tr -d ' ')"

# --- skill-dir ladder: skip a stale global deploy for a complete later mirror
: > "$export_log"; : > "$publish_log"
check stale-global-falls-through-to-complete-mirror 0 run_ladder_hook env \
  DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" ITT_NODE_ID=node_1 PHASE_NUM=P1
assert stale-global-complete-mirror-publishes "1" "$(wc -l < "$publish_log" | tr -d ' ')"

# An incomplete candidate with no complete successor reports an actionable skip.
incomplete_home="$tmpdir/incomplete-home"
mkdir -p "$incomplete_home/.claude/skills/delivery-report/scripts"
cp "$scripts_dir/delivery_report.py" \
  "$incomplete_home/.claude/skills/delivery-report/scripts/delivery_report.py"
stderr_out="$(
  cd "$ladder_cwd" || exit 1
  env -u DELIVERY_REPORT_SKILL_DIR HOME="$incomplete_home" DELIVERY_REPORT_PYTHON="$python_bin" \
    DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" ITT_NODE_ID=node_1 PHASE_NUM=P1 \
    FAKE_EXPORT_LOG="$export_log" FAKE_PUBLISH_LOG="$publish_log" \
    "$hook" 2>&1 >/dev/null
)"
case "$stderr_out" in
  *"$incomplete_home/.claude/skills/delivery-report"*"incomplete"*"stale deploy"*) pass=$((pass + 1)) ;;
  *) printf 'FAIL incomplete-skill-actionable-message: got [%s]\n' "$stderr_out"; fail=$((fail + 1)) ;;
esac

# --- verb unavailable (M2 exit 3) -> benign, non-fatal skip ------------------
: > "$export_log"; : > "$publish_log"
check verb-unavailable 0 run_hook env DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" \
  ITT_NODE_ID=node_1 PHASE_NUM=P1 FAKE_PUBLISH_EXIT=3
assert verb-unavailable-published-once "1" "$(wc -l < "$publish_log" | tr -d ' ')"

# --- guardrail rejection (M2 exit 1) -> loudly logged, still exit 0 ----------
: > "$export_log"; : > "$publish_log"
stderr_out="$(env DELIVERY_REPORT_SKILL_DIR="$skill_dir" DELIVERY_REPORT_PYTHON="$python_bin" \
  DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" ITT_NODE_ID=node_1 PHASE_NUM=P1 \
  FAKE_PUBLISH_EXIT=1 FAKE_PUBLISH_MSG=guardrail_rejected \
  "$hook" 2>&1 >/dev/null)"
case "$stderr_out" in
  *"GUARDRAIL REJECTED"*) pass=$((pass + 1)) ;;
  *) printf 'FAIL guardrail-logged-loudly: got [%s]\n' "$stderr_out"; fail=$((fail + 1)) ;;
esac
check guardrail-rejected-still-exit-0 0 env DELIVERY_REPORT_SKILL_DIR="$skill_dir" \
  DELIVERY_REPORT_PYTHON="$python_bin" DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" \
  ITT_NODE_ID=node_1 PHASE_NUM=P1 FAKE_PUBLISH_EXIT=1 "$hook"

# --- dossier deference: a `feature` manifest defers to a live dossier -------
: > "$export_log"; : > "$publish_log"
feature_dir="$tmpdir/feature-report"
mkdir -p "$feature_dir"
cat > "$feature_dir/report.json" <<JSON
{"report": {"route": "feature", "subject": "${dossier_slug}"}}
JSON
printf '<!doctype html>\n' > "$feature_dir/index.html"

mkdir -p "$dossier_dir"
cat > "$dossier_dir/report.json" <<JSON
{"report": {"route": "dossier", "subject": "${dossier_slug}"}}
JSON
printf '<!doctype html>\n' > "$dossier_dir/index.html"

check dossier-defer-exit-0 0 run_hook env DELIVERY_REPORT_MANIFEST="$feature_dir/report.json" \
  ITT_NODE_ID=node_1
manifest_used="$(head -1 "$export_log" | "$python_bin" -c 'import json,sys; print(json.loads(sys.stdin.read())["manifest"])' 2>/dev/null)"
case "$manifest_used" in
  */dossier/"${dossier_slug}"/report.json) pass=$((pass + 1)) ;;
  *) printf 'FAIL dossier-deferred-to-dossier-manifest: got [%s]\n' "$manifest_used"; fail=$((fail + 1)) ;;
esac
assert dossier-no-double-publish "1" "$(wc -l < "$export_log" | tr -d ' ')"

# --- THE HEADLINE AC: no-collapse across two successive phase closes,
#     idempotent reuse when re-running the SAME phase. -----------------------
: > "$export_log"; : > "$publish_log"
check phase-1-first-close 0 run_hook env DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" \
  ITT_NODE_ID=node_1 PHASE_NUM=P1
check phase-2-close 0 run_hook env DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" \
  ITT_NODE_ID=node_1 PHASE_NUM=P2
check phase-1-rerun 0 run_hook env DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" \
  ITT_NODE_ID=node_1 PHASE_NUM=P1

keys="$("$python_bin" -c '
import json
with open("'"$export_log"'", encoding="utf-8") as fh:
    lines = [json.loads(l) for l in fh if l.strip()]
print(",".join(l["instance_key"] or "" for l in lines))
')"
key1="$(printf '%s' "$keys" | cut -d, -f1)"
key2="$(printf '%s' "$keys" | cut -d, -f2)"
key3="$(printf '%s' "$keys" | cut -d, -f3)"

if [ -n "$key1" ] && [ -n "$key2" ] && [ "$key1" != "$key2" ]; then
  pass=$((pass + 1))
else
  printf 'FAIL two-successive-phase-closes-distinct: key1=[%s] key2=[%s]\n' "$key1" "$key2"
  fail=$((fail + 1))
fi
assert same-phase-rerun-reuses-key "$key1" "$key3"

# no instance key derivable for a recurring route -> local skip (exit 0, no publish call)
: > "$export_log"; : > "$publish_log"
check phase-no-key-skips 0 run_hook env -u PHASE_NUM -u PHASE_ID \
  DELIVERY_REPORT_MANIFEST="$phase_dir/report.json" ITT_NODE_ID=node_1
assert phase-no-key-zero-publish-calls "0" "$(wc -l < "$publish_log" | tr -d ' ')"

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
