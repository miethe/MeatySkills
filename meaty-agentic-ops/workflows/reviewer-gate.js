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
 *   - **An unverified approval is not an approval** (R3, 2026-08-06). The dominant delegate defect
 *     class in the workflow-v41 window was a green suite over a path production does not take, and
 *     the second was a leg self-reporting a side effect it never performed. So `verification_path`
 *     is a REQUIRED schema field, an approving verdict without an established path is converted
 *     into a `gate_integrity_failure`, and any `self_reported_claims` entry downgrades the
 *     approval to a rejection. Prompt text alone was not enough: the whole failure class consists
 *     of confident reports that satisfied every instruction they were given.
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
  required: ['approved', 'reviewer_type', 'summary', 'verification_path'],
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
    // R3 (verification-path evidence gate, 2026-08-06 workflow-v41 retro). A green suite is
    // evidence about the path THE SUITE takes; the dominant delegate defect class was a suite
    // that exercised a path production does not take — an offline fake echoing `system` where
    // the live API returns `source_system`, a branch made dead by an earlier step but still
    // unit-tested directly, a dry-run validating preconditions `apply` does not. Five
    // occurrences in one program. So the reviewer must NAME how it established the path, and
    // an approving verdict that cannot is handled as a gate-integrity failure below — not as
    // an approval, and not as an ordinary rejection either.
    verification_path: {
      type: 'object',
      required: ['established', 'kind'],
      additionalProperties: false,
      properties: {
        established: { type: 'boolean' },
        kind: {
          type: 'string',
          enum: [
            'live-smoke',
            'path-equivalence',
            'real-endpoint-field-check',
            'production-callsite-trace',
            'not-established',
          ],
        },
        // The entry point production actually takes to reach the changed code.
        production_entrypoint: { type: 'string' },
        // The command transcript / file:line pair / response body that proves it.
        evidence: { type: 'string' },
      },
    },
    // Claims the reviewer had to accept on a leg's own word because no artifact backed them.
    // Any entry here blocks approval by construction: "I registered the node / wrote the file /
    // updated the row" is a claim, and five misreporting findings in seven days came from
    // reading one as evidence.
    self_reported_claims: { type: 'array', items: { type: 'string' } },
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
    'AC-mapping lens. For each acceptance criterion, decide met / not-met and name the concrete evidence (a real command transcript, a file:line, a test name). A green suite is NOT evidence on its own — it can sit over a defect on a path nobody tested, so for every criterion resting on tests you must establish and name the verification path (see the VERIFICATION-PATH RULE below). Never accept a fabricated or absent transcript; if evidence is missing, list the criterion under `unverifiable` rather than marking it met.',
  security:
    'Adversarial defect-finding lens. Trace the code, do not read the claims. Hunt fail-open defaults (check the PRODUCER of a value, not just the field), the soft delegate/caller/sibling of anything just hardened, tests that pin unsafe behaviour, and hardening that is unreachable from the path production takes. You are not doing AC bookkeeping — that is the validator lens.',
  karen:
    'Whole-tree reality-check lens. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
  'karen-final-tree-only':
    'Whole-tree reality-check lens, scoped to the final assembled tree. Judge what actually works end-to-end against what is claimed complete. Do not dispatch further reviewers — return your own verdict.',
}

// ─── the R3 evidence rules, verbatim in every lens prompt ────────────────────
//
// Stated as prompt text AND enforced mechanically below (applyEvidenceRules). The prompt is
// what lets a reviewer comply; the enforcement is what makes non-compliance visible instead
// of approving. Grounding: docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md
// (leg B — 8 delegate-bug + 5 misreporting findings in 7 days, one dominant signature).

const EVIDENCE_RULES = `VERIFICATION-PATH RULE — a green suite is evidence about the path THE SUITE takes, never about
the path production takes. Before you treat any criterion as met on the strength of tests,
establish which ONE of these you actually saw, and name it in \`verification_path\`:
  - live-smoke ................. the real entry point run against the real dependency, output shown
  - path-equivalence ........... the seam the test drives IS the object production calls — name both
                                 call sites (file:line) and show they resolve to the same thing
  - real-endpoint-field-check ... every field/key name in a fake checked against a real response or
                                 schema (observed: a fake echoed \`system\` where the live API
                                 returns \`source_system\` — all tests green, feature could not work)
  - production-callsite-trace ... you traced production's entry point to the changed code and it is
                                 reachable (observed: a branch made dead by an earlier
                                 comment-stripping step, still covered by its own unit tests)
If none of the four holds, the criterion is NOT met and the suite is not evidence for it. Check the
dry-run/apply split too: a dry-run that validates a different precondition set than \`apply\` is the
same defect wearing a different hat. Set \`verification_path.established\` true ONLY for one of the
four kinds — withholding it costs nothing, and an approving verdict without it is recorded as a
gate-integrity failure rather than an approval.

SELF-REPORT RULE — never accept a leg's, a report's, or a summary's statement that a side effect
happened as evidence that it happened. "I registered the node / wrote the file / updated the row /
published the artifact" is a claim; the evidence is the artifact itself — the row, the file on
disk, the response body, the diff hunk. Verify each one yourself, or list it in
\`self_reported_claims\`, which blocks approval by construction.`

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

${EVIDENCE_RULES}

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
  - verification_path: established / kind / production_entrypoint / evidence, per the
    VERIFICATION-PATH RULE above. Required on every verdict, approving or not.
  - self_reported_claims: every claim you had to take on a leg's word for lack of an artifact.

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

// ─── R3 enforcement: an unverified approval is not an approval ────────────────

// Only these four are a path. 'not-established' is deliberately absent: it is the reviewer
// saying it could not do this, which is honest and must not read as satisfaction of the rule.
const VERIFICATION_KINDS = new Set([
  'live-smoke',
  'path-equivalence',
  'real-endpoint-field-check',
  'production-callsite-trace',
])

/** Why an approving verdict fails the verification-path rule, or null when it passes. */
function verificationGap(verdict) {
  const vp = verdict.verification_path
  if (!vp) return 'no verification_path on an approving verdict — the gate cannot tell whether the evidence exercises the path production takes'
  if (vp.established !== true) return `verification_path.established is ${JSON.stringify(vp.established)} (kind '${vp.kind}') on an approving verdict — the reviewer approved without establishing the production path`
  if (!VERIFICATION_KINDS.has(vp.kind)) return `verification_path.kind '${vp.kind}' is not one of the four real paths (${[...VERIFICATION_KINDS].join(' | ')}) — established:true is unsupported`
  return null
}

/**
 * The two R3 rules, applied to a real verdict. Their outcomes differ deliberately:
 *
 *   - self-reported side effects ⇒ an ordinary REJECTION. The missing artifact is implementer
 *     work, so a fix cycle is exactly the right next action.
 *   - an unverified approval ⇒ a GATE-INTEGRITY failure, mirroring execute-plan.js
 *     gateIntegrityResult(). The verdict exists but cannot be trusted, and what did not finish
 *     is the REVIEWER — a fix cycle would edit blind against a finding nobody made.
 */
function applyEvidenceRules(verdict) {
  if (verdict.verdict_source !== 'reviewer' || !verdict.approved) return verdict

  const claims = asList(verdict.self_reported_claims)
  if (claims.length) {
    log(`Gate REJECTION on the ${verdict.lens} lens: approved with ${claims.length} self-reported claim(s) and no artifact evidence. Downgrading the approval — a report of a side effect is not the side effect.`)
    return {
      ...verdict,
      approved: false,
      downgraded_from_approval: 'self_reported_side_effect',
      defect_class: verdict.defect_class || 'self-reported-side-effect',
      required_fixes: [
        ...asList(verdict.required_fixes),
        ...claims.map(claim => `Produce artifact evidence — the row, the file on disk, the response body, or the diff hunk — for the side effect reported as "${claim}". A leg's own report of it is not evidence that it happened.`),
      ],
    }
  }

  const gap = verificationGap(verdict)
  if (!gap) return verdict

  log(`GATE INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${gap}. Recording as a gate-integrity failure, NOT as an approval and NOT as a rejection. The caller must NOT run a fix cycle.`)
  return {
    ...verdict,
    approved: false,
    verdict_source: 'gate_integrity_failure',
    integrity_reason: gap,
    summary: `Gate INTEGRITY FAILURE on the ${verdict.lens} lens (${verdict.reviewer_type}): ${gap}`,
    required_fixes: [
      `The ${verdict.lens} lens approved without establishing a verification path (${gap}). This is NOT an approval and NOT an ordinary rejection — what did not finish is the reviewer, not the implementer. Re-dispatch this lens and require one of live-smoke | path-equivalence | real-endpoint-field-check | production-callsite-trace, or record an explicit operator override. Do NOT run a fix cycle: nothing has been found yet.`,
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
    gate_integrity_failures: [],
    escalate: true,
    verification_paths: [],
    self_reported_claims: [],
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
const rawVerdicts = results.map((verdict, index) =>
  verdict || gateFailureVerdict(lenses[index], LENS_REVIEWER_MAP[lenses[index]] || null, 'workflow harness returned no result for this lens')
)

// R3: the evidence rules run BEFORE anything reads `approved`, so no downstream consumer can
// see the un-adjusted verdict. Everything below operates on the adjusted set.
const verdicts = rawVerdicts.map(applyEvidenceRules)

const gateFailures = verdicts
  .filter(v => v.verdict_source === 'gate_failure')
  .map(v => ({ lens: v.lens, reviewer_type: v.reviewer_type, reason: v.gate_failure_reason }))

const integrityFailures = verdicts
  .filter(v => v.verdict_source === 'gate_integrity_failure')
  .map(v => ({ lens: v.lens, reviewer_type: v.reviewer_type, reason: v.integrity_reason }))

const rejecting = verdicts.filter(v => v.verdict_source === 'reviewer' && !v.approved)

// Approval requires THREE things: every lens approved, every lens actually ran, and every
// approving lens established a verification path. Neither a gate failure nor an unverified
// approval is ever absorbed into an approval, however many other lenses were happy.
const approved = gateFailures.length === 0 && integrityFailures.length === 0 && rejecting.length === 0

const blockingFixes = verdicts.flatMap(v => (v.approved ? [] : asList(v.required_fixes)))

// The same-class stop rule needs the class from THIS round to compare against the next one.
// Surfaced on the envelope so the caller does not have to dig through per-lens verdicts.
const defectClasses = [...new Set(verdicts.filter(v => !v.approved && v.defect_class).map(v => v.defect_class))]

if (approved) {
  log(`Gate APPROVED: all ${verdicts.length} lens(es) returned an approving verdict with an established verification path (${verdicts.map(v => `${v.lens}:${v.verification_path && v.verification_path.kind}`).join(', ')}).`)
} else {
  log(`Gate NOT APPROVED — ${gateFailures.length} gate failure(s), ${integrityFailures.length} integrity failure(s), ${rejecting.length} rejection(s). Do not commit or mark complete. Defect class(es): ${defectClasses.length ? defectClasses.join(', ') : 'none named'}.`)
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
  // Verdicts that EXIST but cannot be trusted (approved with no verification path). Distinct
  // from gate_failures (nothing came back) and from rejections (a finding to fix): the next
  // action is re-dispatch or an explicit override, never a fix cycle.
  gate_integrity_failures: integrityFailures,
  // True when the gate's own execution is what needs attention, rather than the code.
  escalate: gateFailures.length > 0 || integrityFailures.length > 0,
  // Per-lens record of how (or whether) the production path was established.
  verification_paths: verdicts.map(v => ({
    lens: v.lens,
    established: Boolean(v.verification_path && v.verification_path.established),
    kind: (v.verification_path && v.verification_path.kind) || 'not-established',
    production_entrypoint: (v.verification_path && v.verification_path.production_entrypoint) || null,
    evidence: (v.verification_path && v.verification_path.evidence) || null,
  })),
  self_reported_claims: verdicts.flatMap(v => asList(v.self_reported_claims)),
  defect_classes: defectClasses,
  blocking_fixes: blockingFixes,
  unverifiable: verdicts.flatMap(v => asList(v.unverifiable)),
  summary: approved
    ? `Gate approved by ${verdicts.map(v => `${v.lens}/${v.reviewer_type}`).join(' + ')}.`
    : `Gate not approved: ${gateFailures.length} lens(es) failed to run, ${integrityFailures.length} approved without establishing a verification path, ${rejecting.length} rejected.`,
}
