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
 * Branch-placement contract (args.run_branch / args.branch_base / args.parent_branch):
 *   Workflow agents run in the SESSION's cwd on whatever branch the session repo is checked out
 *   to. There is no per-agent cwd and background workflow agents ignore EnterWorktree, so an
 *   orchestrator that creates a separate worktree and "passes" it CANNOT reach these agents —
 *   they commit to the session branch regardless. Observed 2026-08-05 (run wf_944c5c91-78e):
 *   autopilot created `.claude/worktrees/<slug>` on `autopilot/<slug>`, that branch received ZERO
 *   commits, and both real commits landed on `main` — one of them pushed — skipping the PR,
 *   review, and squash gates silently while the report read `status: complete`.
 *   The fix is not a path argument; it is to name the branch the orchestrator expects and refuse
 *   to work anywhere else:
 *     - run_branch    the branch the session repo MUST be on. When set, a pre-sprint guard
 *                     verifies it and returns blocked/wrong_branch BEFORE any agent can commit.
 *     - branch_base   the pre-run checkpoint SHA. Replaces the `HEAD~10` guess in the structurer,
 *                     which silently computed files_touched against an arbitrary base.
 *     - parent_branch the PR base, carried through so the report can flag a mid-run parent move.
 *   All three are optional: unset ⇒ every guard degrades to its previous behaviour, so callers
 *   that have not been updated are unaffected.
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

// `commit_sha` is deliberately NOT required. It used to be, with pattern ^[0-9a-f]{7,40}$, while the
// structurer prompt instructed `commit_sha: ""` for the no-report case — an unsatisfiable pair that
// forced the structurer to either fail schema validation repeatedly or invent a plausible SHA. The
// no-commit case is now expressed by OMITTING the field, which the script tests for directly.
// `commit_count` / `current_branch` are required because they are the placement evidence: they are
// what distinguishes "work landed on the branch we assigned" from "work landed somewhere else",
// and a field the structurer may omit is a field the script cannot gate on.
const SPRINT_RESULT_SCHEMA = {
  type: 'object',
  required: ['completion_report_path', 'ac_verdicts', 'files_touched', 'commit_count', 'current_branch'],
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
    commit_count: { type: 'integer', minimum: 0 },
    current_branch: { type: 'string' },
    head_sha: { type: 'string' },
    patch_id: { type: 'string' },
    parent_tip: { type: 'string' },
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

// ─── placement facts (pure) ───────────────────────────────────────────────────
// The provenance block every consumer needs to tell "rebased away" from "never existed" without
// guessing. A bare commit_sha cannot carry that distinction: `git show <sha>` keeps working locally
// while the object survives gc, so a stale SHA looks identical to a live one right up until a fresh
// clone or CI resolves nothing (observed 2026-08-05 — reported 8cd71d1 was an orphan; the real work
// was 952f379, same message and same diffstat, after main moved mid-run and the commit was rebased).
// `patch_id` is stable across rebase, so it re-finds the work when the SHA has moved; parent_moved
// is computed rather than inferred so the post-flight guard can branch on it instead of guessing.
function placementFacts(parsed, sprintResult) {
  const facts = {
    run_branch: parsed.run_branch || null,
    parent_branch: parsed.parent_branch || null,
    base_sha: parsed.branch_base || null,
    current_branch: sprintResult.current_branch || null,
    commit_count: typeof sprintResult.commit_count === 'number' ? sprintResult.commit_count : null,
    head_sha: sprintResult.head_sha || null,
    patch_id: sprintResult.patch_id || null,
    parent_tip_at_start: parsed.parent_tip_at_start || null,
    parent_tip_at_report: sprintResult.parent_tip || null,
  }
  // Only assert movement when BOTH ends are known. Absent either, the honest value is null —
  // reporting `false` would claim the parent held still on evidence we do not have.
  facts.parent_moved =
    facts.parent_tip_at_start && facts.parent_tip_at_report
      ? facts.parent_tip_at_start !== facts.parent_tip_at_report
      : null
  return facts
}

// ─── branch-placement guard (pre-sprint, fail-closed) ─────────────────────────
// Cheap read-only haiku probe. Its whole job is to answer "is the session repo actually on the
// branch the orchestrator assigned?" BEFORE the sprint executor can make its first commit —
// because once a commit lands on the parent branch the damage is already durable and, in the one
// observed case, pushed. Placement was previously checked only after the fact (by the reviewer,
// which treated the branch it found as neutral context) or not at all.
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

// Names the assigned branch in the executor's own prompt and makes verifying it a precondition of
// the first commit. The pre-sprint guard above already established the tree is on the right branch;
// this defends the rest of the sprint, where a `git switch` or `git checkout` mid-run would move the
// commits off it. Empty string when no run_branch was supplied ⇒ byte-for-byte prior behaviour.
function buildBranchContractClause(runBranch) {
  if (!runBranch) return ''
  return `
BRANCH CONTRACT — verify BEFORE your first commit, and fail closed:
  Assigned branch: ${runBranch}
  Run: git rev-parse --abbrev-ref HEAD
  If the output is NOT exactly "${runBranch}": STOP. Do not commit, do not switch branches, do not
  create the branch. Write the Completion Report with a blocker describing the branch you actually
  found, and return. Committing to a different branch bypasses the PR and review gates that this
  run's approval depends on, and has already happened once (2026-08-05: work landed on main and was
  pushed while the run reported success), so this is a hard stop rather than a preference.
  Every commit you make must be on ${runBranch}. Never \`git switch\`/\`git checkout\` to another
  branch, never push, never merge.`
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
${buildBranchContractClause(parsed.run_branch)}

Contract: ${parsed.contract_path}
Completion Report path (write here BEFORE finishing): ${reportPath}
Budget hint: ~${parsed.budget_total || 50000} tokens${contextSection}

Run the full Tier 1 sprint:
  1. Read and internalise the Feature Contract at the path above.
  2. Explore the codebase for relevant patterns (symbols-first, then targeted file reads).
  3. Implement all Acceptance Criteria.
  4. DURABILITY: commit each logical unit of work to ${parsed.run_branch ? `branch ${parsed.run_branch}` : 'the current branch'} as you go.
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
  // `HEAD~10` was the old fallback and it is a guess, not a base: it silently computed
  // files_touched and the commit range against an arbitrary point 10 commits back, which is how a
  // report came to disagree with reality by 55 files. When the caller supplies branch_base (the
  // recorded pre-run checkpoint) we use it; the fallback survives only for un-updated callers.
  const branchBase = parsed.branch_base || 'HEAD~10'
  const parentBranch = parsed.parent_branch
  const parentStep = parentBranch
    ? `\n  6. Run: git rev-parse ${parentBranch} 2>/dev/null || git rev-parse origin/${parentBranch}
     Set parent_tip to that SHA (omit the field if neither resolves). This lets the orchestrator
     tell "the parent branch moved under us" from "this commit never existed".`
    : ''
  return `Mode: A — Exploration Only

Read the Completion Report at: ${reportPath}

ALWAYS report the git facts below, whether or not the report file exists — placement is judged from
git, never from the report. Report what git actually prints; do not normalise it toward what the
orchestrator expects, and never guess a SHA.

  1. Run: git rev-parse --abbrev-ref HEAD
     Set current_branch to that exact value.
  2. Run: git rev-list --count "${branchBase}..HEAD"
     Set commit_count to that integer. Run: git rev-parse HEAD → head_sha.
  3. Run: git log --oneline "${branchBase}..HEAD"
     If commit_count is 0: OMIT the commit_sha field entirely (do NOT send an empty string, do NOT
     substitute head_sha) and set a blocker: "No commits since branch base — sprint work is
     uncommitted or landed on another branch."
     If commit_count is > 0: set commit_sha to the newest commit in that range.
  4. Run: git diff --name-only "${branchBase}..HEAD"
     Set files_touched. If commit_count is 0 this is [].
  5. Run: git diff "${branchBase}..HEAD" | git patch-id --stable
     Set patch_id to the FIRST field of the output (omit the field if the command prints nothing).
     This identity survives a rebase, so a consumer can re-find the work when the SHA has moved.${parentStep}

Then, if the report file exists:
  a. Parse the "### Acceptance Criteria Status" section.
     For each line starting with "- [x]" set met:true; "- [ ]" set met:false.
     Extract the criterion text after the checkbox.
  b. Set completion_report_path to the exact path you read.

If the report file does NOT exist, still return the git facts, plus:
  - completion_report_path: "${reportPath}"
  - ac_verdicts: []
  - blockers: [{description: "Completion report not found — sprint may have failed to write it"}]

Return the structured SprintResult conforming to the schema.

Do NOT edit any files. Read only. Do NOT git add/commit/push/stash/checkout/switch.`
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
// The Completion Report and the sprint's commit_sha are CLAIMS. A sprint has returned without
// committing, left failing tests, and later filed a report crediting itself with a fix written
// by someone else (observed 2026-08-04). The reviewer must therefore establish that the commit
// exists before reasoning about it — and when the sprint reported none, that absence is the
// finding, not a detail to route around.
function reviewPrompt(parsed, sprintResult) {
  const sha = sprintResult.commit_sha
  // Reachability is asserted against the ASSIGNED branch, not bare HEAD. `--is-ancestor <sha> HEAD`
  // passes for a commit sitting on the parent branch whenever HEAD is that parent branch, which is
  // exactly the bypass case — so the previous check reported the wrong branch as neutral context
  // and approved. Naming the branch makes placement a reviewable claim.
  const ref = parsed.run_branch || 'HEAD'
  const shaBlock = sha
    ? `Sprint commit SHA (claimed): ${sha}
Assigned run branch: ${ref}

FIRST, confirm the claim resolves AND sits on the assigned branch. A sha that does not exist, or
that is reachable from some other branch but not from ${ref}, means the work is not where this
review is authorised to approve it — that placement failure is itself a required_fix, not a detail:
  git cat-file -e ${sha}^{commit} && git merge-base --is-ancestor ${sha} ${ref} && echo "${sha} ON ${ref}"
  git branch -a --contains ${sha}    # if the line above failed, this shows where it really went`
    : `Sprint commit SHA: NONE REPORTED.

The sprint claims to have finished without naming a commit. Establish what actually landed
before reviewing anything, and treat "nothing committed" as a required_fix rather than a pass:
  git status --porcelain     # work present but never durably committed
  git log --oneline "$(git merge-base HEAD origin/main)"..HEAD`

  return `Mode: E — Reviewer

Contract: ${parsed.contract_path}
Completion Report (a self-report, not evidence): ${sprintResult.completion_report_path}
${shaBlock}

Review the sprint output against all Acceptance Criteria in the Feature Contract, judging the
CODE rather than the report. Where the two disagree, the code wins and the disagreement is
itself a finding.

  MB=$(git merge-base HEAD origin/main)   # pin the base ONCE
  git diff "$MB"..HEAD

Never diff \`origin/main..HEAD\`: main moves during a run, and the phantom diff that produces is
self-consistent and plausible, so it will not announce itself as wrong.

Return a structured VERDICT:
  - approved: true only when you have read the diff yourself and ALL Acceptance Criteria are met
    with no required fixes outstanding. An approval you cannot support by naming what you
    inspected is the failure this gate exists to catch — including when you are the one
    producing it.
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

Sprint's SELF-REPORTED AC verdicts — these are the claims you are checking, not findings.
A sprint has marked ACs met while shipping a conceptual bug behind exactly this claim:
${acVerdicts || '(none reported by sprint)'}

Validate every Acceptance Criterion in the Feature Contract against the CODE, independently of
the verdicts above. Reach your own conclusion first, then note any AC where you and the sprint
disagree — that disagreement is a finding in its own right.

  MB=$(git merge-base HEAD origin/main)   # pin the base once; never diff origin/main..HEAD
  git diff "$MB"..HEAD
  git status --porcelain                  # work that exists but was never committed
${sprintResult.commit_sha ? `  git cat-file -e ${sprintResult.commit_sha}^{commit}   # the claimed commit must resolve\n` : ''}
EVIDENCE RULE: evidence is a \`file:line\` you read or a behaviour you traced. A restatement of
the sprint's own verdict is NOT evidence — it validates the report against itself. If you cannot
point at code for an AC, it is NOT MET.

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: evidence (file:line or traced behaviour)

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

// ── repo-target guard ─────────────────────────────────────────────────────────
// The sprint agent runs in the SESSION's cwd — there is no per-agent cwd, and
// isolation:'worktree' branches the session repo. A contract whose work lives in a sibling
// repo therefore does not fail; the sprint runs against the wrong repository and its
// Completion Report says it succeeded. Full rationale + contract: the identical guard in
// execute-plan.js. Checked before the dry run — a cross-repo dry run has nothing useful to
// report, and this is the one defect an args-envelope inspection cannot see.
function repoKey(v) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return null
  const base = trimmed.split('/').pop()
  return base && base.length > 0 ? base : trimmed
}

const _target = repoKey(parsed?.target_repo)
const _session = repoKey(parsed?.session_repo)
if (_target && !_session) {
  log(`HALTING — cross_repo_unverified: target_repo '${parsed.target_repo}' declared with no session_repo.`)
  return {
    status: 'blocked',
    reason: 'cross_repo_unverified',
    report: [],
    blockers: [{
      description: `Contract declares target_repo '${parsed.target_repo}' but carries no session_repo, so the workflow cannot confirm it is running in the right repository. No agents were spawned.`,
      resolution_hint: 'In Opus pre-flight, resolve `basename "$(git rev-parse --show-toplevel)"` and pass it as session_repo. Do NOT drop target_repo to silence this.',
    }],
  }
}
if (_target && _session && _target !== _session) {
  log(`HALTING — cross_repo_target: contract targets '${parsed.target_repo}' but session is '${parsed.session_repo}'.`)
  return {
    status: 'blocked',
    reason: 'cross_repo_target',
    report: [],
    blockers: [{
      description: `Contract targets repo '${parsed.target_repo}' but this session is in '${parsed.session_repo}'. The sprint agent always runs in the session's cwd and isolation:'worktree' branches the SESSION repo, so the sprint would have executed against the wrong repository while reporting success. No agents were spawned.`,
      resolution_hint: `Start a session in the '${parsed.target_repo}' checkout and re-run there, or hand-orchestrate and verify \`git rev-parse --show-toplevel\` + \`git branch --show-current\` + \`git diff\` yourself at each step (.claude/skills/dev-execution/git-worktree-pr-protocol.md).`,
    }],
  }
}

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

// ── branch-placement guard (before the sprint can commit anything) ────────────
// Only runs when the caller named a run_branch. Fails CLOSED: an unverifiable branch state halts
// the run rather than proceeding on the assumption it is fine, because the cost of the two errors
// is not symmetric — a false halt costs a re-run, while proceeding on the wrong branch has already
// produced an unreviewed push to a shared remote.
if (parsed.run_branch) {
  const guard = await agent(branchGuardPrompt(parsed.run_branch, parsed.branch_base), {
    label: 'branch-guard',
    phase: 'Sprint',
    agentType: 'general-purpose',
    model: 'haiku',
    schema: BRANCH_GUARD_SCHEMA,
  })

  if (!guard) {
    log(`HALTING — wrong_branch: branch guard returned no verdict; placement on '${parsed.run_branch}' is unverified.`)
    return {
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `Could not verify the working tree is on run branch '${parsed.run_branch}' (the guard agent returned nothing). No sprint agent was spawned, so nothing was committed anywhere.`,
        resolution_hint: `Check out '${parsed.run_branch}' in the session repo and re-run, or re-invoke without run_branch to accept whatever branch the tree is on.`,
      }],
    }
  }

  if (guard.current_branch !== parsed.run_branch) {
    log(`HALTING — wrong_branch: tree is on '${guard.current_branch}', run branch is '${parsed.run_branch}'.`)
    return {
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `The session working tree is on branch '${guard.current_branch}' but this run was assigned '${parsed.run_branch}'. Workflow agents commit to the session branch, so the sprint would have committed to '${guard.current_branch}' — bypassing the PR and review gates — and reported success. No agents were spawned; nothing was committed.`,
        resolution_hint: `In the session repo run: git switch ${parsed.run_branch} (create it from the parent branch if needed), then re-invoke. Do NOT create a separate worktree and pass its path — background workflow agents run in the session's cwd and ignore EnterWorktree, which is the defect this guard exists to catch.`,
      }],
    }
  }

  if (parsed.branch_base && guard.base_resolves === false) {
    log(`HALTING — wrong_branch: branch_base '${parsed.branch_base}' does not resolve in this repo.`)
    return {
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `branch_base '${parsed.branch_base}' does not resolve as a commit in the session repo, so the run has no usable pre-run checkpoint and every later diff/commit-range would be computed against a guess. No agents were spawned.`,
        resolution_hint: 'Re-resolve BASE_SHA with `git rev-parse HEAD` in the session repo at run start and pass that, or omit branch_base.',
      }],
    }
  }

  log(`Branch guard OK: on '${guard.current_branch}' at ${guard.head_sha}.`)
}

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
  // No commit_sha field at all — the absence IS the signal. The old fallback set `commit_sha: ''`,
  // which reads downstream as "there is a sha, it's just blank" and let an empty run pass as one
  // with an unremarkable commit.
  sprintResult = {
    completion_report_path: reportPath,
    ac_verdicts: [],
    files_touched: [],
    commit_count: 0,
    current_branch: '',
    blockers: [{ description: 'Structure stage failed — inspect completion report on disk.', resolution_hint: 'Run: git log --oneline to find sprint commits; read ' + reportPath }],
  }
}

if (!sprintResult) {
  log('Structure stage returned null. Using minimal fallback.')
  sprintResult = {
    completion_report_path: reportPath,
    ac_verdicts: [],
    files_touched: [],
    commit_count: 0,
    current_branch: '',
    blockers: [{ description: 'Structure stage returned null — inspect completion report on disk.', resolution_hint: 'Read ' + reportPath }],
  }
}

// ── post-sprint placement checks ──────────────────────────────────────────────
// The sprint's own text output already claimed success by this point; these two checks are what
// stop that claim from becoming the run's verdict. Both were previously absent, which is how a run
// with ZERO commits on its assigned branch returned `status: complete` with all ACs "met".
//
// Ordering matters: check placement BEFORE emptiness. A sprint that committed to the parent branch
// produces commit_count 0 against the run branch too, and reporting that as "nothing was written"
// would send the operator looking for lost work that is in fact sitting — reviewed by nobody — on
// the parent branch.
if (parsed.run_branch && sprintResult.current_branch && sprintResult.current_branch !== parsed.run_branch) {
  log(`HALTING — wrong_branch: sprint ended on '${sprintResult.current_branch}', not '${parsed.run_branch}'.`)
  return {
    status: 'blocked',
    reason: 'wrong_branch',
    blocked_phase: 'sprint',
    report: [],
    blockers: [{
      description: `The sprint started on run branch '${parsed.run_branch}' but the tree ended on '${sprintResult.current_branch}', so any commits it made are not on the branch this run is authorised to merge from. Nothing has been reviewed or merged.`,
      resolution_hint: `Run \`git branch -a --contains <sha>\` for the sprint's commits to find where they landed, then cherry-pick them onto '${parsed.run_branch}' before opening the PR. Do not merge from '${sprintResult.current_branch}'.`,
    }],
    run_placement: placementFacts(parsed, sprintResult),
  }
}

if (typeof sprintResult.commit_count === 'number' && sprintResult.commit_count === 0) {
  const where = parsed.run_branch ? `run branch '${parsed.run_branch}'` : 'the current branch'
  log(`HALTING — nothing_on_run_branch: zero commits on ${where} since ${parsed.branch_base || 'the branch base'}.`)
  return {
    status: 'needs_opus',
    reason: 'nothing_on_run_branch',
    blocked_phase: 'sprint',
    report: [],
    blockers: [{
      description: `Zero commits exist on ${where} since ${parsed.branch_base || 'the branch base'}. Whatever the sprint's summary or Completion Report says it built, no durable record of it exists here — do not treat any past-tense claim in ${reportPath} as evidence.`,
      resolution_hint: `Check \`git status --porcelain\` for uncommitted work worth keeping, and \`git branch -a --contains\` / the reflog for commits that landed elsewhere. Then re-run, or execute interactively.`,
    }],
    run_placement: placementFacts(parsed, sprintResult),
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
  // Re-resolve the placement identity too, not just the SHA. A fix cycle can move HEAD and — if a
  // fix agent switched branches — move the tree off the run branch, and the report is assembled from
  // this refreshed state. Restamping only commit_sha left patch_id and current_branch describing the
  // pre-fix world.
  const branchBase = parsed.branch_base || 'HEAD~10'
  const refreshedSha = await agent(
    `Mode: A — Exploration Only\n\nRun: git rev-parse HEAD\nRun: git rev-parse --abbrev-ref HEAD\nRun: git diff --name-only "${branchBase}..HEAD"\nRun: git diff "${branchBase}..HEAD" | git patch-id --stable   (take the FIRST field; omit patch_id if it prints nothing)\n\nReturn a JSON object: { "commit_sha": "<40-char sha>", "current_branch": "<branch>", "files_touched": ["<path>", ...], "patch_id": "<id, optional>" }\nReport what git prints; never substitute an expected value.\nDo NOT edit any files. Read only. Do NOT git add/commit/push/stash/checkout/switch.`,
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
          current_branch: { type: 'string' },
          patch_id: { type: 'string' },
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
      head_sha: refreshedSha.commit_sha,
      current_branch: refreshedSha.current_branch || sprintResult.current_branch,
      patch_id: refreshedSha.patch_id || sprintResult.patch_id,
      files_touched: refreshedSha.files_touched || sprintResult.files_touched,
    }
    log(`Fix cycle ${cycleNumber}: refreshed reviewer commit reference to ${refreshedSha.commit_sha}.`)
    if (parsed.run_branch && reviewResult.current_branch && reviewResult.current_branch !== parsed.run_branch) {
      log(`HALTING — wrong_branch: fix cycle ${cycleNumber} left the tree on '${reviewResult.current_branch}', not '${parsed.run_branch}'.`)
      return {
        status: 'blocked',
        reason: 'wrong_branch',
        blocked_phase: `fix-cycle-${cycleNumber}`,
        report: [],
        blockers: [{
          description: `Fix cycle ${cycleNumber} ended with the tree on '${reviewResult.current_branch}' instead of run branch '${parsed.run_branch}', so its commits are not on the branch this run may merge from.`,
          resolution_hint: `Locate the fix commits with \`git branch -a --contains ${refreshedSha.commit_sha}\`, cherry-pick them onto '${parsed.run_branch}', then re-run the reviewer gate.`,
        }],
        run_placement: placementFacts(parsed, reviewResult),
      }
    }
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
// §8b: a gate that could not RUN is not a gate that rejected. `verdict` is null when the
// reviewer died after retries or was skipped — that is an unreviewed sprint, and the next
// action is re-dispatch, not a fix cycle. Conflating it with 'reviewer_unresolved' points
// Opus at a defect nobody found.
const gateFailed = !verdict

let finalStatus = 'complete'
let reason

if (!approved) {
  finalStatus = 'needs_opus'
  reason = gateFailed ? 'gate_failure' : budgetExhausted ? 'budget_exhausted' : 'reviewer_unresolved'
  if (gateFailed) {
    log(`GATE FAILURE: reviewer ${reviewerType} returned no structured verdict after ${cycles} fix cycle(s). The sprint is UNREVIEWED, not rejected — re-dispatch the reviewer (or invoke the reviewer-gate workflow on this scope) before treating it as gated. Escalating to Opus — reason: gate_failure.`)
  } else {
    log(`Escalating to Opus — reason: ${reason} (cycles: ${cycles}).`)
  }
} else {
  log('Reviewer approved. Sprint complete.')
}

// ── Build ExecutionReport conforming to execution-report.schema.json ──────────
const phaseResult = {
  phase: 'sprint',
  tasks: [sprintTaskResult],
  // §8b: name the actual failure. This fallback previously read 'Sprint agent returned null',
  // which pointed at the wrong stage — the sprint result is `sprintResult`, and what is null
  // here is the REVIEWER's verdict.
  verdict: verdict || {
    approved: false,
    reviewer_type: reviewerType,
    verdict_source: 'gate_failure',
    gate_failure_reason: 'reviewer returned no structured verdict (died after retries, or skipped)',
    required_fixes: [
      `The reviewer gate produced no verdict. This is NOT an approval and NOT a rejection — the gate did not run, so the sprint is unreviewed. Re-dispatch ${reviewerType} against the current HEAD (or invoke the reviewer-gate workflow on this scope). Do NOT run another fix cycle: there is no finding to act on.`,
    ],
  },
  fix_cycles: cycles,
  gate_ran: Boolean(verdict),
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

// Placement provenance travels with EVERY outcome, including the approved one. A report that only
// carries provenance when something went wrong is a report whose consumers learn to skip it.
result.run_placement = placementFacts(parsed, reviewResult || sprintResult)
if (result.run_placement.parent_moved === true) {
  log(`NOTE: parent branch '${result.run_placement.parent_branch}' moved during this run (${result.run_placement.parent_tip_at_start} → ${result.run_placement.parent_tip_at_report}). If the run branch is rebased onto the new tip, commit_sha will change; re-find the work by patch_id (${result.run_placement.patch_id || 'unavailable'}), not by the reported SHA.`)
}

return result
