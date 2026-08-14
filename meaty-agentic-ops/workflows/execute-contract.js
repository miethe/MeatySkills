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
 *   Workflow agents run in the SESSION's cwd on whatever branch that tree is checked out to. There
 *   is no per-agent cwd argument. They DO follow the session into a worktree it has ENTERED via the
 *   EnterWorktree tool (measured on Claude Code 2.1.224, 2026-08-07, and again on 2.1.226 — a
 *   lone 2.1.226 non-inheritance report did NOT reproduce, node_01KZGQE6GVJTGXRSHA57FYKNDQ,
 *   and the verdict is deliberately NOT cached: verify placement with the run's probe, never
 *   with a recorded measurement); what they cannot reach is a
 *   worktree merely CREATED with `git worktree add` while the session cwd stayed put — then they
 *   commit to the session branch regardless. Observed 2026-08-05 (run wf_944c5c91-78e):
 *   autopilot created `.claude/worktrees/<slug>` on `autopilot/<slug>`, that branch received ZERO
 *   commits, and both real commits landed on `main` — one of them pushed — skipping the PR,
 *   review, and squash gates silently while the report read `status: complete`.
 *   The fix is not a path argument; it is to name the branch the orchestrator expects and refuse
 *   to work anywhere else. That holds in BOTH lanes — the branch name is what this guard checks,
 *   and it is equally valid inside an entered worktree as in the session repo:
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
    // Measure runs BEFORE Review: the reviewer's test scope and base→head delta are inputs
    // to its judgment, not commentary on it. Fires once at the start of the Review phase and
    // once per fix-cycle re-review, so each verdict lands over the measurement of its own
    // post-fix HEAD. phase() titles must match these exactly (authoring constraint).
    { title: 'Measure' },
    { title: 'Review' },
    { title: 'Fix cycle 1' },
    { title: 'Fix cycle 2' },
  ],
  whenToUse: 'Feature Contract approved, 3–8 story points, no Mode D paths (auth/payments/migrations/deletion). Invoke as: workflow execute-contract with args envelope built by Opus pre-flight.',
}

// ---------------------------------------------------------------------------
// Routing audit accumulator — the wire out of this script
// ---------------------------------------------------------------------------
// A plain array and two pure helpers. Pushing to an array is neither an FS write nor a
// require(), so this stays inside the four constraints (§5) — which is the whole reason the
// PREVIOUS shape existed and the whole reason it failed: routing payloads were handed to
// agent() as a `_routing_log` opts key, and `_routing_log` is not in the opts allowlist (§1),
// so the runtime discarded every one of them. 14 payloads across 5 workflows were written and
// never read, which made `skillmeat routing audit` over a workflow run empty BY CONSTRUCTION
// rather than clean — and empty reads exactly like clean. Measured 2026-08-12,
// node_01KZVV9R3EK13DJXS44VCQ8E9C.
//
// Entries ride out on the report as `routing_log` (§6). The post-run caller drains them:
//   node .claude/skills/delegation-router/log-cli.js --ingest <report.json> --task-id <id>
// so the write lands on claude-primary, where it belongs, and this script stays pure.
//
// `withRouting()` wraps EVERY workflow exit reachable after a routeLog() call. No judgement
// about which exits "matter": the ones that matter most are the mid-run bail-outs that happen
// immediately after a fallback fired, and those are exactly the ones a reachability argument
// talks itself out of.
const __routingLog = []
const routeLog = entry => {
  __routingLog.push(entry)
  return entry
}
const withRouting = result => ({ ...result, routing_log: __routingLog })


// ─── inline schemas ───────────────────────────────────────────────────────────

// `commit_sha` is deliberately NOT required. It used to be, with pattern ^[0-9a-f]{7,40}$, while the
// structurer prompt instructed `commit_sha: ""` for the no-report case — an unsatisfiable pair that
// forced the structurer to either fail schema validation repeatedly or invent a plausible SHA. The
// no-commit case is now expressed by OMITTING the field, which the script tests for directly.
// `commit_count` / `current_branch` are required because they are the placement evidence: they are
// what distinguishes "work landed on the branch we assigned" from "work landed somewhere else",
// and a field the structurer may omit is a field the script cannot gate on.
// contract_artifact_state / report_artifact_state: tracked/committed state of the run's own
// Feature Contract and Completion Report, per the tri-state (four-value) classification rule in
// structurePrompt() below. Required — a field the structurer may omit is a field the post-sprint
// guard cannot gate on, exactly the same rationale as commit_count/current_branch above.
const SPRINT_RESULT_SCHEMA = {
  type: 'object',
  required: ['completion_report_path', 'ac_verdicts', 'files_touched', 'commit_count', 'current_branch', 'contract_artifact_state', 'report_artifact_state'],
  additionalProperties: false,
  properties: {
    completion_report_path: { type: 'string' },
    contract_artifact_state: {
      type: 'string',
      enum: ['not_written', 'written_untracked', 'committed', 'not_applicable'],
    },
    report_artifact_state: {
      type: 'string',
      enum: ['not_written', 'written_untracked', 'committed', 'not_applicable'],
    },
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
  // R3: verification_path is REQUIRED, so a reviewer physically cannot finish without saying
  // whether it established that the evidence exercises the path production takes.
  required: ['approved', 'reviewer_type', 'verification_path'],
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
    // Gate-tiering v4.1 same-class stop rule: the class this round found, so the fix loop
    // can exit needs_redesign when two consecutive rounds surface the same class. Optional;
    // an absent class never trips the rule.
    defect_class: { type: 'string' },
    // AC-3 (validation-scope hardening). Acceptance criteria the reviewer actually checked,
    // with their per-AC support. `supporting_tests` lists the tests each criterion rests on
    // and their measured status — a criterion supported only by red/absent tests is rewritten
    // to met:false by applyTestStatusRules. See VALIDATION_SCOPE_RULES for the reviewer-side
    // contract; reviewer-gate.js:118-164 for the identical shape.
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
          not_met_reason: { type: 'string' },
          supporting_tests: {
            type: 'array',
            items: {
              type: 'object',
              required: ['nodeid', 'status'],
              additionalProperties: false,
              properties: {
                nodeid: { type: 'string' },
                status: {
                  type: 'string',
                  enum: [
                    'passed',
                    'failed',
                    'xfailed',
                    'xpassed',
                    'skipped',
                    'errored',
                    'not-run',
                  ],
                },
              },
            },
          },
        },
      },
    },
    // R3 (verification-path evidence gate, 2026-08-06 workflow-v41 retro). The dominant delegate
    // defect class was a green suite over a path production does not take; the second was a leg
    // self-reporting a side effect it never performed. Both survive any gate that reads reports.
    verification_path: {
      type: 'object',
      required: ['established', 'kind'],
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
        production_entrypoint: { type: 'string' },
        evidence: { type: 'string' },
      },
    },
    self_reported_claims: { type: 'array', items: { type: 'string' } },
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

// ─── artifact tracking facts (pure) ───────────────────────────────────────────
// Maps the structurer's internal SPRINT_RESULT_SCHEMA field names (contract_artifact_state,
// report_artifact_state) onto the ExecutionReport's externally-facing artifact_tracking shape
// (contract_artifact_state, completion_report_artifact_state — the longer name matches the
// Completion Report vocabulary used throughout the rest of the schema). Defaults to
// 'not_applicable' only when the structurer genuinely never populated the field (e.g. the
// catch-block / null fallbacks), never as a substitute for a real classification.
function artifactTrackingFacts(sprintResult) {
  return {
    contract_artifact_state: sprintResult.contract_artifact_state || 'not_applicable',
    completion_report_artifact_state: sprintResult.report_artifact_state || 'not_applicable',
  }
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
    // DESCRIPTIVE, not verified: the caller's own statement of which lane ran. The script has
    // no FS and cannot confirm isolation or worktree_path against reality — echo only, never infer
    // one from the other and never default an absent value to "branch_in_place".
    isolation: parsed.isolation || null,
    worktree_path: parsed.worktree_path || null,
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
  7. CLOSING COMMIT — REQUIRED, in this EXACT order (do not skip or reorder):
     a. Confirm all code commits from step 4 are done — this must be your LAST code commit.
     b. Run: git rev-parse HEAD
        This is your final code commit SHA. Use it verbatim in the next step.
     c. Edit the Feature Contract's YAML frontmatter at ${parsed.contract_path} with a targeted
        edit (do NOT rewrite the whole file) — set:
          status: completed
          commit_refs: ["<the SHA from step b>"]
     d. Run: git add ${parsed.contract_path} ${reportPath}
     e. Commit this as your closing commit, e.g.:
          git commit -m "docs(<slug>): close out contract with commit_refs"
     This step is NOT optional. A run whose contract file or Completion Report is written to disk
     but left uncommitted is halted (status: needs_opus, reason: artifact_untracked) instead of
     being reported complete — no matter how correct the code itself is.
  8. Your final message is a human-readable summary of what was done and what AC passed/failed.
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
  const contractPath = parsed.contract_path || ''
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

ARTIFACT TRACKING STATE (contract_artifact_state, report_artifact_state) — classify BOTH of the
sprint's own artifacts using this exact rule; do not use judgement, only the literal outputs below.
${contractPath
  ? `  Contract file: "${contractPath}"
  c1. Run: git status --porcelain -- "${contractPath}"
  c2. Run: test -f "${contractPath}" && echo EXISTS || echo MISSING
  Classify contract_artifact_state from c1's output and c2's result:
    - c1 printed nothing AND c2 printed MISSING  → "not_written"
    - c1 printed nothing AND c2 printed EXISTS   → "committed"
    - c1 printed ANY line (e.g. "?? ", "A  ", "M  ") → "written_untracked" (this is true even if
      the change is only staged, not yet committed — staged-but-uncommitted counts as untracked
      for this purpose)`
  : `  No contract_path was supplied to this run. Set contract_artifact_state to "not_applicable"
  and do not run any git probe for it.`}

  Completion report file: "${reportPath}"
  r1. Run: git status --porcelain -- "${reportPath}"
  r2. Run: test -f "${reportPath}" && echo EXISTS || echo MISSING
  Classify report_artifact_state from r1's output and r2's result using the SAME rule as above
  (nothing+MISSING → not_written; nothing+EXISTS → committed; any line → written_untracked).

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
// ---------------------------------------------------------------------------
// R3 — the verification-path evidence rules (2026-08-06 workflow-v41 delegate retro).
//
// The dominant delegate defect class in that window was NOT scope drift or bad reasoning: it
// was a mid-tier executor shipping confident code that passed its own green suite while the
// suite exercised a path production never takes — an offline fake echoing `system` where the
// live API returns `source_system`, a branch made dead by an earlier comment-stripping step
// but still unit-tested directly, a dry-run validating preconditions `apply` does not. Five
// occurrences in one program, 8 delegate-bug findings in 7 days. Second class, 5 findings:
// legs self-reporting side effects they never performed.
//
// Both classes are invisible to a gate that reads reports and green suites, and both produce
// reports that satisfy every instruction they were given — so the rules are stated in the
// prompt AND enforced on the verdict. Grounding:
// docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md (leg B).
// ---------------------------------------------------------------------------

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

// Only these four are a path. 'not-established' is deliberately absent: it is the reviewer saying
// it could not do this, which is honest and must never read as satisfaction of the rule.
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
 * Apply the R3 evidence rules AND the AC-3/validation-scope rules to a reviewer verdict,
 * in the {verdict, integrity_failure} shape the reviewer dispatch sites use. Chain:
 *
 *   1. applyTestStatusRules(verdict, measurement) — reconciles claimed test statuses
 *      against the measurement, rewrites red-backed met:true to met:false with
 *      defect_class:'ac-backed-by-red-test'. Fires regardless of the incoming approved.
 *   2. self-reported-side-effect check → ORDINARY REJECTION.
 *   3. verification-path check → GATE-INTEGRITY failure on an unverified approval.
 *   4. enforceValidationScopeRules(verdict, phaseId, reviewerType, measurement) →
 *      GATE-INTEGRITY failure on a still-approving verdict with no/failed measurement or
 *      a measured regression. Same handling as a conditional council verdict.
 *
 * Callers pass `measurement` — the normalizeMeasurement()'d output of the Measure stage.
 * Passing `null` degrades gracefully: applyTestStatusRules no-ops on missing measurement,
 * and enforceValidationScopeRules treats a null as `evidence_present: false` (gate-integrity
 * failure on an approving verdict), which is deliberate — an unmeasured approval is exactly
 * the state PR #299 slipped through in.
 */
function enforceEvidenceRules(verdict, phaseId, reviewerType, measurement) {
  if (!verdict) return { verdict, integrity_failure: null }

  // Normalise here so callers that forget to pass a measurement degrade to
  // `evidence_present: false` rather than blowing up on a null dereference.
  const _measurement = measurement && typeof measurement === 'object'
    ? measurement
    : normalizeMeasurement(null)

  // Step 1: AC-3 + R7 reconciliation. Fires on approving AND rejecting verdicts — a
  // contradicted claimed status is a finding either way.
  verdict = applyTestStatusRules(verdict, _measurement)
  if (!verdict.approved) {
    // A verdict that was already rejecting, or was just downgraded by red-test-AC, drops
    // to the fix loop as an ordinary rejection. The R3 branches below are irrelevant.
    return { verdict, integrity_failure: null }
  }

  // Step 2: self-reported side effects → ordinary rejection.
  const claims = Array.isArray(verdict.self_reported_claims) ? verdict.self_reported_claims.filter(Boolean) : []
  if (claims.length) {
    log(`R3 REJECTION on ${phaseId}: ${reviewerType} approved with ${claims.length} self-reported claim(s) and no artifact evidence. Downgrading the approval — a report of a side effect is not the side effect.`)
    return {
      verdict: {
        ...verdict,
        approved: false,
        downgraded_from_approval: 'self_reported_side_effect',
        defect_class: verdict.defect_class || 'self-reported-side-effect',
        required_fixes: [
          ...(verdict.required_fixes ?? []),
          ...claims.map(claim => `Produce artifact evidence — the row, the file on disk, the response body, or the diff hunk — for the side effect reported as "${claim}". A leg's own report of it is not evidence that it happened.`),
        ],
      },
      integrity_failure: null,
    }
  }

  // Step 3: unverified approval → gate-integrity failure.
  const gap = verificationGap(verdict)
  if (gap) {
    return {
      verdict: {
        ...verdict,
        approved: false,
        verdict_source: 'gate_integrity_failure',
        required_fixes: [
          `The reviewer approved ${phaseId} without establishing a verification path (${gap}). Re-dispatch ${reviewerType} and require one of live-smoke | path-equivalence | real-endpoint-field-check | production-callsite-trace, or record an explicit operator override. Do NOT run a fix cycle: nothing has been found yet.`,
        ],
      },
      integrity_failure: `approving verdict with no established verification path — ${gap}`,
    }
  }

  // Step 4: still-approving over a missing/failed/regression-carrying measurement
  //          → gate-integrity failure.
  return enforceValidationScopeRules(verdict, phaseId, reviewerType, _measurement)
}

// ─── validation-scope enforcement (byte-identically duplicated from reviewer-gate.js) ──
// This block is duplicated between reviewer-gate.js, execute-plan.js, and
// execute-contract.js by necessity — workflow scripts cannot `require()` at runtime, so a
// verdict-landing seam that needs the enforcement has to declare it locally. When you edit
// one, edit the others in the same commit. `tests/test_workflow_gate_integrity.py` §
// "Defect 10" asserts the shape is present in all three and holds the duplicates together;
// see reviewer-gate.js:262-302 for the full grounding (skillmeat PR #299) and per-piece
// rationale (R7 measurement reconciliation, AC-3 red-test rejection, AC-2 baseline delta,
// measurement-integrity gate).

const VALIDATION_SCOPE_RULES = `TEST-SCOPE RULE — your scope for READING is the changed files above, but your scope for TEST
SELECTION is the resolved scope below, which is deliberately WIDER. It was computed by
symbol reference: every test file that names a symbol this diff changed, including files the
diff never touched. A test file can assert the exact behaviour a change removes without
appearing in the diff at all — that is the defect this gate exists to catch, and "the files I
edited" can never see it. Do not narrow the test scope back to the diff.

BASELINE-DELTA RULE — a red test file proves nothing on its own if it was ALREADY red. Judge
regressions by the measured per-file delta below (base counts vs head counts, and the set of
node ids failing at head that were not failing at base), never by the absolute red count. A
file that is 61-red at base and 61-red at head has told you nothing; a file that gained one
NEW failing node id has told you everything. Conversely: a test that stopped being collected
at head ran NOWHERE, so it cannot evidence anything, and its absence LOWERS the failure count —
if the measurement reports a collected-regression or a disappeared node id, treat it as a
regression, never as an improvement.

RED-TEST-AC RULE — never mark an acceptance criterion met on the strength of a test that is
failing, xfailing, erroring, skipped, or was never run. List each criterion's real support in
\`ac_verdicts[].supporting_tests\` as {nodeid, status}, using the measured status below rather
than your expectation of it. A criterion whose only support is red is NOT met: say so, with
the node ids and their statuses as the reason. Every status you report is cross-checked against
the measurement, and a claimed status the measurement contradicts is itself recorded as a
finding — so report what was measured, not what should have been true.

MEASUREMENT-INTEGRITY RULE — if the measurement below is absent, failed, or reports a
truncated scope, say so plainly and do NOT compensate by approving on the narrower evidence.
An unmeasurable scope makes affected criteria \`unverifiable\`, never met.`

// Statuses that cannot support a criterion. `xpassed` is deliberately ABSENT (it passed,
// however confusingly). `not-run` and `errored` are here because a test that did not run
// carries no information at all — the most common way this gate got fooled.
const NON_SUPPORTING_STATUSES = new Set(['failed', 'xfailed', 'errored', 'skipped', 'not-run'])

function asList(value) {
  if (!value) return []
  return Array.isArray(value) ? value.filter(v => v != null && v !== '') : [value]
}

function parseMaybeJson(value) {
  if (value == null) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (_err) {
    return null
  }
}

/**
 * Normalize a validation-scope evidence blob (the output of
 * `.claude/skills/dev-execution/hooks/validation-scope.sh`) into the shape the
 * enforcement path reads. A malformed or missing blob degrades to
 * `evidence_present: false`, which the enforcement treats as a gate-integrity failure —
 * NOT as a clean full-scope run. A missing measurement must never be the cheaper option
 * than a failing one.
 */
function normalizeMeasurement(raw) {
  const blob = parseMaybeJson(raw)
  if (!blob || typeof blob !== 'object') {
    return {
      evidence_present: false,
      reason: 'no validation_scope evidence supplied to the gate',
      files_run: [],
      scope_truncated: false,
      scope_status: null,
      omitted_files: [],
      test_scope: [],
      regressions: [],
      measurement_failures: [],
      status_by_nodeid: {},
    }
  }
  const scope = blob.scope || blob
  const measurements = asList(blob.measurements)
  const filesRun = measurements.map(m => m && m.file).filter(Boolean)
  const regressions = []
  const measurementFailures = []
  const statusByNodeId = {}
  for (const m of measurements) {
    if (!m || typeof m !== 'object') continue
    if (m.measurement_failure) {
      measurementFailures.push({ file: m.file || '(unnamed)', reason: m.failure_reason || 'unspecified' })
      continue
    }
    for (const nodeid of asList(m.newly_failing_node_ids)) {
      regressions.push({ file: m.file, nodeid, kind: 'newly-failing' })
      statusByNodeId[nodeid] = 'failed'
    }
    for (const nodeid of asList(m.disappeared_node_ids)) {
      regressions.push({ file: m.file, nodeid, kind: 'no-longer-collected' })
      statusByNodeId[nodeid] = 'not-run'
    }
    if (m.collected_regression && !asList(m.disappeared_node_ids).length) {
      regressions.push({ file: m.file, nodeid: null, kind: 'collected-regression' })
    }
    const nodeStatuses = (m.head && m.head.node_status) || m.node_status || null
    if (nodeStatuses && typeof nodeStatuses === 'object') {
      for (const [nodeid, status] of Object.entries(nodeStatuses)) {
        if (typeof status === 'string') statusByNodeId[nodeid] = status
      }
    }
  }
  return {
    evidence_present: true,
    reason: null,
    files_run: filesRun,
    scope_truncated: Boolean(scope.scope_truncated) || Boolean(scope.budget_exhausted),
    scope_status: scope.scope_status || null,
    omitted_files: asList(scope.omitted_files),
    test_scope: asList(scope.test_scope),
    regressions,
    measurement_failures: measurementFailures,
    status_by_nodeid: statusByNodeId,
  }
}

/** The measurement rendered for the reviewer prompt. Never a bare "see attached". */
function measurementBrief(measurement) {
  if (!measurement.evidence_present) {
    return `  (NO MEASUREMENT AVAILABLE — ${measurement.reason}. Treat every criterion resting on tests as \`unverifiable\`; do not approve on the narrower diff-scoped evidence.)`
  }
  const lines = []
  lines.push(`  scope_status: ${measurement.scope_status || 'unknown'}${measurement.scope_truncated ? '  ⚠ TRUNCATED — affected criteria are `unverifiable`, never met' : ''}`)
  lines.push(`  test files in resolved scope (${measurement.test_scope.length}): ${measurement.test_scope.join(', ') || '(none)'}`)
  lines.push(`  test files actually measured (${measurement.files_run.length}): ${measurement.files_run.join(', ') || '(none)'}`)
  if (measurement.omitted_files && measurement.omitted_files.length) {
    lines.push(`  ⚠ omitted from scope by a bound: ${measurement.omitted_files.join(', ')}`)
  }
  if (measurement.measurement_failures.length) {
    lines.push(`  ⚠ MEASUREMENT FAILED on ${measurement.measurement_failures.length} file(s) — these are not "0 failed":`)
    for (const f of measurement.measurement_failures) lines.push(`      ${f.file}: ${f.reason}`)
  }
  if (measurement.regressions.length) {
    lines.push(`  ⚠ ${measurement.regressions.length} REGRESSION(S) vs the base commit:`)
    for (const r of measurement.regressions) {
      lines.push(`      [${r.kind}] ${r.nodeid || r.file}`)
    }
    lines.push('    Each of these is worse-than-base. You may not approve over one without naming it.')
  } else {
    lines.push('  no regressions vs base (no new failing node ids, nothing stopped being collected)')
  }
  return lines.join('\n')
}

/** Reconcile a reviewer-claimed test status against the measurement.
 *  The measurement WINS (risk R7): every rule in the R3 lineage exists because a claim
 *  got read as evidence. A contradiction is returned as its own flag so it can be
 *  recorded as a finding rather than silently resolved in the reviewer's favour. */
function reconcileStatus(claimed, measurement) {
  const measured = measurement.status_by_nodeid[claimed.nodeid]
  if (!measured || measured === claimed.status) {
    return { nodeid: claimed.nodeid, status: claimed.status, contradicted: false }
  }
  return { nodeid: claimed.nodeid, status: measured, claimed_status: claimed.status, contradicted: true }
}

/**
 * AC-3 rule + the R7 contradiction check, applied to a real verdict. Outcomes differ:
 *
 *   - An AC met:true whose supporting_tests are all red/absent → ordinary REJECTION with
 *     `defect_class: 'ac-backed-by-red-test'`. The missing work is implementer-side (make
 *     the test pass, or drop the AC), so a fix cycle is the right next action.
 *   - A contradicted status is recorded on the verdict as `measured_status_contradictions`
 *     regardless of the verdict's approval state — it is a finding either way.
 *
 * `applyTestStatusRules` does NOT itself convert a missing/failed/regression-carrying
 * measurement into a gate-integrity failure — that is `enforceValidationScopeRules`
 * below (which fires only on still-APPROVING verdicts, mirroring the R3 branch).
 */
function applyTestStatusRules(verdict, measurement) {
  if (!verdict) return verdict
  const contradictions = []
  const acVerdicts = asList(verdict.ac_verdicts).map(ac => {
    const supporting = asList(ac.supporting_tests).map(t => {
      const reconciled = reconcileStatus(t, measurement)
      if (reconciled.contradicted) {
        contradictions.push(
          `criterion "${ac.criterion}": reviewer reported ${reconciled.nodeid} as '${reconciled.claimed_status}', the measurement shows '${reconciled.status}'`,
        )
      }
      return reconciled
    })
    return { ...ac, supporting_tests: supporting }
  })

  const redBacked = acVerdicts.filter(ac => {
    if (!ac.met) return false
    const supporting = asList(ac.supporting_tests)
    if (!supporting.length) return false
    return supporting.every(t => NON_SUPPORTING_STATUSES.has(t.status))
  })

  let adjusted = { ...verdict, ac_verdicts: acVerdicts }
  if (contradictions.length) {
    adjusted = { ...adjusted, measured_status_contradictions: contradictions }
  }

  if (redBacked.length) {
    const named = redBacked.map(ac => {
      const ids = asList(ac.supporting_tests).map(t => `${t.nodeid} (${t.status})`).join(', ')
      return `Criterion "${ac.criterion}" was reported MET but every supporting test is non-passing: ${ids}. Make the test pass or drop the criterion — a red test is not evidence for the behaviour it fails to demonstrate.`
    })
    adjusted = {
      ...adjusted,
      approved: false,
      downgraded_from_approval: verdict.approved ? 'ac_backed_by_red_test' : adjusted.downgraded_from_approval,
      defect_class: adjusted.defect_class || 'ac-backed-by-red-test',
      ac_verdicts: acVerdicts.map(ac =>
        redBacked.includes(ac)
          ? {
              ...ac,
              met: false,
              not_met_reason: `every supporting test is non-passing: ${asList(ac.supporting_tests).map(t => `${t.nodeid} (${t.status})`).join(', ')}`,
            }
          : ac,
      ),
      required_fixes: [...asList(adjusted.required_fixes), ...named],
    }
  }
  return adjusted
}

/**
 * Missing/failed measurement or an approval standing over a measured regression ⇒
 * GATE-INTEGRITY failure, mirroring the R3 branch in enforceEvidenceRules. Fires ONLY on
 * still-APPROVING verdicts: a rejection already carries the right next action, and
 * downgrading it here would obscure what the reviewer actually said. Returns the same
 * `{ verdict, integrity_failure }` shape enforceEvidenceRules uses.
 */
function enforceValidationScopeRules(verdict, phaseId, reviewerType, measurement) {
  if (!verdict || !verdict.approved) return { verdict, integrity_failure: null }

  if (!measurement.evidence_present) {
    const gap = `approved with no validation-scope measurement (${measurement.reason}) — the gate cannot tell which test files the change actually affects, nor whether any of them regressed`
    return {
      verdict: {
        ...verdict,
        approved: false,
        verdict_source: 'gate_integrity_failure',
        required_fixes: [
          ...asList(verdict.required_fixes),
          `The reviewer approved ${phaseId} without a validation-scope measurement (${gap}). Produce the measurement — run \`.claude/skills/dev-execution/hooks/validation-scope.sh\` (or pass \`validation_evidence\`) and re-dispatch ${reviewerType}. Do NOT run a fix cycle: nothing has been found yet.`,
        ],
      },
      integrity_failure: gap,
    }
  }

  if (measurement.measurement_failures.length) {
    const files = measurement.measurement_failures.map(f => f.file).join(', ')
    const gap = `approved while the measurement FAILED on ${measurement.measurement_failures.length} file(s) (${files}) — a file whose measurement failed is not a file with zero failures`
    return {
      verdict: {
        ...verdict,
        approved: false,
        verdict_source: 'gate_integrity_failure',
        required_fixes: [
          ...asList(verdict.required_fixes),
          `Repair the measurement for ${files} and re-dispatch ${reviewerType}. A measurement_failure is never '0 failed'.`,
        ],
      },
      integrity_failure: gap,
    }
  }

  if (measurement.regressions.length) {
    const named = measurement.regressions.map(r => `[${r.kind}] ${r.nodeid || r.file}`).join(', ')
    const gap = `approved over ${measurement.regressions.length} measured regression(s) vs the base commit: ${named}`
    return {
      verdict: {
        ...verdict,
        approved: false,
        verdict_source: 'gate_integrity_failure',
        required_fixes: [
          ...asList(verdict.required_fixes),
          `Each regression is worse-than-base and must be fixed or explicitly justified: ${named}. Re-dispatch ${reviewerType} once the delta is clean, or record an explicit operator override.`,
        ],
      },
      integrity_failure: gap,
    }
  }

  return { verdict, integrity_failure: null }
}

/**
 * The Measure stage. Preferred path is the caller running validation-scope.sh and passing
 * the blob as `args.validation_evidence`. If absent, dispatch `task-completion-validator`
 * (already Bash-capable, edit-less) with the sole instruction to run the hook and return
 * its JSON verbatim. This script cannot run shell itself (authoring constraint 1), which
 * is the whole reason this is an agent dispatch rather than three lines of code.
 */
async function runMeasureStage(args) {
  const supplied = normalizeMeasurement(args.validation_evidence)
  if (supplied.evidence_present) {
    log(`Measure: using caller-supplied validation evidence (${supplied.files_run.length} file(s) measured, ${supplied.regressions.length} regression(s)).`)
    return supplied
  }
  if (args.skip_measure_fallback) {
    log('Measure: no caller-supplied evidence and skip_measure_fallback set — the gate will treat the measurement as ABSENT, which blocks approval as a gate-integrity failure.')
    return supplied
  }
  const baseRef = args.base_ref || args.base || 'HEAD~1'
  const repo = args.repo_root || '.'
  log(`Measure: no caller-supplied evidence — dispatching the fallback runner (base=${baseRef}).`)
  let blob = null
  try {
    blob = await agent(
      `Run ONE command and return its output. Do not review anything. Do not edit anything.

    cd ${repo} && bash .claude/skills/dev-execution/hooks/validation-scope.sh --json --base-ref ${baseRef}

Return the command's JSON on stdout VERBATIM as your entire answer — no commentary, no
markdown fence, no summary, no interpretation. If the command fails or the hook is absent,
return exactly: {"scope_status": "hook_unavailable"}

Do NOT substitute your own judgment for the measurement. Do NOT fabricate counts. This output
is consumed mechanically as a gate input, and an invented number here defeats the gate.`,
      {
        phase: 'Measure',
        label: 'gate:measure',
        agentType: 'task-completion-validator',
        schema: {
          type: 'object',
          required: ['scope_status'],
          properties: {
            scope_status: { type: 'string' },
            test_scope: { type: 'array', items: { type: 'string' } },
            scope_truncated: { type: 'boolean' },
            budget_exhausted: { type: 'boolean' },
            omitted_files: { type: 'array', items: { type: 'string' } },
            measurements: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    )
  } catch (err) {
    log(`Measure: fallback runner threw (${err && err.message ? err.message : err}). Measurement stays ABSENT — the gate blocks rather than approving on unmeasured evidence.`)
    return supplied
  }
  if (!blob || blob.scope_status === 'hook_unavailable') {
    log('Measure: fallback runner returned no usable measurement (hook unavailable or agent died). Measurement stays ABSENT.')
    return supplied
  }
  const measured = normalizeMeasurement(blob)
  log(`Measure: fallback produced a measurement — ${measured.files_run.length} file(s), ${measured.regressions.length} regression(s), truncated=${measured.scope_truncated}.`)
  return measured
}

// ─── end validation-scope enforcement block ────────────────────────────────────

function reviewPrompt(parsed, sprintResult, measurement) {
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

Measured validation scope and base→head delta (your scope for TEST SELECTION, not for READING):
${measurementBrief(measurement || normalizeMeasurement(null))}

${EVIDENCE_RULES}

${VALIDATION_SCOPE_RULES}

Return a structured VERDICT:
  - approved: true only when you have read the diff yourself and ALL Acceptance Criteria are met
    with no required fixes outstanding. An approval you cannot support by naming what you
    inspected is the failure this gate exists to catch — including when you are the one
    producing it.
  - reviewer_type: your agentType string.
  - required_fixes: if approved is false, list each required fix as a clear, actionable instruction for the fix agent.
  - verification_path: established / kind / production_entrypoint / evidence, per the
    VERIFICATION-PATH RULE above. Required on every verdict. An approving verdict whose path is
    not established is recorded as a gate-integrity failure rather than an approval, so
    withholding it is the honest move and never a penalty.
  - self_reported_claims: every claim you had to take on the sprint's word for lack of an
    artifact. Any entry blocks approval by construction.
  - ac_verdicts: one entry per acceptance criterion, {criterion, met, evidence, supporting_tests}.
    supporting_tests[] is {nodeid, status}, using the MEASURED status above rather than your
    expectation of it. A criterion supported only by red/absent tests must be met:false with the
    node ids named as the reason — the gate enforces this and will downgrade a met:true that
    violates it (defect_class: 'ac-backed-by-red-test').

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

// ─── Mode-D SUBJECT MATTER in the brief (node_01KZC1AHEDYZ8FS9TAZSXQTTSB) ──────
// The three checks below this were all satisfied by the leg that breached Mode-D on
// 2026-08-06: its declared files contained no crypto path, its class was ordinary
// implementation, and its prompt issued no destructive command. It was routed to an
// offload lane on those clean signals and then WROTE its own HMAC signer, minting a
// key with secrets.token_bytes(32).
//
// What the brief *did* contain was the subject matter. These patterns are tight,
// multi-word/technical forms rather than bare words — `token` alone would trip on
// "token bucket" and a noisy guard is a disabled guard.
const MODE_D_INTENT_PATTERNS = [
  /\b(signing|secret|private|encryption)\s+key\b/i,
  /\bkey\s*(pair|material)\b/i,
  /\bhmac\b/i,
  /\btoken_(bytes|hex|urlsafe)\b/i,
  /\b(jwt|oauth|bearer\s+token)\b/i,
  /\bpassword\s+(hash|hashing)\b/i,
  /\b(sign|verify|re-?sign)\s+(the\s+)?(token|payload|envelope|request)\b/i,
  /\balembic\b/i,
  /\bschema\s+migration\b/i,
]

// ─── the inversion: a Mode-D WARNING is itself a Mode-D signal ────────────────
// This is the rule that would have prevented the breach, and the reason it is
// mechanical rather than prose.
//
// The dispatch brief said, verbatim: "It must not read, generate, print or
// reference any signing key. If you find yourself needing a key, STOP and return
// {status: needs_opus, reason: mode_d}." That sentence was treated as the control.
// It is better read as EVIDENCE: a brief that has to warn a delegate off minting a
// signing key is, by construction, a brief about signing keys — i.e. work close
// enough to the boundary that an author felt the need to fence it.
//
// Trusting the fence puts the boundary's enforcement inside the delegate, which is
// exactly the party the boundary exists to constrain. So the presence of the
// warning now routes the leg to primary instead of licensing the offload.
const MODE_D_SELF_WARNING_PATTERNS = [
  /must\s+not\s+(read|generate|print|reference|mint|create)[^.\n]{0,60}\bkey\b/i,
  /\bnever\s+(mint|generate|sign)\b/i,
  /reason:\s*['"]?mode_?d/i,
  /\bneeds_opus\b[^\n]{0,40}\bmode_?d\b/i,
  /\bdo\s+not\s+(sign|mint|generate)\b/i,
]

/**
 * Routing-time Mode-D eligibility. Returns a reason string when the leg must stay
 * on claude-primary, or null when an offload lane is permissible.
 *
 * Named `fixCycleModeDGuard` for continuity with the P4 call sites; the checks now
 * cover subject matter and self-warning in addition to the original three.
 */
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
  // 3. Prompt scan — destructive COMMANDS.
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
  // 4. Prompt scan — Mode-D SUBJECT MATTER.
  for (const pat of MODE_D_INTENT_PATTERNS) {
    if (pat.test(text)) return `brief concerns Mode-D subject matter matching ${pat} — offload lane not eligible`
  }
  // 5. Prompt scan — a Mode-D warning in the brief is evidence, not a control.
  for (const pat of MODE_D_SELF_WARNING_PATTERNS) {
    if (pat.test(text)) {
      return `brief contains a Mode-D warning matching ${pat}; a leg that must be `
        + `warned off the boundary is too close to it to offload (the warning is the signal, not the control)`
    }
  }
  return null // Safe to dispatch to an offload lane.
}

// ─── Mode-D OUTPUT scan (closes node_01KZS162D3TR3ZT113TKVDW1HB) ──────────────
//
// fixCycleModeDGuard (above) and the routing tables are ROUTING-TIME checks: they read a
// declaration (files_affected, task_class, prompt text) before a leg is dispatched. That is
// exactly the class of check that missed the 2026-08-06 breach (node_01KZC1AHEDYZ8FS9TAZSXQTTSB)
// — the leg's declaration was clean; it invented the crypto AFTER being routed.
//
// This is the OUTPUT-time check: after a delegated leg returns, scan what it actually WROTE
// via `.claude/skills/dev-execution/hooks/mode-d-scan.sh`, keyed on the REALIZED provider (never
// the provider that was merely intended — an offload lane that fell back to claude must scan as
// 'claude', not as the lane that failed). This script cannot shell out itself (authoring
// constraint 1), so — exactly like runMeasureStage's validation-scope.sh dispatch — it is an
// agent() call to an edit-less agentType instructed to run the hook and return its JSON verbatim.
async function runModeDScanGuard(stageLabel, realizedProvider, baseRef) {
  const range = `${baseRef || 'HEAD~1'}..HEAD`
  let scan = null
  try {
    scan = await agent(
      `Run ONE command and return its output. Do not review anything. Do not edit anything.

    MODE_D_SCAN_PROVIDER=${realizedProvider} MODE_D_SCAN_RANGE="${range}" MODE_D_SCAN_JSON=1 \\
      bash .claude/skills/dev-execution/hooks/mode-d-scan.sh; echo "MODE_D_SCAN_EXIT=$?"

Return the command's JSON output PLUS the trailing MODE_D_SCAN_EXIT line, parsed into the
schema fields below. Do NOT substitute your own judgment for what the hook reported — an
invented finding count here defeats the gate the same way a fabricated test count would defeat
a validation-scope measurement. If the hook is missing or python3 is unavailable, set
scan_status to "hook_unavailable" and gated to false.`,
      {
        phase: stageLabel,
        label: 'guard:mode-d-scan',
        agentType: 'task-completion-validator',
        schema: {
          type: 'object',
          required: ['gated'],
          properties: {
            scan_status: { type: 'string' },
            gated: { type: 'boolean' },
            lane: { type: 'string' },
            provider: { type: 'string' },
            findings_count: { type: 'integer' },
            exit_code: { type: 'integer' },
          },
        },
      },
    )
  } catch (err) {
    log(`Mode-D output scan (${stageLabel}, provider=${realizedProvider}): runner threw (${err && err.message ? err.message : err}). Treated as non-fatal infra failure — not a breach.`)
    return { gated: false, scan_status: 'runner_error' }
  }
  if (!scan) {
    log(`Mode-D output scan (${stageLabel}, provider=${realizedProvider}): runner returned nothing. Treated as non-fatal — not a breach (absence of a scan is not evidence of a clean leg, but this hook is a backstop, not the sole control).`)
    return { gated: false, scan_status: 'no_result' }
  }
  if (scan.gated) {
    log(`MODE-D OUTPUT BREACH on ${stageLabel} (provider=${realizedProvider}): mode-d-scan.sh reported ${scan.findings_count ?? 'unknown'} finding(s) on an OFFLOAD lane (exit 2). Halting — do not merge this output.`)
  } else {
    log(`Mode-D output scan (${stageLabel}, provider=${realizedProvider}): clean (status=${scan.scan_status || 'ok'}).`)
  }
  return scan
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

${EVIDENCE_RULES}

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: evidence (file:line or traced behaviour) | PATH: <live-smoke |
        path-equivalence | real-endpoint-field-check | production-callsite-trace> — <what you saw>

Every MET line MUST carry a PATH segment naming one of the four kinds. A MET line whose evidence
is only "the tests pass" has no path and is NOT MET. End the file with:
  VERIFICATION-PATH: <kind> — <production entry point> — <evidence>
or, when you could not establish one:
  VERIFICATION-PATH: not-established — <why>
and a line listing anything you had to take on the sprint's word:
  SELF-REPORTED: <claim>; <claim>    (or "SELF-REPORTED: none")

This file MUST exist before you return. A downstream structurer will read it to emit the verdict.
Do NOT emit structured output yourself. Do NOT git add/commit/push/stash.`
}

function codexSprintAcStructurePrompt(parsed, artifactPath) {
  const reviewerType = 'task-completion-validator'
  return `Mode: A — Exploration Only

Read the AC validation checklist at: ${artifactPath}

If the file does not exist, return:
  { "approved": false, "reviewer_type": "${reviewerType}", "verification_path": { "established": false, "kind": "not-established", "evidence": "Stage A artifact absent" }, "required_fixes": ["AC validation artifact not found at ${artifactPath} — codex Stage A may have failed"] }

If the file exists:
  1. Count lines starting with "- [x]" (met) and "- [ ]" (not met).
  2. Set approved:true ONLY if all ACs are marked met (no "- [ ]" lines) AND every "- [x]" line
     carries a "PATH:" segment. A MET line with no PATH segment counts as NOT met — copy its AC
     text into required_fixes with the reason "no verification path recorded".
  3. For each unmet AC, add its text to required_fixes.
  4. Set reviewer_type to "${reviewerType}".
  5. Copy the checklist's trailing "VERIFICATION-PATH:" line into verification_path:
     established=true and kind=<kind> when the line names one of live-smoke | path-equivalence |
     real-endpoint-field-check | production-callsite-trace; otherwise established=false with
     kind="not-established". TRANSCRIBE it — never infer a path the checklist does not state, and
     never upgrade "not-established" because the ACs look met.
  6. Copy the "SELF-REPORTED:" line into self_reported_claims (empty array for "none").
  7. Return the VERDICT_SCHEMA object.

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
  return withRouting({
    status: 'blocked',
    reason: 'cross_repo_unverified',
    report: [],
    blockers: [{
      description: `Contract declares target_repo '${parsed.target_repo}' but carries no session_repo, so the workflow cannot confirm it is running in the right repository. No agents were spawned.`,
      resolution_hint: 'In Opus pre-flight, resolve `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"` (not `--show-toplevel` — inside a worktree that basename is the worktree directory name, not the repo name) and pass it as session_repo. Do NOT drop target_repo to silence this.',
    }],
  })
}
if (_target && _session && _target !== _session) {
  log(`HALTING — cross_repo_target: contract targets '${parsed.target_repo}' but session is '${parsed.session_repo}'.`)
  return withRouting({
    status: 'blocked',
    reason: 'cross_repo_target',
    report: [],
    blockers: [{
      description: `Contract targets repo '${parsed.target_repo}' but this session is in '${parsed.session_repo}'. The sprint agent always runs in the session's cwd and isolation:'worktree' branches the SESSION repo, so the sprint would have executed against the wrong repository while reporting success. No agents were spawned.`,
      resolution_hint: `Start a session in the '${parsed.target_repo}' checkout and re-run there, or hand-orchestrate and verify \`git rev-parse --show-toplevel\` + \`git branch --show-current\` + \`git diff\` yourself at each step (.claude/skills/dev-execution/git-worktree-pr-protocol.md).`,
    }],
  })
}

// ── dry-run short-circuit ─────────────────────────────────────────────────────
if (parsed.dry_run === true) {
  log('Dry-run mode — returning parsed args envelope without spawning agents.')
  return withRouting({
    status: 'complete',
    report: [],
    _dry_run: true,
    _parsed_args: parsed,
  })
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
  return withRouting({
    status: 'needs_opus',
    reason: 'mode_d',
    blocked_phase: 'sprint',
    report: [],
  })
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
    return withRouting({
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `Could not verify the working tree is on run branch '${parsed.run_branch}' (the guard agent returned nothing). No sprint agent was spawned, so nothing was committed anywhere.`,
        resolution_hint: `Check out '${parsed.run_branch}' in the session repo and re-run, or re-invoke without run_branch to accept whatever branch the tree is on.`,
      }],
    })
  }

  if (guard.current_branch !== parsed.run_branch) {
    log(`HALTING — wrong_branch: tree is on '${guard.current_branch}', run branch is '${parsed.run_branch}'.`)
    return withRouting({
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `The session working tree is on branch '${guard.current_branch}' but this run was assigned '${parsed.run_branch}'. Workflow agents commit to the session branch, so the sprint would have committed to '${guard.current_branch}' — bypassing the PR and review gates — and reported success. No agents were spawned; nothing was committed.`,
        resolution_hint: `In the tree this session is standing in, run: git switch ${parsed.run_branch} (create it from the parent branch if needed), then re-invoke. To isolate the run, ENTER a worktree with the EnterWorktree tool first and check the branch out there — agents follow an entered worktree whenever the run's placement probe confirms it (confirmed on 2.1.224 and again on 2.1.226; probed per run, never cached — node_01KZGQE6GVJTGXRSHA57FYKNDQ). Do NOT \`git worktree add\` a worktree and pass its path without entering it: the session cwd would not move, agents would commit here anyway, and the report would read as isolated. That is the defect this guard exists to catch.`,
      }],
    })
  }

  if (parsed.branch_base && guard.base_resolves === false) {
    log(`HALTING — wrong_branch: branch_base '${parsed.branch_base}' does not resolve in this repo.`)
    return withRouting({
      status: 'blocked',
      reason: 'wrong_branch',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `branch_base '${parsed.branch_base}' does not resolve as a commit in the session repo, so the run has no usable pre-run checkpoint and every later diff/commit-range would be computed against a guess. No agents were spawned.`,
        resolution_hint: 'Re-resolve BASE_SHA with `git rev-parse HEAD` in the session repo at run start and pass that, or omit branch_base.',
      }],
    })
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
  return withRouting({
    status: 'needs_opus',
    reason: 'reviewer_unresolved',
    blocked_phase: 'sprint',
    report: [],
  })
}

// Mode-D output scan on the sprint leg itself — feature-sprint-executor has no offload
// routing in this file (always claude-primary), so this scans advisory-only, but it wires
// the automatic post-leg check for the one leg every contract dispatches unconditionally.
await runModeDScanGuard('Sprint', 'claude', parsed.branch_base)

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
    // Honest "we don't know" default — the structurer never ran, so there is no git-probe
    // evidence for either artifact. not_applicable here means "unevaluated", not "no artifact
    // was expected"; the fallback's own blocker below is what surfaces that to Opus.
    contract_artifact_state: 'not_applicable',
    report_artifact_state: 'not_applicable',
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
    contract_artifact_state: 'not_applicable',
    report_artifact_state: 'not_applicable',
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
  return withRouting({
    status: 'blocked',
    reason: 'wrong_branch',
    blocked_phase: 'sprint',
    report: [],
    blockers: [{
      description: `The sprint started on run branch '${parsed.run_branch}' but the tree ended on '${sprintResult.current_branch}', so any commits it made are not on the branch this run is authorised to merge from. Nothing has been reviewed or merged.`,
      resolution_hint: `Run \`git branch -a --contains <sha>\` for the sprint's commits to find where they landed, then cherry-pick them onto '${parsed.run_branch}' before opening the PR. Do not merge from '${sprintResult.current_branch}'.`,
    }],
    run_placement: placementFacts(parsed, sprintResult),
    artifact_tracking: artifactTrackingFacts(sprintResult),
  })
}

if (typeof sprintResult.commit_count === 'number' && sprintResult.commit_count === 0) {
  const where = parsed.run_branch ? `run branch '${parsed.run_branch}'` : 'the current branch'
  log(`HALTING — nothing_on_run_branch: zero commits on ${where} since ${parsed.branch_base || 'the branch base'}.`)
  return withRouting({
    status: 'needs_opus',
    reason: 'nothing_on_run_branch',
    blocked_phase: 'sprint',
    report: [],
    blockers: [{
      description: `Zero commits exist on ${where} since ${parsed.branch_base || 'the branch base'}. Whatever the sprint's summary or Completion Report says it built, no durable record of it exists here — do not treat any past-tense claim in ${reportPath} as evidence.`,
      resolution_hint: `Check \`git status --porcelain\` for uncommitted work worth keeping, and \`git branch -a --contains\` / the reflog for commits that landed elsewhere. Then re-run, or execute interactively.`,
    }],
    run_placement: placementFacts(parsed, sprintResult),
    artifact_tracking: artifactTrackingFacts(sprintResult),
  })
}

// ── artifact-tracking guard (contract file + completion report must be COMMITTED) ─────────────
// Additive coverage, not a duplicate of nothing_on_run_branch above: a sprint that commits code
// but forgets its own contract/report still has commit_count > 0, so the check above does not
// catch it. This guard is what makes AC3 of auto-feature-untracked-artifacts real: it must run
// BEFORE the reviewer/fix-loop path can ever set finalStatus = 'complete'. `written_untracked` on
// EITHER artifact is sufficient to halt — the run is not durable until both are part of the
// commit series, and the two states are read directly off Stage B's git-probe classification
// (never collapsed into a single boolean).
{
  const tracking = artifactTrackingFacts(sprintResult)
  const untracked = []
  if (tracking.contract_artifact_state === 'written_untracked') {
    untracked.push(`Feature Contract (${parsed.contract_path || '(path unknown)'})`)
  }
  if (tracking.completion_report_artifact_state === 'written_untracked') {
    untracked.push(`Completion Report (${reportPath})`)
  }
  if (untracked.length > 0) {
    log(`HALTING — artifact_untracked: ${untracked.join(' and ')} written to disk but never committed on the run branch.`)
    const addPaths = [
      tracking.contract_artifact_state === 'written_untracked' ? parsed.contract_path : null,
      tracking.completion_report_artifact_state === 'written_untracked' ? reportPath : null,
    ].filter(Boolean).join(' ')
    return withRouting({
      status: 'needs_opus',
      reason: 'artifact_untracked',
      blocked_phase: 'sprint',
      report: [],
      blockers: [{
        description: `${untracked.join(' and ')} were written during the sprint but left uncommitted on ${parsed.run_branch ? `run branch '${parsed.run_branch}'` : 'the current branch'}. A sprint is not durable until its own plan artifact and Completion Report are part of the commit series — an uncommitted file vanishes on a fresh clone and is invisible to anything that reads the merged history, even though the code commits themselves may be fine.`,
        resolution_hint: `git add ${addPaths} && git commit on ${parsed.run_branch || 'the current branch'}, then re-run the structure stage (or the whole workflow) so the guard re-evaluates against the committed state.`,
      }],
      run_placement: placementFacts(parsed, sprintResult),
      artifact_tracking: tracking,
    })
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

// ── Phase 2a: Measure ─────────────────────────────────────────────────────────
// Fires BEFORE the reviewer so the reviewer's test scope and base→head delta are inputs
// to its judgment, not commentary on it. Runs again inside the fix loop for each re-review
// (its post-fix HEAD is a different diff). See the shared validation-scope block above and
// reviewer-gate.js for the full rationale. runMeasureStage handles both the caller-supplied
// evidence path (preferred, args.validation_evidence) and the fallback dispatch.
phase('Measure')
let measurement = await runMeasureStage(parsed)

// ── Phase 2b: Review ──────────────────────────────────────────────────────────
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
    // Mode-D output scan on the codex offload leg — realized provider is 'codex' because
    // it just ran and produced the checklist artifact. This is the offload-lane case where
    // the hook can actually GATE (lane_of('codex') === 'offload').
    const stageAScan = await runModeDScanGuard('Review', 'codex', parsed.branch_base)
    if (stageAScan.gated) {
      verdict = {
        approved: false,
        verdict_source: 'mode_d_output_breach',
        reviewer_type: reviewerType,
        required_fixes: [`codex-executor (Stage A AC validation) wrote Mode-D-signature output (${stageAScan.findings_count ?? 'unknown'} finding(s)); re-run on claude-primary and do not merge this output.`],
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
  }
} else {
  // Flag off: existing on-primary reviewer with inline VERDICT_SCHEMA (unchanged).
  verdict = await agent(reviewPrompt(parsed, sprintResult, measurement), {
    label: 'review',
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })
}

// R3 + AC-3 + validation-scope: applied to every producer above (Stage B structurer, its
// fallbacks, and the flag-off reviewer) before anything reads `approved`. Chain:
//   - a red-backed met:true → ORDINARY REJECTION (defect_class:'ac-backed-by-red-test').
//   - a self-reported side effect → ordinary rejection ('self-reported-side-effect').
//   - an approving verdict without a verification path → gate-INTEGRITY failure.
//   - a still-approving verdict over a missing/failed/regression-carrying measurement →
//     gate-INTEGRITY failure. No fix cycle in the two integrity cases — nothing has been
//     found yet, so a cycle would edit blind.
let integrityFailure = null
{
  const enforced = enforceEvidenceRules(verdict, 'sprint', reviewerType, measurement)
  verdict = enforced.verdict
  integrityFailure = enforced.integrity_failure
  if (integrityFailure) {
    log(`GATE INTEGRITY FAILURE: ${integrityFailure}. The sprint is UNREVIEWED, not rejected — re-dispatch ${reviewerType} (or invoke the reviewer-gate workflow on this scope) requiring a named verification path and a clean measured delta. The fix loop is deliberately skipped.`)
  }
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

while (verdict && !verdict.approved && !integrityFailure && cycles < 2 && budget.remaining() > 60_000) {
  const cycleNumber = cycles + 1
  phase(`Fix cycle ${cycleNumber}`)
  log(`Fix cycle ${cycleNumber}: applying ${(verdict.required_fixes || []).length} required fix(es).`)

  const fixPromptText = fixPrompt(parsed, verdict.required_fixes || [], cycleNumber)

  // Realized provider for THIS fix-cycle dispatch — set inside whichever branch below
  // actually runs, then fed into the automatic post-leg Mode-D output scan. Defaults to
  // 'claude' (the flag-off / non-bob path never touches an offload lane).
  let fixCycleRealizedProvider = 'claude'

  if (provider_routing_enabled && fixProvider === 'bob') {
    // P4: Bob fix-cycle routing — three-gate check (design_spec §7 + phase plan).
    const modeDReason = fixCycleModeDGuard(contractFixFiles, contractFixClass, fixPromptText)

    if (modeDReason) {
      // Gate 1: Mode-D triggered — abort Bob, route to claude, log reason.
      log(`P4 Mode-D guard triggered for fix-cycle ${cycleNumber}: ${modeDReason}. Routing to claude (not Bob).`)
      routeLog({
        task_ref: `fix-cycle-${cycleNumber}`,
        // The Mode-D guard fired BEFORE dispatch, so the effective routing decision is claude —
        // recording chosen_plugin_id:'bob' here would assert an intent we knowingly did not act
        // on. The rejected provider is named in `reason` instead (v2 has no override field).
        kind: 'decision',
        chosen_plugin_id: 'claude',
        intended_model: parsed.fix_model || null,
        fallback_applied: false,
        reason: `mode_d: ${modeDReason} (fix_provider:bob rejected by the Mode-D guard before dispatch)`,
      })
      await agent(fixPromptText, {
        label: `fix-cycle-${cycleNumber}`,
        phase: `Fix cycle ${cycleNumber}`,
        agentType: fixAgentType,
        model: parsed.fix_model || undefined,
      })
    } else {
      // Gate 2: Mode-D cleared — dispatch bob-delegate-executor.
      log(`P4 Bob fix-cycle routing: dispatching bob-delegate-executor for fix-cycle ${cycleNumber}.`)
      let bobResult = null
      let bobFailed = false
      // What the workflow actually OBSERVED, for the realization evidence below. Bob's own
      // self-report would not be a measurement; this is the orchestrator's observation.
      let bobFailureMode = null
      try {
        routeLog({
          task_ref: `fix-cycle-${cycleNumber}`,
          // No actual_provider_used: nothing has run yet, and omitted means UNCONFIRMED. Copying
          // the intent into the realized field is what made the field unable to audit anything.
          kind: 'decision',
          chosen_plugin_id: 'bob',
          intended_model: parsed.fix_model || null,
          fallback_applied: false,
          reason: `fix_provider:bob fix-cycle ${cycleNumber} for contract ${parsed.contract_path || '(unknown)'}`,
        })
        bobResult = await agent(fixPromptText, {
          label: `fix-cycle-${cycleNumber}`,
          phase: `Fix cycle ${cycleNumber}`,
          agentType: 'bob-delegate-executor',
          model: parsed.fix_model || undefined,
        })
        if (!bobResult) {
          bobFailed = true
          bobFailureMode = 'returned null'
          log(`P4 Bob fix-cycle: bob-delegate-executor returned null for fix-cycle ${cycleNumber}. Triggering fallback to claude.`)
        } else {
          // Bob actually ran and returned — this is the offload-lane realization.
          fixCycleRealizedProvider = 'bob'
        }
      } catch (bobErr) {
        bobFailed = true
        bobFailureMode = `threw: ${bobErr && bobErr.message ? bobErr.message : bobErr}`
        log(`P4 Bob fix-cycle: bob-delegate-executor threw for fix-cycle ${cycleNumber}: ${bobErr && bobErr.message ? bobErr.message : bobErr}. Triggering fallback to claude.`)
      }

      // Gate 3: Bob fallback — immediate escalation to claude, no Bob retry.
      if (bobFailed) {
        fixCycleRealizedProvider = 'claude'
        log(`P4 Bob fallback: actual_provider_used='claude', fallback_applied=true for fix-cycle ${cycleNumber}.`)
        routeLog({
          task_ref: `fix-cycle-${cycleNumber}`,
          // The one hop this workflow genuinely measures: it observed bob fail and issued this
          // re-dispatch itself, so the realized provider is established by evidence, not claimed.
          kind: 'realization',
          chosen_plugin_id: 'bob',
          intended_model: parsed.fix_model || null,
          actual_provider_used: 'claude',
          // null when the contract pinned no fix model — unknowable, never guessed.
          realized_model: parsed.fix_model || null,
          fallback_applied: true,
          realization_evidence: `orchestrator-observed: bob-delegate-executor ${bobFailureMode} for fix-cycle ${cycleNumber}; this call is the workflow's own in-process re-dispatch to ${fixAgentType} on claude-primary`,
          reason: 'bob-delegate-executor failed (timeout / binary absent / structuring error); escalated to claude immediately (no retry)',
        })
        await agent(fixPromptText, {
          label: `fix-cycle-${cycleNumber}-fallback`,
          phase: `Fix cycle ${cycleNumber}`,
          agentType: fixAgentType,
          model: parsed.fix_model || undefined,
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

  // Mode-D output scan on the fix-cycle leg that just returned, keyed on the REALIZED
  // provider (bob only when bob actually ran and returned; claude on every guard-triggered,
  // fallback, or flag-off path). An offload lane crossing the boundary here is a hard halt —
  // do not merge this output, and do not run the SHA-refresh below that would fold it into
  // reviewResult.
  const fixCycleScan = await runModeDScanGuard(`Fix cycle ${cycleNumber}`, fixCycleRealizedProvider, parsed.branch_base)
  if (fixCycleScan.gated) {
    return withRouting({
      status: 'blocked',
      reason: 'mode_d_output_breach',
      blocked_phase: `fix-cycle-${cycleNumber}`,
      report: [],
      blockers: [{
        description: `Fix cycle ${cycleNumber} (provider=${fixCycleRealizedProvider}) wrote Mode-D-signature output — ${fixCycleScan.findings_count ?? 'unknown'} finding(s) detected by mode-d-scan.sh on an offload lane. Do not merge this output.`,
        resolution_hint: `Inspect the fix-cycle ${cycleNumber} diff for generated key material, auth/migration/deletion paths, or history rewrites. Re-run this fix on claude-primary once confirmed.`,
      }],
      run_placement: placementFacts(parsed, reviewResult),
      artifact_tracking: artifactTrackingFacts(reviewResult),
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
      return withRouting({
        status: 'blocked',
        reason: 'wrong_branch',
        blocked_phase: `fix-cycle-${cycleNumber}`,
        report: [],
        blockers: [{
          description: `Fix cycle ${cycleNumber} ended with the tree on '${reviewResult.current_branch}' instead of run branch '${parsed.run_branch}', so its commits are not on the branch this run may merge from.`,
          resolution_hint: `Locate the fix commits with \`git branch -a --contains ${refreshedSha.commit_sha}\`, cherry-pick them onto '${parsed.run_branch}', then re-run the reviewer gate.`,
        }],
        run_placement: placementFacts(parsed, reviewResult),
        artifact_tracking: artifactTrackingFacts(reviewResult),
      })
    }
  } else {
    log(`Fix cycle ${cycleNumber}: WARNING — SHA refresh returned nothing; reviewer will use last known commit reference.`)
  }

  // Re-measure before each re-review: the post-fix HEAD has a different diff (new tests
  // in scope, potentially new regressions), and a stale measurement here is precisely how a
  // fix cycle could end on an unverified approval over a measured regression the previous
  // Measure did not see. See the shared block for rationale.
  phase('Measure')
  measurement = await runMeasureStage(parsed)

  // Re-run reviewer after each fix cycle, pointed at the post-fix HEAD.
  phase('Review')
  verdict = await agent(reviewPrompt(parsed, reviewResult, measurement), {
    label: `review-cycle-${cycleNumber}`,
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })

  // R3 + AC-3 + validation-scope on the re-review too: a fix cycle must not be able to end
  // on an unverified approval, a red-backed AC, or a measurement-integrity failure.
  const enforcedCycle = enforceEvidenceRules(verdict, 'sprint', reviewerType, measurement)
  verdict = enforcedCycle.verdict
  if (enforcedCycle.integrity_failure) {
    integrityFailure = enforcedCycle.integrity_failure
    log(`GATE INTEGRITY FAILURE on re-review (fix cycle ${cycleNumber}): ${integrityFailure}. Halting the fix loop — the fix so far is unreviewed, not rejected.`)
  }

  cycles++
}

// ── Determine final status ────────────────────────────────────────────────────
const approved = verdict?.approved === true
const budgetExhausted = !approved && cycles < 2 && budget.remaining() <= 60_000
// §8b: a gate that could not RUN is not a gate that rejected. `verdict` is null when the
// reviewer died after retries or was skipped — that is an unreviewed sprint, and the next
// action is re-dispatch, not a fix cycle. Conflating it with 'reviewer_unresolved' points
// Opus at a defect nobody found.
// R3: a verdict that EXISTS but approved without establishing a verification path is equally
// untrustworthy, and its next action is identical — re-dispatch or an explicit override, never a
// fix cycle. `reason` reuses 'gate_failure' because execution-report.schema.json's enum is
// closed; the distinction travels in verdict_source and the log line.
const gateFailed = !verdict || Boolean(integrityFailure)

let finalStatus = 'complete'
let reason

if (!approved) {
  finalStatus = 'needs_opus'
  reason = gateFailed ? 'gate_failure' : budgetExhausted ? 'budget_exhausted' : 'reviewer_unresolved'
  if (gateFailed && integrityFailure) {
    log(`GATE INTEGRITY FAILURE after ${cycles} fix cycle(s): ${integrityFailure}. The sprint is UNREVIEWED, not rejected — re-dispatch the reviewer requiring a named verification path (live-smoke | path-equivalence | real-endpoint-field-check | production-callsite-trace), or record an explicit operator override. Do NOT run another fix cycle. Escalating to Opus — reason: gate_failure.`)
  } else if (gateFailed) {
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
  // An integrity failure means a verdict exists but cannot be trusted — the same "not gated"
  // state as no verdict at all, so gate_ran must be false for both.
  gate_ran: Boolean(verdict) && !integrityFailure,
  escalate: !approved,
  files_touched: sprintResult.files_touched || [],
  blockers: sprintResult.blockers || [],
  // What the gate actually measured, so a caller (or a later reader of the run record) can
  // tell an approval over a MEASURED-clean delta from an approval over no measurement at all.
  // The two are indistinguishable without this — that indistinguishability is what let
  // skillmeat PR #299 through with 4/4 ACs "met". Mirrors reviewer-gate.js return envelope.
  validation_scope: {
    evidence_present: measurement.evidence_present,
    files_run: measurement.files_run,
    scope_truncated: measurement.scope_truncated,
    scope_status: measurement.scope_status,
    omitted_files: measurement.omitted_files || [],
    regressions: measurement.regressions,
    measurement_failures: measurement.measurement_failures,
  },
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
// Same rule for artifact tracking (AC1): a run that reached here already passed the
// artifact_untracked guard above, so both states are expected to read 'committed' — but they
// travel on every outcome, not only the guard-failure path, so a consumer never has to guess
// whether the field's absence means "clean" or "never checked".
result.artifact_tracking = artifactTrackingFacts(reviewResult || sprintResult)
if (result.run_placement.parent_moved === true) {
  log(`NOTE: parent branch '${result.run_placement.parent_branch}' moved during this run (${result.run_placement.parent_tip_at_start} → ${result.run_placement.parent_tip_at_report}). If the run branch is rebased onto the new tip, commit_sha will change; re-find the work by patch_id (${result.run_placement.patch_id || 'unavailable'}), not by the reported SHA.`)
}

return withRouting(result)
