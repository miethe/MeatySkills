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
    // Measure runs BEFORE each Review pass: the reviewer's test scope and base→head delta
    // are inputs to its judgment, not commentary on it. Fires once per phase reviewer gate
    // and once per fix-cycle re-review, so each verdict lands over the measurement of its
    // own post-fix HEAD. phase() titles must match these exactly (authoring constraint).
    { title: 'Measure' },
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
  // R3: verification_path is REQUIRED, so a reviewer physically cannot finish without saying
  // whether it established that the evidence exercises the path production takes.
  required: ['approved', 'reviewer_type', 'verification_path'],
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
    // R3 (verification-path evidence gate, 2026-08-06 workflow-v41 retro). `evidence` above
    // establishes that the reviewer looked at something; this establishes that what it looked at
    // is on the path production takes. The dominant delegate defect class was a green suite over
    // a path production does not take, which every `evidence` string in the world reads past.
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
        // The entry point production actually takes to reach the changed code.
        production_entrypoint: { type: 'string' },
        // The command transcript / file:line pair / response body that proves it.
        evidence: { type: 'string' },
      },
    },
    // Claims the reviewer had to accept on a leg's own word because no artifact backed them.
    // Any entry blocks approval: five misreporting findings in seven days came from reading
    // "I registered the node / wrote the file" as evidence that it happened.
    self_reported_claims: { type: 'array', items: { type: 'string' } },
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
// ⚠️ UPDATE 2026-08-08 — NEITHER DIRECTION IS SILENT ANY MORE, so this set is now a DIAGNOSTIC
// rather than a correctness dependency, and a stale one no longer corrupts a run:
//   * a phantom name  → the task is dispatched, returns null, and is reported as a DROPPED TASK
//     (named, escalated, `reason: 'task_dropped'`) instead of vanishing from the wave.
//   * an omitted real agent → under the default `hitl_routing: 'marker'` it is dispatched with a
//     warning, not reclassified as a human gate. Only opt-in `'roster'` mode reclassifies.
// Keeping it accurate is still worthwhile (it is what makes the pre-dispatch warning useful, and
// what `'roster'` mode depends on), but it is no longer load-bearing. Regenerate it per deployment
// against that deployment's own `.claude/agents/` when convenient — not urgently.
//
// ⚠️ THE SET BELOW IS PER-DEPLOYMENT — do not assume the value you are reading came from upstream.
// Some deployments have regenerated it against their own `.claude/agents/`; others still carry the
// upstream default, which lists `api-librarian`, `telemetry-auditor` and `frontend-developer` —
// names that exist in no known agents dir. The default keeps them rather than removing them
// because presence cannot be verified from upstream, and removing a name a given deployment DOES
// have would reclassify a dispatchable task as a human gate.
//
// Regenerate it from the deploying repo's own `.claude/agents/`. A sync from upstream does NOT
// clobber a regenerated set: `agentic_meta_dev/scripts/sync_project_workflows.py` treats this
// block as its one per-deployment exemption and carries the LOCAL value across the write. Two
// checkers exclude it from their diffs for the same reason (`check_global_artifact_drift.py`, and
// that script's `roster-only` verdict) — so a green gate is not evidence this list matches
// upstream. It is not supposed to. This note is deliberately deployment-neutral so that no repo
// needs a local variant of it; a repo-specific edit here re-opens the drift it warns about.
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

// ─── HITL routing mode (configurable via args.hitl_routing) ───────────────────
//
//   'marker' (DEFAULT) — `t.hitl === true` is the SOLE authority on whether a task is a human
//                        gate. An assigned_to the roster does not recognize is DISPATCHED, with
//                        a warning; if it resolves to nothing, the dropped-task check names it.
//   'roster'           — legacy behaviour: additionally reclassify any assigned_to outside
//                        KNOWN_AGENT_TYPES as a human gate.
//
// Why 'marker' is the default. The roster clause was inference layered on top of an explicit
// declaration, and it failed in the INVISIBLE direction: a real agent missing from the set was
// silently reclassified as a human gate, so a perfectly dispatchable task never ran (17 agents
// were omitted this way at once). Worse, the set cannot verify agent existence at all — workflow
// scripts have no filesystem access, so it is a hand-maintained mirror that must be regenerated
// per deployment and rots between regenerations. The phantom half is now caught AFTER dispatch
// by the dropped-task check below, which is where it is actually observable, and which also
// catches failures the set never could (an agent that exists but is unloadable, a stalled leg).
// That makes roster accuracy a DIAGNOSTIC rather than a correctness dependency.
//
// 'roster' is kept because the strictness is legitimately wanted where the roster is trustworthy
// — an enterprise deployment with a curated agent catalog may prefer an unrecognized name held
// for a human over dispatched. It is opt-in precisely because it is only safe when something
// actually keeps the set accurate. Tracker: node_01KZ9DBRAH35XHNH7NQA1H5NYT.
let hitlRouting = 'marker'

function isHitlTask(t) {
  if (t?.hitl === true) return true
  if (hitlRouting === 'roster') return !!t?.assigned_to && !KNOWN_AGENT_TYPES.has(t.assigned_to)
  return false
}

// An assigned_to the roster does not recognize. In 'marker' mode this drives a WARNING and an
// annotation on a dropped task — never a silent reclassification.
function hasUnknownAgentType(t) {
  return !!t?.assigned_to && !KNOWN_AGENT_TYPES.has(t.assigned_to)
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
        resolution_hint: 'In Opus pre-flight, resolve the session repo (`basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`, not `--show-toplevel` — inside a worktree that basename is the worktree directory name, not the repo name) and pass it as session_repo alongside target_repo. Do NOT drop target_repo to silence this — the guard is what stands between a cross-repo plan and agents editing the wrong tree.',
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

// ─── placement facts (pure) ───────────────────────────────────────────────────
// Provenance attached to EVERY terminal return so a consumer can tell "rebased away" from "never
// existed" without guessing, on the blocked paths as well as the happy one. execute-plan has no
// single sprint result — it runs many agents across waves — so it reports only what the graph
// itself asserts: the branch topology and the caller's DESCRIPTIVE placement lane. The script has
// no FS/shell and cannot verify any of it, so an absent field is null, never a guess and never a
// default like "branch_in_place"; isolation and worktree_path are echoed independently, neither
// inferred from the other. Fields execute-contract measures from a post-sprint git probe
// (commit_count / head_sha / patch_id / parent_tip_at_report / parent_moved) are omitted here
// rather than faked — this workflow cannot measure them.
function placementFacts(graph) {
  return {
    run_branch: graph?.run_branch || null,
    parent_branch: graph?.parent_branch || null,
    base_sha: graph?.branch_base || null,
    parent_tip_at_start: graph?.parent_tip_at_start || null,
    isolation: graph?.isolation || null,
    worktree_path: graph?.worktree_path || null,
  }
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

// Mode-D subject matter in a dispatch brief. Inlined rather than shared with
// execute-contract.js's identical table because workflow scripts cannot require()
// at runtime (workflow-authoring-spec §"no FS/shell in script"); the two copies are
// kept verbatim-identical on purpose so a drift is a visible diff.
// Patterns are deliberately tight multi-word/technical forms — bare `token` would
// trip on "token bucket", and a noisy guard is a guard that gets switched off.
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

// A Mode-D warning present in the brief. See the rationale at check 6 below.
const MODE_D_SELF_WARNING_PATTERNS = [
  /must\s+not\s+(read|generate|print|reference|mint|create)[^.\n]{0,60}\bkey\b/i,
  /\bnever\s+(mint|generate|sign)\b/i,
  /reason:\s*['"]?mode_?d/i,
  /\bneeds_opus\b[^\n]{0,40}\bmode_?d\b/i,
  /\bdo\s+not\s+(sign|mint|generate)\b/i,
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

  // 5. Prompt scan for Mode-D SUBJECT MATTER (node_01KZC1AHEDYZ8FS9TAZSXQTTSB).
  // Checks 1–4 were ALL satisfied by the leg that breached Mode-D on 2026-08-06:
  // clean declared files, ordinary class, no destructive command. It was routed to
  // an offload lane on those clean signals and then wrote its own HMAC signer,
  // minting a key with secrets.token_bytes(32). What the brief did carry was the
  // subject matter.
  for (const pat of MODE_D_INTENT_PATTERNS) {
    if (pat.test(promptText)) {
      return `brief concerns Mode-D subject matter matching ${pat} — offload lane not eligible`
    }
  }

  // 6. A Mode-D warning in the brief is EVIDENCE of proximity, not a control.
  // The breaching brief said "must not read, generate, print or reference any
  // signing key … STOP and return {reason: mode_d}". Treating that as the control
  // puts enforcement inside the delegate — the very party being constrained. Read
  // instead as a signal: a leg that has to be warned off the boundary is too close
  // to it to offload.
  for (const pat of MODE_D_SELF_WARNING_PATTERNS) {
    if (pat.test(promptText)) {
      return `brief contains a Mode-D warning matching ${pat}; a leg that must be `
        + `warned off the boundary is too close to it to offload (the warning is the signal, not the control)`
    }
  }

  return null // Safe to dispatch to an offload lane.
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
 * in the {verdict, integrity_failure} shape dispatchReview uses. Chain:
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
 * Passing `null` degrades gracefully to `evidence_present: false` (gate-integrity failure
 * on an approving verdict), which is deliberate — an unmeasured approval is exactly the
 * state PR #299 slipped through in.
 */
function enforceEvidenceRules(verdict, phaseId, reviewerType, measurement) {
  if (!verdict) return { verdict, integrity_failure: null }

  const _measurement = measurement && typeof measurement === 'object'
    ? measurement
    : normalizeMeasurement(null)

  // Step 1: AC-3 + R7 reconciliation. Fires on approving AND rejecting verdicts.
  verdict = applyTestStatusRules(verdict, _measurement)
  if (!verdict.approved) {
    return { verdict, integrity_failure: null }
  }

  // Step 2: self-reported side effects → ordinary rejection.
  const claims = Array.isArray(verdict.self_reported_claims) ? verdict.self_reported_claims.filter(Boolean) : []
  if (claims.length) {
    log(`R3 REJECTION on phase ${phaseId}: ${reviewerType} approved with ${claims.length} self-reported claim(s) and no artifact evidence. Downgrading the approval — a report of a side effect is not the side effect.`)
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
          `The reviewer approved phase ${phaseId} without establishing a verification path (${gap}). Re-dispatch ${reviewerType} and require one of live-smoke | path-equivalence | real-endpoint-field-check | production-callsite-trace, or record an explicit operator override. Do NOT run a fix cycle: nothing has been found yet.`,
        ],
      },
      integrity_failure: `approving verdict with no established verification path — ${gap}`,
    }
  }

  // Step 4: still-approving over a missing/failed/regression-carrying measurement
  //          → gate-integrity failure.
  return enforceValidationScopeRules(verdict, `phase ${phaseId}`, reviewerType, _measurement)
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

function reviewPrompt(p, taskOut, measurement) {
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
assert. Where the two disagree, the diff wins and the disagreement itself is a finding.

Measured validation scope and base→head delta (your scope for TEST SELECTION, not for READING):
${measurementBrief(measurement || normalizeMeasurement(null))}

${EVIDENCE_RULES}

${VALIDATION_SCOPE_RULES}`

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

Also required on every verdict:
  - verification_path: established / kind / production_entrypoint / evidence, per the
    VERIFICATION-PATH RULE above. An approving verdict whose path is not established is recorded
    as a gate-integrity failure, not an approval — so withholding it is the honest move, never a
    penalty.
  - self_reported_claims: every claim you had to take on a task agent's word for lack of an
    artifact. Any entry blocks approval by construction.
  - ac_verdicts: one entry per acceptance criterion, {criterion, met, evidence, supporting_tests}.
    supporting_tests[] is {nodeid, status} using the MEASURED status above rather than your
    expectation of it. A criterion supported only by red/absent tests must be met:false with the
    node ids named as the reason — the gate enforces this and will downgrade a met:true that
    violates it (defect_class: 'ac-backed-by-red-test').
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
  // Last measurement produced inside the loop, so the return envelope can carry it.
  let lastMeasurement = null

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

    // Re-measure BEFORE each re-review: the post-fix HEAD has a different diff (new tests
    // in scope, potentially new regressions), and a stale measurement here is precisely how
    // a fix cycle could end on an unverified approval over a regression the previous Measure
    // never saw. Fires under the 'Measure' phase group.
    phase('Measure')
    const cycleMeasurement = await runMeasureStage(args)
    lastMeasurement = cycleMeasurement
    phase('Review')

    // Route through dispatchReview, never a bare agent(): for a council phase reviewerType
    // is 'council-review', a skill with no agent file. Dispatching it here resolved nothing
    // and returned null, so EVERY council rejection's re-review gate-failed by construction —
    // a fix cycle that could never be re-reviewed on the path it came from.
    const reReview = await dispatchReview(p, taskOut, reviewerType, cycleMeasurement)
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
    // The measurement produced by the LAST re-review, or absent if the fix loop never
    // ran (`cycles === 0`). Consumers reading the phase result need to be able to tell an
    // approval over a MEASURED-clean delta from one over no measurement at all — the whole
    // reason PR #299 slipped through was that the two were indistinguishable.
    validation_scope: (() => {
      const _m = lastMeasurement || normalizeMeasurement(null)
      return {
        evidence_present: _m.evidence_present,
        files_run: _m.files_run,
        scope_truncated: _m.scope_truncated,
        scope_status: _m.scope_status,
        omitted_files: _m.omitted_files || [],
        regressions: _m.regressions,
        measurement_failures: _m.measurement_failures,
      }
    })(),
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
//
// `measurement` is the normalizeMeasurement()'d output of runMeasureStage, threaded through
// so enforceEvidenceRules can apply AC-3 (red-test-AC rejection), reconcile R7 claimed vs
// measured statuses, and treat a missing/failed/regression-carrying measurement as a
// gate-integrity failure — matching how reviewer-gate.js does it. Callers pass null only
// when a caller-supplied measurement is genuinely unavailable, and that null degrades to
// `evidence_present: false` (approval blocked as gate-integrity failure) rather than to a
// silent approve — a missing measurement must never be the cheaper option than a failing one.
async function dispatchReview(p, taskOut, reviewerType, measurement) {
  if (reviewerType === 'council-review') {
    return assessCouncilVerdict(await runCouncil(p, taskOut), p.id)
  }
  const verdict = await agent(reviewPrompt(p, taskOut, measurement), {
    phase: 'Review',
    agentType: reviewerType,
    schema: VERDICT_SCHEMA,
  })
  // R3 + AC-3 + validation-scope: run at the single funnel every re-review passes through,
  // so a fix cycle cannot end on an unverified approval, a red-backed AC, or an approval
  // over a measured regression.
  return enforceEvidenceRules(verdict, p.id, reviewerType, measurement)
}

// Shared shape for "the gate could not be trusted to have run" — used by both the §8b
// null-verdict case and the council-integrity case. Their next action is identical:
// re-dispatch or record an explicit operator override. Never a fix cycle.
function gateIntegrityResult(p, taskOut, reviewerType, verdict, reason, cycles, measurement) {
  const _m = measurement && typeof measurement === 'object' ? measurement : normalizeMeasurement(null)
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
    // Validation-scope provenance travels with every outcome — including this one.
    // A phase result that only carries validation_scope when the gate ran cleanly is a
    // shape that trains consumers to skip it, and the whole reason PR #299 slipped through
    // was that "approved" and "approved with no measurement" were indistinguishable.
    validation_scope: {
      evidence_present: _m.evidence_present,
      files_run: _m.files_run,
      scope_truncated: _m.scope_truncated,
      scope_status: _m.scope_status,
      omitted_files: _m.omitted_files || [],
      regressions: _m.regressions,
      measurement_failures: _m.measurement_failures,
    },
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
  // Measure BEFORE the reviewer: the test-selection scope and the base→head delta are
  // inputs to the reviewer's judgment. Fires under the 'Measure' phase group; runs again
  // inside fixLoop for each re-review (its post-fix HEAD is a different diff). See the
  // shared block for full rationale.
  phase('Measure')
  const measurement = await runMeasureStage(args)
  phase('Review')

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
      return gateIntegrityResult(p, taskOut, 'council-review', verdict, integrity_failure, 0, measurement)
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
      verdict = await agent(reviewPrompt(p, taskOut, measurement), {
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
    // Flag off: existing on-primary reviewer with inline VERDICT_SCHEMA. Measurement is
    // threaded through so the reviewer sees the resolved test scope and the base→head delta.
    verdict = await agent(reviewPrompt(p, taskOut, measurement), {
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
  }

  // R3 + AC-3 + validation-scope: applies to every producer above — the flag-off reviewer,
  // the P5 primary fallback, and the Stage B structurer. Chains applyTestStatusRules first
  // (red-backed AC → ordinary rejection), then self-reported-side-effects (rejection), then
  // verification-path (integrity failure on unverified approval), then measurement-integrity
  // (integrity failure on approval over missing/failed/regression-carrying measurement).
  const enforced = enforceEvidenceRules(verdict, p.id, reviewerType, measurement)
  verdict = enforced.verdict
  if (enforced.integrity_failure) {
    log(`GATE INTEGRITY FAILURE on phase ${p.id}: ${enforced.integrity_failure}. Recording as a gate failure, NOT as an approval or a rejection. The fix loop is deliberately skipped.`)
    return gateIntegrityResult(p, taskOut, reviewerType, verdict, enforced.integrity_failure, 0, measurement)
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

${EVIDENCE_RULES}

IMPORTANT — TWO-STAGE DURABILITY:
Write your complete AC validation checklist to: ${artifactPath}
Use this format per AC item:
  - [ ] AC text — NOT MET: reason
  - [x] AC text — MET: <file:line or traced behaviour> | PATH: <live-smoke | path-equivalence |
        real-endpoint-field-check | production-callsite-trace> — <what you saw>

Every MET line MUST carry a PATH segment naming one of the four kinds. A MET line whose evidence
is only "the tests pass" has no path and is NOT MET. End the file with one line:
  VERIFICATION-PATH: <kind> — <production entry point> — <evidence>
or, when you could not establish one for the phase as a whole:
  VERIFICATION-PATH: not-established — <why>
and a line listing anything you had to take on a task agent's word:
  SELF-REPORTED: <claim>; <claim>    (or "SELF-REPORTED: none")

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
  { "approved": false, "reviewer_type": "${reviewerType}", "verification_path": { "established": false, "kind": "not-established", "evidence": "Stage A artifact absent" }, "required_fixes": ["AC validation artifact not found at ${artifactPath} — codex Stage A may have failed"] }

If the file exists:
  1. Count lines starting with "- [x]" (met) and "- [ ]" (not met).
  2. Set approved:true ONLY if all ACs are marked met (no "- [ ]" lines) AND every "- [x]" line
     carries a "PATH:" segment. A MET line with no PATH segment counts as NOT met — copy its AC
     text into required_fixes with the reason "no verification path recorded".
  3. For each unmet AC, add its text to required_fixes with a brief reason from the checklist.
  4. Set reviewer_type to "${reviewerType}".
  5. Copy the checklist's trailing "VERIFICATION-PATH:" line into verification_path:
     established=true and kind=<kind> when the line names one of live-smoke | path-equivalence |
     real-endpoint-field-check | production-callsite-trace; otherwise established=false with
     kind="not-established". TRANSCRIBE it — never infer a path the checklist does not state,
     and never upgrade "not-established" because the ACs look met.
  6. Copy the "SELF-REPORTED:" line into self_reported_claims (empty array for "none").
  7. Return the VERDICT_SCHEMA object.

Do NOT write any files. Do NOT git add/commit/push/stash. Read only.`
}

// ---------------------------------------------------------------------------
// Main script body
// ---------------------------------------------------------------------------

// Defensive args parsing: the workflow runtime may pass args as a JSON string.
const graph = typeof args === 'string' ? JSON.parse(args) : args

// Resolve HITL routing before anything calls isHitlTask(). Only the exact string 'roster' opts
// into the legacy strict mode; every other value (including absent, null, a typo, or `true`)
// resolves to 'marker'. A misspelled flag must not silently re-enable the behaviour whose
// failure mode is invisible — the safe direction is the one that dispatches and reports.
hitlRouting = graph?.hitl_routing === 'roster' ? 'roster' : 'marker'

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
    run_placement: placementFacts(graph),
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
  repoBlock.run_placement = placementFacts(graph)
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
    run_placement: placementFacts(graph),
  }
}

// ---------------------------------------------------------------------------
// Branch-placement guard — fail-closed, BEFORE the first wave can commit anything.
//
// Workflow agents run in the session's cwd on whatever branch that tree is checked out to. There is
// no per-agent cwd. They DO follow the session into a worktree it has ENTERED (measured on Claude
// Code 2.1.224, 2026-08-07, and again on 2.1.226 — a lone 2.1.226 non-inheritance report did NOT
// reproduce, node_01KZGQE6GVJTGXRSHA57FYKNDQ, and the verdict is deliberately NOT cached:
// verify placement with the run's probe, never with a recorded measurement); an
// orchestrator that merely CREATES a worktree with `git worktree add`
// and "passes" its path cannot reach these agents at all. Observed
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
        resolution_hint: `In the tree this session is standing in, run: git switch ${graph.run_branch} (create it from the parent branch if needed), then re-invoke. To isolate the run, ENTER a worktree with the EnterWorktree tool first and check the branch out there — agents follow an entered worktree whenever the run's placement probe confirms it (confirmed on 2.1.224 and again on 2.1.226; probed per run, never cached — node_01KZGQE6GVJTGXRSHA57FYKNDQ). Do NOT \`git worktree add\` and pass the path without entering it: the session cwd would not move and agents would commit here anyway.`,
      }],
      run_placement: placementFacts(graph),
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
  if (boundary) {
    boundary.run_placement = placementFacts(graph)
    return boundary
  }

  // Budget exhaustion guard before dispatching an entire wave.
  if (budget.remaining() < 60_000) {
    log(`Budget exhausted before Wave ${wave.id} — returning to Opus.`)
    return { status: 'needs_opus', reason: 'budget_exhausted', report, run_placement: placementFacts(graph) }
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
    // Dispatched tasks that came back with NO result. Recorded, never silently discarded —
    // see the droppedTasks accounting after the batch loop.
    const droppedTasks = []
    let dispatchedCount = 0

    for (const batch of batches) {
      // Inner parallel: only tasks with disjoint files_affected are in the same batch.
      // HITL tasks are skipped here — never passed to agent() as an agentType.
      const dispatchable = batch.filter(t => !isHitlTask(t))
      if (dispatchable.length === 0) continue
      dispatchedCount += dispatchable.length

      // In 'marker' mode an unrecognized agentType is dispatched rather than reclassified, so say
      // so at dispatch time. The roster cannot prove existence (no FS access here); this warning
      // plus the dropped-task check below is what replaces the guess it used to make.
      for (const t of dispatchable.filter(hasUnknownAgentType)) {
        log(`WARNING ${p.id}:${t.id}: assigned_to='${t.assigned_to}' is not in KNOWN_AGENT_TYPES. ` +
            `Dispatching anyway (hitl_routing='marker'). If the agentType resolves to nothing the ` +
            `task is reported as DROPPED, not silently skipped. Pass hitl_routing:'roster' to hold ` +
            `unrecognized names as human gates instead.`)
      }
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
      // `taskOut.push(...batchOut.filter(Boolean))` was the TASK-level instance of exactly the
      // bug fixed one level up for phases (see the droppedPhases comment below): filter(Boolean)
      // doing double duty as "drop empties" and, accidentally, "discard failures". A task whose
      // agentType resolved to nothing — the phantom-roster-entry failure KNOWN_AGENT_TYPES exists
      // to prevent — returns null here and was removed from the array before anything could
      // notice, so the phase reported success having never run it. The fix was applied to phases
      // on 2026-08-04 and never pushed down to tasks. Same loudness contract, same reasoning:
      // recorded, named, and escalated, with the reason travelling in the RETURN VALUE.
      batchOut.forEach((r, i) => {
        if (r) { taskOut.push(r); return }
        const t = dispatchable[i]
        droppedTasks.push({
          id: t?.id ?? `(unnamed task at index ${i})`,
          assigned_to: t?.assigned_to ?? '(none)',
          unknown_agent_type: hasUnknownAgentType(t),
        })
      })
    }

    if (droppedTasks.length > 0) {
      log(`Phase ${p.id}: ${droppedTasks.length} of ${dispatchedCount} dispatched task(s) produced ` +
          `NO result and were dropped: ` +
          droppedTasks.map(d => `${d.id} (assigned_to=${d.assigned_to}` +
            `${d.unknown_agent_type ? ', NOT in KNOWN_AGENT_TYPES — an unresolvable agentType is the likeliest cause' : ''})`).join('; ') +
          `. This phase is NOT complete.`)
    }

    // Reviewer gate + fix-loop (edit-less agentType only — constraint 3).
    // Skip the reviewer when the phase had no agent work (pure-HITL phase) — there is
    // nothing to review; the human gate is surfaced via hitl_gates below.
    const phaseResult = taskOut.length > 0
      ? await reviewerGate(p, taskOut, tier)
      : { phase: p.id, tasks: [], verdict: { approved: true, reviewer_type: 'none' }, fix_cycles: 0, escalate: false, files_touched: [], blockers: [] }

    phaseResult.hitl_gates = hitlGates
    // Recorded on every phase so the invariant is checkable from the report alone, by this
    // workflow and by anything downstream — not only when something went wrong.
    phaseResult.tasks_expected = dispatchedCount
    phaseResult.tasks_returned = taskOut.length
    phaseResult.dropped_tasks = droppedTasks

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
      run_placement: placementFacts(graph),
    }
  }

  // Dropped TASKS halt the wave for the same reason dropped phases do, and this check must come
  // BEFORE the reviewer-escalation check below so the returned `reason` names what actually
  // happened. The reviewer gate DID run here (on whatever landed), which is deliberate — the work
  // that exists is still worth reviewing — but an approving verdict over a partial task set must
  // never let the wave advance. A later wave building on this one builds on missing work.
  const droppedTaskEntries = completedWaveResults.flatMap(r =>
    (r?.dropped_tasks ?? []).map(d => ({ phase: r.phase, ...d })))
  if (droppedTaskEntries.length > 0) {
    log(`Wave ${wave.id}: ${droppedTaskEntries.length} task(s) produced NO result and were dropped: ` +
        droppedTaskEntries.map(d => `${d.phase}:${d.id}`).join(', ') +
        `. Any reviewer approval in this wave covers only the tasks that DID return. Returning to ` +
        `Opus — this is not a completion.`)
    return {
      status: 'needs_opus',
      reason: 'task_dropped',
      dropped_tasks: droppedTaskEntries,
      report,
      blockers: droppedTaskEntries.map(d => ({
        description: `Task ${d.phase}:${d.id} (assigned_to=${d.assigned_to}) returned no result — ` +
          `its agent stalled, threw, or the agentType resolved to nothing.` +
          (d.unknown_agent_type
            ? ` '${d.assigned_to}' is NOT in KNOWN_AGENT_TYPES, so an unresolvable agentType is the likeliest cause.`
            : ''),
        resolution_hint: d.unknown_agent_type
          ? `Confirm an agent definition named '${d.assigned_to}' exists in this deployment's .claude/agents/ (and in ~/.claude/agents/ for the node). If it does, add it to KNOWN_AGENT_TYPES; if it does not, correct the plan's assigned_to. Then re-dispatch this task — do NOT treat the phase as complete.`
          : `Inspect what the task actually wrote (git diff on the run branch), then re-dispatch it or complete it by hand. Do NOT treat the phase as complete on the reviewer's verdict — it never saw this task.`,
      })),
      run_placement: placementFacts(graph),
    }
  }

  // Escalate if any phase's fix-loop exhausted without reviewer approval.
  if (completedWaveResults.some(r => r?.escalate)) {
    log(`Wave ${wave.id}: reviewer escalation unresolved — returning to Opus.`)
    return { status: 'needs_opus', reason: 'reviewer_unresolved', report, run_placement: placementFacts(graph) }
  }

  // HITL gate: if any phase in this wave has pending human-assigned tasks, the wave's
  // agent work + reviewer gates are done, but we cannot advance past a human sign-off
  // inside the workflow (constraint 2 — no mid-run human approval). Bubble up to Opus,
  // which coordinates the human review (future: external task-tracker / intent-tree
  // review request), then relaunches with the HITL tasks marked complete / trimmed.
  const hitlTasks = completedWaveResults.flatMap(r => r?.hitl_gates ?? [])
  if (hitlTasks.length > 0) {
    log(`Wave ${wave.id}: ${hitlTasks.length} human-assigned task(s) require HITL gating — returning to Opus.`)
    return { status: 'needs_opus', reason: 'hitl_required', hitl_tasks: hitlTasks, report, run_placement: placementFacts(graph) }
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
    run_placement: placementFacts(graph),
  }
}

return { status: 'complete', report, run_placement: placementFacts(graph) }
