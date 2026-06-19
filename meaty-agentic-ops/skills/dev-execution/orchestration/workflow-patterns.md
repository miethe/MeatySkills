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

  // Escalate if any phase's fix-loop exhausted without approval.
  if (waveResults.some(r => r?.escalate)) {
    return { status: 'needs_opus', reason: 'reviewer_unresolved', report }
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

  if (!verdict?.approved) {
    return fixLoop(p, taskOut, verdict, reviewerType)
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict,
    fix_cycles: 0,
    escalate: false,
  }
}
```

**Notes**:
- `reviewerType` is always an edit-less `agentType` (constraint 3). Never pass an inline prompt to a
  write-capable agent as a reviewer.
- `VERDICT_SCHEMA` forces structured output — the agent retries on mismatch at the tool layer.
- `reviewPrompt` and `fixPrompt` are author-supplied helpers that build the agent prompt string from
  the phase and task results. They are not primitives.

---

## Pattern: `fixLoop`

**When to use**: Inside `reviewerGate` when initial verdict is not approved. Runs the original
specialist to fix, re-runs the reviewer, repeats up to 2 cycles. Escalates if still failing.

```js
// fixLoop — fix → re-review, max 2 cycles, budget-guarded.
// p: Phase.  taskOut: TaskResult[].  verdict: ReviewerVerdict.  reviewerType: agentType string.
async function fixLoop(p, taskOut, verdict, reviewerType) {
  let cycles = 0

  while (!verdict?.approved && cycles < 2 && budget.remaining() > 60_000) {
    await agent(fixPrompt(p, verdict.required_fixes), {
      phase: `Fix cycle ${cycles + 1}`,
      agentType: p.fix_agent || taskOut[0]?.assigned_to,
      model: p.model,
    })

    verdict = await agent(reviewPrompt(p, taskOut), {
      phase: 'Review',
      agentType: reviewerType,
      schema: VERDICT_SCHEMA,
    })

    cycles++
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict,
    fix_cycles: cycles,
    escalate: !verdict?.approved,
  }
}
```

**Notes**:
- Hard cap: 2 cycles. After 2 failed cycles, `escalate: true` propagates to `waveFanout`, which
  returns `{ status: 'needs_opus', reason: 'reviewer_unresolved' }`.
- `budget.remaining() > 60_000` guard is mandatory (authoring-spec §10). Do not lower this threshold
  to shorten loops — it is a runaway guard, not a quality dial.
- `p.fix_agent` overrides which specialist runs the fix; falls back to the first task's `assigned_to`.

---

## Pattern: `councilEscalation`

**When to use**: Inside `reviewerGate` to select the correct reviewer `agentType`. Routine phases get
a single `task-completion-validator`; core-path phases with `review_intensity: 'council'` get the
full Agent Review Council run.

```js
// councilEscalation — reviewer agentType routing per authoring-spec §8.
// p: Phase.  tier: 1|2|3.
// Returns the agentType string to pass to agent().
function councilEscalation(p, tier) {
  if (p.review_intensity === 'council') return 'council-review'
  if (tier === 3)                        return 'karen'
  return 'task-completion-validator'
}
```

**Notes**:
- `council-review` embeds the full ARC run (authoring-spec §9). The `verdict` returned by a
  `council-review` agent includes a `council_artifacts` object with paths to all six ARC artifacts
  (`run_dir`, `findings_yaml`, `scorecard_json`, `risk_register_yaml`, `decision_record_md`,
  `validation_plan_md`). Opus post-run reads these paths from the `ExecutionReport`.
- Trigger `council` for phases touching auth/payments/data-deletion, architecture-changing phases
  (new routers, schema migrations), or any phase where `tier === 3` and `mode === 'C'` and
  `files_affected` includes API contracts.
- `karen` is the adversarial reviewer for Tier 3 and core-path phases; `task-completion-validator`
  is the default for Tier 2 standard phases.

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
by skeptics is dropped. Increases confidence in survivors.

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
  const HIGH_RISK_PATTERNS = [
    /auth/i, /payment/i, /billing/i, /migration/i, /alembic/i,
    /delete/i, /drop_table/i, /secret/i, /token/i,
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
              └─ fixLoop         (on rejection; escalates after 2 cycles)
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
| `reviewerGate` | `agent` | Always edit-less `agentType` |
| `fixLoop` | `while` | Cap 2 cycles; `budget.remaining() > 60_000` |
| `councilEscalation` | — (pure routing) | `council` → ARC artifacts in verdict |
| `exploreLegs` | `parallel`, `pipeline` | Verdict boundary stays with Opus |
| `adversarialVerify` | `parallel` | Majority-refute drops finding |
| `judgePanel` | `parallel` | Edit-less judge `agentType` |
| `loopUntilDry` | `while` | `budget.remaining() > THRESHOLD` guard |
| `completenessCritic` | `agent` | Budget guard; single extra round only |
| `modeBoundary` | early `return` | Mode D never executed inside workflow |
| `trackerStep` | `agent` | One call per phase; `haiku` model |
