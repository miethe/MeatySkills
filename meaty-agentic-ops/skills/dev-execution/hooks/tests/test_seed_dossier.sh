#!/usr/bin/env bash
# Regression net for the plan-time dossier seed (spec Sec A.1 step 1).
#
# Covers the gate contract (master switch / binding / tier floor / idempotency /
# always-exit-0) AND the deterministic derivation (stage spine from the plan's
# phases, titles from body headings, OQs + decisions from frontmatter). The
# derivation assertions are the ones that matter: a seed that produces a manifest
# the delivery-report validator rejects would leave the dossier dormant, which is
# exactly the failure this feature exists to fix.
set -u

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
hooks="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks/seed-dossier.sh"
engine="$hooks/seed_dossier.py"
python_bin="${DELIVERY_REPORT_TEST_PYTHON:-python3}"

# A minimal, realistic Tier 3 plan: frontmatter phases + body headings + OQs/decisions.
plan="$tmpdir/plan.md"
cat > "$plan" <<'PLAN'
---
title: "Implementation Plan: Widget Sync (v1)"
doc_type: implementation_plan
feature_slug: "widget-sync"
tier: 3
prd_ref: docs/PRD.md
spike_ref: docs/SPIKE.md
effort_estimate: "12 pts"
scope: "Sync widgets across the mesh."
owner: nick
open_questions:
  - "Should sync be push or pull?"
decisions:
  - "Use a single writer per shard."
wave_plan:
  phases:
    - id: P1
      depends_on: []
    - id: P2
      depends_on: [P1]
---

### Phase P1: Data layer — 5 pts
Build the models.

### Phase P2: API surface — 7 pts
Expose the endpoints.
PLAN

tier1_plan="$tmpdir/tier1.md"
printf -- '---\ntitle: "Small"\nfeature_slug: "small-thing"\ntier: 1\n---\n\nbody\n' > "$tier1_plan"

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
    printf 'FAIL %s: expected %s got %s\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

# --- the wrapper's gate contract: every path exits 0 -------------------------
check no-binding 0 env -u DOSSIER_PLAN_FILE "$hook"
check missing-plan 0 env DOSSIER_PLAN_FILE="$tmpdir/nope.md" "$hook"
check switch-off 0 env AOS_DELIVERY_DOSSIER=0 DOSSIER_PLAN_FILE="$plan" \
  DELIVERY_DOSSIER_MANIFEST="$tmpdir/off.json" "$hook"
[ -f "$tmpdir/off.json" ] && { printf 'FAIL switch-off wrote a manifest\n'; fail=$((fail + 1)); }

check tier-floor-skips 0 env DOSSIER_PLAN_FILE="$tier1_plan" \
  DELIVERY_DOSSIER_MANIFEST="$tmpdir/tier1.json" "$hook"
[ -f "$tmpdir/tier1.json" ] && { printf 'FAIL tier-1 plan was auto-seeded\n'; fail=$((fail + 1)); }
check tier-floor-forced 0 env DOSSIER_SEED_FORCE=1 DOSSIER_PLAN_FILE="$tier1_plan" \
  DELIVERY_DOSSIER_MANIFEST="$tmpdir/tier1.json" "$hook"
[ -f "$tmpdir/tier1.json" ] || { printf 'FAIL forced tier-1 seed produced no manifest\n'; fail=$((fail + 1)); }

# A plan citing no spike/charter/feasibility record gets NO research stage — the spine
# reflects what the plan actually cites, never a placeholder stage nobody filled.
if [ -f "$tmpdir/tier1.json" ]; then
  assert no-research-stage-without-ref "plan,phase-1,validate" \
    "$("$python_bin" - "$tmpdir/tier1.json" <<'PY'
import json, sys
print(",".join(s["id"] for s in json.load(open(sys.argv[1]))["stages"]))
PY
)"
fi

# --- the engine's derivation + exit codes ------------------------------------
manifest="$tmpdir/widget/report.json"
check engine-seeds 0 "$python_bin" "$engine" --plan "$plan" --out "$manifest" --json
check engine-idempotent 3 "$python_bin" "$engine" --plan "$plan" --out "$manifest" --json
check engine-reseed-forced 0 "$python_bin" "$engine" --plan "$plan" --out "$manifest" --force --json
check engine-tier-gate 4 "$python_bin" "$engine" --plan "$tier1_plan" --out "$tmpdir/t1.json" --json
check engine-missing-plan 2 "$python_bin" "$engine" --plan "$tmpdir/nope.md" --json

if [ -f "$manifest" ]; then
  read -r route stage_ids oq_count dec_count truth <<EOF
$("$python_bin" - "$manifest" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(d["report"]["route"],
      ",".join(s["id"] for s in d["stages"]),
      len(d["open_questions"]), len(d["decisions"]),
      d["report"]["truth_status"])
PY
)
EOF
  assert route-is-dossier "dossier" "$route"
  assert stage-spine "research,plan,phase-1,phase-2,validate" "$stage_ids"
  assert open-questions-carried "1" "$oq_count"
  assert decisions-carried "1" "$dec_count"
  assert seed-truth-status "not_executed" "$truth"

  label="$("$python_bin" - "$manifest" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print(next(s["label"] for s in d["stages"] if s["id"] == "phase-1"))
PY
)"
  assert phase-title-from-heading "Data layer" "$label"

  # The seed must satisfy the delivery-report validator, or the dossier is born broken.
  for candidate in "$hooks/../../delivery-report" "$HOME/.claude/skills/delivery-report"; do
    if [ -f "$candidate/scripts/delivery_report.py" ]; then
      check seed-validates 0 "$python_bin" "$candidate/scripts/delivery_report.py" \
        validate --manifest "$manifest" --expect-route dossier
      break
    fi
  done
else
  printf 'FAIL engine produced no manifest to inspect\n'
  fail=$((fail + 1))
fi

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
