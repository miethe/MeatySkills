---
schema_version: 2
doc_type: reference
title: "Workflow Pattern Library — Reusable JS Primitives"
status: active
created: 2026-06-01
related_documents:
  - .claude/specs/workflows/workflow-authoring-spec.md
  - .claude/plans/workflow-orchestration-integration-v1.md
  - .claude/rules/delegation-modes.md
  - .claude/rules/context-budget.md
---

# Workflow Pattern Library

Reusable, copy-paste-ready JavaScript patterns for SkillMeat workflows. Each pattern composes
against the primitives defined in `workflow-authoring-spec.md` §1 and the constraints in §5.
Use `workflow-authoring-spec.md` §11 to pick the right pattern; come here for the implementation.

**Anti-hallucination baseline**: every snippet uses only real primitives — `agent`, `parallel`,
`pipeline`, `phase`, `log`, `args`, `budget`, `workflow`. No `on_success`, `condition`, or
`status_field` fields exist. No `Date.now()`, `Math.random()`, or argless `new Date()`.

---

## Constraint Checklist (copy into every workflow PR)

```
[ ] No FS/shell access in script body
[ ] Mode D phases trigger early return, never executed
[ ] All reviewer agents use edit-less agentType
[ ] No Date.now() / Math.random() / new Date() in script body
[ ] meta is a pure literal object
[ ] phase() titles match meta.phases exactly
[ ] Budget guard present in every while / loop-until-dry pattern
```

---

## Pattern: `waveFanout`

**When to use**: The core `execute-plan` shape. Use when a plan has sequential waves (dependency
levels), each wave containing one or more phases that can run in parallel, and each phase contains
task batches where tasks sharing files must run serially but disjoint tasks can parallelize.

This is the primary pattern. All other patterns compose inside the phase body of this one.

```js
// waveFanout — sequential waves, parallel phases, serial file-ownership batches within phases.
// args.waves: Wave[] from execution graph (see workflow-authoring-spec.md §3)
// args.tier: 1 | 2 | 3 — governs reviewer selection

const { waves, tier } = args
const report = []

for (const wave of waves) {
  log(`Starting Wave ${wave.id}`)
  phase(`Wave ${wave.id}`)

  // modeBoundary check per wave — see modeBoundary pattern below.
  const blocked = wave.phases.find(p => p.mode === 'D')
  if (blocked) {
    return { status: 'blocked', reason: 'mode_d', blocked_phase: blocked.id, report }
  }

  // All phases in this wave run concurrently (parallel barrier).
  const waveResults = await parallel(wave.phases.map(p => async () => {
    const taskOut = []

    // File-ownership batching: serial outer loop, parallel inner loop per batch.
    // p.batches is precomputed by Opus from files_affected (no FS in script).
    for (const batch of p.batches) {
      const batchOut = await parallel(batch.map(t => () =>
        agent(t.prompt, {
          label: `${p.id}:${t.id}`,
          phase: `Wave ${wave.id}`,
          agentType: t.assigned_to,
          model: t.model,
          isolation: p.isolation === 'worktree' ? 'worktree' : undefined,
        })
      ))
      taskOut.push(...batchOut.filter(Boolean))
    }

    // Reviewer gate + fix-loop (see reviewerGate + fixLoop patterns).
    const phaseResult = await reviewerGate(p, taskOut, tier)
    return phaseResult
  }))

  report.push({ wave: wave.id, phases: waveResults.filter(Boolean) })

  // Escalate if any phase's fix-loop exhausted its 2-cycle gate budget without approval. Per
  // execution-doctrine.md rule 1, that 3rd failure against the same scope x lens does not mean
  // "a human/Opus looks at it" — it auto-escalates to re-scope/redesign.
  if (waveResults.some(r => r?.escalate)) {
    return { status: 'needs_rescope', reason: 'gate_budget_exhausted', report }
  }

  // NB: cross-wave worktree merge is Opus post-wave (no git in script — constraint 1).
}

return { status: 'complete', report }
```

**Notes**:
- `p.batches` must be precomputed by Opus before launching the workflow. The script never reads
  `files_affected` from disk — Opus sets it in the execution graph.
- The inner `parallel` within each batch is the file-safety guarantee: only tasks with disjoint
  `files_affected` end up in the same batch.
- Cross-wave git merges stay with Opus post-wave (constraint 1 — no git in script).
- `waveFanout` returns an `ExecutionReport` conforming to `workflow-authoring-spec.md` §6.
- **Escalation status changed under the Claude-5 doctrine.** A phase whose `fixLoop` exhausts its
  2-cycle budget now returns `{ status: 'needs_rescope', reason: 'gate_budget_exhausted' }` — a
  distinct status from `needs_opus`, not a rename of it. `needs_opus` still applies to its other
  early-exit case (`modeBoundary`'s implicit Mode D hit, `reason: 'mode_d'`). Consumers of
  `ExecutionReport.status` must branch on `needs_rescope` separately: it routes to re-scope/redesign
  (execution-doctrine.md rule 1), not to an Opus look-and-continue.

---

## Pattern: `reviewerGate`

**When to use**: After an implementation phase completes, before moving to the next wave. Determines
the correct edit-less reviewer by consulting `review_intensity` and `tier`, then delegates to
`fixLoop` if the verdict is not immediately approved.

```js
// reviewerGate — select reviewer, run, hand off to fixLoop on rejection.
// p: Phase object from execution graph.  taskOut: TaskResult[].  tier: 1|2|3.
async function reviewerGate(p, taskOut, tier) {
  const reviewerType = councilEscalation(p, tier)

  let verdict = await agent(reviewPrompt(p, taskOut), {
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })

  // §8b: no verdict at all ⇒ the gate did not RUN. Not an approval, and not a rejection —
  // so do NOT enter the fix loop. There is no finding, so a cycle edits blind and then
  // re-reviews unchanged code. Escalate with the reason named.
  if (!verdict) {
    log(`GATE FAILURE on phase ${p.id}: reviewer ${reviewerType} returned no structured verdict.`)
    return {
      phase: p.id,
      tasks: taskOut,
      verdict: gateFailureVerdict(reviewerType, 'reviewer returned no structured verdict'),
      fix_cycles: 0,
      gate_ran: false,
      escalate: true,
    }
  }

  if (!verdict.approved) {
    return fixLoop(p, taskOut, verdict, reviewerType)
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict,
    fix_cycles: 0,
    gate_ran: true,
    escalate: false,
  }
}
```

**Notes**:
- **A gate that could not run is not a gate that passed** (authoring-spec §8b). Four requirements, all
  mandatory in every workflow:
  1. `schema:` on every reviewer dispatch — always. Never accept and parse a free-text
     `APPROVED` / `CHANGES_REQUESTED` string: without a schema nothing forces a decision to exist, so
     the reviewer can end mid-thought and the caller infers approval from tone.
  2. A `null` verdict is converted **loudly** — `verdict_source: 'gate_failure'`, a named reason, a
     `log()` line. `verdict?.approved` reads false correctly, but a bare `?? {approved:false}` loses
     *why*.
  3. `gate_ran` separates *did not run* from *said no*, because their next actions differ: a rejection
     goes to `fixLoop`, a gate failure goes to re-dispatch or an operator override. **Never send the
     fix loop after a gate failure** — it burns a cycle editing blind, then re-reviews unchanged code.
  4. **No `||` fallback reviewer.** An unmapped lens/intensity is a gate failure, not a default agent.
     A `||` fallback to a non-existent agent is how one phantom name silently disabled two
     `review-council` lenses (2026-08-03 agent-roster-drift AAR).
  5. **An unverified approval is not an approval** (R3, 2026-08-06). `verification_path` is a
     required `VERDICT_SCHEMA` field; an approving verdict without an established path is converted
     to `verdict_source: 'gate_integrity_failure'` with `gate_ran: false` — same handling as a
     conditional council verdict, and never a fix cycle. Any `self_reported_claims` entry downgrades
     an approval to an ordinary rejection instead, because the missing artifact is implementer work.
     Enforced in `reviewer-gate.js` (`applyEvidenceRules`) and in `execute-plan.js` /
     `execute-contract.js` (`enforceEvidenceRules`), at every point a verdict lands — including each
     fix-cycle re-review. See `validation/completion-criteria.md` § "The verification-path evidence
     rule".
  6. **The reviewer's test scope is not the diff** (AC-1/2/3, 2026-08-09). A `Measure` phase runs
     before `Review` and resolves test selection by changed *symbol*, not by changed file — so a test
     file that asserts the old behaviour but sits outside the diff is still in scope. The gate judges
     regressions by the base→head delta (a baseline-red file launders nothing), and rewrites any
     `ac_verdicts[]` entry `met: true` whose `supporting_tests` are all non-passing to `met: false`.
     Outcomes split like note 5's: an AC on a red test is an ordinary rejection
     (`ac-backed-by-red-test`); an absent/failed measurement or an approval over a measured regression
     is a `gate_integrity_failure`. Enforced in `reviewer-gate.js` (`applyTestStatusRules`) today;
     `execute-plan.js` / `execute-contract.js` are tracked for retrofit
     (`node_01KZP97XJKQJ3K7JRPPWXFDB1E`), so a plan/contract gate still scopes to `files_changed`
     until then. See `validation/completion-criteria.md` § "The validation-scope rule". When this doc
     and the script disagree, **the script wins** (this file has documented a `gate_lens` branch the
     script never had).
  - This buys **no wall-clock timeout** — `agent()` has no deadline and a script cannot impose one.
    What it buys against a *slow* reviewer is that the wait is observable and out-of-line (visible in
    `/workflows`, not blocking the main loop). Do not document it as a timeout.
- Gates **outside** `execute-plan` / `execute-contract` do not re-derive this: they invoke the
  `reviewer-gate` workflow (`.claude/workflows/reviewer-gate.js`), which owns the lens→reviewer map,
  the parallel lens fan-out, and the fail-loud conversion. It deliberately has **no** fix loop, so it
  composes with whichever budget the caller already owns.
- `reviewerType` is always an edit-less `agentType` (constraint 3). Never pass an inline prompt to a
  write-capable agent as a reviewer.
- `VERDICT_SCHEMA` forces structured output — the agent retries on mismatch at the tool layer. It
  carries `approved`, `reviewer_type`, `required_fixes`, `council_artifacts`, and **`defect_class`**
  (the stable class label the same-class stop rule reads — see the `fixLoop` notes).
- `fixPrompt` is an author-supplied helper (not a primitive) that builds the fix agent's prompt from
  `p` and `verdict.required_fixes`.
- **`reviewPrompt(p, taskOut)` is now a defined contract, not an open-ended author-supplied helper**
  (execution-doctrine.md rule 2, "Delta context, not the full stack"). It MUST assemble exactly: the
  failure summary (present only on a re-pass — omit it on the first pass), the touched files (from
  `taskOut[].files_affected`, never a full diff), and the AC actually in question for this phase. It
  MUST NOT include the full plan, the cumulative diff, or the progress file. If a reviewer needs more
  than that to judge one AC, the fix is to sharpen the AC (or the phase's `files_affected` scoping),
  not to widen what `reviewPrompt` assembles.

---

## Pattern: `fixLoop`

**When to use**: Inside `reviewerGate` when initial verdict is not approved. Runs the original
specialist to fix, re-runs the reviewer, repeats up to 2 cycles. Escalates if still failing.

```js
// fixLoop — fix → re-review, max 2 cycles, budget-guarded, same-class-stop-guarded.
// p: Phase.  taskOut: TaskResult[].  verdict: ReviewerVerdict.  reviewerType: agentType string.
async function fixLoop(p, taskOut, verdict, reviewerType) {
  let cycles = 0
  // execution-doctrine.md rule 1, same-class stop rule: the class the PREVIOUS round found.
  let priorDefectClass = verdict?.defect_class ?? null
  let sameClassRepeat = null

  while (!verdict?.approved && cycles < 2 && budget.remaining() > 60_000) {
    // Doctrine intent (execution-doctrine.md rule 3, "Continue; don't re-dispatch"): the fix agent
    // should resume the SAME session that implemented this phase — cache-warm, context-live —
    // instead of a fresh dispatch that re-ingests everything to relearn what that session already
    // knew. See the GAP note below: written as a fresh `agent()` call because no session-resume
    // primitive is confirmed to exist in this DSL today.
    await agent(fixPrompt(p, verdict.required_fixes), {
      phase: `Fix cycle ${cycles + 1}`,
      agentType: p.fix_agent || taskOut[0]?.assigned_to,
      model: p.model,
    })

    // Fresh context for the verifier is correct as-is (rule 3) — always a new `agent()` call, never
    // continued. See `adversarialVerify` below when a gate needs more than one fresh-context opinion.
    verdict = await agent(reviewPrompt(p, taskOut), {
      phase: 'Review',
      agentType: reviewerType,
      schema: VERDICT_SCHEMA,
    })

    cycles++

    // Same-class stop rule: two consecutive rounds naming the SAME defect class means the
    // shape is wrong. Exit to redesign rather than spend the remaining budget cycle
    // rediscovering the class one layer down. Absent defect_class never triggers it; two
    // rounds finding DIFFERENT classes is normal review progress.
    if (!verdict?.approved && verdict?.defect_class && priorDefectClass &&
        verdict.defect_class === priorDefectClass) {
      sameClassRepeat = verdict.defect_class
      log(`Same-class stop rule: '${sameClassRepeat}' twice on ${p.id} — design change, not another review.`)
      break
    }
    if (!verdict?.approved && verdict?.defect_class) priorDefectClass = verdict.defect_class
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict,
    fix_cycles: cycles,
    needs_redesign: sameClassRepeat ? { defect_class: sameClassRepeat, rounds: cycles } : null,
    escalate: !verdict?.approved,
  }
}
```

**Notes**:
- Hard cap: 2 cycles — this now **agrees** with execution-doctrine.md rule 1's gate budget ("2
  re-passes, then re-scope"); the prose cap and the runtime cap were already the same number, so the
  loop bound itself is unchanged. What changes is what happens once the cap is hit (see the
  escalation note below) and how each cycle is dispatched (see the next note).
- **The same-class stop rule can end the loop before the cap** (execution-doctrine.md rule 1). It only
  ever exits *earlier* — it never extends the loop. Requirements and boundaries:
  - The reviewer must set `defect_class` on a non-approving verdict (`VERDICT_SCHEMA`). It is a
    **stable class label** (`fail-open-default`, `unguarded-sibling-callsite`,
    `missing-ac-coverage`), not a restatement of the individual finding — class *identity* is what
    the rule tests, so a per-finding string defeats it.
  - An **absent** `defect_class` never triggers the rule. The loop does not guess at class identity.
  - Two rounds finding **different** classes is normal review progress, not a trigger.
  - On trigger, the return carries `needs_redesign: { defect_class, rounds }` and a blocker whose
    `resolution_hint` names the design change (`references/gate-risk-classes.md` §3b — make the
    unsafe state unrepresentable, or route callers through one choke point). Opus routes to redesign;
    it does **not** adjudicate another review pass.
  - After the redesign, re-entering the gate is a **new scope**, so the budget resets. That is not a
    loophole — the shape being reviewed genuinely changed.
- **Continue, don't re-dispatch — known gap, stated honestly.** The doctrine wants the fix agent to
  resume the session that implemented the phase, not be re-spawned. This file's real primitive set
  (`agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`, `workflow` — the
  anti-hallucination baseline at the top of this file) has **no confirmed session-resume/continuation
  call**. The `agent()` invocation in the loop above is therefore written as a fresh dispatch per
  cycle — that is the **honest fallback**, not the doctrine-preferred default, and this pattern
  should not be read as already implementing continuation. Where the surrounding harness *does*
  support it — e.g. a Tier 1 sprint's single `feature-sprint-executor` session under
  `dev-execution/SKILL.md`'s Mode C flow ("fixes in the SAME session (continue, don't re-dispatch) —
  cache-warm, context-live") — prefer that path over re-dispatching through this workflow-script
  pattern. Flag this as an open item for whoever owns the workflow DSL: a real continuation primitive
  would let this loop honor rule 3 as written.
- **Reserve fresh context for the verifier (rule 3).** The reviewer re-run is correctly always a new
  `agent()` call — that half of the pattern already matches doctrine. `adversarialVerify` (below) is
  the same fresh-context-skeptic shape generalized to N reviewers; reach for it when a gate needs more
  than one independent fresh-context opinion (e.g. a `security`-lens gate or an end-of-feature `karen`
  pass) instead of composing an ad hoc multi-reviewer loop here.
- **Escalation target changed.** After 2 failed cycles, `escalate: true` propagates to `waveFanout`,
  which now returns `{ status: 'needs_rescope', reason: 'gate_budget_exhausted' }` — **not**
  `needs_opus` / `reviewer_unresolved`. Per execution-doctrine.md rule 1, three failures against the
  same scope × lens is evidence the *scope* is wrong, not that the fix was sloppy; the escalation
  target is re-scope/redesign, not "a human/Opus looks at it." See the `waveFanout` notes above for
  the updated consumer.
- `budget.remaining() > 60_000` guard is mandatory (authoring-spec §10). Do not lower this threshold
  to shorten loops — it is a runaway guard, not a quality dial.
- `p.fix_agent` overrides which specialist runs the fix; falls back to the first task's `assigned_to`.

---

## Pattern: `councilEscalation`

**When to use**: Inside `reviewerGate` to select the correct reviewer `agentType`. Routine phases get
a single `task-completion-validator`; a phase whose risk class assigned a `security` lens, or that
carries `review_intensity: 'council'`, gets the full Agent Review Council run.

```js
// councilEscalation — reviewer agentType routing per authoring-spec §8.
// p: Phase.  tier: retained for signature compatibility; NEVER changes the default.
// Returns the agentType string to pass to agent().
function councilEscalation(p, _tier) {
  // gate_lens wins when the plan-optimizer assigned one. Security first — it is the
  // non-removable lens, so no later branch may displace it.
  const lenses = Array.isArray(p.gate_lens) ? p.gate_lens : []
  if (lenses.includes('security')) return 'council-review'
  if (lenses.includes('karen') || lenses.includes('karen-final-tree-only')) return 'karen'

  if (p.review_intensity === 'council') return 'council-review'
  if (p.review_intensity === 'tier3')   return 'karen'
  return 'task-completion-validator'
}
```

> **Reconciled to the live script, 2026-07-31 (gate-tiering v4.1).** This pattern had drifted from
> `MeatySkills/meaty-agentic-ops/workflows/execute-plan.js`, the code that actually executes, in two
> ways — and in both the doc was wrong:
>
> - The doc showed a `gate_lens` branch that **did not exist in the script**. `gate_lens` was written
>   by the plan-optimizer and read by nothing, so the "security is non-removable" invariant was
>   documentary only. The branch is now real (script + doc agree).
> - The doc showed `if (tier === 3) return 'karen'`. The script **deliberately removed** that rule,
>   because it fired on every tier-3 phase and silently overrode the per-phase default — making
>   `karen` (opus) the reviewer for every phase of a tier-3 plan regardless of intent. Tier does not
>   promote the reviewer. `review_intensity: 'tier3'` is the explicit opt-in, set only on milestone
>   phases.
>
> When these two disagree again, **the script is the truth** — check it before trusting this block.

**Notes**:
- `council-review` embeds the full ARC run (authoring-spec §9). The `verdict` returned by a
  `council-review` agent includes a `council_artifacts` object with paths to all six ARC artifacts
  (`run_dir`, `findings_yaml`, `scorecard_json`, `risk_register_yaml`, `decision_record_md`,
  `validation_plan_md`). Opus post-run reads these paths from the `ExecutionReport`.
- **`task-completion-validator` is the default, for every tier.** One lens is the norm; a phase gets
  more only because its risk class earned it (`references/gate-risk-classes.md` §2, step 2 — the
  surface parses untrusted input, is an authorization/identity boundary, or its effect is
  irreversible/outward-facing). **Tier does not promote the reviewer.**
- Trigger `council` — via `gate_lens: [security, …]` at plan-optimization time, or
  `review_intensity: 'council'` — for phases matching a step-2 trigger: auth/authz, identity,
  tokens/nonces, isolation, secrets, untrusted-input parsing, preview/writeback safety,
  durability/atomicity, or an outward-facing/irreversible effect (publish, deploy, send, migrate,
  rotate, delete).
- `karen` is the **one whole-tree reality-check per feature**, at end-of-feature
  (`karen-final-tree-only`); a plan-milestone-boundary pass is reserved for `context_class` C3/C4.
  Set it explicitly via `gate_lens` or `review_intensity: 'tier3'` — never inferred from tier.
  Karen does not fan out to other reviewers (see its agent definition).
- **Selection order is `gate_lens` first, then `review_intensity`.** A phase carrying
  `gate_lens: [security, …]` gets the security-capable reviewer regardless of tier — that is what
  makes the plan-optimizer's non-removable-lens invariant real rather than advisory. Gate *budgets*
  cap how many times a lens re-runs; they never remove a lens
  (`references/execution-doctrine.md` § Frequency, composition, not existence).

---

## Pattern: `exploreLegs`

**When to use**: Parallel investigation (`/plan:explore`, `/plan:spike`). Fan out N independent
research legs concurrently, then deep-read through a `pipeline`, then synthesize with an adversarial
cross-check. Verdict sign-off is returned to Opus (workflow boundary — constraint 2).

```js
// exploreLegs — parallel legs → pipeline deep-read → synthesis with adversarial cross-check.
// legs: array of investigation prompts/specs.  synthesisPrompt: string.

const legResults = await parallel(legs.map((leg, i) => () =>
  agent(leg.prompt, {
    label: `leg-${i}`,
    phase: 'Exploration',
    agentType: leg.agentType || 'codebase-explorer',
    model: leg.model || 'haiku',
  })
))

// pipeline: each result goes through deep-read independently (no inter-item barrier).
const deepResults = await pipeline(
  legResults.filter(Boolean),
  async (result) => agent(`Deep-read and extract structured findings:\n${result}`, {
    phase: 'Deep read',
    agentType: 'codebase-explorer',
    model: 'sonnet',
  })
)

// Adversarial cross-check (see adversarialVerify pattern).
const verified = await adversarialVerify(deepResults.filter(Boolean), { skeptics: 2 })

// Synthesis — verdict sign-off left to Opus; workflow returns findings, not a decision.
const synthesis = await agent(synthesisPrompt(verified), {
  phase: 'Synthesis',
  agentType: 'implementation-planner',
  model: 'sonnet',
  schema: EXPLORATION_RESULT_SCHEMA,
})

return { status: 'complete', findings: verified, synthesis }
// NB: synthesis.verdict is reviewed by Opus + human — not gated inside this workflow.
```

**Notes**:
- Use `parallel` for legs (all results needed before deep-read begins — barrier justified).
- Use `pipeline` for deep-read (items are independent; maximum throughput; stragglers don't block).
- Exploration legs use `agentType: 'codebase-explorer'` (read-only by agent definition — constraint 3).
- The verdict sign-off is a workflow boundary per constraint 2: the workflow returns the synthesis;
  Opus and the human decide whether to proceed. Do not add a gate inside this workflow.

---

## Pattern: `adversarialVerify`

**When to use**: After a set of findings has been produced (by explore legs, a code review sweep, or
a council run), spawn N independent skeptic agents to challenge each finding. A finding majority-refuted
by skeptics is dropped. Increases confidence in survivors. **Also the right shape for gate
verification** (execution-doctrine.md rule 3 — fresh context belongs on the verifier, cross-linked
from the `fixLoop` notes above): when a gate needs more than one independent fresh-context opinion —
a `security`-lens gate, an end-of-feature `karen` pass — compose `reviewerGate`/`fixLoop` with this
pattern instead of writing an ad hoc multi-reviewer loop.

```js
// adversarialVerify — N skeptics per finding; majority-refute kills it.
// findings: string[] or object[].  opts.skeptics: number of skeptic agents per finding (default 2).
async function adversarialVerify(findings, opts = {}) {
  const skepticCount = opts.skeptics ?? 2

  const verified = await parallel(findings.map((finding, i) => async () => {
    const votes = await parallel(
      Array.from({ length: skepticCount }, (_, j) => () =>
        agent(
          `Skeptic review. Challenge this finding and return { refuted: boolean, reason: string }.\nFinding:\n${JSON.stringify(finding)}`,
          {
            label: `skeptic-${i}-${j}`,
            phase: 'Adversarial verify',
            agentType: 'senior-code-reviewer',
            model: 'sonnet',
            schema: { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } }, required: ['refuted', 'reason'] },
          }
        )
      )
    )

    const refuteCount = votes.filter(Boolean).filter(v => v.refuted).length
    const majorityRefuted = refuteCount > skepticCount / 2
    return majorityRefuted ? null : finding
  }))

  return verified.filter(Boolean)
}
```

**Notes**:
- Skeptic agents use `agentType: 'senior-code-reviewer'` (edit-less by definition — constraint 3).
- `majority-refute` threshold: more than half of skeptics must mark `refuted: true` to kill a finding.
  Adjust `opts.skeptics` for higher-stakes reviews (3–5 for core-path security findings).
- `null` results from a throwing skeptic agent are tolerated (`.filter(Boolean)` discards them);
  the finding survives if no clear majority emerges.

---

## Pattern: `judgePanel`

**When to use**: Multiple agents attempt the same task from different angles (e.g., different model
prompts, different code strategies); a panel of judges scores each attempt; the highest-scoring result
is returned. Use when correctness is hard to verify structurally and diversity of approach matters.

```js
// judgePanel — N attempts, parallel judges score each, synthesize winner.
// attemptPrompts: string[].  judgeCount: number of judges per attempt.
async function judgePanel(attemptPrompts, judgeCount = 2) {
  // Parallel attempts from different angles.
  const attempts = await parallel(attemptPrompts.map((prompt, i) => () =>
    agent(prompt, {
      label: `attempt-${i}`,
      phase: 'Attempts',
      agentType: 'python-backend-engineer',
      model: 'sonnet',
    })
  ))

  const scoredAttempts = await parallel(
    attempts.filter(Boolean).map((attempt, i) => async () => {
      const scores = await parallel(
        Array.from({ length: judgeCount }, (_, j) => () =>
          agent(
            `Score this attempt 0–10 and return { score: number, rationale: string }.\nAttempt:\n${attempt}`,
            {
              label: `judge-${i}-${j}`,
              phase: 'Judging',
              agentType: 'senior-code-reviewer',
              schema: { type: 'object', properties: { score: { type: 'number' }, rationale: { type: 'string' } }, required: ['score', 'rationale'] },
            }
          )
        )
      )
      const validScores = scores.filter(Boolean)
      const avgScore = validScores.length
        ? validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length
        : 0
      return { attempt, avgScore, rationale: validScores.map(s => s.rationale) }
    })
  )

  const ranked = scoredAttempts.filter(Boolean).sort((a, b) => b.avgScore - a.avgScore)
  return ranked[0] ?? null
}
```

**Notes**:
- Judge agents use `agentType: 'senior-code-reviewer'` (edit-less — constraint 3).
- The `agentType` for attempts should match the domain (use `ui-engineer-enhanced` for frontend
  attempts, `data-layer-expert` for schema attempts, etc.).
- `judgePanel` is expensive: N attempts × M judges agents. Reserve for decisions where multiple
  correct approaches exist and the cost of a wrong pick is high.

---

## Pattern: `loopUntilDry`

**When to use**: Keep spawning finder agents until K consecutive rounds return no new items (the
source is "dry"). Deduplicates against a `seen` set. Use for audit sweeps, bug-finder passes, or
any task where the full item count is unknown in advance.

```js
// loopUntilDry — spawn finders until K consecutive empty rounds; dedup via seen set.
// finderPrompt: (seen: Set) => string.  K: consecutive-empty threshold (default 2).
async function loopUntilDry(finderPrompt, K = 2, THRESHOLD = 80_000) {
  const seen = new Set()
  let emptyRounds = 0

  while (emptyRounds < K && budget.remaining() > THRESHOLD) {
    const result = await agent(finderPrompt(seen), {
      phase: 'Finding',
      agentType: 'codebase-explorer',
      model: 'haiku',
      schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
    })

    const newItems = (result?.items ?? []).filter(item => !seen.has(item))

    if (newItems.length === 0) {
      emptyRounds++
    } else {
      emptyRounds = 0
      newItems.forEach(item => seen.add(item))
    }
  }

  return Array.from(seen)
}
```

**Notes**:
- Budget guard `budget.remaining() > THRESHOLD` is mandatory (authoring-spec §10). Default threshold
  `80_000` is higher than the fix-loop's `60_000` because finder loops can spiral faster.
- `K = 2` means two consecutive rounds with zero new items. Tune upward for sparse corpora.
- `seen` serialization: pass `Array.from(seen)` into the prompt string (finder agents cannot read
  the `seen` Set directly — they receive it via the prompt text).
- Use `agentType: 'codebase-explorer'` (read-only) for finding; never a write-capable agent.

---

## Pattern: `completenessCritic`

**When to use**: After a primary deliverable is produced, spawn a final critic agent that asks "what
is missing?" Its output seeds one more round. Use as a quality-completeness step at the end of
complex research or implementation phases.

```js
// completenessCritic — critic identifies gaps; its output seeds one more improvement round.
// deliverable: string (the primary output to critique).
// improvementAgentType: agentType string for the agent that fills the gaps.
async function completenessCritic(deliverable, improvementAgentType, opts = {}) {
  if (budget.remaining() < (opts.threshold ?? 80_000)) {
    log('Skipping completenessCritic — budget insufficient for an extra round.')
    return deliverable
  }

  const critique = await agent(
    `Review the following deliverable and identify what is missing, incomplete, or under-specified.
Return { gaps: string[], severity: 'minor' | 'major' }.
Deliverable:
${deliverable}`,
    {
      phase: 'Completeness critique',
      agentType: 'senior-code-reviewer',
      model: 'sonnet',
      schema: {
        type: 'object',
        properties: {
          gaps: { type: 'array', items: { type: 'string' } },
          severity: { type: 'string', enum: ['minor', 'major'] },
        },
        required: ['gaps', 'severity'],
      },
    }
  )

  if (!critique?.gaps?.length) return deliverable

  const improved = await agent(
    `Fill the following gaps in the deliverable.
Gaps: ${JSON.stringify(critique.gaps)}
Original deliverable:
${deliverable}`,
    {
      phase: 'Gap filling',
      agentType: improvementAgentType,
      model: 'sonnet',
    }
  )

  return improved ?? deliverable
}
```

**Notes**:
- Budget guard is mandatory. One critic + one improvement round = two extra agents; skip if budget
  is near the floor.
- Critic uses `agentType: 'senior-code-reviewer'` (edit-less); gap-filler uses the domain agent.
- `completenessCritic` runs once. For iterative gap-filling, compose with `loopUntilDry` where
  `finderPrompt` incorporates the previous critique.

---

## Pattern: `modeBoundary`

**When to use**: At the top of each wave (or phase) processing loop. Detects Mode D conditions —
phases whose `mode === 'D'` field, or whose `files_affected` touches auth/payments/migrations/deletion
paths — and returns early to Opus before spawning any agents. This is mandatory per constraint 2
(no mid-run sign-off).

```js
// modeBoundary — detect high-risk phase, stop workflow, hand back to Opus.
// wave: Wave from execution graph.  report: accumulated WaveResult[] so far.
function modeBoundary(wave, report) {
  // Explicit Mode D flag.
  const modeD = wave.phases.find(p => p.mode === 'D')
  if (modeD) {
    return { status: 'blocked', reason: 'mode_d', blocked_phase: modeD.id, report }
  }

  // Implicit Mode D: files_affected heuristic for high-risk paths.
  // Must cover the FULL canonical Mode-D list (auth · payments/billing · schema migrations ·
  // data deletion · secret rotation · infrastructure) — see
  // `references/execution-doctrine.md`. The infra patterns were missing until 2026-07-30,
  // so an infrastructure-only phase could proceed without an explicit `mode: D`.
  const HIGH_RISK_PATTERNS = [
    /auth/i, /payment/i, /billing/i, /migration/i, /alembic/i,
    /delete/i, /drop_table/i, /secret/i, /token/i,
    /dockerfile/i, /docker-compose/i, /\.github\/workflows\//i, /terraform/i,
    /\.tf$/i, /ansible/i, /helm/i, /k8s|kubernetes/i, /systemd|\.service$/i,
    /bootstrap.*\.sh$/i, /deploy/i, /infra/i,
  ]
  const riskyPhase = wave.phases.find(p =>
    (p.files_affected ?? []).some(f =>
      HIGH_RISK_PATTERNS.some(pat => pat.test(f))
    )
  )
  if (riskyPhase) {
    return {
      status: 'needs_opus',
      reason: 'mode_d',
      blocked_phase: riskyPhase.id,
      report,
    }
  }

  return null  // null = no boundary hit; continue execution.
}

// Usage inside waveFanout:
for (const wave of waves) {
  const boundary = modeBoundary(wave, report)
  if (boundary) return boundary

  // ... rest of wave execution
}
```

**Notes**:
- `return null` signals "no boundary"; the caller continues. Any non-null return is an early exit.
- The heuristic `HIGH_RISK_PATTERNS` is a safety net for execution graphs where Opus forgot to
  annotate `mode: 'D'`. It fires `needs_opus` (not `blocked`) so Opus can inspect and decide.
- Per authoring-spec §5 constraint 2: Mode D phases are never executed inside the workflow. The
  script returns; Opus runs the phase interactively, then relaunches with a trimmed `args.waves`.

---

## Pattern: `trackerStep`

**When to use**: After each phase completes, to record progress in the progress YAML. The workflow
script cannot run shell commands (constraint 1), so progress updates are delegated to an
`artifact-tracker` agent that executes `update-batch.py` on behalf of the workflow.

```js
// trackerStep — invoke update-batch.py via artifact-tracker agent (no FS in script).
// progressFile: resolved path to the per-phase progress YAML, passed explicitly by Opus
//   pre-flight via args.progressFile — progress dirs may carry version suffixes and are
//   per-phase, so the caller passes the resolved path; never derive it from plan_ref.
// completedTaskIds: string[] of completed task IDs (e.g. ['TASK-1.1', 'TASK-1.2']).
async function trackerStep(progressFile, completedTaskIds) {
  const updateArg = completedTaskIds.map(id => `${id}:completed`).join(',')

  await agent(
    `Run the following command and return the exit code:
python .claude/skills/artifact-tracking/scripts/update-batch.py \\
  -f ${progressFile} \\
  --updates "${updateArg}"

Do NOT git add/commit/push/stash.`,
    {
      phase: 'Progress update',
      agentType: 'artifact-tracker',
      model: 'haiku',
    }
  )
}

// Usage inside waveFanout phase body, after taskOut is populated:
// args.progressFile is set by Opus pre-flight for the current phase.
await trackerStep(args.progressFile, taskOut.map(t => t.id))
```

**Notes**:
- `agentType: 'artifact-tracker'` is a Bash-capable agent. It runs `update-batch.py` but has no
  edit tools for source files. It must be explicitly told "Do NOT git add/commit/push/stash."
- One `trackerStep` call per phase, not per task. Batch the IDs into one `update-batch.py` invocation.
- `args.progressFile` is the resolved progress-file path Opus passes in the execution graph
  pre-flight. Progress files live at `.claude/progress/<plan-slug>/phase-N-progress.md`; plan
  dirs may carry version suffixes (`-v1`, `-v2`), so Opus resolves the path before launch.
- The CLI script auto-calculates phase completion when all tasks are marked `completed`
  (authoring-spec cross-ref: CLAUDE.md §"CLI-First Updates").

---

## Composing Patterns into `execute-plan`

The §3.3 skeleton in `workflow-orchestration-integration-v1.md` uses these patterns as follows:

```
waveFanout
  └─ per wave:
       modeBoundary              (gate before any agents spawn)
       └─ per phase (parallel):
            [serial batches]     (file-ownership via for loop + parallel within batch)
            reviewerGate         (selects reviewer via councilEscalation)
              └─ fixLoop         (on rejection; needs_rescope after 2 cycles, not needs_opus)
            trackerStep          (post-phase progress YAML update)
```

For `explore`/`spike` workflows:

```
exploreLegs
  ├─ parallel legs              (codebase-explorer agents)
  ├─ pipeline deep-read         (no inter-item barrier)
  ├─ adversarialVerify          (N skeptics per finding)
  └─ completenessCritic         (one gap-fill round)
```

For high-quality decisions with multiple viable approaches:

```
judgePanel                      (N attempts + M judges)
  └─ winner passed to reviewerGate
```

---

## Quick Reference

| Pattern | Primitive used | Key constraint |
|---|---|---|
| `waveFanout` | `for`, `parallel` | `modeBoundary` before every wave |
| `reviewerGate` | `agent` | Always edit-less `agentType`; always `schema:`; null verdict ⇒ `gate_failure`, never the fix loop |
| `fixLoop` | `while` | Cap 2 cycles → `needs_rescope`; `budget.remaining() > 60_000`; fresh `agent()` per cycle is a known continuation gap |
| `councilEscalation` | — (pure routing) | `council` → ARC artifacts in verdict |
| `exploreLegs` | `parallel`, `pipeline` | Verdict boundary stays with Opus |
| `adversarialVerify` | `parallel` | Majority-refute drops finding |
| `judgePanel` | `parallel` | Edit-less judge `agentType` |
| `loopUntilDry` | `while` | `budget.remaining() > THRESHOLD` guard |
| `completenessCritic` | `agent` | Budget guard; single extra round only |
| `modeBoundary` | early `return` | Mode D never executed inside workflow |
| `trackerStep` | `agent` | One call per phase; `haiku` model |
