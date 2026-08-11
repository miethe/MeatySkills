# Changelog — dev-execution

## v1.6 — 2026-08-10 — Validation-scope hardening: the gate's test scope is not the diff

The reviewer gate approved skillmeat PR #299 with 4/4 ACs "met" over a suite containing a 3-red
*untouched* file (asserting the exact behaviour the change removed) and a ~61-red baseline file
(where new failures were invisible), because it scoped test selection to the files the executor
touched. A fix is scoped per file; the tests for its behaviour are scoped per behaviour, so the diff
is the wrong index into the suite. Sibling of R3 (v1.4): R3 presupposes green and asks about the
production path; this asks whether the supporting test is passing at all, and whether the gate even
ran the file that tests the behaviour.

- **New doctrine, `validation/completion-criteria.md`** — "The validation-scope rule (AC-1/2/3)":
  test-selection scope is the resolved symbol-scope (not `files_changed`), regressions judged by the
  base→head delta (not the absolute red count), an AC backed only by a red/absent test is not met.
  Outcome split mirrors R3's: red-backed AC ⇒ ordinary rejection (`ac-backed-by-red-test`);
  absent/failed measurement or an approval over a measured regression ⇒ gate-integrity failure.
- **`task-completion-validator.md` STEP 0d** (+ byte-identical skillmeat twin) — the reviewer-facing
  form of the rule.
- **`orchestration/workflow-patterns.md`** — `reviewerGate` note 6.
- **`references/worktree-isolation-lane.md` §2a** — the one sanctioned `git worktree add --detach`
  (SHA-pinned, read-only baseline measurement), and why it must NOT be `EnterWorktree`
  (`baseRef: fresh` would measure `origin/<default>`).
- **New hook** `hooks/validation_scope.py` + `validation-scope.sh` — symbol-scoped test-scope
  resolution and base→head per-file delta with node-id-level failure-set diffing. Fail-closed on
  import-shadow, zero-collected, collection error, and vanished tests.
- **Enforcement** lives in `reviewer-gate.js` (`Measure` phase, `applyTestStatusRules`,
  `ac_verdicts[].supporting_tests`, `validation_scope` on the envelope). Guarded by
  `tests/test_workflow_gate_integrity.py` § Defect 10. `execute-plan.js` / `execute-contract.js`
  retrofit is tracked (`node_01KZP97XJKQJ3K7JRPPWXFDB1E`), held open by a failing placeholder test.

Tracker `node_01KZKSJKK4W3WA80MEKF2GMNPM`; plan
`docs/project_plans/reviewer-gate-validation-scope-hardening-v1.md`.

## v1.5.1 — 2026-08-06 — Re-baseline § "Leg scoping" onto the §4 cost model

**v1.5 shipped § "Leg scoping" with a unit error inherited unverified from the session notes it was
promoted from.** The 25–30k it measured against is `SKILL.md` § "Budget Targets" — "per execution
phase (Tier 2/3)", whose sibling rows read as a **200K-window allocation** rather than cumulative
spend (~52K orchestration baseline, ~148K available for work in 200K, Tier 1 sprint ≤80K; 52 + 148 =
200). ⚠️ That reading is an **inference that cannot be settled from this corpus** — `SKILL.md`
§ "Token Discipline" names `.claude/rules/context-budget.md` as authoritative and **that file does
not exist**, while `modes/plan-execution.md` calls the same number a per-phase-owner *token* budget.
The comparison fails either way: a resident allocation and a cumulative multi-round total are
different quantities, and if 25–30k were cumulative it would contradict §4's *measured* 355k
implementer pass by ~12×. A second ~25–30k figure — the cheap pre-gate security sweep
(`modes/plan-optimization.md` §6, "a fixed first-pass default, not tuned") — is likewise not a spend
budget. No per-leg spend budget existed in the doctrine before v1.5 wrote one. Corrected in
`references/execution-doctrine.md` § "Leg scoping":

- **Magnitude re-baselined onto `references/gate-risk-classes.md` §4** (the cumulative-spend
  instrument). ⚠️ The plan never declared an `effort` for M1 (`points: 31` + `context_class: C3`
  only) and §4's scaler keys on `effort`, so no band is strictly derivable — the restated figure is a
  **reviewer estimate** over the `l`–`xl` bracket its scope implies (16 files, 87 tests, 4 API
  modules), not a doctrine output. That bracket settles the question anyway: implementer band
  266k–355k → 535,601 is **~1.5–2.0×** the bare line; implementation-plus-fix envelope 642k–743k →
  **~0.7–0.8×, inside it either way**. **Not ~20×.** **The orchestration diagnosis is unchanged**: a
  whole C3 milestone scoped to one leg is a scoping failure regardless of the multiplier. That §4
  could not be applied without an undeclared field is its own finding.
- **Rule 1's budget is now an effort-scaled fraction of the 355k band** (xs≈0.15× → xl≈1×),
  hard-capped by rule 2 at ~150k (≈0.42×) — so a leg runs ~50k–150k and an effort size scaling past
  the cap is *by construction* more than one boundary and must be split. This also removes a
  self-inconsistency: at ~30k a leg was 5× over its own budget before rule 2's ~150k packet-file
  inversion could ever bind, so the two rules could not both hold. The `≤~40 tool uses` cap becomes
  a derived sanity check (~20–60 uses at the observed ~2.4k tokens/tool-use, n=1), not a second
  independent axis.
- **Withdrawn as unverifiable:** the claim that rule 4's 150% tripwire "already existed and was not
  applied". Rule 4 is denominated in % context utilization while the evidence and rule 2 are in
  absolute tokens, and no conversion exists (`SKILL.md` records the tripwire as executor-observed
  with no CCDash-fed enforcement; CCDash's util% does not divide to any context window).
- **Four non-convertible burn units enumerated**, on the axis that actually matters — resident
  footprint vs cumulative spend vs ratio: tokens-in millions (context class), cumulative hundreds of
  thousands (§4 per-pass + the leg rules), resident tens of thousands (`SKILL.md` § "Budget
  Targets"), and % utilization (rule 4). Reconciliation tracked on
  `node_01KZC05ZRKJDB7R1FVT61WS2BH`.
- **Propagation:** the surviving "measured 20× token overrun" in `planning/references/plan-doctrine.md`
  § "Leg contracts" is restated on the §4 band, and `gate-risk-classes.md`'s cross-reference to
  "execution-doctrine.md rule 1" is disambiguated — that file now has two rule 1s (the six-rules gate
  budget, and the leg budget under § "Leg scoping").

Rules 2 and 3 as shipped in v1.5 are correct and unchanged. Origin:
`node_01KZC2719MV6SABQMV82NR6B7V` (review of the `attention-contract-v1` M1 orchestration notes,
reconciled against PR #140).

## v1.5 — 2026-08-06 — Dispatch-time leg contracts + leg scoping

**The milestone doctrine is working and is not the problem. What was missing sat one level down:
what a *delegated leg* is handed at dispatch.** Measured W1→W2 (workflow-v4.1 delegate retro,
`docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md`): cost/session −63%, severe
context ballooning 16.9%→3.8%, Sonnet 5 mean utilization 164%→96%. Zero AARs report a delegate
building the wrong feature, drifting scope, or asking for clarification. Thin plans did not cause
scope drift.

What they did expose is a narrower, nastier class: **verification-path divergence** — 8 bug findings
in 6 days of a Sonnet-tier executor shipping confident code that passes its own green suite while
the suite exercises a path production never takes (offline fakes echoing the wrong field name, code
paths reachable only from tests, dry-runs that never check what `apply` requires; five instances in
one program).

- **New rule 6 — dispatch a leg contract, not a milestone** (`references/execution-doctrine.md`).
  Five mandatory fields per delegated implementation leg: file-ownership boundary, interface names,
  real endpoint/field names, **verification path** ("test through the path production takes; name
  it", plus what does *not* count as evidence), and budget + exit. Plus the **missing-name escape** —
  "if a name in this contract does not exist in the tree, stop and report it; do not substitute a
  nearby one" — because the recorded failure mode is confident wrong delivery, never hesitation.
  The contract is a dispatch-time **render**, never plan mass.
- **New § "Leg scoping"** — the three standing rules promoted out of the session notes of the run
  that violated all three (535,601 tokens / 224 tool uses, an orchestration error rather than a model
  error): (1) one leg = one file-ownership boundary, split before dispatch; (2) never continue a
  session past ~150k — write a packet **file** and dispatch fresh, and a "fix" that is a redesign gets
  a fresh dispatch; (3) batch every gate lens before dispatching a fix. ⚠️ **Rule 1's budget anchor
  and this bullet's original `~20× over a 25–30k target` figure were wrong and are superseded by
  v1.5.1 above** — ~30k budgets the pre-gate security sweep, not implementation. Rules 2 and 3 stand
  as shipped.
- **Rule 3 is now bounded, not contradicted.** Continue-don't-redispatch assumes a *small* warm
  session; past ~150k, replay cost exceeds cache benefit (two resume-from-transcript continuations
  replayed ~400k tokens for ~800 words of directives). Rule 3 carries an explicit boundary note to
  rule 2 of leg scoping.
- **The fields now reach an executor.** `orchestration/batch-delegation.md` § "Task Delegation
  Template" is the paste-ready render carrying all five fields, the not-evidence list, the budget
  exit and the escape; `orchestration/agent-assignments.md` § "Delegation Template" defers to it
  rather than offering a lighter competing skeleton. Doctrine that no dispatch surface threads is
  prose that decays — that is the failure this repo has already recorded once.

Authoring half: `planning` v2.2. Origin: `node_01KZC04VHJVB70G6G9QWAVH2H1` (retro R1).

## v1.4 — 2026-08-03 — The reviewer gate is a schema'd workflow stage

**v1.3 fixed *which* lenses fire. This fixes *how a verdict arrives* — the gate's delivery
mechanism, which was the one part of the gate machinery still specified as free-text prose.**

`/dev:execute-plan` and `/dev:execute-contract` already ran their reviewer with
`schema: VERDICT_SCHEMA`. Every **other** gate in the engine did not: the Tier 0 close, the scaffold
close, the plan-level whole-tree pass and every ad-hoc milestone gate were documented as a bare
in-session `Task("task-completion-validator", "… Verdict: APPROVED or CHANGES_REQUESTED")`. That form
fails three ways, and all three were observed on live runs:

1. **The orchestrator blocks in-line.** A bare Agent call is awaited by the main loop, so a slow or
   silent reviewer stalls the session — and a stalled gate is indistinguishable from a gate that is
   thinking.
2. **The verdict is unparsed prose.** Nothing forces a decision to exist; the reviewer can ramble,
   exhaust its turns, or stop mid-thought.
3. **A dead reviewer reads like a quiet one.** "No verdict" and "rejected, unhelpfully" are the same
   observable, so a gate that never ran passes for a gate that passed.

Changes:

- **New `reviewer-gate` workflow** (`.claude/workflows/reviewer-gate.js`; upstream
  `MeatySkills/meaty-agentic-ops/workflows/reviewer-gate.js`, spec
  `specs/workflows/reviewer-gate-workflow-spec.md`). Runs 1–2 edit-less lenses in `parallel`, each
  forced through `VERDICT_SCHEMA`, and returns a verdict envelope. No fix loop by design — the caller
  already owns a budget, and a second one would compete with it. Never calls `workflow()`, so a
  top-level workflow can nest it.
- **`SKILL.md` § "How a gate is dispatched"** — the normative form, the `args` shape, and the
  three-outcome table.
- **Dispatch sites converted** from `Task(...)` to `Workflow({name:'reviewer-gate', …})`:
  `modes/quick-execution.md` §3.1, `modes/scaffold-execution.md` §5.1, `modes/plan-execution.md`
  step 4.
- **`approved: false` now splits on `gate_ran`, and this is the substantive behavioural change.** A
  rejection goes to the fix loop and consumes a gate-budget re-pass; a **gate failure** goes to
  re-dispatch or an explicit operator override and consumes nothing. Sending a fix cycle after a
  gate failure edits blind against a finding nobody made, then re-reviews unchanged code — it looked
  like diligence and was pure loss. Recorded in `validation/completion-criteria.md` (three-outcome
  table) and `orchestration/workflow-patterns.md` (`reviewerGate` notes).
- **`execute-plan.js` / `execute-contract.js` hardened** to the same contract: new
  `gateFailureVerdict()`; `reviewerGate` returns immediately on a null verdict instead of entering
  `fixLoop`; `fixLoop` breaks on a null re-review with its own blocker text; `execute-contract`
  reports the new `reason: 'gate_failure'` and no longer mislabels a null **reviewer** verdict as
  `'Sprint agent returned null'`. New `gate_failure` value in `execution-report.schema.json`'s
  `reason` enum. Contract: authoring-spec **§8b**.
- **Two new guards** in `tests/test_workflow_agent_roster.py`: the edit-less lens-reviewer check is
  now parametrized over every script carrying a `LENS_REVIEWER_MAP` (was `review-council.js` only),
  and a new test asserts `LENS_REVIEWER_MAP` and `LENS_BRIEF` cover the same lens vocabulary — a
  routed-but-unbriefed lens interpolates `undefined` as its prompt's first line and still returns a
  schema-valid verdict, so nothing downstream could catch it. Verified to fail on injected drift.

**Not done / honest limits.** There is **no wall-clock timeout**: `agent()` exposes no deadline and a
workflow script cannot impose one. Against a *slow* reviewer this buys observability (a stalled stage
sits in `/workflows` under a named phase instead of freezing the main loop), not a bound. Do not
restate it as "the reviewer is killed after N seconds." `story-execution.md` still has no gate section
of its own and inherits the tier table; it was not converted here.

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
