# Changelog — dev-execution

## v1.3 — 2026-07-31 — Gate tiering (workflow-set v4.1)

**Risk-tier the gate set instead of running the full set.** v4 fixed gate *frequency* and gate
*context*; this fixes gate *composition* — how many lenses fire — plus the loop-termination rule.

- **`references/gate-risk-classes.md` §2 restructured into a two-step tier.** Step 1 assigns exactly
  one lens; step 2 is the only thing that can add a second.
  - New **F1** row for **ordinary product surfaces** (CRUD, UI, reporting, read path, internal API
    shaping, test-only) → `[validator]`. Previously these matched *no row at all*.
  - The second lens is gated on exactly **three named triggers** — `untrusted-input`,
    `authz-boundary`, `irreversible-outward` — with R1–R7 regrouped underneath them so there is one
    taxonomy rather than two.
  - New **R8** (untrusted-input parsing: deserialization, path traversal, template rendering, regex
    over caller input, uploads, URL parsing) and **R9** (outward-facing/irreversible: publish,
    deploy, send-to-external-service, PR creation, force-push, migration, secret rotation, deletion).
    Two of the three triggers previously had no rule at all.
  - **D1's "more expensive lens wins" is retired.** It was the largest source of default-two-lens
    inflation: with no F1 row, ordinary phases fell through to "unclear" and were escalated by
    tie-break. Ambiguity now resolves to a *named unknown you read the code to settle*.
  - Two-lens phases must name their trigger (`gate_lens_reason`).
  - `karen` is **one** whole-tree pass per feature; a milestone-boundary pass is reserved for
    `context_class` C3/C4.
  - New **§3b "surface reduction before guard proliferation"** — the counterweight to §3 item 2,
    added alongside the byte-stable verbatim §3 block rather than inside it.
- **`references/execution-doctrine.md` — the same-class stop rule (hard), folded into rule 1**: two
  consecutive rounds surfacing the **same defect class** ⇒ the next action is a **design change, not
  a third review**, even with a re-pass left in the budget. New **rule 5**: prefer the narrowest
  reproducible measurement (>2 min ⇒ find the ten-second version), bounded so it cannot excuse
  narrowing the *claim* or skipping the suite at the gate. "Frequency, not existence" → "Frequency,
  **composition**, not existence".
- **Gate machinery is no longer paper-only.** `gate_lens` had one consumer, and that consumer did not
  exist in the code that runs: the live `MeatySkills/meaty-agentic-ops/workflows/execute-plan.js` had
  **no** `gate_lens` branch, so the "security lens is non-removable" invariant was documentary. The
  branch now exists in the script; `VERDICT_SCHEMA` carries `defect_class`; `fixLoop` exits
  `needs_redesign` on a same-class repeat. `orchestration/workflow-patterns.md` reconciled **to** the
  script (it was the stale side, including a `tier === 3 → karen` rule the script had deliberately
  removed), with a standing note that the script is the truth.
- **Reviewer agents no longer fan out.** `karen` mandated a four-agent consultation sequence
  (repeated 3×) and `task-completion-validator` prescribed follow-on chains — **three of the four
  named agents do not exist in the roster**, so those dispatches failed or no-opped while presenting
  as thoroughness. Removed; both now return a verdict.
- **Tier tables risk-tiered** (`validation/completion-criteria.md`, `SKILL.md`, and both tables in
  `planning/SKILL.md`): base gate of one lens for every tier, second lens only on a named trigger,
  **tier no longer promotes the reviewer**.
- **Modes select by trigger, not tier.** `modes/plan-execution.md` and `modes/phase-execution.md`
  read `gate_lens`; the pre-gate is stated to fire **only** ahead of a security lens.
  `modes/quick-execution.md` (Tier 0) and `modes/scaffold-execution.md` — which had **no reviewer
  pass at all** — gain the one-lens floor.
- **New standing test-rigor `R3`** (`validation/completion-criteria.md`): one e2e pass through the
  product's real entry point, landed **before the first reviewer gate**. Cheap standing requirement,
  never a gate; the value is in the timing.
- **Fixed v4 residue**: `validation/milestone-checks.md`'s FINAL VALIDATION template still passed the
  full plan + progress file, contradicting the delta-context rule two files over.
- `modes/plan-optimization.md` aligned throughout (steps 1/4/6, outputs, hand-off, Do-Not-Say).

## v1.2 — 2026-07-30

- **Wire in the Claude-5-generation execution doctrine** (`references/execution-doctrine.md`, new —
  authoring-side counterpart is `planning/references/plan-doctrine.md`; long form + evidence:
  `docs/project_plans/design-specs/claude5-plan-doctrine-v1.md`). One pointer near the top of
  SKILL.md; every gate/section cites it rather than restating it.
- **Gate budget: 2 re-passes per scope x lens, then auto re-scope.** Replaced the "2+ failed fix
  cycles → escalate to Opus" language (Mandatory Reviewer Gates + Tier 1 Sprint Flow) with the hard
  rule: the 3rd failure against the same lens auto-escalates to re-scope/redesign, not to a human
  looking at it. Re-passes count per scope x lens, not per dispatch.
- **Delta-context gate dispatch.** Mandatory Reviewer Gates now states explicitly that a gate
  dispatch — including re-passes — carries only the failure summary, touched files, and the AC in
  question, never the full plan/cumulative diff/progress file; a reviewer needing the whole plan is a
  signal the AC is under-specified.
- **Continue, don't re-dispatch; fresh context is for verification.** Fix loops now continue the
  existing executor session instead of re-spawning; fresh context is reserved for the reviewer/
  verifier. Documented explicitly that today's actual default is inverted (implementers re-spawned,
  validators inherit stale context) and that this doctrine flips it.
- **150% context tripwire** added to Token Discipline: above 150% utilization in one session, split
  or summarize-forward before continuing. Documented honestly as an executor-observed live signal,
  not an automated gate — the CCDash `context_ballooning` signal remains a follow-up.
- **Implementation notes over halt-and-gate** (new Core Principles §4): executors log deviations to
  `.claude/worknotes/<slug>/implementation-notes.md` and keep going; reviewed at milestone
  boundaries. Mid-milestone halts reserved for destructive actions, real scope changes, or
  operator-only input. Mode-D boundaries are explicitly called out as unchanged and non-negotiable.
- **Bookkeeping demotions**: IntentTree lookup/claim/status-sync now fires once per plan milestone
  (was every task start; task-done/phase-done syncs unchanged); the living-dossier
  `hooks/update-dossier.sh` now fires once at end-of-plan (was every phase boundary); the plan-level
  Completion Report (`.claude/worknotes/<slug>/completion-report.md`) is **retired** — the reviewer
  verdict + `commit_refs` is the record. The Tier 1 sprint's contract-appended Completion Report is a
  **different, surviving artifact** — Tier 1 has no wave/phase record to fall back on; the Exit
  Criteria section now states the distinction explicitly so the two are never conflated.
- **Deleted `orchestrator_model`** — the plan/phase frontmatter field and its handoff-string emit
  site in Execution Model Routing. It was advisory and never read; the workflow cannot switch its own
  main-loop model mid-run.
- Added two rows to Deferred / Do Not Say: the context tripwire is executor-observed, not automated;
  there is no gate-budget counter hook enforcing the 2-re-pass cap.

## v1.1 — 2026-07-29

- **Add the `plan-optimization` mode** (risk-classed reviewer-gate selection at the plan/execute
  boundary): new `modes/plan-optimization.md` (the pre-dispatch procedure) + `references/gate-risk-classes.md`
  (risk-class → reviewer-lens ruleset, verbatim defect checklist, cost calibration, and the RF
  Operator MCP P1 worked example). Wired into the Execution Modes dispatch table and the Mandatory
  Reviewer Gates section. Emits advisory `gate_lens`/`gate_shared_with` keys per phase, a duplicate-lens
  report, a paste-ready defect checklist, a cheap pre-gate before each security lens, and a
  cost/inversion projection. Never removes the only lens a phase's risk class requires.
  Spec: `docs/skill-development/plan-optimizer/spec.md`. Grounding: RF Operator MCP P1 execution retro.
- **First validator-conformant version.** Added `version`/`app_version`/`updated` frontmatter, this
  CHANGELOG, and the required `When NOT To Use` + `Deferred / Do Not Say` + absolute `Key References`
  sections. Clears all 6 `skill-dev` `validate_skill.py` FAILs (mirror-parity + ≤500-line WARNs remain;
  mirror parity is skillmeat-generated on codex deploy).
