/**
 * reviewer-gate — the mandatory reviewer gate, as a schema'd workflow stage.
 *
 * Spec:      .claude/specs/workflows/workflow-authoring-spec.md (master contract)
 * Patterns:  .claude/skills/dev-execution/orchestration/workflow-patterns.md (`reviewerGate`)
 * Ruleset:   .claude/skills/dev-execution/references/gate-risk-classes.md §2 (lens selection)
 * Matrix:    .claude/skills/dev-execution/validation/completion-criteria.md
 *
 * WHY THIS EXISTS
 * ---------------
 * `execute-plan` and `execute-contract` already run their reviewer as a schema'd stage. Every
 * OTHER gate in the engine did not: the Tier-0, scaffold, plan-level and ad-hoc/milestone gates
 * were documented as a bare in-session `Task("task-completion-validator", "...")` returning the
 * free text `APPROVED` / `CHANGES_REQUESTED`. That form has three failure modes, and all three
 * were observed on live runs:
 *
 *   1. **The orchestrator blocks in-line.** A bare Agent call is awaited by the main loop. A
 *      reviewer that goes slow or silent stalls the whole session, and there is nothing to read
 *      while it does — the run looks identical to a run that is thinking.
 *   2. **The verdict is unparsed prose.** Nothing forces the reviewer to emit a decision at all.
 *      It can ramble, run out of turns, or end mid-thought, and the orchestrator is left
 *      inferring approval from vibes.
 *   3. **A dead reviewer looks like a quiet one.** No verdict and a rejected verdict are the
 *      same observable (nothing useful came back), so a gate that never ran can be mistaken for
 *      a gate that passed.
 *
 * This workflow fixes all three by construction. What it does NOT do — stated plainly so nobody
 * builds on a promise that isn't here: **there is no wall-clock timeout.** `agent()` exposes no
 * deadline, and a workflow script cannot impose one. The fix is not "the reviewer is killed after
 * N seconds"; it is:
 *
 *   - **The verdict is a validated tool call.** `schema: VERDICT_SCHEMA` forces a StructuredOutput
 *     call and the tool layer makes the agent retry on mismatch. A reviewer cannot finish without
 *     emitting a decision, so "slow" is the only failure left — "ambiguous" is gone.
 *   - **A silent reviewer becomes a recorded failure, not an empty pass.** `agent()` returns null
 *     when the subagent dies on a terminal error after retries. Null is converted into an explicit
 *     `verdict_source: 'gate_failure'` verdict with `approved: false` and a named reason, and it is
 *     `log()`-ed. A gate that could not run NEVER reads as approved, and it never reads as an
 *     ordinary rejection either — the two are distinguishable fields.
 *   - **The wait is observable and out-of-line.** Workflows run in the background: a stalled lens
 *     sits visibly in `/workflows` progress under a named phase instead of freezing the main loop,
 *     and the orchestrator keeps its context.
 *   - **No silent lens fallback.** An unrecognized lens name is a gate failure, not a `||` default.
 *     A `||` fallback to an agent that did not exist is exactly how a "5-lens" council silently
 *     reviewed 4 (2026-08-03 agent-roster-drift AAR).
 *
 * CONSUMPTION
 * -----------
 *   Standalone (the common case — any gate outside execute-plan/execute-contract):
 *     Workflow({ name: 'reviewer-gate', args: { scope: {...}, lenses: ['validator'], ... } })
 *
 *   As a sub-workflow: permitted, but only from a TOP-LEVEL workflow (nesting is one level only).
 *   `execute-plan`/`execute-contract` keep their own inline reviewer stages — they already satisfy
 *   this contract and already nest `review-council`; re-routing them through here would consume
 *   their one nesting level. This script therefore never calls `workflow()` itself.
 *
 * Four-constraints checklist:
 *   [x] No FS/shell access in script body
 *   [x] Mode D — n/a: this workflow spawns only edit-less reviewers and mutates nothing
 *   [x] All reviewer agents use edit-less agentType (LENS_REVIEWER_MAP, all in .claude/agents/)
 *   [x] No Date.now() / Math.random() / new Date() in script body (timestamps come from args)
 *   [x] meta is a pure literal object
 *   [x] phase() titles match meta.phases exactly
 *   [x] No implementation agents dispatched → no durability/commit instruction needed
 */

// ─── meta (pure literal — no computed values, no function calls) ──────────────

export const meta = {
  name: 'reviewer-gate',
  description: 'The mandatory reviewer gate as a schema\'d workflow stage: runs one or two edit-less reviewer lenses in parallel, forces each verdict through a validated StructuredOutput call, and converts a silent or dead reviewer into an explicit recorded gate failure instead of an in-line hang. Use for any gate outside execute-plan/execute-contract — Tier 0, scaffold, plan-level, milestone, or ad-hoc re-pass.',
  phases: [
    { title: 'Review' },
  ],
  whenToUse: 'Any mandatory reviewer gate that is not already inside execute-plan or execute-contract: /dev:quick-feature Tier 0 close, /dev:create-feature scaffold close, the plan-level whole-tree pass, a milestone gate, or a fresh-context re-pass on a delta. Pass lenses chosen by gate-risk-classes.md §2 — one lens by default, a second only with a named trigger.',
}

// ─── inline schemas (script cannot read files — constraint 1) ─────────────────

// The verdict every lens must emit. Deliberately compatible with execute-plan.js /
// execute-contract.js VERDICT_SCHEMA so a verdict is portable across all three gates:
// same `approved` / `reviewer_type` / `required_fixes` / `defect_class` semantics.
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['approved', 'reviewer_type', 'summary'],
  additionalProperties: false,
  properties: {
    approved: { type: 'boolean' },
    reviewer_type: {
      type: 'string',
      enum: [
        'task-completion-validator',
        'karen',
        'senior-code-reviewer',
        'code-reviewer',
      ],
    },
    // One-line statement of what was judged and how it came out. Required so an approving
    // verdict still carries evidence of having looked at something.
    summary: { type: 'string' },
    required_fixes: { type: 'array', items: { type: 'string' } },
    // The stable class label the same-class stop rule reads (execution-doctrine.md rule 1 /
    // gate-risk-classes.md §3b). Omit rather than guess — an absent class never trips the rule.
    defect_class: { type: 'string' },
    // Acceptance criteria the reviewer actually checked, and its per-AC call. An approving
    // verdict with an empty list is the shape a rubber-stamp takes, and is visible here.
    ac_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'met'],
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
    // Set when the reviewer could not judge an AC at all (missing evidence, unreadable
    // surface). Distinct from `required_fixes`: this is "I could not tell", not "this is wrong".
    unverifiable: { type: 'array', items: { type: 'string' } },
  },
}

// ─── lens → reviewer routing (no silent fallback) ─────────────────────────────
//
// Every value MUST be an edit-less agent present in .claude/agents/ (constraint 3);
// tests/test_workflow_agent_roster.py fails the build on a phantom name.
// `karen-final-tree-only` is a PLACEMENT of the karen lens (one whole-tree pass per feature),
// not a different reviewer — gate-risk-classes.md § "Karen placement".

const LENS_REVIEWER_MAP = {
  validator: 'task-completion-validator',
  security: 'senior-code-reviewer',
  karen: 'karen',
  'karen-final-tree-only': 'karen',
}

const LENS_BRIEF = {
  validator:
    'AC-mapping lens. For each acceptance criterion, decide met / not-met and name the concrete evidence (a real command transcript, a file:line, a test name). A green suite is NOT evidence on its own — it can sit over a defect on a path nobody tested. Never accept a fabricated or absent transcript; if evidence is missing, list the criterion under `unverifiable` rather than marking it met.',
  security:
    'Adversarial defect-finding lens. Trace the code, do not read the claims. Hunt fail-open defaults (check the PRODUCER of a value, not just the field), the soft delegate/caller/sibling of anything just hardened, and tests that pin unsafe behaviour. You are not doing AC bookkeeping — that is the validator lens.',
  karen:
    'Whole-tree reality-check lens. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
  'karen-final-tree-only':
    'Whole-tree reality-check lens, scoped to the final assembled tree. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
}

// ─── helpers (pure functions — no primitives called here) ─────────────────────

function asList(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(v => v != null && v !== '') : [value]
}

function bullets(items, emptyText) {
  const list = asList(items)
  if (!list.length) return `  (${emptyText})`
  return list.map(item => `  - ${item}`).join('\n')
}

/**
 * Reviewer prompt. Carries the DELTA only, per execution-doctrine.md rule 2:
 * the failure summary (re-pass only), the touched files, and the ACs in question.
 * Never the full plan, never the cumulative diff, never the progress file.
 */
function reviewPrompt(args, lens, reviewerType) {
  const scope = args.scope || {}
  const isRepass = Boolean(args.failure_summary)

  return `${LENS_BRIEF[lens]}

You are the **${lens}** lens on the mandatory reviewer gate for: ${scope.title || scope.id || 'the change under review'}
Scope kind: ${scope.kind || 'change'}${scope.tier != null ? ` (tier ${scope.tier})` : ''}${scope.id ? `\nScope id: ${scope.id}` : ''}${args.plan_ref ? `\nPlan/contract ref: ${args.plan_ref}` : ''}${args.timestamp ? `\nGate timestamp: ${args.timestamp}` : ''}
${isRepass ? `\nThis is a RE-PASS. What the previous round rejected:\n${args.failure_summary}\n` : ''}
Acceptance criteria in question:
${bullets(args.acceptance_criteria, 'none supplied — say so in `unverifiable` rather than inventing criteria')}

Files changed (this is the scope of your review — do not widen it):
${bullets(args.files_changed, 'none supplied')}
${asList(args.evidence_refs).length ? `\nEvidence the implementer offered (verify it, do not trust it):\n${bullets(args.evidence_refs, '')}\n` : ''}${args.notes ? `\nOperator notes:\n${args.notes}\n` : ''}
Read the code and the evidence. Run read-only commands where they settle a question.

You MUST end by calling StructuredOutput exactly once with your verdict:
  - approved: true only if every acceptance criterion above is met AND you found no blocking defect.
  - reviewer_type: "${reviewerType}".
  - summary: one line — what you judged and how it came out.
  - required_fixes: one entry per blocking item, each specific enough to act on without you.
  - defect_class: a short stable label for the dominant defect class when rejecting (e.g.
    "fail-open-default", "untested-path", "missing-ac-evidence"). Omit it rather than guessing —
    a wrong label mis-fires the same-class stop rule.
  - ac_verdicts: one entry per acceptance criterion, with the evidence you actually saw.
  - unverifiable: criteria you could not judge, and why.

Do NOT write, edit, or commit anything — you are an edit-less reviewer. Do NOT dispatch other
agents. Do NOT report approval you cannot evidence: withholding approval is cheap, and a
rubber-stamp is the one outcome this gate cannot recover from.`
}

/** The verdict synthesized when a lens produced nothing. Never mistakable for a real one. */
function gateFailureVerdict(lens, reviewerType, reason) {
  return {
    approved: false,
    reviewer_type: reviewerType,
    verdict_source: 'gate_failure',
    lens,
    gate_failure_reason: reason,
    summary: `Gate FAILED TO RUN on the ${lens} lens (${reviewerType}): ${reason}`,
    required_fixes: [
      `The ${lens} lens produced no verdict (${reason}). This is NOT an approval and NOT an ordinary rejection — the gate did not run. Re-dispatch this lens, or record an explicit operator override, before treating the scope as reviewed.`,
    ],
  }
}

// ─── stage: one lens, schema'd, fail-loud ─────────────────────────────────────

async function runLens(args, lens) {
  const reviewerType = LENS_REVIEWER_MAP[lens]

  // No silent fallback: an unknown lens is a failure, not a default reviewer. A `||` default
  // is how a lens silently disappears from a gate that still reports its full lens count.
  if (!reviewerType) {
    const known = Object.keys(LENS_REVIEWER_MAP).join(', ')
    log(`GATE FAILURE: unknown lens '${lens}' — no reviewer mapping. Known lenses: ${known}. Not falling back to a default reviewer.`)
    return gateFailureVerdict(lens, 'task-completion-validator', `unknown lens '${lens}' (known: ${known})`)
  }

  let verdict = null
  try {
    verdict = await agent(reviewPrompt(args, lens, reviewerType), {
      phase: 'Review',
      label: `gate:${lens}`,
      agentType: reviewerType,
      schema: VERDICT_SCHEMA,
    })
  } catch (err) {
    const reason = `reviewer threw: ${err && err.message ? err.message : err}`
    log(`GATE FAILURE: ${lens} lens (${reviewerType}) threw — ${reason}. Recording as a gate failure, NOT as a rejection.`)
    return gateFailureVerdict(lens, reviewerType, reason)
  }

  // null ⇒ the subagent died on a terminal error after retries, or the user skipped it.
  // Either way no decision exists. Do not let it read as an empty rejection.
  if (!verdict) {
    log(`GATE FAILURE: ${lens} lens (${reviewerType}) returned no verdict (agent died after retries, or was skipped). Recording as a gate failure, NOT as an approval or a rejection.`)
    return gateFailureVerdict(lens, reviewerType, 'reviewer returned no structured verdict (died after retries, or skipped)')
  }

  return { ...verdict, verdict_source: 'reviewer', lens }
}

// ─── script body ──────────────────────────────────────────────────────────────

phase('Review')

const gateArgs = args || {}
const lenses = asList(gateArgs.lenses)

// Arg validation is itself a loud failure. A gate invoked with no lenses must not return a
// cheerful empty pass — that is the exact shape of "the gate never ran but nothing said so".
if (!lenses.length) {
  log('GATE FAILURE: reviewer-gate invoked with no `lenses`. Refusing to return an approval. Pass lenses per gate-risk-classes.md §2 — one lens by default, a second only with a named trigger.')
  return {
    approved: false,
    gate_ran: false,
    scope: gateArgs.scope || null,
    verdicts: [],
    gate_failures: [
      {
        lens: null,
        reviewer_type: null,
        reason: 'no lenses supplied — reviewer-gate cannot approve a scope it was given no lens to review',
      },
    ],
    blocking_fixes: [
      'Re-invoke reviewer-gate with an explicit `lenses` array (see gate-risk-classes.md §2 step 1/2).',
    ],
    summary: 'Gate did not run: no lenses supplied.',
  }
}

// A two-lens gate must name its trigger (gate-risk-classes.md §2 step 2). Advisory here — the
// classification lives in the plan, not in this script — but recorded so an unjustified second
// lens is auditable after the fact rather than accumulating silently.
if (lenses.length > 1 && !gateArgs.gate_lens_reason) {
  log(`Advisory: ${lenses.length} lenses requested (${lenses.join(', ')}) with no gate_lens_reason. A two-lens gate with no named trigger (untrusted-input | authz-boundary | irreversible-outward | ambiguity-tie) is a classification error, not a cautious default — gate-risk-classes.md §2 step 2.`)
}

log(`Reviewer gate: ${lenses.length} lens(es) — ${lenses.map(l => `${l} → ${LENS_REVIEWER_MAP[l] || 'UNMAPPED'}`).join(', ')}`)

// Lenses are independent judgments of the same scope, and the gate's outcome needs all of them,
// so a barrier is correct here (not a pipeline). Each thunk is internally fail-safe, so
// parallel() never yields a bare null for a lens.
const results = await parallel(lenses.map(lens => () => runLens(gateArgs, lens)))

// parallel() maps a thrown thunk to null. runLens catches its own errors, so a null here means
// the harness itself dropped the thunk — still a gate failure, never a pass.
const verdicts = results.map((verdict, index) =>
  verdict || gateFailureVerdict(lenses[index], LENS_REVIEWER_MAP[lenses[index]] || null, 'workflow harness returned no result for this lens')
)

const gateFailures = verdicts
  .filter(v => v.verdict_source === 'gate_failure')
  .map(v => ({ lens: v.lens, reviewer_type: v.reviewer_type, reason: v.gate_failure_reason }))

const rejecting = verdicts.filter(v => v.verdict_source === 'reviewer' && !v.approved)

// Approval requires BOTH: every lens approved, and every lens actually ran. A gate failure is
// never absorbed into an approval, however many other lenses were happy.
const approved = gateFailures.length === 0 && rejecting.length === 0

const blockingFixes = verdicts.flatMap(v => (v.approved ? [] : asList(v.required_fixes)))

// The same-class stop rule needs the class from THIS round to compare against the next one.
// Surfaced on the envelope so the caller does not have to dig through per-lens verdicts.
const defectClasses = [...new Set(verdicts.filter(v => !v.approved && v.defect_class).map(v => v.defect_class))]

if (approved) {
  log(`Gate APPROVED: all ${verdicts.length} lens(es) returned an approving verdict.`)
} else {
  log(`Gate NOT APPROVED — ${gateFailures.length} gate failure(s), ${rejecting.length} rejection(s). Do not commit or mark complete. Defect class(es): ${defectClasses.length ? defectClasses.join(', ') : 'none named'}.`)
}

return {
  approved,
  // false when NO lens produced a real verdict — the gate is absent, not negative. The caller
  // must not treat this like a rejection it can fix; there is nothing to fix yet.
  gate_ran: verdicts.some(v => v.verdict_source === 'reviewer'),
  scope: gateArgs.scope || null,
  lenses,
  gate_lens_reason: gateArgs.gate_lens_reason || null,
  verdicts,
  gate_failures: gateFailures,
  defect_classes: defectClasses,
  blocking_fixes: blockingFixes,
  unverifiable: verdicts.flatMap(v => asList(v.unverifiable)),
  summary: approved
    ? `Gate approved by ${verdicts.map(v => `${v.lens}/${v.reviewer_type}`).join(' + ')}.`
    : `Gate not approved: ${gateFailures.length} lens(es) failed to run, ${rejecting.length} rejected.`,
}
