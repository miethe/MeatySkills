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
    { title: 'Branch guard' },
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

// Branch-placement guard (see the guard block before the wave loop). Kept identical in shape to
// execute-contract.js's copy on purpose: the two engines are dispatched interchangeably by
// auto-feature, so a placement check that differed between them would make the run's guarantees
// depend on which engine the tier classifier happened to pick.
const BRANCH_GUARD_SCHEMA = {
  type: 'object',
  required: ['current_branch', 'head_sha'],
  additionalProperties: false,
  properties: {
    current_branch: { type: 'string' },
    head_sha: { type: 'string' },
    base_resolves: { type: 'boolean' },
    detached: { type: 'boolean' },
  },
}

function branchGuardPrompt(runBranch, branchBase) {
  const baseStep = branchBase
    ? `\n  3. Run: git cat-file -e ${branchBase}^{commit} && echo RESOLVES\n     Set base_resolves true if it printed RESOLVES, false otherwise.`
    : ''
  return `Mode: A — Exploration Only

Report the git branch state of the CURRENT working tree. Do not change it.

  1. Run: git rev-parse --abbrev-ref HEAD
     Set current_branch to that exact value. If it is "HEAD" the tree is detached — set
     detached true and still report current_branch as "HEAD".
  2. Run: git rev-parse HEAD
     Set head_sha to that value.${baseStep}

Report what you observe verbatim. The orchestrator expects branch "${runBranch}"; do NOT switch,
create, or check out any branch to make that true, and do NOT report the expected value when you
observed something different — a mismatch is the finding this stage exists to surface.

Do NOT edit any files. Read only. Do NOT git add/commit/push/stash/checkout/switch.`
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
    // Gate-tiering v4.1: the defect class this round found, so fixLoop can apply the
    // same-class stop rule (execution-doctrine.md rule 1). Two consecutive rounds
    // surfacing the SAME class means the shape is wrong — the next action is a design
    // change, not a third review. Reviewers set this on any non-approving verdict.
    // Free-form but must be a stable label (e.g. 'fail-open-default',
    // 'unguarded-sibling-callsite', 'missing-ac-coverage'), not a restatement of the
    // individual finding — class identity is what the rule tests.
    defect_class: { type: 'string' },
    // What the reviewer actually inspected, in its own words (the pinned merge-base it
    // diffed, the commits it resolved, the files it read). Optional so the council
    // synthesis path and older callers stay schema-valid, but reviewPrompt asks for it on
    // every verdict: an approval that cannot say what it looked at is the abdication this
    // gate exists to catch, and it is cheaper to notice a missing `evidence` field than to
    // rediscover the defect it waved through.
    evidence: { type: 'string' },
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
// Gate-failure verdict (authoring-spec §8b): a gate that could NOT run is not a gate
// that passed — and it is not a gate that rejected, either. `agent()` returns null when
// the reviewer dies after retries or is skipped, and a bare `?? {approved:false}` loses
// that distinction: the caller then sends a fix loop after a defect nobody found, burns a
// cycle, and re-reviews unchanged code. Tagging the synthesized verdict keeps the two
// outcomes separable, because their next actions differ (fix vs. re-dispatch/override).
// ---------------------------------------------------------------------------

function gateFailureVerdict(reviewerType, reason) {
  return {
    approved: false,
    reviewer_type: reviewerType,
    verdict_source: 'gate_failure',
    gate_failure_reason: reason,
    required_fixes: [
      `The reviewer gate produced no verdict (${reason}). This is NOT an approval and NOT a rejection — the gate did not run. Re-dispatch the reviewer, or record an explicit operator override, before treating this scope as reviewed.`,
    ],
  }
}

// ---------------------------------------------------------------------------
// Pattern: councilEscalation — reviewer agentType routing per authoring-spec §8.
// ---------------------------------------------------------------------------

// Reviewer routing is driven PURELY by per-phase fields, NEVER by plan tier. The
// previous `tier === 3 → karen` rule fired on every tier-3 phase and silently
// overrode the per-phase 'standard' default — making karen (opus) the reviewer for
// all phases of a tier-3 plan regardless of intent. `tier` is retained for signature
// compatibility but does not change the default.
//
// Gate-tiering v4.1: `gate_lens` wins over `review_intensity`. The plan-optimizer
// pass (dev-execution/modes/plan-optimization.md) risk-classes each phase and writes
// gate_lens per references/gate-risk-classes.md §2 — one lens by default, a second
// only when the phase matches a named trigger (untrusted-input / authz-boundary /
// irreversible-outward). Until this branch existed, gate_lens was written and never
// read, so a phase over an R1–R9 surface could silently get only
// task-completion-validator — which in the grounding retro approved a critical
// authorization bypass twice. Reading gate_lens here is what makes the ruleset's
// "security is non-removable" invariant real rather than documentary.
//
// Order matters: security is the non-removable lens, so it is checked first and no
// later branch can displace it.
function councilEscalation(p, _tier) {
  const lenses = Array.isArray(p.gate_lens) ? p.gate_lens : []
  if (lenses.includes('security')) return 'council-review'
  if (lenses.includes('karen') || lenses.includes('karen-final-tree-only')) return 'karen'

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

// This set MUST mirror .claude/agents/ in THIS repo, plus the 'general-purpose' builtin — and
// nothing else. Deliberately not ~/.claude/agents/: a workflow that could only dispatch an agent
// present on one machine would pass here and fail on the node. Drift is bidirectional and
// both directions silently corrupt a run:
//   - a name listed here with NO agent file  → dispatched to nothing, agent() returns null,
//     and the task is silently dropped from the wave (it looks like it ran).
//   - a real agent missing from here         → isHitlTask() reclassifies it as a HUMAN gate,
//     so a perfectly dispatchable task never runs.
// Both had occurred in agentic_meta_dev: 4 phantoms (api-librarian, telemetry-auditor,
// frontend-developer, council-review) alongside 17 real agents omitted. Its copy was repaired
// against its own agents dir (05c5384); tests/test_workflow_agent_roster.py fails that repo's
// build if it drifts again.
//
// ⚠️ THE SET BELOW IS THE UPSTREAM DEFAULT AND HAS NOT HAD THAT REPAIR. It is the pre-repair
// legacy value, and it is what every deployment inherits until that deployment regenerates it.
// `api-librarian`, `telemetry-auditor` and `frontend-developer` are still listed here and exist
// in no known agents dir — a task assigned to one is dispatched to nothing and silently dropped
// from the wave. They are left in place rather than removed because presence is per-deployment
// and cannot be verified from upstream; removing a name that a given deployment DOES have would
// reclassify a dispatchable task as a human gate. Regenerate this set from the deploying repo's
// own .claude/agents/ — do not assume the default is correct for you.
//
// `council-review` is deliberately EXCLUDED: it is a skill, not an agent, in every deployment.
// Its presence here was the mechanism of a real defect — a phase whose only security signal was
// gate_lens:['security'] dispatched it as an agentType, so the security lens never ran while the
// failure looked like a flaky reviewer. Keeping it in this set is what let that pass isHitlTask()
// instead of being caught. Never re-add it.
const KNOWN_AGENT_TYPES = new Set([
  'python-backend-engineer', 'ui-engineer-enhanced', 'ui-engineer', 'frontend-developer',
  'frontend-architect', 'backend-architect', 'backend-typescript-architect',
  'nextjs-architecture-expert', 'data-layer-expert', 'refactoring-expert', 'openapi-expert',
  'ai-engineer', 'documentation-complex', 'documentation-writer', 'documentation-expert',
  'api-documenter', 'changelog-generator', 'feature-sprint-executor', 'phase-owner',
  'codebase-explorer', 'search-specialist', 'symbols-engineer', 'artifact-tracker',
  'task-completion-validator', 'karen', 'code-reviewer',
  'senior-code-reviewer', 'api-librarian', 'telemetry-auditor', 'prd-writer',
  'feature-planner', 'general-purpose',
  // Provider-routing executors (registered agent definitions — see
  // .claude/specs/provider-routing-spec.md). Omitting them here made any task with
  // assigned_to:'ica-executor' (etc.) fall through isHitlTask() and be silently
  // reclassified as a human gate, so cost-shifted leaves were never dispatched.
  'ica-executor', 'codex-executor', 'gemini-executor', 'bob-delegate-executor',
])

function isHitlTask(t) {
  return t?.hitl === true || (!!t?.assigned_to && !KNOWN_AGENT_TYPES.has(t.assigned_to))
}

// ---------------------------------------------------------------------------
// Batch member resolution + graph validation.
//
// `p.batches[][]` used to be consumed as if every member were a COMPLETE task object,
// while /dev:execute-plan's pre-flight instruction ("group tasks by files_affected
// disjointness") reads naturally as an INDEX over `p.tasks`. Nothing reconciled the two and
// nothing rejected the mismatch, so an id-only member — `batches: [[{id:'M1-01'}]]` — took
// the worst possible path: `t.prompt` was undefined, so the agent was dispatched with the
// literal string "undefined" plus the durability footer; `t.assigned_to` was undefined, so
// `agentType` was undefined; and `isHitlTask({id})` returned FALSE (no `hitl` flag, and the
// unknown-agent branch is guarded by `!!t.assigned_to`), so the malformed member was
// classified DISPATCHABLE rather than caught. The wave then "ran", the agents burned budget
// on a one-word prompt, and their output flowed into taskOut and on to the reviewer gate,
// which was asked to validate acceptance criteria against work that was never attempted.
// No error, no null, no escalation — the phase could plausibly come back approved.
//
// Two changes close it. resolveBatchMember() makes the documented id-reference form work as
// written by looking the member up in `p.tasks`. validateGraph() then asserts that EVERY
// dispatchable member resolves to a usable prompt + assigned_to, and it runs BEFORE the wave
// loop — so an unresolvable member halts the run instead of spawning anything. Resolution is
// the convenience; the validation is the load-bearing half, because whichever form is
// canonical, a member that cannot be resolved must never reach agent().
// ---------------------------------------------------------------------------

function resolveBatchMember(member, tasks) {
  if (!member || typeof member !== 'object') return member
  // Already a full task object — nothing to resolve.
  if (typeof member.prompt === 'string' && member.prompt.length > 0) return member
  const byId = (tasks ?? []).find(t => t && t.id != null && t.id === member.id)
  if (!byId) return member
  // Member fields win over the referenced task (a member may carry per-dispatch overrides
  // such as `model` or `isolation`); an id-only member simply inherits the whole task.
  return { ...byId, ...member, prompt: byId.prompt ?? member.prompt, assigned_to: member.assigned_to ?? byId.assigned_to }
}

function resolvedBatches(p) {
  const raw = p.batches && p.batches.length > 0
    ? p.batches
    : [p.tasks ?? []] // Fallback: treat all tasks as one batch if batches not precomputed.
  return raw.map(batch => (batch ?? []).map(m => resolveBatchMember(m, p.tasks)))
}

// Returns an array of human-readable graph errors (empty = valid). Pure; no agent() calls.
function validateGraph(waves) {
  const errors = []
  for (const wave of waves ?? []) {
    for (const p of wave?.phases ?? []) {
      if (p?.phase_strategy === 'adaptive') continue // No static batches to resolve.
      resolvedBatches(p).forEach((batch, bi) => {
        batch.forEach((t, ti) => {
          const where = `wave ${wave?.id} / phase ${p?.id} / batch ${bi} / member ${ti}`
          if (!t || typeof t !== 'object') {
            errors.push(`${where}: batch member is not an object (got ${typeof t}).`)
            return
          }
          // HITL members are gates, never dispatched — they legitimately carry no prompt.
          if (isHitlTask(t)) return
          const ref = t.id ? `id '${t.id}'` : '(no id)'
          if (typeof t.prompt !== 'string' || t.prompt.length === 0) {
            errors.push(
              `${where}: batch member ${ref} has no prompt after resolution against tasks[]. ` +
              `A batch member must be a full task object, or an {id} reference matching an entry in this phase's tasks[]. ` +
              `Dispatching it would send the literal prompt "undefined" to an agent.`
            )
          }
          if (!t.assigned_to) {
            errors.push(
              `${where}: batch member ${ref} has no assigned_to after resolution against tasks[]. ` +
              `Dispatching it would call agent() with agentType undefined.`
            )
          }
        })
      })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Repo-target guard — the workflow runs where the SESSION runs, and nowhere else.
//
// The Workflow tool spawns every agent in the session's cwd. There is no per-agent cwd
// parameter, and `isolation:'worktree'` makes a worktree of the SESSION's repo — so a plan
// whose work lives in a sibling repo does not fail, it succeeds against the wrong tree:
// agents read the wrong files, commit to the wrong repo, and report `complete`. Observed
// twice — /dev:autopilot invoked from agentic_meta_dev for work in the sibling intenttree
// repo (di294-outcome-consolidation AAR lesson 5), and again on the DI-294 follow-ups, where
// the operator hand-orchestrated specifically to avoid this and recorded it as the reason.
//
// The script cannot resolve either repo itself (no FS/shell — constraint 1), so Opus
// pre-flight passes both and the script compares them. That split is deliberate: the
// comparison is the load-bearing half and belongs where it cannot be skipped, while the
// resolution belongs where a shell exists.
//
// Contract:
//   - neither field present  → no-op. Every pre-existing graph keeps working unchanged.
//   - target_repo only       → BLOCKED. A declared target with no proof of where the session
//                              is standing is exactly the unverified claim this guard exists
//                              to reject; "probably the same repo" is how both incidents read
//                              at the time.
//   - both present, differ   → BLOCKED. Hand-orchestrate in the target repo instead.
//
// Comparison is on basename as well as full path, so `/repos/intenttree` and
// `~/dev/.../intenttree` match: the question is which repo, not which absolute path.
// ---------------------------------------------------------------------------

function repoKey(v) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return null
  const base = trimmed.split('/').pop()
  return base && base.length > 0 ? base : trimmed
}

// Returns a blocked ExecutionReport, or null when the target is verified (or unclaimed).
function validateRepoTarget(graph) {
  const target = repoKey(graph?.target_repo)
  const session = repoKey(graph?.session_repo)

  if (!target && !session) return null // Nothing declared — legacy graph, no-op.

  if (target && !session) {
    return {
      status: 'blocked',
      reason: 'cross_repo_unverified',
      report: [],
      blockers: [{
        description: `Graph declares target_repo '${graph.target_repo}' but carries no session_repo, so the workflow cannot confirm it is running in the right repository. No agents were spawned.`,
        resolution_hint: 'In Opus pre-flight, resolve the session repo (`basename "$(git rev-parse --show-toplevel)"`) and pass it as session_repo alongside target_repo. Do NOT drop target_repo to silence this — the guard is what stands between a cross-repo plan and agents editing the wrong tree.',
      }],
    }
  }

  if (target && session && target !== session) {
    return {
      status: 'blocked',
      reason: 'cross_repo_target',
      report: [],
      blockers: [{
        description: `Plan targets repo '${graph.target_repo}' but this session is in '${graph.session_repo}'. Workflow agents always run in the session's cwd and isolation:'worktree' branches the SESSION repo, so every task would have executed against the wrong repository — reading the wrong files and committing to the wrong tree while reporting success. No agents were spawned.`,
        resolution_hint: `Re-run from the target repo: start a session in the '${graph.target_repo}' checkout and invoke the workflow there. If that is not possible, hand-orchestrate the plan and verify \`git rev-parse --show-toplevel\` + \`git branch --show-current\` + \`git diff\` yourself at each step — per .claude/skills/dev-execution/git-worktree-pr-protocol.md, never trust a completion report for repo identity.`,
      }],
    }
  }

  return null
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
//   - Commit each logical unit as you go, BY EXPLICIT PATHSPEC.
//   - Never rewrite history; never push, merge, stash, or touch other branches.
// Reviewer and tracker agents do NOT use this footer (they are edit-less).
//
// The footer is a FUNCTION of actual isolation, not a constant. The previous constant
// asserted "an isolated worktree branch you own" to EVERY task agent, which is false for
// a static batch: the batch runs via parallel() and, unless the task carries
// isolation:'worktree', all its members share ONE working tree, ONE index and ONE HEAD.
// Observed live 2026-08-04 (7-task batch): a pathspec-less `git commit` swept a sibling's
// staged files into the wrong commit, and the follow-up `git reset --soft HEAD~1` to split
// them raced a third sibling's commit — a history rewrite under 6 concurrent writers,
// averted only by that agent's own caution. Attribution is the load-bearing loss: per-task
// commit_sha feeds the reviewer gate and the progress file's commit_refs, and under a shared
// index which files land in which commit is decided by scheduling.
//
// Two changes make the instruction survivable: (1) commits are pathspec-scoped and every
// history-rewriting verb is forbidden outright, so a racing sibling cannot be captured or
// clobbered; (2) the "branch you own" claim is made ONLY when isolation is real, so a
// shared-tree agent is told plainly that siblings are writing to the same branch right now.
//
// This also reconciles a doctrine conflict the footer previously lost: dev-execution/SKILL.md
// and git-worktree-pr-protocol.md both say the phase-owner is the SINGLE committer and that
// children "never git add/commit/push/stash". That rule still holds for NESTED children
// (see buildPhaseOwnerNestingClause). A batch task agent is not a nested child: it commits,
// but only its own assigned files, and never rewrites.
// ---------------------------------------------------------------------------

const DURABILITY_COMMON = `Commit each logical unit of your work as you go (this is required so your work survives a mid-run crash and is visible to the reviewer/resume).

COMMIT ONLY YOUR OWN FILES, BY EXPLICIT PATHSPEC: \`git add <path> [<path>...]\` then \`git commit -- <paths>\`. NEVER \`git add -A\`, NEVER \`git add .\`, NEVER a pathspec-less \`git commit -a\` — those capture whatever a concurrently-running sibling task happens to have staged, and silently attribute its work to your commit.

NEVER REWRITE HISTORY: no \`git reset\` (any mode), no \`git rebase\`, no \`git commit --amend\`, no \`git push --force\`, no \`git filter-branch\`. If you believe a previous commit is wrong, do NOT fix it by rewriting — record the problem in your summary and let the orchestrator resolve it.

Do NOT push, do NOT merge, do NOT stash, do NOT touch other branches.`

// Names the assigned branch and makes verifying it a precondition of the first commit. Without it
// the footer says "do not touch other branches" while never saying which branch is *this* one — so
// an agent that finds itself on the parent branch has no way to recognise that as the error case.
// Observed 2026-08-05: commits landed on `main` and were pushed while the run reported success.
function buildRunBranchClause(runBranch) {
  if (!runBranch) return ''
  return `

BRANCH CONTRACT: your commits MUST land on branch \`${runBranch}\`. Before your FIRST commit run \`git rev-parse --abbrev-ref HEAD\`; if it is not exactly \`${runBranch}\`, STOP — do not commit, do not switch or create branches. Report the branch you actually found in your summary and return. Committing elsewhere bypasses the PR and review gates this run's approval depends on.`
}

// The clause is suppressed for an isolation:'worktree' task on purpose: that task really is on a
// branch of its own that the harness created, so telling it to verify it is on the run branch would
// be instructing it to halt on a correct state. Placement for those is asserted at merge time by
// the orchestrator instead.
function durabilityFooter(isolated, runBranch) {
  const branchClause = isolated ? '' : buildRunBranchClause(runBranch)
  return (isolated
    ? `

DURABILITY: You are on an isolated worktree branch you own. ${DURABILITY_COMMON}`
    : `

DURABILITY: You are on a SHARED working tree and a SHARED branch. Sibling tasks in your batch are running CONCURRENTLY against this same index and HEAD right now — you do NOT own this branch. ${DURABILITY_COMMON}`) + branchClause
}

// ---------------------------------------------------------------------------
// Per-task fallback structurer schema and prompt.
// Used when a task agent throws on its terminal StructuredOutput call (schema miss).
// A cheap haiku structurer reads git state and emits a minimal TASK_RESULT_SCHEMA result
// so the task is not silently dropped from the phase's taskOut array.
// ---------------------------------------------------------------------------

// The recovery path used to hard-code `status: "completed"` and accept an empty commit_sha,
// which made it a laundry for the two worst outcomes it is supposed to surface: an agent that
// produced nothing came back 'completed', and so did one that left everything uncommitted.
// (The empty-string instruction was also unsatisfiable — commit_sha's schema pattern is
// ^[0-9a-f]{7,40}$, so "" fails validation and the recovery itself dies, dropping the task
// after all.) The agent's status is now DERIVED from what is on disk, and the field is
// omitted rather than emptied when there is no commit.
function fallbackStructurePrompt(t) {
  return `Mode: A — Exploration Only

A task agent finished without emitting structured output. Recover what ACTUALLY happened from
git state. Do not assume the work succeeded — a missing structured result is equally consistent
with an agent that crashed, stalled, or never wrote anything.

Task id: ${t.id}
Agent: ${t.assigned_to}

Observe:
  MB=$(git merge-base HEAD origin/main)
  git log --oneline "$MB"..HEAD     # commits on this branch
  git status --porcelain            # uncommitted work still in the tree

Return a TASK_RESULT_SCHEMA result with:
  - id: "${t.id}"
  - assigned_to: "${t.assigned_to}"
  - status — DERIVED, not assumed:
      "completed" ONLY if there is at least one commit on this branch plausibly belonging to
                  this task; set commit_sha to that commit.
      "failed"    if there are no such commits. Say so in the summary, and note whether
                  \`git status --porcelain\` shows uncommitted changes (work done but never
                  durably committed) or a clean tree (no work landed at all).
  - commit_sha — OMIT THE FIELD ENTIRELY when there is no commit. Never send an empty string,
    never send a sha you did not resolve.
  - summary: what you observed, in one line — e.g. "recovered from disk: 2 commits, HEAD abc1234"
    or "recovered from disk: no commits since merge-base; 4 files modified but uncommitted".

Do NOT edit any files. Read only.`
}

// ---------------------------------------------------------------------------
// Prompt builders — pure string construction, no FS access.
// ---------------------------------------------------------------------------

// The reviewer's input is a set of CLAIMS, and it used to be its only input.
//
// The prompt listed each task's self-reported summary/status/commit_sha and asked for a
// verdict, so an executor that mis-reported was reviewed on its mis-report. Observed live
// 2026-08-04 across a three-executor delegation: one shipped a conceptual bug while claiming
// per-AC verification, one returned without committing and later filed a report crediting
// itself with a fix the operator had written, and the gate agent itself abdicated. Every
// defect was found by re-running the gate and reading the diff; none was visible in any
// report. A reviewer handed only reports cannot do better than the reports.
//
// So the prompt now (1) names the summaries as claims rather than facts, (2) requires the
// reviewer to observe the diff itself against a PINNED merge-base — `origin/main..HEAD`
// silently mixes in whatever landed on main mid-run, which already corrupted one review into
// analysing another commit's work (di294-followups AAR lesson 4) — and (3) hands it the
// claims that carry no commit at all, pre-computed, because "completed with no commit_sha"
// is the exact shape of the executor that never committed and is the one thing the reviewer
// can check cheaply and decisively.
function reviewPrompt(p, taskOut) {
  const claimed = taskOut.filter(Boolean)

  const taskSummaries = claimed
    .map(t => `- ${t.id} (${t.assigned_to}): ${t.summary ?? 'no summary'} [${t.status}]${t.commit_sha ? ' commit:' + t.commit_sha : ' commit:NONE REPORTED'}`)
    .join('\n')

  // Claims of completion with nothing committed to point at. Not necessarily wrong — a
  // verification-only task legitimately produces no commit — but never self-evident.
  const uncommitted = claimed.filter(t => t.status === 'completed' && !t.commit_sha)
  const shas = claimed.map(t => t.commit_sha).filter(Boolean)

  const verifyBlock = `
INDEPENDENT VERIFICATION (required before you decide anything):
The list above is what the task agents SAID they did. It is not evidence, and agents in this
workflow have reported completion for work they did not commit, and credited themselves with
fixes written by someone else. Verify against the repository itself:

  MB=$(git merge-base HEAD origin/main)     # pin the base ONCE
  git diff --stat "$MB"..HEAD               # what this branch actually changed
  git log --oneline "$MB"..HEAD

Never diff \`origin/main..HEAD\` — main moves during a run and the phantom diff that produces
is self-consistent and plausible, so it will not announce itself as wrong.
${shas.length ? `
Confirm each reported commit exists and belongs to this branch:
${shas.map(s => `  git cat-file -e ${s}^{commit} && git merge-base --is-ancestor ${s} HEAD && echo "${s} OK"`).join('\n')}
A reported sha that does not resolve, or is not an ancestor of HEAD, means the report is
describing work that is not here.` : ''}
${uncommitted.length ? `
These tasks claim status 'completed' but reported NO commit — treat each as UNVERIFIED until
you find its work in the diff, and do not approve on the strength of its summary alone:
${uncommitted.map(t => `  - ${t.id} (${t.assigned_to})`).join('\n')}
Also check \`git status --porcelain\`: uncommitted changes in the tree mean the work exists
but was never durably committed, which is a required_fix, not a pass.` : ''}

Judge the acceptance criteria against what the diff shows, not against what the summaries
assert. Where the two disagree, the diff wins and the disagreement itself is a finding.`

  return `Mode: E — Reviewer

Review the completed phase and determine whether acceptance criteria are met.

Phase: ${p.id} — ${p.title}
Plan reference: ${planRef}

Task agents' self-reported claims:
${taskSummaries || '(no tasks completed)'}
${verifyBlock}

Return a verdict conforming to the VERDICT_SCHEMA. Set approved:true only if you have observed
the diff yourself, every acceptance criterion is met in the code you read, and no blockers
remain. Record what you actually inspected in \`evidence\` — an approval with no evidence of
inspection is the failure mode this gate exists to catch, including when you are the one
producing it. If approved:false, provide actionable required_fixes.
Do NOT git add/commit/push/stash.`
}

function fixPrompt(p, requiredFixes) {
  const fixList = (requiredFixes ?? []).map((f, i) => `${i + 1}. ${f}`).join('\n')

  return `Mode: C — Autonomous Feature Sprint

Fix the following issues identified by the reviewer for phase ${p.id} — ${p.title}.

Required fixes:
${fixList || '(see phase context for issues)'}

Apply all fixes.` + durabilityFooter(p?.isolation === 'worktree', graph?.run_branch)
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

Explore the plan, implement the phase tasks with appropriate file-ownership batching.` + buildPhaseOwnerNestingClause(nestingEnabled) + durabilityFooter(p?.isolation === 'worktree', graph?.run_branch)
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
  // Gate-tiering v4.1 (execution-doctrine.md rule 1, same-class stop rule): the class
  // the PREVIOUS round found. If a round repeats it, the shape is wrong and the next
  // action is a design change, not another review — so we exit needs_redesign instead
  // of spending the remaining budget cycle rediscovering the same class one layer down.
  let priorDefectClass = initialVerdict?.defect_class ?? null
  let sameClassRepeat = null
  // Set when the loop exits because a re-review produced NO verdict (§8b) rather than a
  // rejection. Kept separate from sameClassRepeat: same exit, different next action.
  let gateFailed = null

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

    // Route through dispatchReview, never a bare agent(): for a council phase reviewerType
    // is 'council-review', a skill with no agent file. Dispatching it here resolved nothing
    // and returned null, so EVERY council rejection's re-review gate-failed by construction —
    // a fix cycle that could never be re-reviewed on the path it came from.
    const reReview = await dispatchReview(p, taskOut, reviewerType)
    verdict = reReview.verdict

    cycles++

    // A council re-review that came back conditional / partial / unvalidated is not a
    // rejection to iterate on; stop for the same reason a null verdict stops the loop.
    if (reReview.integrity_failure) {
      log(`GATE INTEGRITY FAILURE on phase ${p.id} re-review (fix cycle ${cycles}): ${reReview.integrity_failure}. Halting the fix loop — the fix so far is unreviewed, not rejected.`)
      gateFailed = reReview.integrity_failure
      break
    }

    // §8b: the re-review itself produced no verdict. Looping would spend the remaining
    // budget on fixes chosen from a rejection that does not exist, so stop and say why.
    if (!verdict) {
      log(`GATE FAILURE on phase ${p.id} re-review (fix cycle ${cycles}): reviewer ${reviewerType} returned no structured verdict. Halting the fix loop — the fix so far is unreviewed, not rejected.`)
      gateFailed = 'reviewer returned no structured verdict on re-review (died after retries, or skipped)'
      break
    }

    // Same-class stop rule. Only fires on a non-approving verdict that names a class
    // matching the previous round's. An absent defect_class never triggers it (we do
    // not guess), and two rounds finding DIFFERENT classes is normal review progress.
    if (!verdict?.approved && verdict?.defect_class && priorDefectClass &&
        verdict.defect_class === priorDefectClass) {
      sameClassRepeat = verdict.defect_class
      log(`Same-class stop rule: phase ${p.id} surfaced defect class '${sameClassRepeat}' in two consecutive rounds after ${cycles} fix cycle(s). Halting the fix loop — the next action is a design change (surface reduction / choke point), not another review. See dev-execution/references/gate-risk-classes.md §3b.`)
      break
    }
    if (!verdict?.approved && verdict?.defect_class) {
      priorDefectClass = verdict.defect_class
    }
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict: verdict ?? gateFailureVerdict(reviewerType, gateFailed || 'reviewer returned no structured verdict'),
    fix_cycles: cycles,
    // false when the LAST reviewer pass produced nothing, OR produced something that cannot
    // be trusted as a verdict (conditional / lost findings / failed arc validate). A plain
    // rejection still ran. `gateFailed` covers both untrustworthy cases.
    gate_ran: Boolean(verdict) && !gateFailed,
    // Set only when the loop exited via the same-class stop rule. Opus reads this to
    // route to redesign rather than adjudicating another review pass.
    needs_redesign: sameClassRepeat ? { defect_class: sameClassRepeat, rounds: cycles } : null,
    escalate: !verdict?.approved,
    files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
    blockers: verdict?.approved
      ? []
      : gateFailed
        ? [{
            description: `Reviewer gate did not run on phase ${p.id} after ${cycles} fix cycle(s) — ${reviewerType} returned no verdict on re-review.`,
            resolution_hint: 'The last fix is UNREVIEWED, not rejected. Re-dispatch the reviewer against the current state (or invoke the reviewer-gate workflow on the same scope). Do NOT run another fix cycle — there is no finding to act on.',
          }]
        : sameClassRepeat
          ? [{
              description: `Defect class '${sameClassRepeat}' recurred across two consecutive review rounds on phase ${p.id}.`,
              resolution_hint: 'Do NOT re-review. Make a design change: render the unsafe state unrepresentable, or route every caller through one choke point, then re-enter the gate against the new shape (budget resets — the scope changed). See dev-execution/references/gate-risk-classes.md §3b.',
            }]
          : [{ description: 'Reviewer did not approve after fix-loop cycles.', resolution_hint: 'Opus adjudication required.' }],
  }
}

// ---------------------------------------------------------------------------
// Council verdict assessment (authoring-spec §8b, one level up).
//
// §8b closes the case where a reviewer DIES: verdict === null ⇒ gate_failure, gate_ran:false,
// escalate:true. It does not touch the case where a verdict EXISTS but is conditional,
// partial, or self-reportedly under-evidenced — and that case was collapsing into a clean
// pass. Observed 2026-08-04 at an M1 council gate: the council's own scorecard said
// recommendation "proceed_with_conditions", overall 45/100, every lens 2–3/10, evidence
// completeness 1/10, and its findings.yaml recorded that 5 of 8 adjudicated findings never
// reached the artifact writer. The orchestrator received `approved:true` with
// `required_fixes: []` and `arc_validate_passed:false`, and the wave advanced. Nothing in the
// envelope pointed at any of it; it was found only by opening the scorecard by hand.
//
// Three independent losses, all pointing the same way — toward false assurance:
//   1. 'proceed_with_conditions' → approved:true. The verdict is boolean, so "proceed, but
//      these conditions hold" is indistinguishable from an unconditional pass, and the
//      conditions are dropped rather than carried as required_fixes.
//   2. Findings lost between adjudication and the artifact writer are reported as if the
//      SURVIVORS were the whole population — the envelope actively asserts watchlist:0 for a
//      run that had 3 watchlist findings it simply never received.
//   3. arc_validate_passed:false is present, load-bearing, and keyed off by nothing.
//
// A lost-findings or failed-validation run is NOT a rejection: there is no finding to act on,
// so a fix cycle would edit blind and then re-review unchanged code. It belongs in the same
// family as gate_ran:false — re-dispatch or record an explicit operator override. A
// conditional verdict IS actionable, so its conditions become required_fixes and it takes the
// normal non-approval path.
// ---------------------------------------------------------------------------

const CONDITIONAL_RECOMMENDATIONS = new Set([
  'proceed_with_conditions',
  'approve_with_conditions',
  'conditional',
  'conditional_approval',
])

function assessCouncilVerdict(raw, phaseId) {
  // workflow() returns null if the user skips it.
  if (!raw) {
    return {
      verdict: {
        approved: false,
        reviewer_type: 'council-review',
        required_fixes: ['Council workflow was skipped — manual review required.'],
      },
      integrity_failure: null,
    }
  }

  // The council bailed before writing its decision record. It carries a fallback_verdict, but
  // the previous spread produced an object with no `approved` key at all — falsy by accident.
  if (raw.status === 'needs_opus' || raw.status === 'blocked') {
    return {
      verdict: {
        ...(raw.fallback_verdict ?? {}),
        approved: false,
        reviewer_type: 'council-review',
        council_status: raw.status,
        council_reason: raw.reason ?? null,
      },
      integrity_failure: `the review-council sub-workflow did not complete (status '${raw.status}'${raw.reason ? `, reason '${raw.reason}'` : ''})`,
    }
  }

  const summary = raw.summary ?? {}
  const verdict = {
    ...raw,
    reviewer_type: 'council-review',
    // Propagate the scorecard signals so the orchestrator can apply judgement from the
    // envelope alone, instead of opening scorecard.json by hand.
    council_recommendation: raw.recommendation ?? null,
    council_overall: raw.overall ?? null,
    council_by_lens: raw.by_lens ?? null,
  }

  // --- Integrity checks: a pass that cannot be trusted as a pass. ---
  const integrityReasons = []

  const claimed = summary.total_findings_claimed
  const delivered = summary.total_findings
  const notReceived = summary.findings_not_received
  if (typeof notReceived === 'number' && notReceived > 0) {
    integrityReasons.push(`${notReceived} adjudicated finding(s) never reached the artifact writer (findings_not_received=${notReceived})`)
  } else if (typeof claimed === 'number' && typeof delivered === 'number' && claimed > delivered) {
    integrityReasons.push(`the council claimed ${claimed} findings but only ${delivered} were delivered — ${claimed - delivered} lost at the adjudication/artifact seam`)
  }
  if (summary.arc_validate_passed === false) {
    integrityReasons.push('the council\'s own `arc validate` did not pass (arc_validate_passed=false)')
  }

  if (integrityReasons.length > 0) {
    return {
      verdict: { ...verdict, approved: false, verdict_source: 'gate_integrity_failure' },
      integrity_failure: integrityReasons.join('; '),
    }
  }

  // --- Conditional recommendation: actionable, so it takes the normal rejection path. ---
  const rec = typeof raw.recommendation === 'string' ? raw.recommendation.toLowerCase() : null
  if (rec && CONDITIONAL_RECOMMENDATIONS.has(rec) && verdict.approved) {
    const conditions = (raw.required_fixes ?? []).length > 0
      ? raw.required_fixes
      : [`The council returned '${raw.recommendation}' for phase ${phaseId} but supplied no explicit conditions in required_fixes. Read the council artifacts (${raw.council_artifacts?.scorecard_json ?? raw.council_artifacts?.run_dir ?? 'run_dir'}) and resolve the conditions before treating this phase as approved.`]
    return {
      verdict: {
        ...verdict,
        approved: false,
        verdict_source: 'conditional_approval',
        required_fixes: conditions,
      },
      integrity_failure: null,
    }
  }

  return { verdict, integrity_failure: null }
}

// Invoke the review-council sub-workflow for a phase. One nesting level: execute-plan is the
// top workflow and review-council is the only sub-workflow it may nest.
async function runCouncil(p, taskOut) {
  return workflow('review-council', {
    target: { type: 'phase-taskout', ref: p.id, description: p.title || p.id },
    task_summaries: JSON.stringify(taskOut.filter(Boolean)),
    plan_ref: planRef,
    phase_id: p.id,
    timestamp: graph.timestamp,
    intensity: 'standard',
  })
}

// Single review dispatch point. Routing MUST go through here so that 'council-review' — a
// SKILL, deliberately absent from KNOWN_AGENT_TYPES — can never land in an agentType position.
// Returns { verdict, integrity_failure }.
async function dispatchReview(p, taskOut, reviewerType) {
  if (reviewerType === 'council-review') {
    return assessCouncilVerdict(await runCouncil(p, taskOut), p.id)
  }
  const verdict = await agent(reviewPrompt(p, taskOut), {
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })
  return { verdict, integrity_failure: null }
}

// Shared shape for "the gate could not be trusted to have run" — used by both the §8b
// null-verdict case and the council-integrity case. Their next action is identical:
// re-dispatch or record an explicit operator override. Never a fix cycle.
function gateIntegrityResult(p, taskOut, reviewerType, verdict, reason, cycles) {
  return {
    phase: p.id,
    reviewer_type: reviewerType,
    tasks: taskOut,
    verdict,
    fix_cycles: cycles ?? 0,
    gate_ran: false,
    escalate: true,
    files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
    blockers: [{
      description: `Reviewer gate on phase ${p.id} did not produce a trustworthy verdict — ${reason}.`,
      resolution_hint: 'This is NOT an approval and NOT a rejection. Re-dispatch the reviewer against the current state (or invoke the reviewer-gate workflow on the same scope), or record an explicit operator override. Do NOT run a fix cycle — there is no finding to act on.',
    }],
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
  // Resolve the reviewer FIRST, then branch on it.
  //
  // The council branch used to be guarded by `p.review_intensity === 'council'` while the
  // standard branch dispatched `agentType: councilEscalation(p, tier)`. Those two disagree
  // for exactly the phase shape gate-tiering v4.1 prescribes: a phase carrying
  // gate_lens:['security'] (per references/gate-risk-classes.md §2) but no legacy
  // review_intensity field resolves to 'council-review' — which is a SKILL, deliberately
  // absent from KNOWN_AGENT_TYPES — and was handed straight to agent() as an agentType. The
  // dispatch resolved nothing, the verdict came back null, and §8b recorded a generic
  // "reviewer returned no verdict" escalation. It did not silently approve, but the security
  // lens never ran, and the failure looked like a flaky reviewer rather than an undispatchable
  // gate config — so the operator's natural response (re-dispatch) reproduces it verbatim.
  //
  // Reading gate_lens was added precisely to stop a high-risk surface getting only
  // task-completion-validator. Branching on the RESOLVED reviewer is what makes the
  // "security is non-removable" invariant reachable rather than documentary.
  const reviewerType = councilEscalation(p, tier)

  // Council path: invoke review-council sub-workflow for core-path / high-risk phases.
  // This codifies the "[Pair adversarial reviewer with AC validator]" lesson:
  // deterministically runs diverse-lens reviewers + adversarial code-tracer in parallel.
  if (reviewerType === 'council-review') {
    const { verdict, integrity_failure } = assessCouncilVerdict(await runCouncil(p, taskOut), p.id)

    // A conditional / partial / unvalidated council result is not a pass, and — unlike a
    // rejection — it is not something a fix cycle can act on.
    if (integrity_failure) {
      log(`GATE INTEGRITY FAILURE on phase ${p.id}: ${integrity_failure}. Recording as a gate failure, NOT as an approval or a rejection. The fix loop is deliberately skipped.`)
      return gateIntegrityResult(p, taskOut, 'council-review', verdict, integrity_failure, 0)
    }

    if (!verdict.approved) {
      return fixLoop(p, taskOut, verdict, 'council-review')
    }

    return {
      phase: p.id,
      tasks: taskOut,
      verdict,
      fix_cycles: 0,
      gate_ran: true,
      escalate: false,
      files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
      blockers: [],
    }
  }

  // Standard / tier3 path: single edit-less reviewer agent.
  // P3: when provider_routing_enabled=true, use codex-executor two-stage AC validation
  // instead of direct agent() call with VERDICT_SCHEMA. Council path is MUST-STAY (above).

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

  // §8b: no verdict at all ⇒ the gate did not run. Do NOT enter the fix loop — there is no
  // finding to fix, so a cycle would edit blind and then re-review unchanged code. Escalate
  // immediately with the reason named.
  if (!verdict) {
    log(`GATE FAILURE on phase ${p.id}: reviewer ${reviewerType} returned no structured verdict (died after retries, or skipped). Recording as a gate failure, NOT as an approval or a rejection. The fix loop is deliberately skipped — re-dispatch the reviewer or record an operator override.`)
    const failed = gateFailureVerdict(reviewerType, 'reviewer returned no structured verdict (died after retries, or skipped)')
    return {
      phase: p.id,
      tasks: taskOut,
      verdict: failed,
      fix_cycles: 0,
      gate_ran: false,
      escalate: true,
      files_touched: taskOut.filter(Boolean).flatMap(t => t.files_affected ?? []),
      blockers: [{
        description: `Reviewer gate did not run on phase ${p.id} — ${reviewerType} returned no verdict.`,
        resolution_hint: 'Re-dispatch the reviewer for this phase (or invoke the reviewer-gate workflow against the same scope). Do NOT treat the phase as reviewed, and do NOT run a fix cycle: nothing has been found yet.',
      }],
    }
  }

  if (!verdict.approved) {
    return fixLoop(p, taskOut, verdict, reviewerType)
  }

  return {
    phase: p.id,
    tasks: taskOut,
    verdict: verdict,
    fix_cycles: 0,
    gate_ran: true,
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

// Evidence must be something the validator READ, not something it was TOLD. The prior
// instruction accepted "one-line evidence citing task IDs or commit SHAs" — but a task id is
// a pointer back to the same self-report being validated, so an AC could be marked MET on the
// strength of the claim under review. Observed 2026-08-04: a phase shipped a conceptual bug
// while its report claimed per-AC verification, and the AC pass did not contradict it.
function codexAcValidationPrompt(p, taskOut, planRef, artifactPath) {
  const claimed = taskOut.filter(Boolean)

  const taskSummaries = claimed
    .map(t => `- ${t.id} (${t.assigned_to}): ${t.summary ?? 'no summary'} [${t.status}]${t.commit_sha ? ' commit:' + t.commit_sha : ' commit:NONE REPORTED'}`)
    .join('\n')

  const uncommitted = claimed.filter(t => t.status === 'completed' && !t.commit_sha)

  return `Mode: A — Exploration Only. Read-only investigation. Do NOT write production code. Do NOT git add/commit/push/stash.

You are the AC validator for phase: ${p.id} — ${p.title}
Plan reference: ${planRef}

Task agents' self-reported claims (NOT evidence — these are what you are checking):
${taskSummaries || '(no tasks completed)'}
${uncommitted.length ? `
⚠️ These claim 'completed' but reported no commit. Find their work in the diff or treat the
   corresponding ACs as NOT MET:
${uncommitted.map(t => `   - ${t.id} (${t.assigned_to})`).join('\n')}
` : ''}
Validate every Acceptance Criterion in the plan reference against the CODE, not the claims:

  MB=$(git merge-base HEAD origin/main)   # pin the base once; never diff origin/main..HEAD
  git diff "$MB"..HEAD
  git status --porcelain                  # work that exists but was never committed

EVIDENCE RULE: evidence is a \`file:line\` you read, a function/behaviour you traced, or a
command you ran and its output. A task id or a quoted task summary is NOT evidence — it is the
claim under review, and citing it validates the report against itself. If you cannot point at
code for an AC, it is NOT MET, even when a task says it did it.

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: <file:line or traced behaviour>

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
  // Advisory only — names the model that should drive the orchestration loop
  // (session / main-loop) for the plan. Cascades to phases unless a phase sets
  // its own orchestrator_model. The workflow cannot switch its own main-loop
  // model mid-run; this value is echoed in the startup banner and carried in the
  // graph for surfacing. It does NOT change the delegate model: on any agent() call.
  orchestrator_model,
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
  const dryErrors = validateGraph(waves)
  if (dryErrors.length > 0) {
    log(`Graph validation found ${dryErrors.length} error(s):\n  - ${dryErrors.join('\n  - ')}`)
  }
  // Surface a repo-target mismatch in the dry run too — the whole point of a dry run is to
  // learn this BEFORE spending a live wave, and a cross-repo graph is the one error a dry
  // run would otherwise report as a clean graph.
  const dryRepoBlock = validateRepoTarget(graph)
  if (dryRepoBlock) {
    log(`REPO TARGET MISMATCH (${dryRepoBlock.reason}): ${dryRepoBlock.blockers[0].description}`)
  }
  return {
    status: 'dry_run',
    graph,
    graph_errors: dryErrors,
    repo_target_blocked: dryRepoBlock ? dryRepoBlock.reason : null,
  }
}

// ---------------------------------------------------------------------------
// Repo-target guard — runs BEFORE graph validation and before any agent is spawned.
// A graph can be perfectly well-formed and still be pointed at the wrong repository;
// that failure is silent by construction, so it is checked first.
// ---------------------------------------------------------------------------
const repoBlock = validateRepoTarget(graph)
if (repoBlock) {
  log(`HALTING — ${repoBlock.reason}: ${repoBlock.blockers[0].description}`)
  return repoBlock
}

// ---------------------------------------------------------------------------
// Graph validation — runs BEFORE the wave loop, so a malformed graph halts the run
// instead of dispatching agents with an undefined prompt / undefined agentType.
// This is the "never dispatch what you could not resolve" half of the batch-member fix.
// ---------------------------------------------------------------------------
const graphErrors = validateGraph(waves)
if (graphErrors.length > 0) {
  log(`INVALID GRAPH — halting before any agent is spawned. ${graphErrors.length} error(s):\n  - ${graphErrors.join('\n  - ')}`)
  return {
    status: 'blocked',
    reason: 'invalid_graph',
    graph_errors: graphErrors,
    report: [],
    blockers: graphErrors.map(e => ({
      description: e,
      resolution_hint: 'Fix the ExecutionGraph in Opus pre-flight: every batch member must be a full task object, or an {id} that matches an entry in the same phase\'s tasks[]. No agents were spawned.',
    })),
  }
}

// ---------------------------------------------------------------------------
// Branch-placement guard — fail-closed, BEFORE the first wave can commit anything.
//
// Workflow agents run in the session's cwd on whatever branch the session repo is checked out to.
// There is no per-agent cwd, and background workflow agents ignore EnterWorktree, so an
// orchestrator that creates a worktree and "passes" it cannot reach these agents. Observed
// 2026-08-05 in the sibling autopilot lane: the assigned branch received zero commits while the
// real work landed on `main` and was pushed, skipping the PR and review gates, and the report
// still read `complete`. Naming the branch and refusing to run anywhere else is the only check
// that fires before the damage is durable.
//
// No-op when graph.run_branch is unset, so un-updated callers behave exactly as before.
// ---------------------------------------------------------------------------
if (graph.run_branch) {
  phase('Branch guard')
  const guard = await agent(branchGuardPrompt(graph.run_branch, graph.branch_base), {
    label: 'branch-guard',
    phase: 'Branch guard',
    agentType: 'general-purpose',
    model: 'haiku',
    schema: BRANCH_GUARD_SCHEMA,
  })

  if (!guard || guard.current_branch !== graph.run_branch) {
    const found = guard ? `'${guard.current_branch}'` : 'unverifiable (guard returned nothing)'
    log(`HALTING — wrong_branch: expected '${graph.run_branch}', found ${found}.`)
    return {
      status: 'blocked',
      reason: 'wrong_branch',
      report: [],
      blockers: [{
        description: `This plan was assigned run branch '${graph.run_branch}' but the session working tree is on ${found}. Task agents commit to the session branch, so every wave would have committed to the wrong branch — bypassing the PR and review gates — while reporting success. No agents were spawned; nothing was committed.`,
        resolution_hint: `In the session repo run: git switch ${graph.run_branch} (create it from the parent branch if needed), then re-invoke. Do NOT create a separate worktree and pass its path — background workflow agents run in the session's cwd and ignore EnterWorktree.`,
      }],
    }
  }
  log(`Branch guard OK: on '${guard.current_branch}' at ${guard.head_sha}.`)
}

// ---------------------------------------------------------------------------
// Pattern: waveFanout — sequential waves, parallel phases, file-ownership batches.
// ---------------------------------------------------------------------------

const report = []

// Advisory startup banner: echo the orchestration-loop model for this plan and any
// per-phase overrides. The workflow runs under the operator's session model and cannot
// switch its own main-loop model mid-run — this only surfaces intent.
const orchOverrides = waves
  .flatMap(w => w.phases)
  .filter(p => p.orchestrator_model && p.orchestrator_model !== orchestrator_model)
  .map(p => `${p.id}→${p.orchestrator_model}`)
log(`Orchestrator model: ${orchestrator_model || 'session default'}${orchOverrides.length ? ` (per-phase overrides: ${orchOverrides.join(', ')})` : ''} — advisory; launch the session under this model.`)

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
    // Members may be full task objects or {id} references into p.tasks; resolvedBatches()
    // normalises both, and validateGraph() has already rejected anything unresolvable.
    const batches = resolvedBatches(p)

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
        // Durability footer appended to every task prompt (see durabilityFooter()).
        let result
        // The footer's premise must match reality: only a task actually granted
        // isolation:'worktree' owns its branch. Everything else shares the tree with the
        // sibling tasks running alongside it in this very parallel() call.
        const taskIsolated = (t.isolation ?? p.isolation) === 'worktree'
        try {
          result = await agent(t.prompt + durabilityFooter(taskIsolated, graph?.run_branch), {
            label: `${p.id}:${t.id}`,
            phase: `Wave ${wave.id}`,
            agentType: t.assigned_to,
            model: t.model,
            isolation: taskIsolated ? 'worktree' : undefined,
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

  // A phase whose thunk threw — or whose agent stalled through every retry — resolves to
  // `null` in waveResults (documented parallel() behaviour). `filter(Boolean)` was doing
  // double duty: "drop empties" and, accidentally, "discard failures". The nulled phase was
  // removed from the array BEFORE the escalation check inspected it, so `.some(r =>
  // r?.escalate)` could not fire for it, and the loop advanced to the next wave as though the
  // phase had succeeded.
  //
  // Observed 2026-08-04 on the final wave of a 3-wave plan: one agent stalled through 6
  // consecutive 180s no-progress retries, its phase produced no result, the wave's `phases`
  // array came back EMPTY, and the workflow returned `{status:'complete', report:[{wave:'3',
  // phases:[]}]}`. The reviewer gate for that milestone never ran at all. The only signal was
  // an empty array plus a line in the harness's <failures> channel — which a programmatic
  // caller (cron / unattended lane) never sees, and which an orchestrator trusting
  // `status:'complete'` has no reason to correlate. 13 commits across 53 files, including a
  // live id-leak fix, came within one hand-read of merging entirely ungated.
  //
  // So: a dropped phase is recorded, named, and escalated — the same loudness contract §8b
  // already applies to a dead reviewer — and the reason travels in the RETURN VALUE.
  const droppedPhases = waveResults
    .map((r, i) => (r ? null : (wave.phases[i]?.id ?? `(unnamed phase at index ${i})`)))
    .filter(Boolean)

  const completedWaveResults = waveResults.filter(Boolean)
  report.push({
    wave: wave.id,
    phases: completedWaveResults,
    // Recorded on every wave so the terminal invariant below is checkable from the report
    // alone, by this workflow and by anything downstream that consumes it.
    phases_expected: wave.phases.length,
    phases_returned: completedWaveResults.length,
    dropped_phases: droppedPhases,
  })

  if (droppedPhases.length > 0) {
    log(`Wave ${wave.id}: ${droppedPhases.length} phase(s) produced NO result and were dropped: ${droppedPhases.join(', ')}. Their reviewer gates did NOT run. Returning to Opus — this is not a completion.`)
    return {
      status: 'needs_opus',
      reason: 'phase_dropped',
      dropped_phases: droppedPhases,
      report,
      blockers: droppedPhases.map(id => ({
        description: `Phase ${id} in wave ${wave.id} returned no result — its agent stalled, threw, or was skipped after retries. Its reviewer gate did NOT run.`,
        resolution_hint: 'Do NOT treat this wave as complete. Inspect the phase\'s worktree state by hand, then either re-dispatch the phase or run the reviewer gate against whatever work actually landed. Any later wave building on this one is building on an unverified predecessor.',
      })),
    }
  }

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

// ---------------------------------------------------------------------------
// Terminal completeness invariant.
//
// The per-wave check above already escalates a dropped phase, so reaching here with a short
// wave should be impossible. That is exactly why the assertion is worth its three lines: it
// is cheap, it is the last thing standing between a silently-shortened report and a
// `status:'complete'` that an unattended caller will believe, and it holds for any FUTURE
// early-exit path that forgets to account for its own phases. status:'complete' must be
// unreachable whenever any wave returned fewer phases than it was given.
// ---------------------------------------------------------------------------
const shortWaves = report.filter(w => (w.phases?.length ?? 0) !== (w.phases_expected ?? w.phases?.length ?? 0))
if (shortWaves.length > 0) {
  const detail = shortWaves.map(w => `wave ${w.wave}: ${w.phases_returned ?? w.phases?.length ?? 0}/${w.phases_expected} phases${(w.dropped_phases ?? []).length ? ` (dropped: ${w.dropped_phases.join(', ')})` : ''}`).join('; ')
  log(`COMPLETENESS INVARIANT VIOLATED — refusing to report complete. ${detail}`)
  return {
    status: 'needs_opus',
    reason: 'phase_dropped',
    dropped_phases: shortWaves.flatMap(w => w.dropped_phases ?? []),
    report,
    blockers: [{
      description: `Completeness invariant violated: ${detail}. One or more phases produced no result, so their reviewer gates did not run.`,
      resolution_hint: 'Do NOT treat this plan as complete. Identify the missing phases from the report, inspect what actually landed, and re-run their reviewer gates before merging.',
    }],
  }
}

return { status: 'complete', report }
