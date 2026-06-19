// execute-plan.js — Tier 2/3 plan execution workflow.
//
// Spec:     .claude/specs/workflows/execute-plan-workflow-spec.md
// Contract: .claude/specs/workflows/workflow-authoring-spec.md
// Patterns: .claude/skills/dev-execution/orchestration/workflow-patterns.md
// Schemas:  .claude/specs/workflows/schemas/execution-graph.schema.json
//           .claude/specs/workflows/schemas/execution-report.schema.json
//
// P3 offload wiring (provider_routing_enabled=true required to activate):
//   - AC validation / task-completion-validator: codex-executor (read-only sandbox, two-stage)
//     Stage A: codex validates AC checklist → writes artifact to deterministic path (no schema).
//     Stage B: cheap haiku structurer reads artifact → emits VERDICT_SCHEMA result.
//     Stage-B miss: fallback minimal verdict (approved:false) — Stage A artifact preserved.
//     P5 runtime-failure fallback: Stage A codex null/throw (rate-limit / timeout / binary-absent)
//     → SINGLE re-dispatch to the PRIMARY claude reviewer via the flag-off on-primary path
//     (reviewPrompt → reviewerType + VERDICT_SCHEMA), yielding a real verdict; records
//     actual_provider_used:'claude' + fallback_applied:true + a log() line. No retry, no backoff.
// P4 offload wiring (provider_routing_enabled=true AND phase/task provider:bob required):
//   - Fix-cycle agent: bob-delegate-executor when provider:bob + Mode-D guard passes.
//     Mode-D guard fires BEFORE Bob dispatch; on trigger → route to claude (on-primary).
//     Bob fallback: timeout/binary-absent/structuring-error → log actual_provider_used:'claude',
//     fallback_applied:true; dispatch same task to claude immediately (no Bob retry).
//   MUST-stay (never offloaded under any flag):
//   - Council-tier adjudication: review-council sub-workflow (unchanged)
//   - Standard / tier3 reviewer: task-completion-validator / karen (on-primary)
//   - Mode-D boundary: always fires before any agents spawn (constraint 2)
//   - Progress tracker: artifact-tracker on haiku (on-primary utility)
//
// Forbidden in this file: Date.now(), Math.random(), new Date() (no args), any FS/shell call.
// All timestamps come from args.timestamp (set by Opus pre-flight).

export const meta = {
  name: 'execute-plan',
  description: 'Execute a Tier 2/3 implementation plan wave-by-wave with per-task specialists. Opus builds the ExecutionGraph pre-flight and passes it as args. Use when running a multi-wave plan that has wave_plan frontmatter.',
  phases: [
    { title: 'Dry run' },
    { title: 'Wave wave-1' },
    { title: 'Wave wave-2' },
    { title: 'Wave wave-3' },
    { title: 'Wave wave-4' },
    { title: 'Wave wave-5' },
    { title: 'Review' },
    { title: 'Fix cycle 1' },
    { title: 'Fix cycle 2' },
    { title: 'Progress update' },
  ],
  whenToUse: 'Invoke via /dev:execute-plan after Opus builds the ExecutionGraph from wave_plan frontmatter. Use dry_run:true first to inspect the graph. Keep the manual /dev:execute-plan loop as fallback until Phase 6.',
}

// ---------------------------------------------------------------------------
// JSON Schemas for structured agent output (passed via schema: option to agent()).
// These are inline because the script cannot read files (constraint 1).
// ---------------------------------------------------------------------------

const TASK_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'assigned_to', 'status'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    assigned_to: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'skipped', 'failed'] },
    commit_sha: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
    summary: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['approved', 'reviewer_type'],
  additionalProperties: false,
  properties: {
    approved: { type: 'boolean' },
    reviewer_type: {
      type: 'string',
      enum: ['task-completion-validator', 'karen', 'council-review', 'code-reviewer', 'senior-code-reviewer'],
    },
    required_fixes: { type: 'array', items: { type: 'string' } },
    council_artifacts: {
      type: 'object',
      properties: {
        run_dir: { type: 'string' },
        findings_yaml: { type: 'string' },
        scorecard_json: { type: 'string' },
        risk_register_yaml: { type: 'string' },
        decision_record_md: { type: 'string' },
        validation_plan_md: { type: 'string' },
      },
      required: ['run_dir'],
    },
  },
}

// ---------------------------------------------------------------------------
// Pattern: councilEscalation — reviewer agentType routing per authoring-spec §8.
// ---------------------------------------------------------------------------

// Reviewer routing is driven PURELY by the per-phase review_intensity field
// (schema default 'standard'), NOT by plan tier. The previous `tier === 3 → karen`
// rule fired on every tier-3 phase and silently overrode the per-phase 'standard'
// default — making karen (opus) the reviewer for all phases of a tier-3 plan
// regardless of intent. Opus pre-flight now sets review_intensity:'tier3' only on
// milestone phases (e.g. end-of-feature, security cutover); everything else stays
// 'standard' → task-completion-validator. `tier` is retained for signature
// compatibility but no longer changes the default.
function councilEscalation(p, _tier) {
  if (p.review_intensity === 'council') return 'council-review'
  if (p.review_intensity === 'tier3') return 'karen'
  return 'task-completion-validator'
}

// ---------------------------------------------------------------------------
// HITL detection — tasks assigned to a human (not a registered agentType) are
// never dispatched via agent() (that would try to spawn an agent literally named
// e.g. "nick"). They are collected as HITL gates and bubbled up to Opus after the
// wave's agent work completes (reason:'hitl_required'). Until the external task
// tracker (intent-tree) is wired in, this is the human-in-the-loop gate. A task is
// HITL when explicitly flagged (t.hitl === true) or its assigned_to is not a known agent.
// ---------------------------------------------------------------------------

const KNOWN_AGENT_TYPES = new Set([
  'python-backend-engineer', 'ui-engineer-enhanced', 'ui-engineer', 'frontend-developer',
  'frontend-architect', 'backend-architect', 'backend-typescript-architect',
  'nextjs-architecture-expert', 'data-layer-expert', 'refactoring-expert', 'openapi-expert',
  'ai-engineer', 'documentation-complex', 'documentation-writer', 'documentation-expert',
  'api-documenter', 'changelog-generator', 'feature-sprint-executor', 'phase-owner',
  'codebase-explorer', 'search-specialist', 'symbols-engineer', 'artifact-tracker',
  'task-completion-validator', 'karen', 'council-review', 'code-reviewer',
  'senior-code-reviewer', 'api-librarian', 'telemetry-auditor', 'prd-writer',
  'feature-planner', 'general-purpose',
])

function isHitlTask(t) {
  return t?.hitl === true || (!!t?.assigned_to && !KNOWN_AGENT_TYPES.has(t.assigned_to))
}

// ---------------------------------------------------------------------------
// Pattern: modeBoundary — detect Mode D before spawning any agents for a wave.
// Returns an early-exit ExecutionReport or null (continue).
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS = [
  /auth/i, /payment/i, /billing/i, /migration/i, /alembic/i,
  /delete/i, /drop_table/i, /secret/i, /token/i,
]

function modeBoundary(wave, report) {
  // Explicit Mode D flag on any phase in this wave.
  const modeD = wave.phases.find(p => p.mode === 'D')
  if (modeD) {
    return { status: 'blocked', reason: 'mode_d', blocked_phase: modeD.id, report }
  }

  // Implicit Mode D: files_affected heuristic for high-risk paths.
  // Fires needs_opus (not blocked) so Opus can inspect before deciding.
  const riskyPhase = wave.phases.find(p =>
    (p.files_affected ?? []).some(f =>
      HIGH_RISK_PATTERNS.some(pat => pat.test(f))
    )
  )
  if (riskyPhase) {
    return { status: 'needs_opus', reason: 'mode_d', blocked_phase: riskyPhase.id, report }
  }

  return null // No boundary — continue execution.
}

// ---------------------------------------------------------------------------
// P4: Mode-D guard for individual fix-cycle tasks (design_spec §7 MUST-stay table).
// Called BEFORE dispatching Bob in the fix-cycle. Returns a reason string if Mode-D
// is triggered, or null (safe to proceed to Bob).
//
// Trigger table (phase-4-bob-fixcycle.md § "Mode-D Guard Specification"):
//   1. files_affected ∩ skillmeat/api/auth/   — auth scope changes
//   2. files_affected ∩ skillmeat/api/middleware/auth* — auth middleware
//   3. files_affected ∩ payment-related paths — payment processing
//   4. files_affected ∩ skillmeat/cache/migrations/ — DB migrations
//   5. task_class contains 'deletion' / SQL contains DROP / DELETE keyword
//   6. task_class contains 'secret' / 'rotate' — secret rotation
//   7. task prompt / class mentions force-push / git reset --hard
// ---------------------------------------------------------------------------

const MODE_D_FILE_PATTERNS = [
  /skillmeat\/api\/auth\//i,
  /skillmeat\/api\/middleware\/auth/i,
  /skillmeat\/cache\/migrations\//i,
  /payment/i,
  /billing/i,
  /stripe/i,
]

const MODE_D_CLASS_PATTERNS = [
  /deletion/i,
  /secret/i,
  /rotat/i,
  /force.push/i,
  /reset.*--hard/i,
  /drop.table/i,
]

/**
 * P4 Mode-D guard for a fix-cycle task before Bob dispatch.
 * Reuses the same HIGH_RISK_PATTERNS from modeBoundary() for files.
 *
 * @param {object} phase  - Current phase object (has files_affected, mode, task_class, id)
 * @param {string} prompt - Fix prompt text (scanned for destructive git keywords)
 * @returns {string|null}  Trigger reason string, or null (safe to dispatch Bob)
 */
function fixTaskModeDGuard(phase, prompt) {
  // 1. Explicit Mode D on the phase.
  if (phase && phase.mode === 'D') {
    return `phase.mode is 'D' for phase ${phase.id || '(unknown)'}`
  }

  // 2. files_affected heuristic (Mode-D file paths).
  const files = phase && Array.isArray(phase.files_affected) ? phase.files_affected : []
  for (const f of files) {
    for (const pat of MODE_D_FILE_PATTERNS) {
      if (pat.test(f)) {
        return `files_affected contains high-risk path matching ${pat}: ${f}`
      }
    }
  }

  // 3. task_class / fix_agent class heuristic (deletion, secret, force-push keywords).
  const taskClass = (phase && phase.task_class) || ''
  for (const pat of MODE_D_CLASS_PATTERNS) {
    if (pat.test(taskClass)) {
      return `task_class '${taskClass}' matches Mode-D class pattern ${pat}`
    }
  }

  // 4. Prompt scan for destructive git operations or DROP/DELETE SQL keywords.
  const promptText = typeof prompt === 'string' ? prompt : ''
  const PROMPT_DANGER = [
    /git\s+push\s+--force/i,
    /git\s+reset\s+--hard/i,
    /DROP\s+TABLE/i,
    /\bDELETE\s+FROM\b/i,
    /alembic\s+(upgrade|downgrade)/i,
  ]
  for (const pat of PROMPT_DANGER) {
    if (pat.test(promptText)) {
      return `fix prompt contains destructive operation matching ${pat}`
    }
  }

  return null // Safe to dispatch Bob.
}

// ---------------------------------------------------------------------------
// Durability footer — appended to all implementation/sprint/fix agent prompts.
// Encodes the commit-checkpoint invariant (workflow-authoring-spec.md §16):
//   - Isolated worktree branch: commit each logical unit as you go.
//   - Do NOT push, merge, stash, or touch other branches.
// Reviewer and tracker agents do NOT use this footer (they are edit-less).
// ---------------------------------------------------------------------------

const DURABILITY_FOOTER = `

DURABILITY: You are on an isolated worktree branch you own. Commit each logical unit of your work to this branch as you go (this is required so your work survives a mid-run crash and is visible to the reviewer/resume). Do NOT push, do NOT merge, do NOT stash, do NOT touch other branches.`

// ---------------------------------------------------------------------------
// Per-task fallback structurer schema and prompt.
// Used when a task agent throws on its terminal StructuredOutput call (schema miss).
// A cheap haiku structurer reads git state and emits a minimal TASK_RESULT_SCHEMA result
// so the task is not silently dropped from the phase's taskOut array.
// ---------------------------------------------------------------------------

function fallbackStructurePrompt(t) {
  return `Mode: A — Exploration Only

A task agent completed its work but failed to emit structured output.
Recover its result by reading git state.

Task id: ${t.id}
Agent: ${t.assigned_to}

Run:
  git log -1 --oneline
  git rev-parse HEAD

Return a TASK_RESULT_SCHEMA result:
  - id: "${t.id}"
  - assigned_to: "${t.assigned_to}"
  - status: "completed"
  - commit_sha: <the HEAD sha you found, or "" if no new commits>
  - summary: "recovered from disk after StructuredOutput miss"

Do NOT edit any files. Read only.`
}

// ---------------------------------------------------------------------------
// Prompt builders — pure string construction, no FS access.
// ---------------------------------------------------------------------------

function reviewPrompt(p, taskOut) {
  const taskSummaries = taskOut
    .filter(Boolean)
    .map(t => `- ${t.id} (${t.assigned_to}): ${t.summary ?? 'no summary'} [${t.status}]${t.commit_sha ? ' commit:' + t.commit_sha : ''}`)
    .join('\n')

  return `Mode: E — Reviewer

Review the completed phase and determine whether acceptance criteria are met.

Phase: ${p.id} — ${p.title}
Plan reference: ${planRef}

Completed tasks:
${taskSummaries || '(no tasks completed)'}

Return a verdict conforming to the VERDICT_SCHEMA. Set approved:true only if all tasks completed
successfully and no blockers remain. If approved:false, provide actionable required_fixes.
Do NOT git add/commit/push/stash.`
}

function fixPrompt(p, requiredFixes) {
  const fixList = (requiredFixes ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')

  return `Mode: C — Autonomous Feature Sprint

Fix the following issues identified by the reviewer for phase ${p.id} — ${p.title}.

Required fixes:
${fixList || '(see phase context for issues)'}

Apply all fixes.` + DURABILITY_FOOTER
}

function trackerPrompt(progressFile, completedTaskIds) {
  const updateArg = completedTaskIds.map(id => `${id}:completed`).join(',')
  return `Run the following command and return the exit code:

python .claude/skills/artifact-tracking/scripts/update-batch.py \\
  -f ${progressFile} \\
  --updates "${updateArg}"

Do NOT git add/commit/push/stash.`
}

// Phase 3 Tier B nesting pilot. Returns a governed implementer-decomposition clause when
// enabled, or an empty string (byte-for-byte preservation) when off. The phase-owner is a
// Mode C executor and the SINGLE committer; nested children may edit but never commit.
function buildPhaseOwnerNestingClause(enabled) {
  if (!enabled) return ''
  return `
BOUNDED IMPLEMENTER DECOMPOSITION (Tier B nesting pilot — depth-capped):
If this phase splits into bounded sub-tasks you cannot cleanly implement inline, you MAY spawn
nested implementers via the Agent tool to DECOMPOSE the work. Rules:
  - Decomposition, NOT throughput: a single Agent call blocks, and batched nested spawns get
    UNGOVERNED concurrency (no parallel() cap+queue, no shared-budget accounting). Prefer
    implementing inline; spawn children only to break a genuinely separable sub-task down.
  - Depth cap = 1: children MUST NOT spawn their own children. Do not grant them recursion rights.
  - Each child is bounded to fewer than 40 tool uses (per-level context budget). Keep slices narrow.
  - Children may edit files in this worktree but MUST NOT git add/commit/push/stash. YOU remain the
    SINGLE committer for this phase and consolidate all child work into your commits.
  - Mode-D-at-depth: nested agents are PROHIBITED from auth / payments / migrations / deletion /
    force-push / secret-rotation work. If a sub-task touches Mode-D territory, do NOT delegate it to
    a child — STOP that thread and surface 'needs_opus / mode_d' in your Completion Report for Opus.
  - Claude-primary-only: nested children run on the primary subscription; never route a child to an
    offloaded provider executor.
Governance: .claude/specs/subagent-nesting-spec.md (Mode-D at Depth, Per-Level Context Budget,
Durability Contract, Claude-Primary-Only Nesting).`
}

function adaptivePhasePrompt(p, planRef, nestingEnabled) {
  const taskList = (p.tasks ?? [])
    .map(t => `- ${t.id} (${t.assigned_to}): ${t.prompt.slice(0, 120)}...`)
    .join('\n')

  return `Mode: C — Autonomous Feature Sprint

You are the phase orchestrator for an adaptive phase that cannot enumerate tasks up front.

Phase: ${p.id} — ${p.title}
Plan reference: ${planRef}
Isolation: ${p.isolation ?? 'shared'}

Known tasks (may be partial):
${taskList || '(derive from plan context)'}

Explore the plan, implement the phase tasks with appropriate file-ownership batching.` + buildPhaseOwnerNestingClause(nestingEnabled) + DURABILITY_FOOTER
}

// ---------------------------------------------------------------------------
// Pattern: fixLoop — fix → re-review, max 2 cycles, budget-guarded.
//
// P4: When provider_routing_enabled=true AND the phase specifies provider:'bob',
// the fix agent is routed to bob-delegate-executor (instead of the hardcoded
// p.fix_agent / task assigned_to). Gate order:
//   1. Mode-D guard (fixTaskModeDGuard) — if triggered: route to claude, log reason.
//   2. provider:bob routing — dispatch bob-delegate-executor.
//   3. Bob failure (try/catch null result) — log fallback, dispatch claude immediately.
//   Flag-off (provider_routing_enabled=false): restores pre-P4 hardcoded fix-agent path.
// ---------------------------------------------------------------------------

async function fixLoop(p, taskOut, initialVerdict, reviewerType) {
  let verdict = initialVerdict
  let cycles = 0

  while (!verdict?.approved && cycles < 2 && budget.remaining() > 60_000) {
    const cycleLabel = `Fix cycle ${cycles + 1}`
    const fixPromptText = fixPrompt(p, verdict?.required_fixes)

    // P4: Bob fix-cycle routing — three-gate check.
    if (provider_routing_enabled && p.provider === 'bob') {
      // Gate 1: Mode-D guard (MUST fire before Bob dispatch — design_spec §7).
      const modeDReason = fixTaskModeDGuard(p, fixPromptText)
      if (modeDReason) {
        // Mode-D triggered: abort Bob, route to claude, record reason.
        log(`P4 Mode-D guard triggered for phase ${p.id} fix-cycle ${cycles + 1}: ${modeDReason}. Routing to claude (not Bob).`)
        // Dispatch claude on-primary for this fix (same prompt, same semantics).
        await agent(fixPromptText, {
          phase: cycleLabel,
          agentType: p.fix_agent || taskOut.filter(Boolean)[0]?.assigned_to || 'python-backend-engineer',
          model: p.model,
          _routing_log: {
            chosen_plugin_id: 'claude',
            actual_provider_used: 'claude',
            fallback_applied: false,
            reason: `mode_d: ${modeDReason}`,
          },
        })
      } else {
        // Gate 2: Bob dispatch (Mode-D cleared).
        log(`P4 Bob fix-cycle routing: dispatching bob-delegate-executor for phase ${p.id} fix-cycle ${cycles + 1}.`)
        let bobResult = null
        let bobFailed = false
        try {
          bobResult = await agent(fixPromptText, {
            phase: cycleLabel,
            agentType: 'bob-delegate-executor',
            model: p.model,
            _routing_log: {
              chosen_plugin_id: 'bob',
              actual_provider_used: 'bob',
              fallback_applied: false,
              reason: `provider:bob fix-cycle for phase ${p.id}`,
            },
          })
          // Bob returns null on Mode-D abort inside the executor or tool failure.
          if (!bobResult) {
            bobFailed = true
            log(`P4 Bob fix-cycle: bob-delegate-executor returned null for phase ${p.id} fix-cycle ${cycles + 1}. Triggering fallback to claude.`)
          }
        } catch (bobErr) {
          bobFailed = true
          log(`P4 Bob fix-cycle: bob-delegate-executor threw for phase ${p.id} fix-cycle ${cycles + 1}: ${bobErr && bobErr.message ? bobErr.message : bobErr}. Triggering fallback to claude.`)
        }

        // Gate 3: Bob fallback — immediate escalation to claude, no Bob retry.
        if (bobFailed) {
          log(`P4 Bob fallback: actual_provider_used='claude', fallback_applied=true for phase ${p.id} fix-cycle ${cycles + 1}.`)
          await agent(fixPromptText, {
            phase: cycleLabel,
            agentType: p.fix_agent || taskOut.filter(Boolean)[0]?.assigned_to || 'python-backend-engineer',
            model: p.model,
            _routing_log: {
              chosen_plugin_id: 'bob',
              actual_provider_used: 'claude',
              fallback_applied: true,
              reason: 'bob-delegate-executor failed (timeout / binary absent / structuring error); escalated to claude immediately (no retry)',
            },
          })
        }
      }
    } else {
      // Flag-off OR no provider:bob: pre-P4 hardcoded fix-agent path (unchanged).
      await agent(fixPromptText, {
        phase: cycleLabel,
        agentType: p.fix_agent || taskOut.filter(Boolean)[0]?.assigned_to || 'python-backend-engineer',
        model: p.model,
      })
    }

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
    verdict: verdict ?? { approved: false, reviewer_type: reviewerType },
    fix_cycles: cycles,
    escalate: !verdict?.approved,
    files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
    blockers: verdict?.approved
      ? []
      : [{ description: 'Reviewer did not approve after fix-loop cycles.', resolution_hint: 'Opus adjudication required.' }],
  }
}

// ---------------------------------------------------------------------------
// Pattern: reviewerGate — select reviewer, run, hand off to fixLoop on rejection.
//
// For review_intensity:'council' phases, invokes the review-council sub-workflow
// via workflow('review-council', ...) (one nesting level — execute-plan is the top
// workflow; review-council is the only sub-workflow it may nest).
// For all other phases, falls back to a plain agent() call with an edit-less agentType.
// ---------------------------------------------------------------------------

async function reviewerGate(p, taskOut, tier) {
  // Council path: invoke review-council sub-workflow for core-path / high-risk phases.
  // This codifies the "[Pair adversarial reviewer with AC validator]" lesson:
  // deterministically runs diverse-lens reviewers + adversarial code-tracer in parallel.
  if (p.review_intensity === 'council') {
    const councilVerdict = await workflow('review-council', {
      target: { type: 'phase-taskout', ref: p.id, description: p.title || p.id },
      task_summaries: JSON.stringify(taskOut.filter(Boolean)),
      plan_ref: planRef,
      phase_id: p.id,
      timestamp: graph.timestamp,
      intensity: 'standard',
    })

    // workflow() returns null if the user skips. Treat as a non-approval requiring escalation.
    const verdict = councilVerdict
      ? { ...councilVerdict, reviewer_type: 'council-review' }
      : { approved: false, reviewer_type: 'council-review', required_fixes: ['Council workflow was skipped — manual review required.'] }

    if (!verdict.approved) {
      return fixLoop(p, taskOut, verdict, 'council-review')
    }

    return {
      phase: p.id,
      tasks: taskOut,
      verdict,
      fix_cycles: 0,
      escalate: false,
      files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
      blockers: [],
    }
  }

  // Standard / tier3 path: single edit-less reviewer agent.
  // P3: when provider_routing_enabled=true, use codex-executor two-stage AC validation
  // instead of direct agent() call with VERDICT_SCHEMA. Council path is MUST-STAY (above).
  const reviewerType = councilEscalation(p, tier)

  let verdict

  if (provider_routing_enabled) {
    // P3 two-stage AC validation: codex-executor Stage A + haiku Stage B.
    const acArtifactPath = acValidationArtifactPath(p.id, planRef, graph.timestamp)
    log(`P3 two-stage AC validation for phase ${p.id}: Stage A codex → artifact at ${acArtifactPath}`)

    // Stage A: codex-executor — validates ACs, writes checklist to artifact path, no schema.
    // P5 runtime-failure fallback (generalizes the P4 Bob null→claude pattern): a null
    // return OR a thrown error (rate-limit / timeout / binary-absent) from codex-executor
    // triggers a SINGLE re-dispatch to the PRIMARY claude reviewer — the flag-off on-primary
    // path (reviewPrompt → reviewerType with VERDICT_SCHEMA), which yields a real verdict.
    // No retry loop, no backoff (constraint 4: no timers). Records actual_provider_used +
    // fallback_applied. reviewerType is edit-less (constraint 3), preserved unchanged.
    let stageAText = null
    let stageAFailed = false
    try {
      stageAText = await agent(
        codexAcValidationPrompt(p, taskOut, planRef, acArtifactPath),
        {
          label: `${p.id}:ac-validate:stage-a`,
          phase: 'Review',
          agentType: 'codex-executor',
          model: 'sonnet',
          // No schema: read-only AC validation; structurer Stage B emits VERDICT_SCHEMA.
          _routing_log: {
            chosen_plugin_id: 'codex',
            actual_provider_used: 'codex',
            fallback_applied: false,
            reason: `offload AC validation Stage A to codex-executor for phase ${p.id}`,
          },
        }
      )
      if (!stageAText) {
        stageAFailed = true
        log(`P5 fallback: codex-executor returned null for ${p.id} AC validation Stage A. Falling back to primary claude reviewer (${reviewerType}).`)
      }
    } catch (codexErr) {
      stageAFailed = true
      log(`P5 fallback: codex-executor threw for ${p.id} AC validation Stage A: ${codexErr && codexErr.message ? codexErr.message : codexErr}. Falling back to primary claude reviewer (${reviewerType}).`)
    }

    if (stageAFailed) {
      // Primary-claude fallback: run the flag-off on-primary reviewer directly. This emits a
      // real VERDICT_SCHEMA verdict (not a synthetic not-approved placeholder) and skips the
      // codex Stage B structurer entirely (no artifact was written).
      log(`P5 fallback: actual_provider_used='claude', fallback_applied=true for ${p.id} AC validation.`)
      verdict = await agent(reviewPrompt(p, taskOut), {
        label: `${p.id}:ac-validate:primary-fallback`,
        phase: 'Review',
        agentType: reviewerType,
        schema: VERDICT_SCHEMA,
        _routing_log: {
          chosen_plugin_id: 'codex',
          actual_provider_used: 'claude',
          fallback_applied: true,
          reason: `codex-executor failed (rate-limit / timeout / binary absent); escalated to primary claude reviewer immediately (no retry)`,
        },
      })
      if (!verdict) {
        log(`Primary-claude AC validation fallback returned null for ${p.id}. Using not-approved placeholder so fix-loop runs.`)
        verdict = {
          approved: false,
          reviewer_type: reviewerType,
          required_fixes: [`AC validation failed for phase ${p.id} — codex-executor and primary claude reviewer both returned null`],
        }
      }
    } else {
      log(`Stage A complete for ${p.id}. Running Stage B haiku structurer...`)
      // Stage B: cheap haiku structurer — reads checklist artifact, emits VERDICT_SCHEMA.
      try {
        verdict = await agent(
          codexAcStructurePrompt(p, taskOut, planRef, acArtifactPath, graph.timestamp, reviewerType),
          {
            label: `${p.id}:ac-validate:stage-b`,
            phase: 'Review',
            agentType: 'general-purpose',
            model: 'haiku',
            schema: VERDICT_SCHEMA,
          }
        )
      } catch (stageBErr) {
        log(`Stage B threw for ${p.id} AC validation: ${stageBErr && stageBErr.message ? stageBErr.message : stageBErr}. Stage A artifact preserved at ${acArtifactPath}.`)
        verdict = {
          approved: false,
          reviewer_type: reviewerType,
          required_fixes: [`Stage B schema extraction failed for phase ${p.id} — read ${acArtifactPath} for Stage A output`],
        }
      }
      if (!verdict) {
        log(`Stage B returned null for ${p.id} AC validation. Stage A artifact preserved at ${acArtifactPath}.`)
        verdict = {
          approved: false,
          reviewer_type: reviewerType,
          required_fixes: [`Stage B returned null for phase ${p.id} AC validation — read ${acArtifactPath}`],
        }
      }
    }
  } else {
    // Flag off: existing on-primary reviewer with inline VERDICT_SCHEMA (unchanged).
    verdict = await agent(reviewPrompt(p, taskOut), {
      phase: 'Review',
      agentType: reviewerType,
      schema: VERDICT_SCHEMA,
    })
  }

  if (!verdict?.approved) {
    return fixLoop(p, taskOut, verdict, reviewerType)
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict: verdict,
    fix_cycles: 0,
    escalate: false,
    files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
    blockers: [],
  }
}

// ---------------------------------------------------------------------------
// Pattern: trackerStep — update progress YAML via artifact-tracker agent.
// ---------------------------------------------------------------------------

async function trackerStep(progressFile, completedTaskIds) {
  if (!progressFile || completedTaskIds.length === 0) return

  await agent(trackerPrompt(progressFile, completedTaskIds), {
    phase: 'Progress update',
    agentType: 'artifact-tracker',
    model: 'haiku',
  })
}

// ---------------------------------------------------------------------------
// P3: Two-stage AC validation helpers.
// Used only when provider_routing_enabled=true (codex-executor for AC validation).
// Stage A: codex-executor reads plan + task outputs, writes AC checklist artifact.
// Stage B: cheap haiku reads artifact + emits VERDICT_SCHEMA result.
// Stage-B miss: fallback verdict with approved:false + blocker — Stage A artifact preserved.
// ---------------------------------------------------------------------------

function acValidationArtifactPath(phaseId, planRef, timestamp) {
  // Deterministic path: no Date.now(), no Math.random().
  // timestamp format: 2026-06-01T12:00:00Z → 20260601
  const datePart = (timestamp || 'nodate').replace(/T.*$/, '').replace(/-/g, '')
  const phaseSlug = (phaseId || 'phase').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  const planSlug = (planRef || 'plan').split('/').pop().replace(/\.md$/, '').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 24)
  return `.claude/worknotes/ac-validation/${datePart}-${planSlug}-${phaseSlug}-ac-check.md`
}

function codexAcValidationPrompt(p, taskOut, planRef, artifactPath) {
  const taskSummaries = taskOut
    .filter(Boolean)
    .map(t => `- ${t.id} (${t.assigned_to}): ${t.summary ?? 'no summary'} [${t.status}]${t.commit_sha ? ' commit:' + t.commit_sha : ''}`)
    .join('\n')

  return `Mode: A — Exploration Only. Read-only investigation. Do NOT write production code. Do NOT git add/commit/push/stash.

You are the AC validator for phase: ${p.id} — ${p.title}
Plan reference: ${planRef}

Completed tasks:
${taskSummaries || '(no tasks completed)'}

Validate that the completed tasks satisfy all Acceptance Criteria from the plan reference.
For each AC: check if it is met (yes/no) with one-line evidence citing task IDs or commit SHAs.

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: evidence

This file MUST exist before you return. A downstream structurer will read it to emit the verdict.
Do NOT emit structured output yourself. Do NOT git add/commit/push/stash.`
}

function codexAcStructurePrompt(p, taskOut, planRef, artifactPath, timestamp, reviewerType) {
  // FIX 2: reviewerType is passed in (resolved via councilEscalation) so the verdict's
  // reviewer_type field reflects the actual escalation tier — e.g. 'karen' on tier3 phases,
  // not a hardcoded 'task-completion-validator'. Approval routing is unaffected.
  return `Mode: A — Exploration Only

Read the AC validation checklist at: ${artifactPath}

If the file does not exist, return:
  { "approved": false, "reviewer_type": "${reviewerType}", "required_fixes": ["AC validation artifact not found at ${artifactPath} — codex Stage A may have failed"] }

If the file exists:
  1. Count lines starting with "- [x]" (met) and "- [ ]" (not met).
  2. Set approved:true ONLY if all ACs are marked met (no "- [ ]" lines).
  3. For each unmet AC, add its text to required_fixes with a brief reason from the checklist.
  4. Set reviewer_type to "${reviewerType}".
  5. Return the VERDICT_SCHEMA object.

Do NOT write any files. Do NOT git add/commit/push/stash. Read only.`
}

// ---------------------------------------------------------------------------
// Main script body
// ---------------------------------------------------------------------------

// Defensive args parsing: the workflow runtime may pass args as a JSON string.
const graph = typeof args === 'string' ? JSON.parse(args) : args

const {
  waves,
  tier,
  plan_ref: planRef,
  dry_run: dryRun,
  progressFile,
  // P3: provider routing feature flag — DEFAULT FALSE. When off, existing reviewer
  // selections are preserved byte-for-byte. When true, AC validation routes to
  // codex-executor two-stage pattern.
  provider_routing_enabled = false,
  // Phase 3 Tier B nesting pilot — DEFAULT FALSE. When off, the adaptive phase-owner
  // prompt is byte-for-byte identical to pre-pilot. When true, the phase-owner MAY nest
  // bounded implementers for decomposition (governed by .claude/specs/subagent-nesting-spec.md).
  phase_owner_nesting_enabled = false,
} = graph

// ---------------------------------------------------------------------------
// dryRun short-circuit — FIRST conditional after graph parsing, before any agent() calls.
// Returns the parsed graph for Opus inspection. Not an ExecutionReport.
// ---------------------------------------------------------------------------
if (dryRun) {
  phase('Dry run')
  log('dry_run=true — returning parsed graph for inspection, no agents spawned.')
  return { status: 'dry_run', graph }
}

// ---------------------------------------------------------------------------
// Pattern: waveFanout — sequential waves, parallel phases, file-ownership batches.
// ---------------------------------------------------------------------------

const report = []

for (const wave of waves) {
  log(`Starting Wave ${wave.id}`)
  phase(`Wave ${wave.id}`)

  // Pattern: modeBoundary — detect Mode D before spawning any agents for this wave.
  // Mode D phases are NEVER executed inside the workflow (constraint 2).
  const boundary = modeBoundary(wave, report)
  if (boundary) return boundary

  // Budget exhaustion guard before dispatching an entire wave.
  if (budget.remaining() < 60_000) {
    log(`Budget exhausted before Wave ${wave.id} — returning to Opus.`)
    return { status: 'needs_opus', reason: 'budget_exhausted', report }
  }

  // All phases in this wave run concurrently (parallel barrier).
  const waveResults = await parallel(wave.phases.map(p => async () => {

    // Adaptive phases: task list cannot be enumerated up front; dispatch a phase-owner.
    if (p.phase_strategy === 'adaptive') {
      log(`Phase ${p.id} is adaptive — dispatching phase-owner.`)
      if (phase_owner_nesting_enabled) {
        log(`Tier B nesting pilot: phase_owner_nesting_enabled=true for ${p.id} (depth-1, single-committer).`)
      }
      const poResult = await agent(adaptivePhasePrompt(p, planRef, phase_owner_nesting_enabled), {
        label: p.id,
        phase: `Wave ${wave.id}`,
        agentType: 'phase-owner',
        model: p.model,
        isolation: p.isolation === 'worktree' ? 'worktree' : undefined,
      })

      // Adaptive phases get a reviewer gate on the phase-owner's output.
      const taskOut = poResult
        ? [{ id: p.id, assigned_to: 'phase-owner', status: 'completed', summary: poResult }]
        : []
      const phaseResult = await reviewerGate(p, taskOut, tier)

      if (progressFile) {
        await trackerStep(progressFile, taskOut.map(t => t.id))
      }
      return phaseResult
    }

    // Static phases: per-task specialist dispatch via file-ownership batches.
    const batches = p.batches && p.batches.length > 0
      ? p.batches
      : [p.tasks] // Fallback: treat all tasks as one batch if batches not precomputed.

    // Partition out human-assigned (HITL) tasks: they are gates, not dispatchable agent work.
    const hitlGates = (p.tasks ?? [])
      .filter(t => isHitlTask(t) && t.status !== 'completed')
      .map(t => ({ phase: p.id, id: t.id, assigned_to: t.assigned_to, prompt: t.prompt }))

    const taskOut = []

    for (const batch of batches) {
      // Inner parallel: only tasks with disjoint files_affected are in the same batch.
      // HITL tasks are skipped here — never passed to agent() as an agentType.
      const dispatchable = batch.filter(t => !isHitlTask(t))
      if (dispatchable.length === 0) continue
      const batchOut = await parallel(dispatchable.map(t => async () => {
        // Happy path: task agent emits structured output directly.
        // Durability footer appended to every task prompt (see DURABILITY_FOOTER).
        let result
        try {
          result = await agent(t.prompt + DURABILITY_FOOTER, {
            label: `${p.id}:${t.id}`,
            phase: `Wave ${wave.id}`,
            agentType: t.assigned_to,
            model: t.model,
            isolation: (t.isolation ?? p.isolation) === 'worktree' ? 'worktree' : undefined,
            schema: TASK_RESULT_SCHEMA,
          })
        } catch (_schemaErr) {
          // Per-task fallback structurer: task did work but missed terminal StructuredOutput.
          // A cheap haiku structurer reads git state and emits a minimal TASK_RESULT_SCHEMA result
          // so the task is not silently dropped. Keeps happy path single-agent.
          log(`Task ${t.id} schema miss — running fallback structurer.`)
          try {
            result = await agent(fallbackStructurePrompt(t), {
              label: `${p.id}:${t.id}:struct`,
              phase: `Wave ${wave.id}`,
              agentType: 'general-purpose',
              model: 'haiku',
              schema: TASK_RESULT_SCHEMA,
            })
          } catch (_fallbackErr) {
            log(`Task ${t.id} fallback structurer also failed — task will be dropped.`)
            result = null
          }
        }
        return result
      }))
      taskOut.push(...batchOut.filter(Boolean))
    }

    // Reviewer gate + fix-loop (edit-less agentType only — constraint 3).
    // Skip the reviewer when the phase had no agent work (pure-HITL phase) — there is
    // nothing to review; the human gate is surfaced via hitl_gates below.
    const phaseResult = taskOut.length > 0
      ? await reviewerGate(p, taskOut, tier)
      : { phase: p.id, tasks: [], verdict: { approved: true, reviewer_type: 'none' }, fix_cycles: 0, escalate: false, files_touched: [], blockers: [] }

    phaseResult.hitl_gates = hitlGates

    // trackerStep: one per phase (no FS in script — via artifact-tracker agent).
    if (progressFile) {
      const completedIds = taskOut.filter(t => t?.status === 'completed').map(t => t.id)
      if (completedIds.length > 0) {
        await trackerStep(progressFile, completedIds)
      }
    }

    return phaseResult
  }))

  const completedWaveResults = waveResults.filter(Boolean)
  report.push({ wave: wave.id, phases: completedWaveResults })

  // Escalate if any phase's fix-loop exhausted without reviewer approval.
  if (completedWaveResults.some(r => r?.escalate)) {
    log(`Wave ${wave.id}: reviewer escalation unresolved — returning to Opus.`)
    return { status: 'needs_opus', reason: 'reviewer_unresolved', report }
  }

  // HITL gate: if any phase in this wave has pending human-assigned tasks, the wave's
  // agent work + reviewer gates are done, but we cannot advance past a human sign-off
  // inside the workflow (constraint 2 — no mid-run human approval). Bubble up to Opus,
  // which coordinates the human review (future: external task-tracker / intent-tree
  // review request), then relaunches with the HITL tasks marked complete / trimmed.
  const hitlTasks = completedWaveResults.flatMap(r => r?.hitl_gates ?? [])
  if (hitlTasks.length > 0) {
    log(`Wave ${wave.id}: ${hitlTasks.length} human-assigned task(s) require HITL gating — returning to Opus.`)
    return { status: 'needs_opus', reason: 'hitl_required', hitl_tasks: hitlTasks, report }
  }

  // NB: cross-wave worktree merge happens in Opus post-wave (no git in script — constraint 1).
  log(`Wave ${wave.id} complete. Opus: run git merge --squash on worktree branches before next wave.`)
}

return { status: 'complete', report }
