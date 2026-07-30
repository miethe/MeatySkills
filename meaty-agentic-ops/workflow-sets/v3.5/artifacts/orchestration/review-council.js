// review-council.js — Agent Review Council (ARC) workflow.
//
// Spec:        .claude/specs/workflows/review-council-workflow-spec.md
// Contract:    .claude/specs/workflows/workflow-authoring-spec.md
// Patterns:    .claude/skills/dev-execution/orchestration/workflow-patterns.md
// ARC contract:.claude/skills/council-review/references/output-contract.md
//
// Consumption modes:
//   Standalone: /review-council {"target":{...},"timestamp":"ISO-8601",...}
//   Embedded:   workflow('review-council', {...}) from execute-plan when review_intensity:'council'
//
// P3 offload wiring (provider_routing_enabled=true required to activate):
//   - Evidence scribe: codex-executor (Pattern B, two-stage; Stage A writes artifact;
//     Stage B cheap haiku validates EVIDENCE_PACK_SCHEMA; Stage-B miss never voids Stage A)
//     P5 runtime-failure fallback: Stage A codex null/throw (rate-limit / timeout / binary-absent)
//     → SINGLE re-dispatch of the same scribe prompt to primary claude (code-reviewer, the flag-off
//     agentType), recording actual_provider_used:'claude' + fallback_applied:true + a log() line,
//     BEFORE the needs_opus give-up. No retry loop, no backoff (constraint 4).
//   - Skeptic votes (lens-level adversarial): ica-executor (Pattern A internal agentType)
//   MUST-stay (never offloaded under any flag — fallback target is always primary claude):
//   - All lens reviewers: LENS_REVIEWER_MAP entries (on-primary, edit-less)
//   - Adversarial code-tracer: senior-code-reviewer (on-primary, edit-less)
//   - Adjudicator: karen (on-primary) — council-tier adjudication invariant
//   - Decision-record writer: task-completion-validator (on-primary, final-gate)
//   - Verdict sign-off: returns complete/needs_opus from script (never delegated)
//   adj#4 requirement: adjudicator prompt tolerates stage_b_failed shapes in reviewer outputs.
//
// Forbidden in this file: Date.now(), Math.random(), new Date() (no args), any FS/shell call.
// All timestamps come from args.timestamp (set by Opus / execute-plan pre-flight).
// All file writes happen inside the Phase 4 decision-record agent (not the script itself).

export const meta = {
  name: 'review-council',
  description: 'Agent Review Council (ARC) workflow. Fans out N diverse-lens reviewers plus an adversarial code-tracer in parallel, adjudicates findings, and produces the full ARC artifact set (findings.yaml, scorecard.json, risk_register.yaml, decision_record.md, validation_plan.md). Two modes: standalone /review-council invocation and embedded reviewer gate inside execute-plan when review_intensity is council.',
  phases: [
    { title: 'Dry run' },
    { title: 'Evidence collection' },
    { title: 'Reviewer fan-out' },
    { title: 'Adjudication' },
    { title: 'Decision record' },
  ],
  whenToUse: 'Use standalone for architecture reviews, core-path PRs, auth/payment changes, and security audits. Used automatically by execute-plan when a phase declares review_intensity: council. Reserve for phases where the cost of a missed bug exceeds the cost of the extra reviewer fan-out.',
}

// ---------------------------------------------------------------------------
// JSON Schemas for structured agent output (inline — script cannot read files, constraint 1).
// ---------------------------------------------------------------------------

const EVIDENCE_PACK_SCHEMA = {
  type: 'object',
  required: ['source_artifacts', 'acceptance_criteria', 'constraints', 'evidence_gaps'],
  additionalProperties: false,
  properties: {
    source_artifacts: { type: 'array', items: { type: 'string' } },
    acceptance_criteria: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    deterministic_checks: { type: 'array', items: { type: 'string' } },
    evidence_gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'claim', 'finding_type', 'severity', 'confidence', 'evidence', 'recommendation'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[A-Z]+-[0-9]+$' },
    title: { type: 'string' },
    claim: { type: 'string' },
    finding_type: { type: 'string', enum: ['bug', 'security', 'performance', 'design', 'contract', 'observability', 'style'] },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    confidence: { type: 'string', enum: ['confirmed', 'probable', 'speculative'] },
    evidence: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, locator: { type: 'string' }, quote: { type: 'string' } }, required: ['source'] } },
    recommendation: { type: 'string' },
    validation_method: { type: 'string' },
    reviewer_lens: { type: 'string' },
  },
}

const REVIEWER_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['lens', 'findings', 'reviewer_type'],
  additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    reviewer_type: { type: 'string' },
    findings: { type: 'array', items: FINDING_SCHEMA },
    summary: { type: 'string' },
  },
}

const ADJUDICATED_FINDINGS_SCHEMA = {
  type: 'object',
  required: ['accepted', 'rejected', 'disputed', 'watchlist'],
  additionalProperties: false,
  properties: {
    accepted: { type: 'array', items: FINDING_SCHEMA },
    rejected: { type: 'array', items: FINDING_SCHEMA },
    disputed: { type: 'array', items: FINDING_SCHEMA },
    watchlist: { type: 'array', items: FINDING_SCHEMA },
    adjudicator_notes: { type: 'string' },
  },
}

const COUNCIL_VERDICT_SCHEMA = {
  type: 'object',
  required: ['approved', 'reviewer_type', 'council_artifacts', 'summary'],
  additionalProperties: false,
  properties: {
    approved: { type: 'boolean' },
    reviewer_type: { type: 'string', const: 'council-review' },
    required_fixes: { type: 'array', items: { type: 'string' } },
    council_artifacts: {
      type: 'object',
      required: ['run_dir', 'findings_yaml', 'scorecard_json', 'risk_register_yaml', 'decision_record_md', 'validation_plan_md'],
      properties: {
        run_dir: { type: 'string' },
        findings_yaml: { type: 'string' },
        scorecard_json: { type: 'string' },
        risk_register_yaml: { type: 'string' },
        decision_record_md: { type: 'string' },
        validation_plan_md: { type: 'string' },
      },
    },
    summary: {
      type: 'object',
      required: ['total_findings', 'accepted', 'rejected', 'disputed', 'watchlist', 'blocking_count'],
      properties: {
        total_findings: { type: 'number' },
        accepted: { type: 'number' },
        rejected: { type: 'number' },
        disputed: { type: 'number' },
        watchlist: { type: 'number' },
        blocking_count: { type: 'number' },
        arc_validate_passed: { type: 'boolean' },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Lens → agentType routing table.
// ALL entries are edit-less agentTypes (constraint 3).
// Varied by index position, not by Math.random(), to satisfy constraint 4.
// ---------------------------------------------------------------------------

const LENS_REVIEWER_MAP = {
  correctness:   'task-completion-validator',
  security:      'senior-code-reviewer',
  concurrency:   'karen',
  performance:   'code-reviewer',
  contract:      'senior-code-reviewer',
  observability: 'code-reviewer',
}

const DEFAULT_LENS_SET = ['correctness', 'security', 'concurrency', 'performance', 'contract']
const DEEP_LENS_SET    = ['correctness', 'security', 'concurrency', 'performance', 'contract', 'observability']

// ---------------------------------------------------------------------------
// Prompt builders — pure string construction, no FS access.
// ---------------------------------------------------------------------------

// Phase 4 Tier C nesting pilot. Returns a governed read-only sub-check clause when enabled,
// or an empty string (byte-for-byte preservation) when off. Read-only enforcement lives in the
// child agentType's disallowedTools, not in this prompt text (permissionMode propagates to depth).
function buildLensSubCheckClause(enabled) {
  if (!enabled) return ''
  return `
BOUNDED SUB-CHECK DECOMPOSITION (Tier C nesting pilot — depth-capped, read-only):
If this lens needs a focused deep-dive you cannot resolve inline (e.g. security lens → auth-path
tracer), you MAY spawn at most 2 child checkers via the Agent tool. Rules:
  - Each child MUST use a read-only subagent_type ('codebase-explorer' or 'search-specialist' —
    their disallowedTools forbid Write/Edit/MultiEdit).
  - Depth cap = 1: children MUST NOT spawn their own children.
  - Each child is bounded to fewer than 15 tool uses; keep sub-checks narrow and mechanical.
  - Mode-D-at-depth: if a sub-check touches auth / payments / migrations / deletion / force-push /
    secret-rotation, do NOT delegate it — STOP and note 'needs_opus / mode_d' in your findings.
  - Claude-primary-only; children write nothing to git. You remain the single author of this lens's
    findings and consolidate child results into your REVIEWER_OUTPUT_SCHEMA object.
This is a decomposition aid, not a throughput tool — prefer reviewing inline when feasible.
Governance: .claude/specs/subagent-nesting-spec.md.`
}

function evidenceCollectionPrompt(target, taskSummaries, planRef) {
  return `Mode: E — Reviewer

You are the evidence scribe for an Agent Review Council run.

Target under review:
  type: ${target.type}
  ref: ${target.ref}
  description: ${target.description || '(none provided)'}
${planRef ? `\nPlan reference (acceptance criteria source): ${planRef}` : ''}
${taskSummaries ? `\nCompleted task summaries:\n${taskSummaries}` : ''}

Build a structured evidence pack for the reviewers. Include:
1. Source artifacts and files under review (list paths or refs).
2. Acceptance criteria extracted from the plan reference (if provided).
3. Known constraints and assumptions.
4. Deterministic checks already completed (type errors, lint, tests) — include any results
   provided in task summaries.
5. Open questions and evidence gaps that reviewers should be aware of.

Return a structured EVIDENCE_PACK_SCHEMA object.
Do NOT read files not listed above. Do NOT write any files.
Do NOT git add/commit/push/stash.`
}

function lensReviewerPrompt(lens, lensIndex, target, evidencePack, nestingEnabled) {
  const lensDescriptions = {
    correctness:   'logic correctness, acceptance criteria coverage, edge cases, and functional completeness',
    security:      'authentication, authorization, injection risks, data exposure, RBAC violations, and secret handling',
    concurrency:   'race conditions, cache invalidation ordering, locking gaps, and atomicity violations',
    performance:   'N+1 queries, unbounded loops, missing pagination guards, and response time regressions',
    contract:      'API schema alignment, OpenAPI conformance, type drift between frontend and backend, and breaking changes',
    observability: 'logging gaps, missing error handling, swallowed exceptions, and absent metrics',
  }

  // Vary the prompt opening by lens index (not Math.random) to produce diverse review angles.
  const stanceStarters = [
    'Approach this review by first mapping the happy path, then systematically probing each boundary.',
    'Begin by identifying the riskiest change in the diff, then work outward to supporting context.',
    'Start with the data flow: trace inputs to outputs and flag every implicit assumption.',
    'Open by checking the acceptance criteria against the implementation line by line.',
    'Lead with the failure modes: what would cause this change to fail in production?',
    'Prioritise finding the one bug that a hurried engineer would miss.',
  ]
  const stance = stanceStarters[lensIndex % stanceStarters.length]

  return `Mode: E — Reviewer

You are a specialist reviewer for an Agent Review Council run. Your lens: **${lens}**.
Focus: ${lensDescriptions[lens] || lens}.

${stance}

Target under review:
  type: ${target.type}
  ref: ${target.ref}
  description: ${target.description || '(none provided)'}

Evidence pack summary:
${evidencePack.summary || JSON.stringify(evidencePack).slice(0, 800)}

Source artifacts: ${(evidencePack.source_artifacts || []).join(', ') || '(see target ref)'}
Acceptance criteria: ${(evidencePack.acceptance_criteria || []).join('; ') || '(none listed)'}
Evidence gaps: ${(evidencePack.evidence_gaps || []).join('; ') || '(none listed)'}

Conduct an independent review. Do NOT look at other reviewers' findings — this is an
isolated pass. For each finding, provide a stable id (e.g. SEC-01, CONC-02), title,
specific claim with evidence, severity, confidence, and a concrete recommendation.
Findings without evidence are hypotheses — mark confidence 'speculative'.
High-severity findings require strong evidence or explicit uncertainty acknowledgement.

${buildLensSubCheckClause(nestingEnabled)}
Return a REVIEWER_OUTPUT_SCHEMA object.
Do NOT write any files. Do NOT git add/commit/push/stash.`
}

function adversarialTracePrompt(lensIndex, target, evidencePack, nestingEnabled) {
  // Adversarial code-tracer uses a distinct prompt even though agentType is senior-code-reviewer.
  // lensIndex is always the last index in the fan-out array, making the stance distinct.
  return `Mode: E — Reviewer

You are the adversarial code-tracer for an Agent Review Council run. Your job is different
from the other reviewers: you must trace execution paths through the changed code looking for
logic errors, security gaps, and runtime failures — not just static pattern matching.

Do NOT follow the happy path. Trace the paths that fail silently.

${lensIndex % 2 === 0
  ? 'Start at the outermost entry point (HTTP handler, CLI command, or public API). Trace inward.'
  : 'Start at the innermost data mutation (DB write, cache invalidation, file write). Trace outward.'}

Target under review:
  type: ${target.type}
  ref: ${target.ref}
  description: ${target.description || '(none provided)'}

Evidence pack summary:
${evidencePack.summary || JSON.stringify(evidencePack).slice(0, 800)}

Source artifacts: ${(evidencePack.source_artifacts || []).join(', ') || '(see target ref)'}

Conduct an adversarial trace. For each finding: stable id (ADV-01, ADV-02, ...), specific
code path traced with line references, what goes wrong, under what conditions, severity, and
a concrete fix recommendation. Confirmed-severity bugs must trace the exact path, not just
assert a class of vulnerability.

${buildLensSubCheckClause(nestingEnabled)}
Return a REVIEWER_OUTPUT_SCHEMA object (use lens: 'adversarial-trace').
Do NOT write any files. Do NOT git add/commit/push/stash.`
}

function adjudicationPrompt(reviewerOutputs, evidencePack) {
  // adj#4 (P3): reviewer outputs may include stage_b_failed shapes when an offloaded
  // reviewer's Stage B structurer failed. These entries are truthy objects (not null)
  // and survive the .filter(Boolean) step. They carry status:'stage_b_failed' and
  // empty findings arrays. Filter them out of the findings list but note them in
  // the prompt so the adjudicator knows about the degraded reviewer count.
  const validReviewerOutputs = reviewerOutputs.filter(Boolean)
  const stageBFailedOutputs = validReviewerOutputs.filter(
    r => r.status === 'stage_b_failed' || r.status === 'stage_b_null'
  )
  const normalOutputs = validReviewerOutputs.filter(
    r => r.status !== 'stage_b_failed' && r.status !== 'stage_b_null' && Array.isArray(r.findings)
  )

  const outputSummaries = normalOutputs
    .map((r, i) => `Reviewer ${i + 1} (${r.reviewer_type}, lens: ${r.lens}): ${r.findings.length} findings. ${r.summary || ''}`)
    .join('\n')

  const stageBFailedNote = stageBFailedOutputs.length > 0
    ? `\nDEGRADED REVIEWERS (${stageBFailedOutputs.length} Stage-B failures — their findings could not be extracted; see artifact paths in evidence_gaps for raw output):\n${stageBFailedOutputs.map(r => `  - ${r.artifact_path || r.status || 'unknown'}`).join('\n')}\nTreat any finding areas covered by these reviewers as speculative — their raw output may be on disk.`
    : ''

  const allFindings = normalOutputs.flatMap(r => r.findings)

  const acceptanceCriteria = (evidencePack.acceptance_criteria || []).join('\n- ') || '(none listed)'
  const constraints        = (evidencePack.constraints || []).join('\n- ') || '(none listed)'
  const evidenceGaps       = (evidencePack.evidence_gaps || []).join('\n- ') || '(none listed)'

  return `Mode: E — Reviewer

You are the adjudicator for an Agent Review Council run.

You have received independent findings from ${normalOutputs.length} reviewers (${validReviewerOutputs.length} total, ${stageBFailedOutputs.length} with Stage-B failures — see note below).
Your job: synthesise, deduplicate, and assign final dispositions. Be adversarial — most
findings should not survive adjudication unchanged.

Acceptance criteria (from plan reference — use to determine in-scope vs out-of-scope):
- ${acceptanceCriteria}

Constraints and assumptions (use to reject findings that violate stated constraints):
- ${constraints}

Evidence gaps (treat claims in these areas as speculative unless the reviewer traced concrete code):
- ${evidenceGaps}
${stageBFailedNote}

Reviewer summary:
${outputSummaries || '(no reviewers returned valid findings)'}

All findings (${allFindings.length} total — may contain duplicates and overlaps):
${JSON.stringify(allFindings, null, 2).slice(0, 4000)}${allFindings.length > 20 ? '\n...(truncated for prompt — you have the full set above via reviewer outputs)' : ''}

Adjudication rules:
- ACCEPTED: finding is evidence-backed, in scope, actionable, and worth fixing now.
- REJECTED: finding is unsupported, out of scope, stylistic-only, or a duplicate of an accepted finding.
- DISPUTED: plausible but conflicting evidence or unresolved disagreement between reviewers.
- WATCHLIST: worth tracking but not blocking this merge.

For accepted findings: keep severity and confidence as assigned by the strongest-evidence reviewer.
For rejected findings: preserve the finding but add a rejection_reason.
For disputed findings: preserve both positions, note the disagreement.
Deduplicate across lenses — a bug reported by both the security and concurrency reviewer is
ONE finding. Pick the richer evidence set and note both lenses in reviewer_lens.

Return an ADJUDICATED_FINDINGS_SCHEMA object.
Do NOT write any files. Do NOT git add/commit/push/stash.`
}

function decisionRecordPrompt(adjudicatedFindings, runDir, target, timestamp) {
  const blockingFindings = (adjudicatedFindings.accepted || [])
    .filter(f => f.severity === 'critical' || f.severity === 'high')

  return `Mode: E — Reviewer (with artifact write permission for run directory only)

You are the decision-record writer for an Agent Review Council run.
Write all six ARC artifact files to the run directory: ${runDir}

Target: ${target.type} / ${target.ref} — ${target.description || ''}
Timestamp: ${timestamp}

Adjudicated findings:
  Accepted:  ${(adjudicatedFindings.accepted || []).length}
  Rejected:  ${(adjudicatedFindings.rejected || []).length}
  Disputed:  ${(adjudicatedFindings.disputed || []).length}
  Watchlist: ${(adjudicatedFindings.watchlist || []).length}
  Blocking (severity >= high, accepted): ${blockingFindings.length}

Full adjudicated findings:
${JSON.stringify(adjudicatedFindings, null, 2).slice(0, 5000)}

Write these six files (create the run directory if needed):
1. ${runDir}/evidence_pack.md — narrative evidence pack (see ARC output contract)
2. ${runDir}/findings.yaml — all findings (all dispositions), YAML format
3. ${runDir}/scorecard.json — numeric scoring: { overall: 0-100, by_lens: {lens: score}, blocking_count, total_findings }
4. ${runDir}/risk_register.yaml — risk items from accepted + disputed findings
5. ${runDir}/decision_record.md — disposition buckets with rationale (accepted/rejected/disputed/watchlist)
6. ${runDir}/validation_plan.md — validation steps for accepted and disputed findings

After writing all six files, run:
  uv run arc validate ${runDir}

Return a COUNCIL_VERDICT_SCHEMA object. Set approved:true only if blocking_count === 0.
required_fixes must list the recommendation from each accepted finding with severity >= 'high'.
council_artifacts must contain the relative paths to all six files.
Include arc_validate_passed in summary.
Do NOT git add/commit/push/stash.`
}

// ---------------------------------------------------------------------------
// Run slug builder — deterministic from timestamp and target ref (no Date.now()).
// ---------------------------------------------------------------------------

function buildRunSlug(timestamp, targetRef, phaseId) {
  // timestamp format: 2026-06-01T12:00:00Z → 20260601
  const datePart = (timestamp || '').replace(/T.*$/, '').replace(/-/g, '')
  const refPart = (phaseId || targetRef || 'review')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32)
    .toLowerCase()
  return `${datePart}-${refPart}`
}

// ---------------------------------------------------------------------------
// P3: Two-stage evidence scribe helpers.
// Used only when provider_routing_enabled=true (Pattern B, codex-executor).
// Stage A: codex-executor writes evidence pack artifact to a deterministic path.
// Stage B: cheap haiku validates EVIDENCE_PACK_SCHEMA from the artifact.
// Stage-B miss (null/throw) never voids Stage A artifact (adj#4 / gotcha P0-004).
// ---------------------------------------------------------------------------

function evidenceArtifactPath(runSlug) {
  // Deterministic: derived from runSlug (itself derived from timestamp + targetRef).
  // No Date.now(), no Math.random() — workflow constraint 4.
  return `.claude/worknotes/arc-evidence/${runSlug}-evidence-pack.md`
}

function codexEvidenceScribePrompt(target, taskSummaries, planRef, artifactPath) {
  return `Mode: A — Exploration Only. Read-only investigation. Do NOT write production code. Do NOT git add/commit/push/stash.

You are the evidence scribe for an Agent Review Council run. Use Codex (via your pre-loaded delegate skill) for structured JSON analysis.

Target under review:
  type: ${target.type}
  ref: ${target.ref}
  description: ${target.description || '(none provided)'}
${planRef ? `\nPlan reference (acceptance criteria source): ${planRef}` : ''}
${taskSummaries ? `\nCompleted task summaries:\n${taskSummaries}` : ''}

Build a structured evidence pack for the reviewers. Include:
1. Source artifacts and files under review (list paths or refs).
2. Acceptance criteria extracted from the plan reference (if provided).
3. Known constraints and assumptions.
4. Deterministic checks already completed (type errors, lint, tests).
5. Open questions and evidence gaps.

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete evidence pack output to: ${artifactPath}
This file MUST exist before you return. Use Markdown format with clearly labeled sections.
Your final message is a human-readable summary. A downstream structurer will read ${artifactPath} to emit the machine-readable result.

Do NOT emit structured JSON yourself. Do NOT git add/commit/push/stash.`
}

function codexEvidenceStructurePrompt(artifactPath) {
  return `Mode: A — Exploration Only

Read the evidence pack artifact at: ${artifactPath}

If the file does not exist, return a minimal valid result conforming to the EVIDENCE_PACK_SCHEMA:
  Set source_artifacts, acceptance_criteria, constraints, deterministic_checks, evidence_gaps to [].
  Set summary to "Artifact not found at ${artifactPath} — Stage A (codex evidence scribe) may have failed."

If the file exists, parse its content and produce a structured result:
  - source_artifacts: list of file/ref paths mentioned
  - acceptance_criteria: list of AC items extracted
  - constraints: list of constraints and assumptions
  - deterministic_checks: list of completed checks with any results
  - evidence_gaps: list of open questions or gaps
  - summary: one paragraph narrative summary of the evidence

Do NOT write any files. Do NOT git add/commit/push/stash. Read only.`
}

// ---------------------------------------------------------------------------
// Flag-off evidence collection: on-primary code-reviewer with inline
// EVIDENCE_PACK_SCHEMA. Produces the evidence pack object in-memory (no artifact
// file, no Stage B). This is the canonical claude path used both when
// provider_routing_enabled=false AND as the Stage A failure fallback (FIX 1):
// the Stage A scribe prompt WRITES the artifact, but code-reviewer is write-locked
// (disallowedTools: Write,Edit,MultiEdit) — so the fallback must NOT re-dispatch the
// write prompt. It runs this in-memory collection instead.
// ---------------------------------------------------------------------------
function collectEvidenceOnPrimary(target, taskSummaries, planRef) {
  return agent(
    evidenceCollectionPrompt(target, taskSummaries, planRef),
    {
      label: 'evidence-scribe',
      phase: 'Evidence collection',
      agentType: 'code-reviewer',
      model: 'sonnet',
      schema: EVIDENCE_PACK_SCHEMA,
    }
  )
}

// ---------------------------------------------------------------------------
// Main script body
// ---------------------------------------------------------------------------

// Defensive args parsing: workflow runtime may pass args as a JSON string (constraint 4 gotcha).
const graph = typeof args === 'string' ? JSON.parse(args) : args

const {
  target,
  lens_set: lensSetArg,
  intensity = 'standard',
  plan_ref: planRef,
  phase_id: phaseId,
  task_summaries: taskSummaries,
  run_dir_prefix: runDirPrefix = 'runs',
  timestamp,
  dry_run: dryRun,
  // P3: provider routing feature flag — DEFAULT FALSE. When off, existing behaviour
  // preserved byte-for-byte (evidence scribe stays on code-reviewer with inline schema).
  // When true: evidence scribe uses codex-executor two-stage pattern (Pattern B).
  provider_routing_enabled = false,
  // Phase 4 Tier C nesting pilot — DEFAULT FALSE. When off, lens reviewer prompts are
  // byte-for-byte identical to pre-pilot. When true, a lens reviewer MAY nest bounded
  // read-only sub-checkers (governed by .claude/specs/subagent-nesting-spec.md).
  lens_sub_check_nesting_enabled = false,
} = graph

// ---------------------------------------------------------------------------
// dryRun short-circuit — FIRST conditional after graph parsing, before any agent() calls.
// ---------------------------------------------------------------------------
if (dryRun) {
  phase('Dry run')
  log('dry_run=true — returning parsed graph for inspection, no agents spawned.')
  return { status: 'dry_run', graph }
}

const activeLensSet = lensSetArg
  || (intensity === 'deep' ? DEEP_LENS_SET : DEFAULT_LENS_SET)

const runSlug = buildRunSlug(timestamp, target.ref, phaseId)
const runDir  = `${runDirPrefix}/${runSlug}`

log(`review-council: target=${target.type}/${target.ref} lenses=[${activeLensSet.join(',')}] intensity=${intensity} runDir=${runDir}`)

// ---------------------------------------------------------------------------
// Phase 1 — Evidence collection
// P3 offload: when provider_routing_enabled=true, evidence scribe uses codex-executor
// two-stage pattern (Pattern B, adj#3 guidance: Codex preferred for deep-read structurer).
//   Stage A: codex-executor writes evidence artifact to deterministic path (no schema).
//   Stage B: cheap haiku reads artifact + emits EVIDENCE_PACK_SCHEMA result.
//   Stage-B miss: fallback minimal result with blockers — Stage A artifact preserved (adj#4).
// When flag is off: existing code-reviewer with inline EVIDENCE_PACK_SCHEMA (unchanged).
// MUST-STAY: adjudicator, reviewers, final-gate — always on-primary regardless of flag.
// ---------------------------------------------------------------------------

phase('Evidence collection')
log(`Collecting evidence from target (provider_routing_enabled=${provider_routing_enabled})...`)

let evidencePack

if (provider_routing_enabled) {
  // Two-stage pattern (P3): codex-executor Stage A + haiku Stage B.
  const evidArtifactPath = evidenceArtifactPath(runSlug)
  log(`P3 two-stage evidence scribe: Stage A codex → artifact at ${evidArtifactPath}`)

  // Stage A: codex-executor — writes evidence pack to deterministic path, no schema.
  // P5 runtime-failure fallback (FIX 1): a null return OR a thrown error (rate-limit /
  // timeout / binary-absent) from codex-executor does NOT re-dispatch the WRITE scribe
  // prompt to a write-locked agent. code-reviewer carries disallowedTools: Write,Edit,
  // MultiEdit and cannot create evidArtifactPath, so Stage B would read a missing file and
  // build an EMPTY evidence pack (council runs blind). Instead, on Stage A failure we fall
  // back to the EXACT flag-off path: collectEvidenceOnPrimary() runs evidenceCollectionPrompt
  // against code-reviewer with the inline EVIDENCE_PACK_SCHEMA, producing the evidence pack
  // IN-MEMORY (no artifact file, no Stage B). No retry loop, no backoff (constraint 4).
  let stageAText = null
  let stageAFailed = false
  try {
    stageAText = await agent(
      codexEvidenceScribePrompt(target, taskSummaries, planRef, evidArtifactPath),
      {
        label: 'evidence-scribe:stage-a',
        phase: 'Evidence collection',
        agentType: 'codex-executor',
        model: 'sonnet',
        // No schema: heavy external agent must not carry terminal StructuredOutput call.
        _routing_log: {
          chosen_plugin_id: 'codex',
          actual_provider_used: 'codex',
          fallback_applied: false,
          reason: 'offload evidence-scribe Stage A to codex-executor',
        },
      }
    )
    if (!stageAText) {
      stageAFailed = true
      log('P5 fallback: codex-executor returned null for evidence-scribe Stage A. Falling back to primary claude (code-reviewer, in-memory collection).')
    }
  } catch (codexErr) {
    stageAFailed = true
    log(`P5 fallback: codex-executor threw for evidence-scribe Stage A: ${codexErr && codexErr.message ? codexErr.message : codexErr}. Falling back to primary claude (code-reviewer, in-memory collection).`)
  }

  if (stageAFailed) {
    // FIX 1: fall back to the flag-off in-memory evidence collection, NOT a re-dispatch of the
    // write scribe prompt to a write-locked agent. Produces the pack directly (no Stage B).
    log("P5 fallback: actual_provider_used='claude', fallback_applied=true for evidence-scribe Stage A. Running in-memory code-reviewer collection (no artifact write, no Stage B).")
    evidencePack = await collectEvidenceOnPrimary(target, taskSummaries, planRef)

    if (!evidencePack) {
      log('In-memory primary fallback returned null — evidence collection failed.')
      return {
        status: 'needs_opus',
        reason: 'evidence_collection_failed',
        report: [],
        run_dir: runDir,
      }
    }
  } else {
    // Stage A succeeded on codex: run the two-stage path (Stage B haiku structurer).
    log('Stage A complete. Running Stage B haiku structurer...')

    // Stage B: cheap haiku structurer — reads artifact, emits EVIDENCE_PACK_SCHEMA.
    // Wrapped in try/catch: Stage-B throw never propagates (Stage A artifact preserved).
    try {
      evidencePack = await agent(
        codexEvidenceStructurePrompt(evidArtifactPath),
        {
          label: 'evidence-scribe:stage-b',
          phase: 'Evidence collection',
          agentType: 'general-purpose',
          model: 'haiku',
          schema: EVIDENCE_PACK_SCHEMA,
        }
      )
    } catch (stageBErr) {
      log(`Stage B threw for evidence scribe: ${stageBErr && stageBErr.message ? stageBErr.message : stageBErr}. Stage A artifact preserved at ${evidArtifactPath}.`)
      // adj#4: graceful fallback — minimal evidence pack with stage_b_failed status.
      // Adjudicator prompt below explicitly tolerates this shape.
      evidencePack = {
        source_artifacts: [],
        acceptance_criteria: [],
        constraints: [],
        deterministic_checks: [],
        evidence_gaps: [`Stage B schema validation failed — read ${evidArtifactPath} for Stage A output`],
        summary: `stage_b_failed: evidence pack schema extraction failed. Stage A artifact at ${evidArtifactPath}.`,
      }
    }

    if (!evidencePack) {
      log(`Stage B returned null. Using minimal fallback (Stage A artifact at ${evidArtifactPath} preserved).`)
      // adj#4: null Stage B — minimal fallback, Stage A artifact intact.
      evidencePack = {
        source_artifacts: [],
        acceptance_criteria: [],
        constraints: [],
        deterministic_checks: [],
        evidence_gaps: [`Stage B returned null — read ${evidArtifactPath} for Stage A output`],
        summary: `stage_b_null: Stage B structurer returned null. Stage A artifact at ${evidArtifactPath}.`,
      }
    }
  }
} else {
  // Flag off: existing on-primary code-reviewer with inline EVIDENCE_PACK_SCHEMA (unchanged).
  evidencePack = await collectEvidenceOnPrimary(target, taskSummaries, planRef)

  if (!evidencePack) {
    return {
      status: 'needs_opus',
      reason: 'evidence_collection_failed',
      report: [],
      run_dir: runDir,
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — Reviewer fan-out (parallel barrier — all must complete before adjudication)
// ---------------------------------------------------------------------------

phase('Reviewer fan-out')
log(`Fanning out ${activeLensSet.length} lens reviewers + 1 adversarial code-tracer...`)

// Build reviewer thunks: one per lens, using lens-appropriate agentType.
// All agentTypes in LENS_REVIEWER_MAP are edit-less by definition (constraint 3).
const lensThunks = activeLensSet.map((lens, i) => () =>
  agent(
    lensReviewerPrompt(lens, i, target, evidencePack, lens_sub_check_nesting_enabled),
    {
      label: `reviewer-${lens}`,
      phase: 'Reviewer fan-out',
      agentType: LENS_REVIEWER_MAP[lens] || 'code-reviewer',
      model: 'sonnet',
      schema: REVIEWER_OUTPUT_SCHEMA,
    }
  )
)

// Adversarial code-tracer always runs; uses the last index for prompt variation.
// agentType: 'senior-code-reviewer' — edit-less by definition (constraint 3).
const adversarialThunk = () =>
  agent(
    adversarialTracePrompt(activeLensSet.length, target, evidencePack, lens_sub_check_nesting_enabled),
    {
      label: 'adversarial-code-tracer',
      phase: 'Reviewer fan-out',
      agentType: 'senior-code-reviewer',
      model: 'sonnet',
      schema: REVIEWER_OUTPUT_SCHEMA,
    }
  )

// parallel() is a barrier: all reviewers complete before adjudication begins.
// This preserves the ARC "independent pass" principle (reviewers don't see each other).
// A throwing thunk resolves to null (never rejects) — filter before use.
const allReviewerOutputs = await parallel([...lensThunks, adversarialThunk])
const validOutputs = allReviewerOutputs.filter(Boolean)

if (validOutputs.length === 0) {
  return {
    status: 'needs_opus',
    reason: 'all_reviewers_failed',
    report: [],
    run_dir: runDir,
  }
}

log(`Reviewer fan-out complete: ${validOutputs.length}/${activeLensSet.length + 1} reviewers returned findings.`)

// Budget guard before adjudication — adjudication + decision-record are two more agents.
if (budget.remaining() < 80_000) {
  log('Budget near floor before adjudication — returning partial results to Opus.')
  return {
    status: 'needs_opus',
    reason: 'budget_exhausted',
    partial_reviewer_outputs: validOutputs,
    run_dir: runDir,
    report: [],
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — Adjudication
// ---------------------------------------------------------------------------

phase('Adjudication')
log('Adjudicating findings across reviewers...')

// Adjudicator uses 'karen' — adversarial by nature, appropriate for synthesis under pressure.
// 'karen' is edit-less by agent definition (constraint 3).
const adjudicatedFindings = await agent(
  adjudicationPrompt(validOutputs, evidencePack),
  {
    label: 'adjudicator',
    phase: 'Adjudication',
    agentType: 'karen',
    model: 'sonnet',
    schema: ADJUDICATED_FINDINGS_SCHEMA,
  }
)

if (!adjudicatedFindings) {
  return {
    status: 'needs_opus',
    reason: 'adjudication_failed',
    partial_reviewer_outputs: validOutputs,
    run_dir: runDir,
    report: [],
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — Decision record
// ---------------------------------------------------------------------------

phase('Decision record')
log(`Writing ARC artifacts to ${runDir}...`)

// 'task-completion-validator' writes ARC artifacts to runs/<slug>/ only (constraint 3).
// It is edit-less for source files; run-dir artifact writes are the only exception.
const verdict = await agent(
  decisionRecordPrompt(adjudicatedFindings, runDir, target, timestamp),
  {
    label: 'decision-record-writer',
    phase: 'Decision record',
    agentType: 'task-completion-validator',
    model: 'sonnet',
    schema: COUNCIL_VERDICT_SCHEMA,
  }
)

if (!verdict) {
  // Fallback: synthesise a verdict from adjudicated findings without full artifact writes.
  const blockingCount = (adjudicatedFindings.accepted || [])
    .filter(f => f.severity === 'critical' || f.severity === 'high').length
  const allAccepted = adjudicatedFindings.accepted || []
  const requiredFixes = allAccepted
    .filter(f => f.severity === 'critical' || f.severity === 'high')
    .map(f => f.recommendation)

  return {
    status: 'needs_opus',
    reason: 'decision_record_write_failed',
    fallback_verdict: {
      approved: blockingCount === 0,
      reviewer_type: 'council-review',
      required_fixes: requiredFixes,
      council_artifacts: { run_dir: runDir },
      summary: {
        total_findings: (allAccepted.length + (adjudicatedFindings.rejected || []).length +
                         (adjudicatedFindings.disputed || []).length + (adjudicatedFindings.watchlist || []).length),
        accepted: allAccepted.length,
        rejected: (adjudicatedFindings.rejected || []).length,
        disputed: (adjudicatedFindings.disputed || []).length,
        watchlist: (adjudicatedFindings.watchlist || []).length,
        blocking_count: blockingCount,
      },
    },
    run_dir: runDir,
    report: [],
  }
}

log(`review-council complete. approved=${verdict.approved} blocking=${verdict.summary?.blocking_count ?? '?'} runDir=${runDir}`)

// Return the CouncilVerdict as both the workflow return value and an ExecutionReport-compatible
// shape so execute-plan's reviewerGate can consume it directly.
return {
  status: 'complete',
  // CouncilVerdict — consumed by execute-plan reviewerGate / fixLoop
  ...verdict,
  // ExecutionReport envelope (for Opus post-run when invoked standalone)
  report: [{
    wave: 'council',
    phases: [{
      phase: phaseId || target.ref,
      verdict: verdict,
      fix_cycles: 0,
      escalate: !verdict.approved,
      files_touched: [],
      blockers: verdict.approved
        ? []
        : (verdict.required_fixes || []).map(f => ({ description: f, resolution_hint: 'See decision_record.md' })),
    }],
  }],
}
