/**
 * auto-feature — autopilot lane: request → plan → feasibility gate → execute
 *
 * Spec: .claude/specs/workflows/auto-feature-workflow-spec.md
 * Master contract: .claude/specs/workflows/workflow-authoring-spec.md
 * Recalibration: .claude/plans/tiered-workflow-overhaul.md §12 (Opus 4.8 + Autopilot)
 *
 * Takes a RAW feature request (not a pre-built plan), classifies it against the
 * recalibrated tier system, decomposes it into an ExecutionGraph, applies a
 * deterministic single-pass feasibility gate, and — when the work fits single-pass
 * capacity — executes it by NESTING the existing engines (execute-contract for a
 * single wave, execute-plan for ≤3 waves), which bring their own reviewer + fix-loop.
 * When the work exceeds single-pass capacity (or hits a Mode D / SPIKE boundary) it
 * returns needs_opus with a specific reason so Opus routes to full planning — always
 * leaving a durable plan artifact on disk so escalation gets a head start.
 *
 * Patterns used: two-stage structuring (durability), modeBoundary (gate), sub-workflow
 *   nesting (one level only). Reviewer gating + fix-loops are delegated to the nested
 *   engines — NOT reimplemented here.
 *
 * Durability design (see workflow-authoring-spec.md §16):
 *   - Plan stage: implementation-planner, NO schema. Writes the plan artifact (with an
 *     embedded `autopilot-graph` JSON block) to disk before returning plain text.
 *   - Structure stage: haiku general-purpose agent, schema: AUTOPILOT_PLAN_SCHEMA.
 *     Reads the artifact and extracts the structured plan. try/catch → graceful fallback.
 *
 * Four-constraints checklist:
 *   [x] No FS/shell access in script body (planner writes the artifact; nested git merges = Opus)
 *   [x] Mode D triggers early return before the Execute phase / nested engine spawns
 *   [x] All reviewer agents use edit-less agentType (transitively, inside nested engines)
 *   [x] No Date.now() / Math.random() / new Date() in script body
 *   [x] meta is a pure literal object
 *   [x] phase() titles match meta.phases exactly
 *   [x] No while-loops here (fix-loops live in nested engines, already budget-guarded)
 *   [x] Planner prompt forbids git add/commit/push/stash; nested engines own commit discipline
 */

// ─── meta (pure literal — no computed values, no function calls) ──────────────

export const meta = {
  name: 'auto-feature',
  description: 'Autopilot: take a raw feature request, classify its tier, decompose + write a durable plan, gate on single-pass capacity, then execute via nested execute-contract (single wave) or execute-plan (≤3 waves). Escalates to full planning on Mode D, SPIKE-needed, or scope beyond single-pass capacity.',
  phases: [
    { title: 'Plan' },
    { title: 'Structure plan' },
    { title: 'Execute' },
  ],
  whenToUse: 'A raw feature request that has no PRD/contract yet and plausibly fits single-pass capacity (≤13 pts, ≤3 waves, no auth/payments/migrations/deletion, no research unknowns). Invoke via /dev:autopilot. For clearly large/risky work, use /plan:explore or /plan:plan-feature directly.',
}

// ─── inline schema ────────────────────────────────────────────────────────────

const AUTOPILOT_PLAN_SCHEMA = {
  type: 'object',
  required: [
    'tier', 'effort_points', 'wave_count', 'phase_count', 'file_count',
    'mode_d', 'needs_spike', 'single_pass_feasible',
    'plan_artifact_path', 'execution_target',
  ],
  additionalProperties: false,
  properties: {
    tier: { type: 'integer', minimum: 0, maximum: 3 },
    effort_points: { type: 'number' },
    wave_count: { type: 'integer', minimum: 0 },
    phase_count: { type: 'integer', minimum: 0 },
    file_count: { type: 'integer', minimum: 0 },
    mode_d: { type: 'boolean' },
    mode_d_reasons: { type: 'array', items: { type: 'string' } },
    needs_spike: { type: 'boolean' },
    spike_reasons: { type: 'array', items: { type: 'string' } },
    single_pass_feasible: { type: 'boolean' },
    plan_artifact_path: { type: 'string' },
    execution_target: { type: 'string', enum: ['execute-contract', 'execute-plan'] },
    slug: { type: 'string' },
    category: { type: 'string' },
    review_intensity: { type: 'string', enum: ['standard', 'tier3', 'council'] },
    files_affected: { type: 'array', items: { type: 'string' } },
    // The ExecutionGraph for execute-plan (waves[]), or a minimal object for execute-contract.
    execution_graph: { type: 'object' },
    escalation_recommendation: { type: 'string' },
  },
}

// ─── high-risk path heuristic (Mode D backstop) ───────────────────────────────
// Mirrors modeBoundary pattern + execute-contract.js HIGH_RISK_PATTERNS.

const HIGH_RISK_PATTERNS = [
  /auth/i, /payment/i, /billing/i, /migration/i, /alembic/i,
  /delete/i, /drop_table/i, /secret/i, /token/i,
]

function hasHighRiskPaths(filesAffected) {
  if (!Array.isArray(filesAffected)) return false
  return filesAffected.some(f => HIGH_RISK_PATTERNS.some(pat => pat.test(f)))
}

// ─── ceiling resolution (pure) ────────────────────────────────────────────────

function resolveCeiling(parsed) {
  const c = parsed.ceiling || {}
  return {
    max_points: typeof c.max_points === 'number' ? c.max_points : 13,
    max_waves: typeof c.max_waves === 'number' ? c.max_waves : 3,
    max_phases: typeof c.max_phases === 'number' ? c.max_phases : 8,
    max_files: typeof c.max_files === 'number' ? c.max_files : 25,
  }
}

// ─── prompts ──────────────────────────────────────────────────────────────────

// Phase 4 Tier C nesting pilot. Returns a governed read-only scoping clause when enabled,
// or an empty string (byte-for-byte preservation) when off. Read-only enforcement lives in the
// child agentType's disallowedTools, not in this prompt text (permissionMode propagates to depth).
function buildPlannerNestingClause(enabled) {
  if (!enabled) return ''
  return `
BOUNDED SCOPING DECOMPOSITION (Tier C nesting pilot — depth-capped, read-only):
If decomposing this request requires scoping a sub-area you cannot map inline, you MAY spawn at
most 2 child scouts via the Agent tool. Rules:
  - Each child MUST use a read-only subagent_type ('codebase-explorer' or 'search-specialist').
  - Depth cap = 1: children MUST NOT spawn their own children.
  - Each child is bounded to fewer than 15 tool uses; keep scoping questions narrow.
  - Mode-D-at-depth: if a sub-area touches auth / payments / migrations / deletion / force-push /
    secret-rotation, do NOT delegate it — STOP and note 'needs_opus / mode_d' in the plan artifact.
  - Claude-primary-only; children write nothing to git. You remain the single author of the plan
    artifact and consolidate child findings into it.
This is a decomposition aid, not a throughput tool — prefer planning inline when feasible.
Governance: .claude/specs/subagent-nesting-spec.md.`
}

/**
 * Plan stage (Stage A — implementation-planner, NO schema).
 * Classifies the request, decomposes it, and WRITES a durable plan artifact with an
 * embedded `autopilot-graph` JSON block. Returns a plain-text summary only.
 */
function planPrompt(parsed, ceiling, nestingEnabled) {
  const category = parsed.category || 'features'
  const contextSection = parsed.context_paths && parsed.context_paths.length > 0
    ? `\nSeed context paths (read first):\n${parsed.context_paths.map(p => `  - ${p}`).join('\n')}`
    : ''
  const requestIdSection = parsed.request_id ? `\nRequest-log ID: ${parsed.request_id}` : ''

  return `Mode: B — Contract Drafting (planning artifact only; NO production code, NO git add/commit/push/stash)

You are the autopilot planner. Classify and decompose the following feature request, then write
ONE durable plan artifact to disk. Do NOT implement anything.

=== FEATURE REQUEST ===
${parsed.request}
=== END REQUEST ===${requestIdSection}
Default category: ${category}
Timestamp (use verbatim; do not invent a date): ${parsed.timestamp}${contextSection}

STEPS:
1. Explore the codebase symbols-first (ai/symbols-*.json), then targeted reads, to ground scope.
2. Classify: tier (0-3), effort_points, and decompose into an ExecutionGraph of sequential WAVES
   (each wave = a set of phases that can run in parallel; phases contain tasks with disjoint file
   ownership). Count: wave_count (sequential depth), phase_count (total), file_count (distinct
   files_affected across all tasks).
3. Choose execution_target:
   - 'execute-contract' when the work is ONE cohesive sprint (single wave, ≤8 pts, no meaningful
     phase decomposition). Write a Feature Contract.
   - 'execute-plan' when the work needs 2-3 sequential waves. Write a lightweight Implementation
     Plan with wave_plan-style structure.
4. Detect boundaries HONESTLY (the gate trusts these):
   - mode_d = true if the work touches auth, payments, billing, DB migrations, data deletion,
     secret/token rotation, or infrastructure. List mode_d_reasons.
   - needs_spike = true if there are unresolved research/feasibility unknowns that must be
     investigated before committing to an approach. List spike_reasons.
   - single_pass_feasible = your assessment vs. the ceiling (max_points ${ceiling.max_points},
     max_waves ${ceiling.max_waves}, max_phases ${ceiling.max_phases}, max_files ${ceiling.max_files}).
     This is ADVISORY — a deterministic gate re-checks it.
5. Build each task's prompt fully: first line a Mode marker, then file paths and acceptance
   detail, ending with "Do NOT git add/commit/push/stash." Assign each task an appropriate
   implementation agentType (python-backend-engineer, ui-engineer-enhanced, data-layer-expert,
   refactoring-expert, etc.). Set per-phase review_intensity ('standard' default; 'tier3' for
   core-path/risky phases; 'council' only if cross-domain architecture review is warranted).
6. WRITE the artifact:
   - Feature Contract → docs/project_plans/feature_contracts/${category}/<slug>.md
   - Implementation Plan → docs/project_plans/implementation_plans/${category}/<slug>-v1.md
   Use the canonical frontmatter + body for that doc_type (see .claude/skills/planning templates).
   Derive <slug> as a short kebab-case name from the request.
7. EMBED a fenced \`\`\`json block tagged exactly "autopilot-graph" near the top of the artifact
   body, containing this object (the downstream structurer parses ONLY this block):
   {
     "tier": <int 0-3>, "effort_points": <number>,
     "wave_count": <int>, "phase_count": <int>, "file_count": <int>,
     "mode_d": <bool>, "mode_d_reasons": [<string>...],
     "needs_spike": <bool>, "spike_reasons": [<string>...],
     "single_pass_feasible": <bool>,
     "plan_artifact_path": "<the exact repo-relative path you wrote>",
     "execution_target": "execute-contract" | "execute-plan",
     "slug": "<kebab-slug>", "category": "${category}",
     "review_intensity": "standard" | "tier3" | "council",
     "files_affected": [<string>...],
     "execution_graph": { "waves": [ { "id": "wave-1", "phases": [ { "id": "phase-1", "title": "...", "mode": "C", "review_intensity": "standard", "tasks": [ { "id": "TASK-1.1", "prompt": "<full agent prompt>", "assigned_to": "<agentType>", "effort": <number>, "files_affected": [<string>...] } ] } ] } ] },
     "escalation_recommendation": "<one line: if this exceeds single-pass capacity, what full-planning path to take>"
   }
   For execute-contract, execution_graph may be a single wave/phase whose task is the sprint;
   the contract file itself is the source of truth for the sprint.

OUTPUT: a plain-text summary (tier, points, waves, target, artifact path, and whether you believe
it is single-pass feasible). Do NOT emit structured output — a structurer reads your artifact.
${buildPlannerNestingClause(nestingEnabled)}
Do NOT implement code. Do NOT git add/commit/push/stash.`
}

/**
 * Structure stage (Stage B — haiku general-purpose, schema: AUTOPILOT_PLAN_SCHEMA).
 * Reads the artifact, extracts the `autopilot-graph` JSON block. Read-only.
 */
function structurePrompt() {
  return `Mode: A — Exploration Only

The autopilot planner just wrote a plan artifact under docs/project_plans/ (a Feature Contract
or an Implementation Plan). Its body contains a fenced \`\`\`json block tagged "autopilot-graph".

STEPS:
1. Locate the artifact. It was written this run; the planner's summary names the path. If needed,
   search docs/project_plans/feature_contracts/ and docs/project_plans/implementation_plans/ for
   the most recently modified file matching the request slug.
2. Read the artifact and find the fenced "autopilot-graph" JSON block.
3. Return that object EXACTLY as the structured AutopilotPlan, conforming to the schema. Pass
   execution_graph through verbatim. Do not invent or alter values; copy what the planner wrote.
4. If you cannot find the artifact or the block, return your best-effort object with
   single_pass_feasible=false and escalation_recommendation explaining the miss.

Do NOT edit any files. Read only. Do NOT git add/commit/push/stash.`
}

// ─── nested-engine arg builders (pure — timestamp threaded from args) ─────────

function nestedBudget(plan) {
  const pts = typeof plan.effort_points === 'number' ? plan.effort_points : 4
  return Math.max(25000, Math.round(pts * 6250))
}

function contractArgs(parsed, plan) {
  return {
    contract_path: plan.plan_artifact_path,
    plan_ref: plan.plan_artifact_path,
    tier: plan.tier || 1,
    timestamp: parsed.timestamp,
    budget_total: nestedBudget(plan),
    review_intensity: plan.review_intensity || 'standard',
    context_paths: parsed.context_paths || [],
    contract_metadata: {
      slug: plan.slug || '',
      mode: 'C',
      files_affected: plan.files_affected || [],
      effort_points: plan.effort_points || 0,
    },
  }
}

function planExecArgs(parsed, plan) {
  const graph = plan.execution_graph || {}
  return {
    waves: graph.waves || [],
    tier: plan.tier || 2,
    plan_ref: plan.plan_artifact_path,
    timestamp: parsed.timestamp,
    budget_total: nestedBudget(plan),
  }
}

function autopilotAnnotation(plan, executionTarget, recommendation) {
  return {
    tier: plan.tier,
    effort_points: plan.effort_points,
    wave_count: plan.wave_count,
    phase_count: plan.phase_count,
    file_count: plan.file_count,
    plan_artifact_path: plan.plan_artifact_path,
    execution_target: executionTarget,
    escalation_recommendation: recommendation || plan.escalation_recommendation || '',
  }
}

// ─── workflow body ────────────────────────────────────────────────────────────

// Parse args defensively: the Workflow tool may deliver args as a JSON string or object.
const parsed = typeof args === 'string' ? JSON.parse(args) : args

// ── dry-run short-circuit ─────────────────────────────────────────────────────
if (parsed.dry_run === true) {
  log('Dry-run mode — returning parsed args envelope without spawning agents.')
  return {
    status: 'complete',
    report: [],
    _dry_run: true,
    _parsed_args: parsed,
  }
}

const ceiling = resolveCeiling(parsed)

// Phase 4 Tier C nesting pilot — DEFAULT FALSE. When off, the planner prompt is byte-for-byte
// identical to pre-pilot. When true, the planner MAY nest bounded read-only scouts for scoping
// (governed by .claude/specs/subagent-nesting-spec.md).
const {
  planner_nesting_enabled = false,
} = parsed

// ── Phase 1: Plan (Stage A — implementation-planner, no schema) ──────────────
phase('Plan')
log(`Planning autopilot request (ceiling: ≤${ceiling.max_points} pts, ≤${ceiling.max_waves} waves).`)

if (planner_nesting_enabled) {
  log('Tier C nesting pilot: planner_nesting_enabled=true (depth-1, read-only scouts).')
}
const planText = await agent(planPrompt(parsed, ceiling, planner_nesting_enabled), {
  label: 'plan',
  phase: 'Plan',
  agentType: 'implementation-planner',
  // No schema: the planner writes the durable artifact; Stage B structures it.
})

if (!planText) {
  log('Planner was skipped — returning to Opus.')
  return {
    status: 'needs_opus',
    reason: 'plan_structure_failed',
    report: [],
    autopilot: { execution_target: 'none', escalation_recommendation: 'Planner agent was skipped; re-run /dev:autopilot or plan manually.' },
  }
}

// ── Phase 2: Structure plan (Stage B — haiku, schema) ────────────────────────
phase('Structure plan')
log('Structuring the plan artifact into an AutopilotPlan.')

let plan
try {
  plan = await agent(structurePrompt(parsed), {
    label: 'plan-structurer',
    phase: 'Structure plan',
    agentType: 'general-purpose',
    model: 'haiku',
    schema: AUTOPILOT_PLAN_SCHEMA,
  })
} catch (structureErr) {
  log(`WARNING: Structure stage threw (${structureErr && structureErr.message ? structureErr.message : structureErr}). Escalating to Opus.`)
  plan = null
}

if (!plan) {
  return {
    status: 'needs_opus',
    reason: 'plan_structure_failed',
    report: [],
    autopilot: { execution_target: 'none', escalation_recommendation: 'Could not structure the plan artifact. Read the most recent file under docs/project_plans/ and decide manually.' },
  }
}

// ── Feasibility gate (deterministic; authoritative over planner self-assessment) ──
// Order: boundary reasons (mode_d, spike) win over scope; plan_only is evaluated last.
const modeD = plan.mode_d === true || hasHighRiskPaths(plan.files_affected)
if (modeD) {
  log('Mode D boundary detected — escalating to interactive Opus before any execution.')
  return {
    status: 'needs_opus',
    reason: 'mode_d',
    blocked_phase: 'execute',
    report: [],
    autopilot: autopilotAnnotation(plan, 'none', 'High-risk (Mode D) work: run interactively under Mode D discipline (delegation-modes.md).'),
  }
}

if (plan.needs_spike === true) {
  log('Unresolved research unknowns — escalating to SPIKE/exploration.')
  return {
    status: 'needs_opus',
    reason: 'spike_required',
    report: [],
    autopilot: autopilotAnnotation(plan, 'none', 'Run /plan:explore or /plan:spike to resolve unknowns before committing.'),
  }
}

const scopeExceeded =
  (plan.tier || 0) >= 3 ||
  (plan.effort_points || 0) > ceiling.max_points ||
  (plan.wave_count || 0) > ceiling.max_waves ||
  (plan.phase_count || 0) > ceiling.max_phases ||
  (plan.file_count || 0) > ceiling.max_files

if (scopeExceeded) {
  log(`Scope exceeds single-pass capacity (tier ${plan.tier}, ${plan.effort_points} pts, ${plan.wave_count} waves, ${plan.phase_count} phases, ${plan.file_count} files). Escalating to full planning.`)
  return {
    status: 'needs_opus',
    reason: 'scope_exceeds_single_pass',
    report: [],
    autopilot: autopilotAnnotation(plan, 'none', 'Run /plan:plan-feature (Tier 2/3 → PRD + Implementation Plan). The draft plan artifact is a head start.'),
  }
}

if (parsed.plan_only === true) {
  log('plan_only mode — plan is feasible; returning to Opus without executing.')
  return {
    status: 'needs_opus',
    reason: 'plan_only',
    report: [],
    autopilot: autopilotAnnotation(plan, plan.execution_target, 'Plan is single-pass feasible. Relaunch /dev:autopilot with plan_only:false to execute.'),
  }
}

// ── Phase 3: Execute (nest the appropriate engine — one level only) ──────────
phase('Execute')
log(`Feasibility gate passed. Dispatching to ${plan.execution_target}.`)

let childReport
try {
  if (plan.execution_target === 'execute-plan') {
    childReport = await workflow('execute-plan', planExecArgs(parsed, plan))
  } else {
    childReport = await workflow('execute-contract', contractArgs(parsed, plan))
  }
} catch (execErr) {
  log(`WARNING: Nested ${plan.execution_target} threw (${execErr && execErr.message ? execErr.message : execErr}). Escalating to Opus.`)
  return {
    status: 'needs_opus',
    report: [],
    autopilot: autopilotAnnotation(plan, plan.execution_target, `Nested ${plan.execution_target} errored — inspect the plan artifact and git state, then resume manually.`),
  }
}

if (!childReport || typeof childReport !== 'object') {
  return {
    status: 'needs_opus',
    report: [],
    autopilot: autopilotAnnotation(plan, plan.execution_target, `Nested ${plan.execution_target} returned no report — inspect git state and resume manually.`),
  }
}

// Propagate the nested engine's report, annotated with the autopilot classification.
const result = {
  status: childReport.status || 'needs_opus',
  report: childReport.report || [],
  autopilot: autopilotAnnotation(plan, plan.execution_target, plan.escalation_recommendation || ''),
}
if (childReport.reason) result.reason = childReport.reason
if (childReport.blocked_phase) result.blocked_phase = childReport.blocked_phase
if (childReport.hitl_tasks) result.hitl_tasks = childReport.hitl_tasks

log(`Autopilot complete — nested ${plan.execution_target} returned status: ${result.status}.`)
return result
