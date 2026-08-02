/**
 * execute-contract — Tier 1 sprint workflow
 *
 * Spec: .claude/specs/workflows/execute-contract-workflow-spec.md
 * Master contract: .claude/specs/workflows/workflow-authoring-spec.md
 *
 * Patterns used: reviewerGate, fixLoop, modeBoundary (inline), two-stage structuring
 * Schemas: execution-graph.schema.json (args), execution-report.schema.json (return)
 *
 * Durability design (see workflow-authoring-spec.md §16):
 *   - Sprint stage: feature-sprint-executor, NO schema. Commits checkpoints to worktree.
 *     Writes Completion Report to a deterministic path before returning plain text.
 *   - Structure stage: haiku general-purpose agent, schema: SPRINT_RESULT_SCHEMA.
 *     Reads the report from disk and derives structured fields from git state.
 *   This two-stage design prevents a terminal StructuredOutput miss from discarding
 *   the sprint's committed work. The structure stage falls back gracefully on failure.
 *
 * P3 offload wiring (provider_routing_enabled=true required to activate):
 *   - AC validation reviewer: codex-executor (read-only sandbox, two-stage)
 *     Stage A: codex validates sprint ACs → writes checklist artifact (no schema).
 *     Stage B: cheap haiku structurer reads artifact → emits VERDICT_SCHEMA result.
 *     Stage-B miss: fallback verdict (approved:false) — Stage A artifact preserved.
 * P4 offload wiring (provider_routing_enabled=true AND args.fix_provider:'bob' required):
 *   - Fix-cycle agent: bob-delegate-executor when fix_provider:'bob' + Mode-D guard passes.
 *     Mode-D guard fires BEFORE Bob dispatch; on trigger → route to claude (on-primary).
 *     Bob fallback: timeout/binary-absent/structuring-error → log actual_provider_used:'claude',
 *     fallback_applied:true; dispatch same task to feature-sprint-executor immediately (no retry).
 *   MUST-stay (never offloaded under any flag):
 *   - Sprint executor: feature-sprint-executor (on-primary)
 *   - Fix agent (Mode-D or flag-off): feature-sprint-executor (on-primary; Mode-D boundary always active)
 *   - Mode-D boundary: fires before sprint spawns (constraint 2)
 *
 * Phase 1 Tier A nesting pilot (subtask_sharding_enabled, DEFAULT FALSE):
 *   When true, the on-primary sprint executor MAY shard bounded mechanical sub-tasks
 *   (test-writer, doc-updater, fixture-builder) to depth-1 nested helpers — mitigating the
 *   execute-contract-blows-context-on-large-files failure mode. Governed inline: depth=1,
 *   <25 tool uses/helper, single-committer (helpers never commit), Mode-D-at-depth bubble-up to
 *   a Completion Report blocker. Pilot-gated, never auto-promoted. See
 *   .claude/plans/subagent-nesting-orchestration-strategy-v1.md §6 Phase 1.
 *
 * Four-constraints checklist:
 *   [x] No FS/shell access in script body
 *   [x] Mode D triggers early return before sprint spawns
 *   [x] All reviewer agents use edit-less agentType
 *   [x] No Date.now() / Math.random() / new Date() in script body
 *   [x] meta is a pure literal object
 *   [x] phase() titles match meta.phases exactly
 *   [x] Budget guard in fix-loop: budget.remaining() > 60_000
 *   [x] All implementation prompts include durability commit instruction
 */

// ─── meta (pure literal — no computed values, no function calls) ──────────────

export const meta = {
  name: 'execute-contract',
  description: 'Tier 1 autonomous sprint: feature-sprint-executor sprint → reviewer gate → ≤2-cycle fix-loop → structured Completion Report. Use when a Feature Contract (3–8 pts) is approved and does not touch auth/payments/migrations.',
  phases: [
    { title: 'Sprint' },
    { title: 'Review' },
    { title: 'Fix cycle 1' },
    { title: 'Fix cycle 2' },
  ],
  whenToUse: 'Feature Contract approved, 3–8 story points, no Mode D paths (auth/payments/migrations/deletion). Invoke as: workflow execute-contract with args envelope built by Opus pre-flight.',
}

// ─── inline schemas ───────────────────────────────────────────────────────────

const SPRINT_RESULT_SCHEMA = {
  type: 'object',
  required: ['completion_report_path', 'ac_verdicts', 'commit_sha', 'files_touched'],
  additionalProperties: false,
  properties: {
    completion_report_path: { type: 'string' },
    ac_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'met'],
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          met: { type: 'boolean' },
          notes: { type: 'string' },
        },
      },
    },
    commit_sha: { type: 'string', pattern: '^[0-9a-f]{7,40}$' },
    files_touched: { type: 'array', items: { type: 'string' } },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description'],
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          resolution_hint: { type: 'string' },
        },
      },
    },
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
      enum: [
        'task-completion-validator',
        'karen',
        'council-review',
        'code-reviewer',
        'senior-code-reviewer',
      ],
    },
    required_fixes: {
      type: 'array',
      items: { type: 'string' },
    },
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
    },
  },
}

// ─── helpers (pure functions — no primitives called here) ─────────────────────

/**
 * Route reviewer agentType from review_intensity + tier.
 * Mirrors authoring-spec §8 and councilEscalation pattern.
 * Always returns an edit-less agentType (constraint 3).
 */
function reviewerAgentType(reviewIntensity, tier) {
  if (reviewIntensity === 'council') return 'council-review'
  if (reviewIntensity === 'tier3' || tier === 3) return 'karen'
  return 'task-completion-validator'
}

/**
 * Derive the deterministic completion report path for a contract.
 * Returns parsed.completion_report_path if provided in args, otherwise derives
 * .claude/worknotes/<slug>/completion-report.md where <slug> is the contract
 * filename without directory or .md extension (string ops only — no FS).
 */
function reportPathForContract(parsed) {
  if (parsed.completion_report_path) return parsed.completion_report_path
  // Derive slug from contract_path: strip directory and .md extension.
  const contractPath = parsed.contract_path || ''
  const basename = contractPath.split('/').pop() || 'contract'
  const slug = basename.replace(/\.md$/, '')
  return `.claude/worknotes/${slug}/completion-report.md`
}

/**
 * Build the sprint agent prompt (Stage A — no schema, plain text output).
 * Includes Mode marker, contract path, context paths, budget hint.
 * DURABILITY: sprint agent must commit each logical unit AND write the Completion
 * Report to the deterministic path BEFORE returning. Final message is a human
 * summary only — a downstream structurer emits the machine-readable result.
 */
function sprintPrompt(parsed, reportPath, subtaskShardingEnabled) {
  const contextSection = parsed.context_paths && parsed.context_paths.length > 0
    ? `\nRelevant context paths (read before implementing):\n${parsed.context_paths.map(p => `  - ${p}`).join('\n')}`
    : ''

  return `Mode: C — Autonomous Feature Sprint

Contract: ${parsed.contract_path}
Completion Report path (write here BEFORE finishing): ${reportPath}
Budget hint: ~${parsed.budget_total || 50000} tokens${contextSection}

Run the full Tier 1 sprint:
  1. Read and internalise the Feature Contract at the path above.
  2. Explore the codebase for relevant patterns (symbols-first, then targeted file reads).
  3. Implement all Acceptance Criteria.
  4. DURABILITY: commit each logical unit of work to the current worktree branch as you go.
     This is REQUIRED so your work survives a mid-run crash and is visible to the reviewer.
     Commit message format: "feat(<slug>): <what was done>". Do NOT push, merge, stash,
     or touch other branches.
  5. Run validation commands (pytest / pnpm test + type-check + lint as applicable).
  6. Write the Completion Report to: ${reportPath}
     The report MUST be written to disk before you return. Use the standard template from
     your agent definition (Summary, Files Changed, AC Status, Validation Run, Deviations,
     Risks, Follow-Up, Memory Candidates).
  7. Your final message is a human-readable summary of what was done and what AC passed/failed.
     A downstream structurer agent will read the report file and git log to emit the
     machine-readable SprintResult — you do NOT need to emit structured output yourself.
${buildSubtaskShardingClause(subtaskShardingEnabled)}
Do NOT push, merge, stash, or touch branches other than your current worktree branch.
Do NOT install new dependencies without justification in the Completion Report.`
}

/**
 * Phase 1 Tier A nesting pilot. Returns a governed sub-task-sharding clause when enabled,
 * or an empty string (byte-for-byte preservation) when off. Mitigates the
 * execute-contract-blows-context-on-large-files failure mode by letting the sprint
 * executor spread mechanical sub-slices across depth-1 nested helpers. The single-committer
 * durability model is preserved: helpers never commit; the sprint executor commits their output.
 */
function buildSubtaskShardingClause(enabled) {
  if (!enabled) return ''
  return `
SUB-TASK SHARDING (Tier A nesting pilot — depth-capped, single committer):
To avoid a context blow on large files, you MAY shard bounded, mechanical sub-tasks to nested
helper agents via the Agent tool (e.g. test-writer, doc-updater, fixture-builder). Rules:
  - Depth cap = 1: helpers MUST NOT spawn their own children. Do not grant them recursion rights.
  - Each helper is bounded (keep its slice small, fewer than 25 tool uses) and scoped to the
    explicit file paths you name in its prompt.
  - SINGLE COMMITTER: helpers run in your worktree but MUST NOT git add/commit/push/stash. After a
    helper returns, review its output and commit it yourself as one of your logical units. This
    keeps your commit history the sole durable record.
  - Mode-D-at-depth: if a sub-slice would touch auth / payments / migrations / deletion /
    force-push / secret-rotation, do NOT delegate it and do NOT implement it — STOP and record it
    as a blocker in your Completion Report for Opus to handle. (This contract is gated non-Mode-D;
    this is defense-in-depth.)
  - Durability contract: a nested subtree is, from the workflow's view, part of your single
    agent() call — if a helper blows its context the whole sprint re-runs. Keep helper slices small
    and commit consolidated output promptly so progress survives.
Use sharding for independent mechanical slices only; keep the core implementation yourself.`
}

/**
 * Build the structure agent prompt (Stage B — haiku, schema: SPRINT_RESULT_SCHEMA).
 * Reads the Completion Report from the deterministic path, runs git commands to
 * derive commit_sha and files_touched, parses AC verdicts from the report.
 */
function structurePrompt(parsed, reportPath) {
  const branchBase = parsed.branch_base || 'HEAD~10'
  return `Mode: A — Exploration Only

Read the Completion Report at: ${reportPath}

If the file does not exist, set commit_sha to "" and return a result with:
  - completion_report_path: "${reportPath}"
  - ac_verdicts: []
  - files_touched: []
  - blockers: [{description: "Completion report not found — sprint may have failed to write it"}]

If the file exists:
  1. Run: git log --oneline "${branchBase}..HEAD"
     and: git rev-parse HEAD
     to get the latest commit SHA. If no new commits exist since the branch base,
     set a blocker: "No commits found since branch base — sprint work may be uncommitted."
  2. Run: git diff --name-only "${branchBase}..HEAD"
     to get files_touched.
  3. Parse the "### Acceptance Criteria Status" section of the report.
     For each line starting with "- [x]" set met:true; "- [ ]" set met:false.
     Extract the criterion text after the checkbox.
  4. Set completion_report_path to the exact path you read.
  5. Return the structured SprintResult conforming to the schema.

Do NOT edit any files. Read only.`
}

/**
 * Build the reviewer prompt.
 * Includes Mode marker, contract path, completion report path, and commit SHA.
 * Reviewer must NOT produce code changes — enforced by agentType definition.
 *
 * @param {object} parsed      - Parsed workflow args.
 * @param {object} sprintResult - SprintResult from Stage B (may be the original or a
 *                                post-fix-cycle refresh with an updated commit_sha).
 */
function reviewPrompt(parsed, sprintResult) {
  return `Mode: E — Reviewer

Contract: ${parsed.contract_path}
Completion Report: ${sprintResult.completion_report_path}
Sprint commit SHA: ${sprintResult.commit_sha}

Review the sprint output against all Acceptance Criteria in the Feature Contract.
Diff the commit SHA against the branch base to verify the changes match the contract scope.

Return a structured VERDICT:
  - approved: true only when ALL Acceptance Criteria are met with no required fixes outstanding.
  - reviewer_type: your agentType string.
  - required_fixes: if approved is false, list each required fix as a clear, actionable instruction for the fix agent.

Do NOT modify any source files. Read only.`
}

/**
 * Build the fix-cycle agent prompt.
 * Receives the reviewer's required_fixes list and applies targeted patches only.
 * DURABILITY: fix agent must commit its fixes to the worktree branch.
 */
function fixPrompt(parsed, requiredFixes, cycleNumber) {
  return `Mode: C — Autonomous Feature Sprint (Fix cycle ${cycleNumber})

Contract: ${parsed.contract_path}
Fix cycle: ${cycleNumber} of 2

The reviewer found the following issues that must be resolved:
${requiredFixes.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}

Apply targeted fixes ONLY for the issues listed above. Do not re-implement areas the reviewer approved.
Run relevant validation commands after fixing (pytest / pnpm test + type-check as applicable).

DURABILITY: commit your fixes to the current worktree branch before returning.
This is REQUIRED so your work survives a session interruption.
Do NOT push, merge, stash, or touch other branches.`
}

// ─── Mode D boundary detection ────────────────────────────────────────────────

/**
 * High-risk path heuristic for implicit Mode D detection.
 * Mirrors modeBoundary pattern in workflow-patterns.md.
 * Returns true if any path in filesAffected matches a high-risk pattern.
 */
const HIGH_RISK_PATTERNS = [
  /auth/i, /payment/i, /billing/i, /migration/i, /alembic/i,
  /delete/i, /drop_table/i, /secret/i, /token/i,
]

function hasHighRiskPaths(filesAffected) {
  if (!Array.isArray(filesAffected)) return false
  return filesAffected.some(f =>
    HIGH_RISK_PATTERNS.some(pat => pat.test(f))
  )
}

/**
 * P4 Mode-D guard for fix-cycle tasks before Bob dispatch (design_spec §7).
 * Same trigger set as execute-plan.js fixTaskModeDGuard — inlined here because
 * workflow scripts cannot share code (no FS/require in script body at runtime).
 *
 * Returns a reason string if Mode-D is triggered, or null (safe to proceed to Bob).
 *
 * @param {string[]} filesAffected - Files the fix task touches (from contractMeta)
 * @param {string}   taskClass     - fix_task_class from args, or '' if absent
 * @param {string}   promptText    - Fix prompt text (scanned for destructive patterns)
 * @returns {string|null}
 */
const MODE_D_FIX_FILE_PATTERNS = [
  /skillmeat\/api\/auth\//i,
  /skillmeat\/api\/middleware\/auth/i,
  /skillmeat\/cache\/migrations\//i,
  /payment/i,
  /billing/i,
  /stripe/i,
]

const MODE_D_FIX_CLASS_PATTERNS = [
  /deletion/i,
  /secret/i,
  /rotat/i,
  /force.push/i,
  /reset.*--hard/i,
  /drop.table/i,
]

function fixCycleModeDGuard(filesAffected, taskClass, promptText) {
  // 1. files_affected heuristic.
  const files = Array.isArray(filesAffected) ? filesAffected : []
  for (const f of files) {
    for (const pat of MODE_D_FIX_FILE_PATTERNS) {
      if (pat.test(f)) return `files_affected contains high-risk path matching ${pat}: ${f}`
    }
  }
  // 2. task_class heuristic.
  const cls = taskClass || ''
  for (const pat of MODE_D_FIX_CLASS_PATTERNS) {
    if (pat.test(cls)) return `fix_task_class '${cls}' matches Mode-D class pattern ${pat}`
  }
  // 3. Prompt scan.
  const text = typeof promptText === 'string' ? promptText : ''
  const PROMPT_DANGER = [
    /git\s+push\s+--force/i,
    /git\s+reset\s+--hard/i,
    /DROP\s+TABLE/i,
    /\bDELETE\s+FROM\b/i,
    /alembic\s+(upgrade|downgrade)/i,
  ]
  for (const pat of PROMPT_DANGER) {
    if (pat.test(text)) return `fix prompt contains destructive operation matching ${pat}`
  }
  return null // Safe to dispatch Bob.
}

// ─── workflow body ────────────────────────────────────────────────────────────

// ─── P3: Two-stage AC validation helpers (codex-executor) ─────────────────────
// Used only when provider_routing_enabled=true.
// Stage A: codex-executor validates sprint ACs, writes checklist artifact (no schema).
// Stage B: cheap haiku reads artifact, emits VERDICT_SCHEMA result.
// Stage-B miss never voids Stage A artifact (workflow-authoring-spec.md §16).

function acValidationArtifactPath(contractPath, timestamp) {
  // Deterministic: derived from contract path + timestamp. No Date.now().
  const datePart = (timestamp || 'nodate').replace(/T.*$/, '').replace(/-/g, '')
  const contractSlug = (contractPath || 'contract').split('/').pop().replace(/\.md$/, '').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 40)
  return `.claude/worknotes/ac-validation/${datePart}-${contractSlug}-ac-check.md`
}

function codexSprintAcValidationPrompt(parsed, sprintResult, artifactPath) {
  const acVerdicts = (sprintResult.ac_verdicts || [])
    .map(v => `- [${v.met ? 'x' : ' '}] ${v.criterion}${v.notes ? ' — ' + v.notes : ''}`)
    .join('\n')

  return `Mode: A — Exploration Only. Read-only investigation. Do NOT write production code. Do NOT git add/commit/push/stash.

You are the AC validator for a Tier 1 sprint.
Contract: ${parsed.contract_path}
Sprint commit SHA: ${sprintResult.commit_sha || '(none)'}
Completion Report: ${sprintResult.completion_report_path}

Sprint-reported AC verdicts:
${acVerdicts || '(none reported by sprint)'}

Review the sprint output against all Acceptance Criteria in the Feature Contract.
Use Codex to diff the commit SHA against the branch base and verify the changes satisfy each AC.

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: evidence (file:line or commit reference)

This file MUST exist before you return. A downstream structurer will read it to emit the verdict.
Do NOT emit structured output yourself. Do NOT git add/commit/push/stash.`
}

function codexSprintAcStructurePrompt(parsed, artifactPath) {
  const reviewerType = 'task-completion-validator'
  return `Mode: A — Exploration Only

Read the AC validation checklist at: ${artifactPath}

If the file does not exist, return:
  { "approved": false, "reviewer_type": "${reviewerType}", "required_fixes": ["AC validation artifact not found at ${artifactPath} — codex Stage A may have failed"] }

If the file exists:
  1. Count lines starting with "- [x]" (met) and "- [ ]" (not met).
  2. Set approved:true ONLY if all ACs are marked met (no "- [ ]" lines).
  3. For each unmet AC, add its text to required_fixes.
  4. Set reviewer_type to "${reviewerType}".
  5. Return the VERDICT_SCHEMA object.

Do NOT write any files. Do NOT git add/commit/push/stash. Read only.`
}

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

// ── Mode D boundary check (before any agents spawn) ──────────────────────────
// Explicit flag first, then implicit heuristic on files_affected.
// Per constraint 2: no mid-run sign-off — Mode D must be a workflow boundary.
const contractMeta = parsed.contract_metadata || {}
const modeD =
  contractMeta.mode === 'D' ||
  hasHighRiskPaths(contractMeta.files_affected)

if (modeD) {
  log('Mode D boundary detected — returning to Opus before spawning any agents.')
  return {
    status: 'needs_opus',
    reason: 'mode_d',
    blocked_phase: 'sprint',
    report: [],
  }
}

// ── Phase 1: Sprint (two-stage: executor + structurer) ───────────────────────
// Stage A: feature-sprint-executor, NO schema. Heavy executor commits checkpoints
// to the worktree branch and writes the Completion Report to a deterministic path
// before returning plain text. This decouples durable work from terminal output.
// Stage B: haiku general-purpose structurer reads the report + git state and emits
// the machine-readable SprintResult. Isolated from the sprint so a schema miss in
// Stage B cannot discard Stage A's committed work.
phase('Sprint')
log(`Starting Tier 1 sprint for contract: ${parsed.contract_path}`)

const reportPath = reportPathForContract(parsed)
log(`Completion report path: ${reportPath}`)

// Phase 1 Tier A nesting pilot — DEFAULT FALSE. When false, sprintPrompt is byte-for-byte
// identical to the pre-pilot behaviour. When true, the sprint executor may shard bounded,
// mechanical sub-tasks to depth-1 nested helpers (single-committer preserved, Mode-D-at-depth
// bubble-up). Pilot-gated — never auto-promoted. See
// .claude/plans/subagent-nesting-orchestration-strategy-v1.md §6 Phase 1.
const subtaskShardingEnabled = parsed.subtask_sharding_enabled === true
if (subtaskShardingEnabled) {
  log('Tier A nesting pilot: subtask_sharding_enabled=true — sprint executor may shard depth-1 helper agents (single committer).')
}

// Stage A — sprint (no schema, plain text output)
const sprintText = await agent(sprintPrompt(parsed, reportPath, subtaskShardingEnabled), {
  label: 'sprint',
  phase: 'Sprint',
  agentType: 'feature-sprint-executor',
  // No schema: heavy executor must not carry a terminal StructuredOutput call.
  // The structurer (Stage B) emits the machine-readable result.
})

// If the user skipped the sprint agent, return blocked.
if (!sprintText) {
  log('Sprint agent was skipped — returning to Opus.')
  return {
    status: 'needs_opus',
    reason: 'reviewer_unresolved',
    blocked_phase: 'sprint',
    report: [],
  }
}

log('Sprint stage complete. Running structure stage.')

// Stage B — structurer (haiku, schema: SPRINT_RESULT_SCHEMA)
// Reads the report file and git state to fill structured fields.
// Wrapped in try/catch so a structure failure degrades gracefully rather than crashing.
let sprintResult
try {
  sprintResult = await agent(structurePrompt(parsed, reportPath), {
    label: 'sprint-structurer',
    phase: 'Sprint',
    agentType: 'general-purpose',
    model: 'haiku',
    schema: SPRINT_RESULT_SCHEMA,
  })
} catch (structureErr) {
  log(`WARNING: Structure stage threw (${structureErr && structureErr.message ? structureErr.message : structureErr}). Falling back to minimal result.`)
  // Fallback: minimal result; Opus can inspect the report on disk.
  sprintResult = {
    completion_report_path: reportPath,
    commit_sha: '',
    ac_verdicts: [],
    files_touched: [],
    blockers: [{ description: 'Structure stage failed — inspect completion report on disk.', resolution_hint: 'Run: git log --oneline to find sprint commits; read ' + reportPath }],
  }
}

if (!sprintResult) {
  log('Structure stage returned null. Using minimal fallback.')
  sprintResult = {
    completion_report_path: reportPath,
    commit_sha: '',
    ac_verdicts: [],
    files_touched: [],
    blockers: [{ description: 'Structure stage returned null — inspect completion report on disk.', resolution_hint: 'Read ' + reportPath }],
  }
}

// Build the base task result from the sprint.
const sprintTaskResult = {
  id: 'SPRINT',
  assigned_to: 'feature-sprint-executor',
  status: 'completed',
  commit_sha: sprintResult.commit_sha,
  summary: `Sprint complete. AC verdicts: ${sprintResult.ac_verdicts.filter(v => v.met).length}/${sprintResult.ac_verdicts.length} met. Completion report: ${sprintResult.completion_report_path}`,
}

// ── Phase 2: Review ───────────────────────────────────────────────────────────
phase('Review')
log('Running reviewer gate.')

const reviewerType = reviewerAgentType(
  parsed.review_intensity || 'standard',
  parsed.tier || 1
)

// P3: provider_routing_enabled flag — DEFAULT FALSE. When off: existing reviewer path preserved.
// When true: codex-executor two-stage AC validation replaces direct reviewer agent() call.
const provider_routing_enabled = parsed.provider_routing_enabled === true

let verdict

if (provider_routing_enabled) {
  // P3 two-stage AC validation: codex-executor Stage A + haiku Stage B.
  const acArtifactPath = acValidationArtifactPath(parsed.contract_path, parsed.timestamp)
  log(`P3 two-stage AC validation: Stage A codex → artifact at ${acArtifactPath}`)

  // Stage A: codex-executor — validates sprint ACs, writes checklist artifact (no schema).
  const stageAText = await agent(
    codexSprintAcValidationPrompt(parsed, sprintResult, acArtifactPath),
    {
      label: 'review:stage-a',
      phase: 'Review',
      agentType: 'codex-executor',
      model: 'sonnet',
      // No schema: read-only AC validation; Stage B haiku emits VERDICT_SCHEMA.
    }
  )

  if (!stageAText) {
    log('Stage A (codex AC validation) returned null. Using fallback verdict.')
    verdict = {
      approved: false,
      reviewer_type: reviewerType,
      required_fixes: ['AC validation Stage A failed — codex-executor returned null'],
    }
  } else {
    log('Stage A complete. Running Stage B haiku structurer...')
    // Stage B: cheap haiku structurer — reads checklist artifact, emits VERDICT_SCHEMA.
    try {
      verdict = await agent(
        codexSprintAcStructurePrompt(parsed, acArtifactPath),
        {
          label: 'review:stage-b',
          phase: 'Review',
          agentType: 'general-purpose',
          model: 'haiku',
          schema: VERDICT_SCHEMA,
        }
      )
    } catch (stageBErr) {
      log(`Stage B threw for AC validation: ${stageBErr && stageBErr.message ? stageBErr.message : stageBErr}. Stage A artifact preserved at ${acArtifactPath}.`)
      verdict = {
        approved: false,
        reviewer_type: reviewerType,
        required_fixes: [`Stage B schema extraction failed — read ${acArtifactPath} for Stage A output`],
      }
    }
    if (!verdict) {
      log(`Stage B returned null. Stage A artifact preserved at ${acArtifactPath}.`)
      verdict = {
        approved: false,
        reviewer_type: reviewerType,
        required_fixes: [`Stage B returned null — read ${acArtifactPath} for AC validation output`],
      }
    }
  }
} else {
  // Flag off: existing on-primary reviewer with inline VERDICT_SCHEMA (unchanged).
  verdict = await agent(reviewPrompt(parsed, sprintResult), {
    label: 'review',
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })
}

// ── Phase 3+: Fix-loop (≤2 cycles, budget-guarded) ───────────────────────────
// Pattern: fixLoop from workflow-patterns.md
// Cap: 2 cycles. Guard: budget.remaining() > 60_000.
// Fix agent defaults to feature-sprint-executor; override via args.fix_agent.
// P4: When provider_routing_enabled=true AND args.fix_provider==='bob', route to
// bob-delegate-executor after Mode-D guard check. Fallback: claude, no retry.
// Flag-off (provider_routing_enabled=false): pre-P4 hardcoded fix-agent path.
const fixAgentType = parsed.fix_agent || 'feature-sprint-executor'
const fixProvider = parsed.fix_provider || 'claude'

// P4: Derive Mode-D guard inputs from contract metadata.
// files_affected and fix_task_class come from contractMeta if available.
const contractFixFiles = (contractMeta && Array.isArray(contractMeta.files_affected))
  ? contractMeta.files_affected
  : []
const contractFixClass = (contractMeta && contractMeta.fix_task_class) || ''

let cycles = 0

// reviewResult tracks the sprintResult passed to the reviewer; starts as the original
// sprint result and is refreshed after each fix cycle so the reviewer diffs the
// post-fix commits rather than the original sprint SHA (Defect 1 fix).
let reviewResult = sprintResult

while (verdict && !verdict.approved && cycles < 2 && budget.remaining() > 60_000) {
  const cycleNumber = cycles + 1
  phase(`Fix cycle ${cycleNumber}`)
  log(`Fix cycle ${cycleNumber}: applying ${(verdict.required_fixes || []).length} required fix(es).`)

  const fixPromptText = fixPrompt(parsed, verdict.required_fixes || [], cycleNumber)

  if (provider_routing_enabled && fixProvider === 'bob') {
    // P4: Bob fix-cycle routing — three-gate check (design_spec §7 + phase plan).
    const modeDReason = fixCycleModeDGuard(contractFixFiles, contractFixClass, fixPromptText)

    if (modeDReason) {
      // Gate 1: Mode-D triggered — abort Bob, route to claude, log reason.
      log(`P4 Mode-D guard triggered for fix-cycle ${cycleNumber}: ${modeDReason}. Routing to claude (not Bob).`)
      await agent(fixPromptText, {
        label: `fix-cycle-${cycleNumber}`,
        phase: `Fix cycle ${cycleNumber}`,
        agentType: fixAgentType,
        model: parsed.fix_model || undefined,
        _routing_log: {
          chosen_plugin_id: 'bob',
          actual_provider_used: 'claude',
          fallback_applied: false,
          reason: `mode_d: ${modeDReason}`,
        },
      })
    } else {
      // Gate 2: Mode-D cleared — dispatch bob-delegate-executor.
      log(`P4 Bob fix-cycle routing: dispatching bob-delegate-executor for fix-cycle ${cycleNumber}.`)
      let bobResult = null
      let bobFailed = false
      try {
        bobResult = await agent(fixPromptText, {
          label: `fix-cycle-${cycleNumber}`,
          phase: `Fix cycle ${cycleNumber}`,
          agentType: 'bob-delegate-executor',
          model: parsed.fix_model || undefined,
          _routing_log: {
            chosen_plugin_id: 'bob',
            actual_provider_used: 'bob',
            fallback_applied: false,
            reason: `fix_provider:bob fix-cycle ${cycleNumber} for contract ${parsed.contract_path || '(unknown)'}`,
          },
        })
        if (!bobResult) {
          bobFailed = true
          log(`P4 Bob fix-cycle: bob-delegate-executor returned null for fix-cycle ${cycleNumber}. Triggering fallback to claude.`)
        }
      } catch (bobErr) {
        bobFailed = true
        log(`P4 Bob fix-cycle: bob-delegate-executor threw for fix-cycle ${cycleNumber}: ${bobErr && bobErr.message ? bobErr.message : bobErr}. Triggering fallback to claude.`)
      }

      // Gate 3: Bob fallback — immediate escalation to claude, no Bob retry.
      if (bobFailed) {
        log(`P4 Bob fallback: actual_provider_used='claude', fallback_applied=true for fix-cycle ${cycleNumber}.`)
        await agent(fixPromptText, {
          label: `fix-cycle-${cycleNumber}-fallback`,
          phase: `Fix cycle ${cycleNumber}`,
          agentType: fixAgentType,
          model: parsed.fix_model || undefined,
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
    // Flag-off OR fix_provider !== 'bob': pre-P4 hardcoded fix-agent path (unchanged).
    await agent(fixPromptText, {
      label: `fix-cycle-${cycleNumber}`,
      phase: `Fix cycle ${cycleNumber}`,
      agentType: fixAgentType,
      model: parsed.fix_model || undefined,
    })
  }

  // Fix agents commit their changes. Refresh the commit reference so the reviewer
  // diffs the latest commits rather than the original sprint SHA.
  const branchBase = parsed.branch_base || 'HEAD~10'
  const refreshedSha = await agent(
    `Mode: A — Exploration Only\n\nRun: git rev-parse HEAD\nRun: git diff --name-only "${branchBase}..HEAD"\n\nReturn a JSON object: { "commit_sha": "<40-char sha>", "files_touched": ["<path>", ...] }\nDo NOT edit any files. Read only.`,
    {
      label: `fix-sha-refresh-${cycleNumber}`,
      phase: `Fix cycle ${cycleNumber}`,
      agentType: 'general-purpose',
      model: 'haiku',
      schema: {
        type: 'object',
        required: ['commit_sha', 'files_touched'],
        additionalProperties: false,
        properties: {
          commit_sha: { type: 'string' },
          files_touched: { type: 'array', items: { type: 'string' } },
        },
      },
    }
  )

  // Merge refreshed git state into reviewResult; fall back to original if the
  // refresh agent failed or returned nothing.
  if (refreshedSha && refreshedSha.commit_sha) {
    reviewResult = {
      ...sprintResult,
      commit_sha: refreshedSha.commit_sha,
      files_touched: refreshedSha.files_touched || sprintResult.files_touched,
    }
    log(`Fix cycle ${cycleNumber}: refreshed reviewer commit reference to ${refreshedSha.commit_sha}.`)
  } else {
    log(`Fix cycle ${cycleNumber}: WARNING — SHA refresh returned nothing; reviewer will use last known commit reference.`)
  }

  // Re-run reviewer after each fix cycle, pointed at the post-fix HEAD.
  verdict = await agent(reviewPrompt(parsed, reviewResult), {
    label: `review-cycle-${cycleNumber}`,
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })

  cycles++
}

// ── Determine final status ────────────────────────────────────────────────────
const approved = verdict?.approved === true
const budgetExhausted = !approved && cycles < 2 && budget.remaining() <= 60_000

let finalStatus = 'complete'
let reason

if (!approved) {
  finalStatus = 'needs_opus'
  reason = budgetExhausted ? 'budget_exhausted' : 'reviewer_unresolved'
  log(`Escalating to Opus — reason: ${reason} (cycles: ${cycles}).`)
} else {
  log('Reviewer approved. Sprint complete.')
}

// ── Build ExecutionReport conforming to execution-report.schema.json ──────────
const phaseResult = {
  phase: 'sprint',
  tasks: [sprintTaskResult],
  verdict: verdict || { approved: false, reviewer_type: reviewerType, required_fixes: ['Sprint agent returned null'] },
  fix_cycles: cycles,
  escalate: !approved,
  files_touched: sprintResult.files_touched || [],
  blockers: sprintResult.blockers || [],
}

const report = [
  {
    wave: 'wave-1',
    phases: [phaseResult],
  },
]

const result = { status: finalStatus, report }
if (reason) result.reason = reason
if (finalStatus === 'needs_opus' && reason === 'mode_d') result.blocked_phase = 'sprint'

return result
