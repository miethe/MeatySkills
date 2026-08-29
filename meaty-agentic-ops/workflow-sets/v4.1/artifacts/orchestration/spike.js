// spike.js — Research SPIKE workflow
// Spec: .claude/specs/workflows/explore-spike-workflow-spec.md
// Master contract: .claude/specs/workflows/workflow-authoring-spec.md
//
// Four-constraints checklist:
// [x] No FS/shell access in script body
// [x] Mode D phases trigger early return (defensive — no Mode D in research workflows)
// [x] All reviewer/explorer agents use edit-less agentType
// [x] No Date.now() / Math.random() / new Date() in script body
// [x] meta is a pure literal object
// [x] phase() titles match meta.phases exactly
// [x] Budget guard present in completenessCritic call
//
// P3 offload wiring (provider_routing_enabled=true required to activate):
//   - Exploration legs: gemini-executor (only when resume_active=false, stochastic exclusion guard)
//   - Completeness critic: gemini-executor (budget-guarded, only when resume_active=false)
//   - Adversarial skeptic votes: ica-executor (Pattern A — internal agentType; stochastic exclusion)
//   P5 runtime-failure fallback (generalizes the P4 Bob null→claude pattern):
//     every offloaded call above is wrapped by agentWithPrimaryFallback() — a null return OR a
//     thrown error (rate-limit / timeout / binary-absent / structuring miss) triggers a SINGLE
//     re-dispatch of the same task to the primary claude agentType (the agentType the leg/skeptic/
//     critic would use with routing OFF), recording actual_provider_used + fallback_applied:true +
//     a log() line. No retry loop, no backoff (constraint 4: no timers).
//   MUST-stay (never offloaded under any flag — fallback target is always primary claude):
//   - Synthesis: implementation-planner (on-primary)
//   - Verdict sign-off: always returns needs_opus (never self-approved)
//
// Verdict sign-off boundary: script always returns { status: 'needs_opus', reason: 'verdict_signoff' }.
// Opus + human review synthesis.verdict and sign off. Never self-approved inside this workflow.
//
// Phase 1 Tier A nesting pilot (leg_recursion_enabled, DEFAULT FALSE):
//   When true (and the leg is NOT offloaded — claude-primary-only nesting, §5.2), each read-only
//   research leg may spawn a single depth-capped layer of read-only child investigators for bounded
//   decomposition. Governed inline: depth=1, <15 tool uses/child, Mode-D-at-depth bubble-up,
//   children write nothing to git. Pilot-gated, never auto-promoted. See subagent-nesting plan §6.
//
// Read-only leg agentType: 'codebase-explorer' and 'search-specialist' — their agent definitions
// carry disallowedTools that prevents Write/Edit/MultiEdit (constraint 3).

export const meta = {
  name: 'spike',
  description: 'Research SPIKE. Runs 1–4 parallel research legs (from a SPIKE charter or ad-hoc question list), deep-reads and adversarially verifies findings, synthesises into a schema-valid FeasibilityBrief with structured verdict, and returns to Opus for verdict sign-off. Supports standalone SPIKE research and exploration-leg mode (--leg-of). Verdict is never self-approved.',
  phases: [
    { title: 'Exploration' },
    { title: 'Deep read' },
    { title: 'Adversarial verify' },
    { title: 'Synthesis' },
  ],
  whenToUse: 'Invoke via /plan:spike or directly for SPIKE research. Pass args built by Opus from the SPIKE charter frontmatter. When running as a leg of /plan:explore, set args.leg_of to the parent charter path.',
}

// ---------------------------------------------------------------------------
// args is the structured envelope built by Opus pre-flight.
// The script never reads the charter file itself (constraint 1 — no FS access).
// Shape: see explore-spike-workflow-spec.md §2.
// ---------------------------------------------------------------------------

// Defensive parse: args may arrive as a JSON string from the Workflow tool.
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args

const {
  charter_ref,
  spike_slug,
  research_questions = [],
  legs,
  output_dir,
  synthesis_output,
  leg_of = null,
  timestamp,
  dry_run = false,
  depth = 'standard',
  skip_completeness_critic = false,
  sequential = false,
  seeded_findings = [],
  // Phase 1 Tier A nesting pilot — DEFAULT FALSE. When false, leg prompts are
  // byte-for-byte identical to the pre-pilot behaviour. When true, read-only legs MAY
  // spawn a single depth-capped layer of read-only child investigators (governed:
  // depth=1, bounded tool budget, Mode-D-at-depth bubble-up). Pilot-gated — never
  // auto-promoted. See .claude/plans/subagent-nesting-orchestration-strategy-v1.md §6 Phase 1.
  leg_recursion_enabled = false,
  // P3: provider routing feature flag — DEFAULT FALSE. When off, existing agentType
  // selections are preserved byte-for-byte. When true, eligible stages route to
  // external providers (gemini-executor, ica-executor). resume_active guards stochastic stages.
  provider_routing_enabled = false,
  resume_active = false,
} = parsedArgs

// ---------------------------------------------------------------------------
// Dry-run: return the parsed args for inspection without spawning agents.
// ---------------------------------------------------------------------------
if (dry_run) {
  log('Dry-run mode: returning parsed args without spawning agents.')
  return {
    status: 'dry_run',
    workflow_type: 'spike',
    parsed_args: parsedArgs,
  }
}

// ---------------------------------------------------------------------------
// Validate legs (1–4 required).
// ---------------------------------------------------------------------------
if (!legs || legs.length === 0) {
  return {
    status: 'needs_opus',
    reason: 'invalid_args',
    message: 'args.legs must contain at least one leg.',
    workflow_type: 'spike',
  }
}

if (legs.length > 4) {
  return {
    status: 'needs_opus',
    reason: 'invalid_args',
    message: 'args.legs must contain at most 4 legs.',
    workflow_type: 'spike',
  }
}

// Defensive Mode D guard: research/SPIKE workflows should never carry Mode D legs.
const modeDLeg = legs.find(l => l.mode === 'D')
if (modeDLeg) {
  return {
    status: 'needs_opus',
    reason: 'mode_d',
    message: `Leg '${modeDLeg.id}' is marked Mode D. SPIKE legs must not be Mode D. Remove or reclassify.`,
    workflow_type: 'spike',
  }
}

// ---------------------------------------------------------------------------
// Exploration-leg mode: running as a child leg of a parent /plan:explore.
// Output paths are already set correctly in args.legs[i].output_path and
// args.synthesis_output by Opus pre-flight. No special branching needed in the
// script — the difference is captured entirely in the output paths and prompt context.
// ---------------------------------------------------------------------------
const runningAsLeg = leg_of !== null
if (runningAsLeg) {
  log(`Spike running as exploration leg of parent charter: ${leg_of}`)
}

// ---------------------------------------------------------------------------
// Phase 1: Exploration — parallel research legs (read-only agentType).
// All results needed before deep-read begins; parallel barrier is intentional.
// Leg prompts vary by index to produce diverse research angles without Math.random().
//
// P3 offload: when provider_routing_enabled=true AND resume_active=false, legs route
// to gemini-executor. Stochastic exclusion guard: resume_active=true blocks offload
// because Gemini responses are not deterministic across replays — cached leg results
// from a previous run would be replaced with different content on resume.
// When flag is off or resume is active: existing agentType preserved (leg.agentType
// or 'codebase-explorer') — byte-for-byte identical to pre-P3 behaviour.
// ---------------------------------------------------------------------------
phase('Exploration')
log(`Spike: spike_slug=${spike_slug}, legs=${legs.length}, depth=${depth}${runningAsLeg ? ', leg_of=' + leg_of : ''}`)

// P3: resolve leg agentType for this run. Offload only when flag on AND not resuming.
const offloadLegsToGemini = provider_routing_enabled && !resume_active
if (provider_routing_enabled) {
  log(`P3 routing: provider_routing_enabled=true, resume_active=${resume_active}, offloadLegsToGemini=${offloadLegsToGemini}`)
}
// Phase 1 Tier A nesting pilot: legs may spawn depth-1 read-only child investigators.
// Suppressed when the leg is offloaded — an external shell-out leg cannot nest
// (claude-primary-only nesting, §5.2).
const legRecursion = leg_recursion_enabled && !offloadLegsToGemini
if (leg_recursion_enabled) {
  log(`Tier A nesting pilot: leg_recursion_enabled=true, effective=${legRecursion} (suppressed when offloaded — claude-primary-only nesting).`)
}

// ---------------------------------------------------------------------------
// Runtime-failure fallback helper (P5 generalization of the P4 Bob null→claude pattern).
// When an offloaded leg/skeptic/critic is dispatched to a non-primary executor
// (gemini/ica), a null return OR a thrown error (rate-limit / timeout / binary-absent /
// structuring miss) triggers a SINGLE re-dispatch of the same task to the primary claude
// agentType — the agentType that stage would have used with routing OFF. No retry loop,
// no backoff (constraint 4: no timers). Records actual_provider_used + fallback_applied:true
// on the fallback call and emits a log() line, matching the Bob fix-cycle fallback template.
//
// `offloaded` is true only when routing actually selected a non-primary executor; when false
// the call runs exactly as the flag-off path would (no wrapping behaviour change).
async function agentWithPrimaryFallback({ prompt, label, phase, offloaded, offloadAgentType, primaryAgentType, model, schema, chosenPluginId }) {
  if (!offloaded) {
    // Flag-off / on-primary: byte-identical to the pre-P5 direct call.
    return await agent(prompt, { label, phase, agentType: primaryAgentType, model, schema })
  }
  let result = null
  let failed = false
  try {
    result = await agent(prompt, {
      label,
      phase,
      agentType: offloadAgentType,
      model,
      schema,
      _routing_log: {
        chosen_plugin_id: chosenPluginId,
        actual_provider_used: chosenPluginId,
        fallback_applied: false,
        reason: `offload ${label} to ${offloadAgentType}`,
      },
    })
    if (!result) {
      failed = true
      log(`P5 fallback: ${offloadAgentType} returned null for ${label}. Falling back to primary claude (${primaryAgentType}).`)
    }
  } catch (offloadErr) {
    failed = true
    log(`P5 fallback: ${offloadAgentType} threw for ${label}: ${offloadErr && offloadErr.message ? offloadErr.message : offloadErr}. Falling back to primary claude (${primaryAgentType}).`)
  }
  if (failed) {
    log(`P5 fallback: actual_provider_used='claude', fallback_applied=true for ${label}.`)
    result = await agent(prompt, {
      label: `${label}-fallback`,
      phase,
      agentType: primaryAgentType,
      model,
      schema,
      _routing_log: {
        chosen_plugin_id: chosenPluginId,
        actual_provider_used: 'claude',
        fallback_applied: true,
        reason: `${offloadAgentType} failed (rate-limit / timeout / binary absent / structuring error); escalated to primary claude immediately (no retry)`,
      },
    })
  }
  return result
}

let legResults

if (sequential) {
  // Sequential fallback for resource-constrained environments or debugging.
  legResults = []
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    const result = await agentWithPrimaryFallback({
      prompt: buildLegPrompt(leg, i, charter_ref, research_questions, depth, leg_of, timestamp, legRecursion),
      label: `leg-${leg.id}`,
      phase: 'Exploration',
      offloaded: offloadLegsToGemini,
      offloadAgentType: 'gemini-executor',
      primaryAgentType: leg.agentType || 'codebase-explorer',
      model: leg.model || 'sonnet',
      chosenPluginId: 'gemini',
    })
    legResults.push(result)
  }
} else {
  legResults = await parallel(
    legs.map((leg, i) => () =>
      agentWithPrimaryFallback({
        prompt: buildLegPrompt(leg, i, charter_ref, research_questions, depth, leg_of, timestamp, legRecursion),
        label: `leg-${leg.id}`,
        phase: 'Exploration',
        offloaded: offloadLegsToGemini,
        offloadAgentType: 'gemini-executor',
        primaryAgentType: leg.agentType || 'codebase-explorer',
        model: leg.model || 'sonnet',
        chosenPluginId: 'gemini',
      })
    )
  )
}

const validLegResults = legResults.filter(Boolean)
const legsPartial = legs.length - validLegResults.length

if (validLegResults.length === 0) {
  return {
    status: 'needs_opus',
    reason: 'all_legs_failed',
    message: 'All research legs returned null. Check leg agentType registrations and prompts.',
    workflow_type: 'spike',
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Deep read — pipeline (no inter-item barrier; items are independent).
// Each leg result is structured independently; stragglers don't block others.
// ---------------------------------------------------------------------------
phase('Deep read')
log(`Deep read: structuring ${validLegResults.length} leg result(s)...`)

const deepResults = await pipeline(
  validLegResults,
  async (legText) => agent(
    buildDeepReadPrompt(legText, depth),
    {
      phase: 'Deep read',
      agentType: 'codebase-explorer',
      model: 'sonnet',
    }
  )
)

const validDeepResults = deepResults.filter(Boolean)

if (validDeepResults.length === 0) {
  return {
    status: 'needs_opus',
    reason: 'deep_read_failed',
    message: 'All deep-read stages returned null.',
    workflow_type: 'spike',
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Adversarial verify — N skeptics per finding; majority-refute drops it.
// Skeptic count: 2 (standard/shallow) or 3 (deep or conflicting findings).
//
// P3 offload: when provider_routing_enabled=true AND resume_active=false, skeptic votes
// route to ica-executor (Pattern A — internal agentType auto-classifies; ICA free-tier).
// Stochastic exclusion guard: resume_active=true keeps skeptics on-primary (senior-code-reviewer)
// because ICA response content is non-deterministic and cannot be safely replayed on resume.
// When flag is off or resume is active: senior-code-reviewer preserved (on-primary, edit-less).
// MUST-STAY: synthesis and verdict sign-off are NEVER offloaded regardless of flag.
// ---------------------------------------------------------------------------
phase('Adversarial verify')

const skepticCount = depth === 'deep' ? 3 : 2

// P3: resolve skeptic agentType. Offload to ica-executor only when flag on AND not resuming.
// ica-executor is an internal agentType with disallowedTools covering Write/Edit (constraint 3).
const offloadSkepticsToIca = provider_routing_enabled && !resume_active
log(`Adversarial verify: ${validDeepResults.length} finding(s), ${skepticCount} skeptic(s) each (agentType=${offloadSkepticsToIca ? 'ica-executor' : 'senior-code-reviewer'})...`)

const verifiedFindings = await parallel(
  validDeepResults.map((finding, i) => async () => {
    const votes = await parallel(
      // Vary by both finding index and skeptic index (no Math.random()).
      Array.from({ length: skepticCount }, (_, j) => () =>
        agentWithPrimaryFallback({
          prompt: buildSkepticPrompt(finding, i, j),
          label: `skeptic-${i}-${j}`,
          phase: 'Adversarial verify',
          offloaded: offloadSkepticsToIca,
          offloadAgentType: 'ica-executor',
          primaryAgentType: 'senior-code-reviewer',
          model: 'sonnet',
          chosenPluginId: 'ica',
          schema: {
            type: 'object',
            properties: {
              refuted: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['refuted', 'reason'],
          },
        })
      )
    )

    const validVotes = votes.filter(Boolean)
    const refuteCount = validVotes.filter(v => v.refuted).length
    const majorityRefuted = refuteCount > skepticCount / 2
    return majorityRefuted ? null : finding
  })
)

const survivingFindings = verifiedFindings.filter(Boolean)
log(`Adversarial verify complete: ${survivingFindings.length} finding(s) survived of ${validDeepResults.length}.`)

// ---------------------------------------------------------------------------
// Phase 4: Synthesis — structured FeasibilityBrief result.
// Synthesis agent writes the synthesis file and returns a schema-valid object.
// No verdict gate in this workflow — Opus + human sign off after return.
// When running as an exploration leg, synthesis includes confidence score and
// partial status for the parent charter's output_artifacts array.
// ---------------------------------------------------------------------------
phase('Synthesis')
log('Synthesis: building FeasibilityBrief result...')

const seededContext = seeded_findings.length > 0
  ? `\n\nPrior seeded findings to incorporate as context (not authoritative — treat as priors):\n${JSON.stringify(seeded_findings, null, 2)}`
  : ''

const synthesisPromptText = buildSynthesisPrompt({
  charterRef: charter_ref,
  spikeSlug: spike_slug,
  researchQuestions: research_questions,
  legs,
  survivingFindings,
  outputPath: synthesis_output,
  outputDir: output_dir,
  depth,
  seededContext,
  timestamp,
  runningAsLeg,
  legOf: leg_of,
})

const FEASIBILITY_BRIEF_RESULT_SCHEMA = {
  type: 'object',
  required: ['feature_slug', 'verdict', 'verdict_confidence', 'verdict_rationale', 'investigation_summary', 'open_questions', 'synthesis_path'],
  properties: {
    feature_slug: { type: 'string' },
    verdict: { type: 'string', enum: ['go', 'no-go', 'conditional'] },
    verdict_confidence: { type: 'number', minimum: 0, maximum: 1 },
    verdict_rationale: { type: 'string' },
    exploration_charter_ref: { type: ['string', 'null'] },
    proposed_adr_ref: { type: ['string', 'null'] },
    recommended_next_action: { type: ['string', 'null'] },
    investigation_summary: {
      type: 'array',
      items: {
        type: 'object',
        required: ['leg_id', 'agent', 'confidence', 'findings_path', 'conclusion', 'partial'],
        properties: {
          leg_id: { type: 'string' },
          agent: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          findings_path: { type: 'string' },
          conclusion: { type: 'string' },
          partial: { type: 'boolean' },
        },
      },
    },
    cost_estimate_range: { type: ['string', 'null'] },
    risk_summary: {
      type: 'array',
      items: {
        type: 'object',
        required: ['risk', 'category', 'severity'],
        properties: {
          risk: { type: 'string' },
          category: { type: 'string', enum: ['technical', 'operational', 'organizational'] },
          severity: { type: 'string', enum: ['H', 'M', 'L'] },
        },
      },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
    synthesis_path: { type: 'string' },
  },
}

const synthesis = await agent(synthesisPromptText, {
  phase: 'Synthesis',
  agentType: 'implementation-planner',
  model: 'sonnet',
  schema: FEASIBILITY_BRIEF_RESULT_SCHEMA,
})

if (!synthesis) {
  return {
    status: 'needs_opus',
    reason: 'synthesis_failed',
    message: 'Synthesis agent returned null. Review leg findings and retry.',
    workflow_type: 'spike',
  }
}

// ---------------------------------------------------------------------------
// Completeness critic — budget-guarded; optional; single extra round only.
// P3 offload: completeness critic routes to gemini-executor when
//   provider_routing_enabled=true AND resume_active=false.
// When flag is off or resume is active: senior-code-reviewer preserved (on-primary).
// Critic is edit-less by agentType definition (constraint 3).
// ---------------------------------------------------------------------------
let finalSynthesis = synthesis

// P3: resolve completeness critic agentType. Offload only when flag on AND not resuming.
const offloadCriticToGemini = provider_routing_enabled && !resume_active

if (!skip_completeness_critic && budget.remaining() > 80_000) {
  log(`Running completeness critic (agentType=${offloadCriticToGemini ? 'gemini-executor' : 'senior-code-reviewer'})...`)

  const critique = await agentWithPrimaryFallback({
    prompt: `Review this SPIKE feasibility brief synthesis and identify what is missing, incomplete, or under-specified.
Return { gaps: string[], severity: 'minor' | 'major' }.

Synthesis:
${JSON.stringify(synthesis, null, 2)}`,
    label: 'completeness-critic',
    phase: 'Synthesis',
    offloaded: offloadCriticToGemini,
    offloadAgentType: 'gemini-executor',
    primaryAgentType: 'senior-code-reviewer',
    model: 'sonnet',
    chosenPluginId: 'gemini',
    schema: {
      type: 'object',
      properties: {
        gaps: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string', enum: ['minor', 'major'] },
      },
      required: ['gaps', 'severity'],
    },
  })

  if (critique?.gaps?.length && budget.remaining() > 60_000) {
    const improved = await agent(
      buildGapFillPrompt(synthesis, critique.gaps, charter_ref, synthesis_output, timestamp),
      {
        phase: 'Synthesis',
        agentType: 'implementation-planner',
        model: 'sonnet',
        schema: FEASIBILITY_BRIEF_RESULT_SCHEMA,
      }
    )
    if (improved) {
      finalSynthesis = improved
    }
  }
}

// ---------------------------------------------------------------------------
// Return to Opus — verdict sign-off boundary.
// Workflow never advances the verdict to an approved decision.
// status: 'needs_opus' / reason: 'verdict_signoff' is mandatory.
//
// When running as an exploration leg, the synthesis.investigation_summary and
// synthesis.verdict_confidence are the fields Opus uses to append the confidence
// score entry to the parent charter's output_artifacts array.
// ---------------------------------------------------------------------------
log('Spike workflow complete. Returning to Opus for verdict sign-off.')

return {
  status: 'needs_opus',
  reason: 'verdict_signoff',
  workflow_type: 'spike',
  charter_ref,
  spike_slug,
  leg_of,
  synthesis: finalSynthesis,
  legs_run: validLegResults.length,
  legs_partial: legsPartial,
  verified_findings_count: survivingFindings.length,
  budget_remaining: budget.remaining(),
}

// ---------------------------------------------------------------------------
// Prompt builders — pure functions, no FS/shell access, no Date.now().
// Varied by index for pseudo-randomness without Math.random().
// ---------------------------------------------------------------------------

function buildLegPrompt(leg, index, charterRef, researchQuestions, depth, legOf, timestamp, legRecursionEnabled) {
  const depthInstructions = {
    shallow: 'Extract key claims only. Be concise — 3–5 bullet points maximum.',
    standard: 'Extract key claims with supporting evidence. Include confidence signals.',
    deep: 'Extract key claims, supporting evidence, alternative interpretations, and a confidence score (0.0–1.0).',
  }

  const angles = [
    'Focus on technical feasibility: what is possible, what is blocked, what the integration constraints are.',
    'Focus on prior art and existing patterns: what analogous systems exist and what can be reused.',
    'Focus on risks and failure modes: what could prevent this from working or becoming a maintenance burden.',
    'Focus on the concrete implementation path: what the phased breakdown would look like.',
  ]
  const angleInstruction = angles[index % angles.length]

  const legOfContext = legOf
    ? `\nParent exploration charter: ${legOf}\nRead the parent charter for hypothesis and deal-killer context.`
    : ''

  const questionsContext = researchQuestions.length > 0
    ? `\nAll research questions for this SPIKE (for context — this leg answers only the one below):\n${researchQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : ''

  return `Mode: A — Exploration Only. Read-only investigation. Do NOT write code. Do NOT git add/commit/push/stash.

Research question for this leg: ${leg.question}

Charter context: ${charterRef}
Read the charter at ${charterRef} to understand the full SPIKE context.
${legOfContext}
${questionsContext}

Investigation angle (leg ${index}): ${angleInstruction}

Depth instructions: ${depthInstructions[depth] || depthInstructions.standard}

Timestamp (for reference): ${timestamp}

Output: Write your findings to ${leg.output_path}
Include a confidence score (0.0–1.0) in your findings frontmatter.
If you are operating under a timebox from a parent charter, respect it — mark findings as partial with a one-line reason if you run out of time.
${buildLegRecursionClause(legRecursionEnabled)}
Do NOT git add/commit/push/stash.`
}

// Phase 1 Tier A nesting pilot. Returns a governed recursion clause when enabled,
// or an empty string (byte-for-byte preservation) when off. Read-only enforcement
// lives in the child agentType definition (codebase-explorer / search-specialist
// carry disallowedTools), NOT in this prompt text — Phase 0 proved permissionMode
// propagates to depth, so prompt text alone cannot make a child read-only.
function buildLegRecursionClause(enabled) {
  if (!enabled) return ''
  return `
BOUNDED RECURSIVE DECOMPOSITION (Tier A nesting pilot — depth-capped, read-only):
If this research question splits into a narrow sub-question you cannot resolve inline, you MAY
spawn at most 3 child investigators via the Agent tool to decompose it. Rules:
  - Each child MUST use subagent_type 'codebase-explorer' or 'search-specialist' (read-only by
    definition — their disallowedTools forbid Write/Edit/MultiEdit).
  - Depth cap = 1: children MUST NOT spawn their own children. Do not grant them recursion rights.
  - Each child is bounded to fewer than 15 tool uses; keep sub-questions narrow and mechanical.
  - Mode-D-at-depth: if a sub-question touches auth / payments / migrations / deletion /
    force-push / secret-rotation, do NOT investigate it via a child — STOP that thread and record
    'needs_opus / mode_d' in your findings for Opus to handle.
  - Children write nothing to git. You remain the single author of this leg's findings file and
    are responsible for consolidating their results into it.
This is a decomposition aid, not a throughput tool — prefer answering inline when feasible.`
}

function buildDeepReadPrompt(legText, depth) {
  const extractionInstructions = {
    shallow: 'Extract key claims only. Return them as a structured list.',
    standard: 'Extract claims and supporting evidence. Identify confidence signals for each claim.',
    deep: 'Extract claims, evidence, alternative interpretations, and assign a confidence score (0.0–1.0) to each claim.',
  }

  return `Deep-read and structure the following SPIKE research findings. Extract and normalise into a structured findings object.

${extractionInstructions[depth] || extractionInstructions.standard}

Return a JSON object with:
{
  "claims": [{ "claim": string, "evidence": string, "confidence": number }],
  "risk_signals": string[],
  "open_questions": string[],
  "architectural_implications": string[],
  "raw_summary": string
}

Findings to structure:
${legText}`
}

function buildSkepticPrompt(finding, findingIndex, skepticIndex) {
  // Vary framing by index to produce independent perspectives without Math.random().
  const framings = [
    'Challenge this finding from a technical accuracy standpoint. Is the evidence sufficient to support the claim?',
    'Challenge this finding from a completeness standpoint. What critical information is absent that would change the conclusion?',
    'Challenge this finding from a scope standpoint. Does it actually answer the research question, or is it tangential?',
  ]
  const framing = framings[(findingIndex + skepticIndex) % framings.length]

  return `Skeptic review (finding ${findingIndex}, skeptic ${skepticIndex}).

${framing}

Return { refuted: boolean, reason: string }.
Set refuted: true only if the finding is materially incorrect, unsupported, or irrelevant to the research question.
Set refuted: false if the finding is directionally sound even if incomplete.

Finding to review:
${typeof finding === 'string' ? finding : JSON.stringify(finding, null, 2)}`
}

function buildSynthesisPrompt({ charterRef, spikeSlug, researchQuestions, legs, survivingFindings, outputPath, outputDir, depth, seededContext, timestamp, runningAsLeg, legOf }) {
  const legOfContext = runningAsLeg
    ? `\nThis SPIKE is running as an exploration leg. Parent charter: ${legOf}\nAppend confidence score and status to the parent charter's output_artifacts frontmatter after writing the synthesis file.`
    : ''

  return `Synthesise the following verified SPIKE research findings into a structured FeasibilityBrief result.

Charter ref: ${charterRef}
Read the charter at ${charterRef} for full context and research scope.
${legOfContext}

Spike slug: ${spikeSlug}
Timestamp (for reference): ${timestamp}
Depth: ${depth}

Research questions addressed:
${researchQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Legs run: ${JSON.stringify(legs.map(l => ({ id: l.id, question: l.question, agentType: l.agentType, output_path: l.output_path })), null, 2)}

Verified findings (${survivingFindings.length}):
${survivingFindings.map((f, i) => `Finding ${i}:\n${typeof f === 'string' ? f : JSON.stringify(f, null, 2)}`).join('\n\n')}
${seededContext}

Instructions:
1. Produce a verdict: go | no-go | conditional based on the verified findings.
2. Compute verdict_confidence (0.0–1.0) as the weighted average of surviving leg confidences.
3. Write 2–4 sentences of verdict_rationale citing specific findings.
4. Populate investigation_summary from leg outputs. Set agent to the leg's agentType.
   Mark legs that returned null as partial: true.
5. If any architectural decisions surfaced, note them in the synthesis but do NOT draft an ADR —
   that is Opus's decision after verdict sign-off.
6. Populate risk_summary with H/M/L risks identified across all findings.
7. Surface unresolved questions in open_questions.
8. Write the full feasibility brief document to: ${outputPath}
   Follow the feasibility-brief-template.md structure from .claude/skills/planning/templates/feasibility-brief-template.md
   Output directory for supporting files: ${outputDir}
9. Set synthesis_path to: ${outputPath}
10. Set exploration_charter_ref to: ${legOf || null}

IMPORTANT: Do NOT git add/commit/push/stash. Write the synthesis file and return the structured result object.`
}

function buildGapFillPrompt(synthesis, gaps, charterRef, outputPath, timestamp) {
  return `Fill the following gaps in the SPIKE feasibility brief synthesis.

Gaps identified: ${JSON.stringify(gaps)}

Original synthesis:
${JSON.stringify(synthesis, null, 2)}

Charter ref: ${charterRef}
Timestamp: ${timestamp}

Address each gap by:
1. Re-reading relevant sections of the charter and leg findings
2. Adding the missing content to the synthesis
3. Updating the synthesis file at: ${outputPath}
4. Returning the updated structured synthesis object

Do NOT git add/commit/push/stash.`
}
