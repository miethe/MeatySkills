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
 * Post-execution, a Phase 4 Verify gate runs an adversarial claims-vs-code pass over the finished
 * diff (only when the nested engine reported complete). "Green per-phase validators" is necessary
 * but not sufficient — two AARs caught a critical data bug + a refresh gap that survived green
 * per-phase gates. Confirmed critical/high findings downgrade complete → needs_opus/post_verify_failed.
 *
 * Patterns used: two-stage structuring (durability), modeBoundary (gate), sub-workflow
 *   nesting (one level only), adversarialVerify (Phase 4). Per-phase reviewer gating + fix-loops
 *   are delegated to the nested engines — NOT reimplemented here; Phase 4 is the whole-diff pass on top.
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
 *   [x] All reviewer agents use edit-less agentType (nested engines + Phase 4 senior-code-reviewer)
 *   [x] Phase 4 verify skeptics are read-only; they read the diff via git, never EnterWorktree
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
    { title: 'Verify' },
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

// Post-execution claims-vs-code verify (Phase 4). Each skeptic returns this.
// adversarialVerify precedent: workflow-patterns.md §adversarialVerify + explore.js Phase 3.
const VERIFY_FINDINGS_SCHEMA = {
  type: 'object',
  required: ['verified', 'findings'],
  additionalProperties: false,
  properties: {
    // true = the diff faithfully implements the plan's claims with no unresolved defect.
    verified: { type: 'boolean' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'summary'],
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          summary: { type: 'string' },
          claim: { type: 'string' },          // the plan/contract claim this challenges
          code_location: { type: 'string' },  // file:line or symbol the defect lives at
          mismatch: { type: 'string' },        // how the code diverges from the claim / the bug
        },
      },
    },
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

// ─── Mode-D subject matter in the REQUEST (node_01KZC1AHEDYZ8FS9TAZSXQTTSB) ────
// hasHighRiskPaths above reads DECLARED paths, which the planner produces. The leg
// that breached Mode-D on 2026-08-06 declared no crypto path and was routed to an
// offload lane on that clean declaration — then wrote its own HMAC signer, minting
// a key with secrets.token_bytes(32). The subject matter was in the text all along.
//
// Patterns are tight multi-word/technical forms; bare `token` would trip on
// "token bucket", and a noisy boundary is one that gets routed around.
// Kept verbatim-identical to the tables in execute-{plan,contract}.js — workflow
// scripts cannot require() at runtime, so drift shows up as a visible diff.
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

// A Mode-D warning in the text is EVIDENCE of proximity to the boundary, not a
// control over it. A request that has to say "must not mint a signing key" is a
// request about signing keys.
const MODE_D_SELF_WARNING_PATTERNS = [
  /must\s+not\s+(read|generate|print|reference|mint|create)[^.\n]{0,60}\bkey\b/i,
  /\bnever\s+(mint|generate|sign)\b/i,
  /reason:\s*['"]?mode_?d/i,
  /\bneeds_opus\b[^\n]{0,40}\bmode_?d\b/i,
  /\bdo\s+not\s+(sign|mint|generate)\b/i,
]

/**
 * Mode-D subject-matter detector over free text.
 * @param {string} text
 * @returns {string|null} the matching pattern's source, or null.
 */
function hasModeDIntent(text) {
  const t = typeof text === 'string' ? text : ''
  if (!t) return null
  for (const pat of MODE_D_INTENT_PATTERNS) {
    if (pat.test(t)) return `subject matter ${pat}`
  }
  for (const pat of MODE_D_SELF_WARNING_PATTERNS) {
    if (pat.test(t)) return `Mode-D warning present ${pat}`
  }
  return null
}

// ─── implementation-agent roster (domain-grouped) ─────────────────────────────
// Shown to the planner so it assigns a real, domain-appropriate agentType instead of
// defaulting every task to the handful of names that used to be hardcoded inline here
// (python-backend-engineer / ui-engineer-enhanced / data-layer-expert / refactoring-expert),
// which biased every plan toward Python+UI regardless of the actual domain.
//
// Workflow scripts have NO filesystem access, so this roster cannot be globbed at runtime —
// it is a hand-maintained mirror of .claude/agents/. tests/test_workflow_agent_roster.py
// fails if it drifts from the real roster, so it cannot silently rot again.
const IMPLEMENTATION_AGENT_ROSTER = `
     backend/API     python-backend-engineer, backend-architect, backend-typescript-architect,
                     openapi-expert, api-documenter
     data            data-layer-expert
     frontend/UI     ui-engineer-enhanced, ui-engineer, frontend-architect,
                     nextjs-architecture-expert, ui-designer
     quality         refactoring-expert, code-reviewer, senior-code-reviewer
     AI/agents       ai-engineer, ai-artifacts-engineer, prompt-engineer, agent-expert,
                     command-creator, symbols-engineer
     architecture    system-architect, lead-architect, devops-architect
     docs            documentation-writer, documentation-expert, documentation-complex,
                     technical-writer, changelog-generator
     exploration     codebase-explorer, search-specialist
     fallback        general-purpose (only when no specialist fits)`

// ─── file-placement clause (shared, verbatim) ─────────────────────────────────
//
// Autopilot commonly runs inside a git WORKTREE the session entered, so the repo root is
// `.claude/worktrees/autopilot-<slug>/`, not the main checkout. Entering a worktree moves cwd but
// does NOT sandbox absolute paths: a Write to `/…/<repo>/docs/…` lands in the MAIN checkout even
// though the agent's cwd is the worktree — with no error and no warning.
//
// Measured 2026-08-08 (agentic_meta_dev PR #173): the planner's final Write targeted the absolute
// main-checkout path for `docs/project_plans/implementation_plans/features/daily-intent-ritual-v1.md`
// while its cwd was the worktree. The run reported `isolation: worktree` — true for commits, false
// for that file. Days later `git merge --ff-only origin/main` ABORTED on the untracked stray. Worse
// shape available from the same defect: an absolute Write over a TRACKED file lands outside the run
// branch, outside the PR, and outside every gate.
//
// The command spec's §3c warning covers the ORCHESTRATOR's git commands; nothing constrained a
// spawned agent. This clause is that constraint, and it goes in EVERY brief naming an output path.
const RELATIVE_PATH_CLAUSE = `
FILE PLACEMENT — mandatory, and not a style preference:
  - Every path you read or write is REPO-RELATIVE (docs/project_plans/..., src/...). Never an
    absolute path, never a leading '/Users/...' or '~/...', never a '../' that escapes the repo.
  - You may be running inside a git worktree whose root is NOT the main checkout. cwd is already
    the correct repo root; a relative path is therefore always right and an absolute one may
    silently write to a DIFFERENT checkout of this same repo.
  - If you genuinely need the root, derive it at runtime: \`git rev-parse --show-toplevel\`. Do not
    hardcode it, and do not reconstruct it from a path you saw in a brief or in your own context.
  - Report the path you wrote in repo-relative form — the downstream placement guards compare
    against relative paths and cannot reason about an absolute one.`

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
   detail, ending with "Do NOT git add/commit/push/stash." Every task prompt whose work writes a
   file MUST also carry the FILE PLACEMENT clause below verbatim, and every path you put in a task
   prompt or in files_affected MUST be repo-relative — a brief that hands an agent an absolute path
   is how the stray-write defect propagates. Assign each task an appropriate
   implementation agentType whose domain actually matches the work, chosen from this roster
   (these are the ONLY valid values — an unlisted name is silently dropped as a human gate, so
   never invent one):
${IMPLEMENTATION_AGENT_ROSTER}
   Match on the task's domain, not on habit: a docs task goes to a docs agent, an agent/skill
   authoring task to ai-artifacts-engineer, a pure cleanup task to refactoring-expert. Set
   per-phase review_intensity ('standard' default; 'tier3' for core-path/risky phases;
   'council' only if cross-domain architecture review is warranted).
6. WRITE the artifact:
   - Feature Contract → docs/project_plans/feature_contracts/${category}/<slug>.md
   - Implementation Plan → docs/project_plans/implementation_plans/${category}/<slug>-v1.md
   Use the canonical frontmatter + body for that doc_type (see .claude/skills/planning templates).
   Derive <slug> as a short kebab-case name from the request.
${RELATIVE_PATH_CLAUSE}
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
function structurePrompt(planText) {
  // The planner's own report is passed in VERBATIM. Previously this function took no
  // arguments at all (the call site's `parsed` was silently ignored), so the structurer
  // was told "the planner's summary names the path" while never being shown that summary.
  // Its only recourse was the step-1 fallback — "most recently modified file matching the
  // slug" — which twice resolved to an unrelated, already-shipped contract and sent the
  // executor off to rebuild the wrong feature (AARs 2026-08-03, 2026-08-04).
  return `Mode: A — Exploration Only

The autopilot planner just wrote a plan artifact under docs/project_plans/ (a Feature Contract
or an Implementation Plan). Its body contains a fenced \`\`\`json block tagged "autopilot-graph".

Here is the planner's own report, verbatim. It names the exact artifact path it wrote. This is
AUTHORITATIVE — the path you return MUST be the one named here:

<planner-report>
${planText}
</planner-report>

STEPS:
1. Take the artifact path from the planner report above. Do NOT search for it, and do NOT fall
   back to "most recently modified file" — a stale artifact from an earlier, unrelated feature
   is the single failure this stage has actually produced in practice, twice. If the report
   somehow names no path, return single_pass_feasible=false and say so in
   escalation_recommendation rather than guessing.
2. Read THAT artifact and find the fenced "autopilot-graph" JSON block.
3. Return that object EXACTLY as the structured AutopilotPlan, conforming to the schema. Pass
   execution_graph through verbatim. Do not invent or alter values; copy what the planner wrote.
   In particular tier / effort_points / execution_graph must match the artifact — the caller's
   feasibility gate depends on them, so understating tier silently disables it.
4. If you cannot find the artifact or the block, return your best-effort object with
   single_pass_feasible=false and escalation_recommendation explaining the miss.

Do NOT edit any files. Read only. Do NOT git add/commit/push/stash.`
}

// Cheap, deterministic drift check — no filesystem access needed, which matters because
// workflow scripts have none. If the structurer returns an artifact path the planner never
// mentioned, the two stages are describing different features and everything downstream
// (feasibility gate, nested engine, report) is about to be applied to the wrong one.
function planTextClaimsArtifact(planText, artifactPath) {
  if (!planText || typeof artifactPath !== 'string' || !artifactPath.trim()) return false
  if (planText.includes(artifactPath)) return true
  // Tolerate a leading ./ or a repo-root prefix difference; compare on the basename+parent
  // so a cosmetic path spelling does not halt an otherwise-consistent run.
  const tail = artifactPath.split('/').slice(-2).join('/')
  return tail.length > 0 && planText.includes(tail)
}

/**
 * Verify stage (Phase 4 — adversarial claims-vs-code skeptic, edit-less senior-code-reviewer).
 *
 * Runs ONLY after the nested engine returns status:complete. The nested engines already ran a
 * per-phase reviewer + fix-loop ("phase validators green"); this is the whole-diff pass that green
 * per-phase validators demonstrably miss. Codified lesson (workflow-authoring-spec.md): a checklist
 * validator rationalizes real bugs a code-tracing adversarial reviewer catches — and two autopilot
 * AARs (cc-item-display-iteration-v2 + the cascade-revert/refresh-gap run) hit that exact miss.
 *
 * Harness note: the skeptic reads the finished work through git in the CURRENT working tree and
 * never switches trees itself. Background Workflow agents DO inherit a worktree the session has
 * entered (measured on Claude Code 2.1.224, 2026-08-07 — an earlier note here claimed they ignore
 * EnterWorktree, which was wrong), so the current tree is already the run's tree. An agent calling
 * EnterWorktree mid-review would therefore be moving AWAY from the tree under review — still the
 * wrong move, but for the opposite reason. Placement is the orchestrator's job, not the reviewer's.
 * ⚠️ Do not read that measurement as a standing guarantee. A single 2.1.226 report of
 * NON-inheritance was filed and did NOT reproduce — 5 of 6 marker-based probes on that version
 * say inherits (node_01KZGQE6GVJTGXRSHA57FYKNDQ, closed), and the verdict is deliberately NOT
 * cached: placement is decided by the run's probe, never by a recorded result. Either way, do
 * not switch trees from here.
 */
function verifyPrompt(parsed, plan) {
  const artifact = plan.plan_artifact_path || '(the plan/contract artifact written this run)'
  // Pin the diff base when the caller recorded one. The merge-base guess below is correct only
  // while the parent branch holds still; when main moves mid-run it resolves to a phantom range
  // that mixes this run's work with other people's commits, which is how a skeptic came to review
  // a diff that was not the run's diff.
  const baseBlock = parsed.branch_base
    ? `     - This run's pre-run checkpoint is ${parsed.branch_base}. Use it as the base — do NOT
       re-derive one from merge-base, which drifts when the parent branch moves mid-run:
         \`git diff ${parsed.branch_base}..HEAD\`
     - \`git log --oneline ${parsed.branch_base}..HEAD\` to see exactly this run's commits.`
    : `     - \`git log --oneline -20\` to see this run's commits.
     - \`git diff \$(git merge-base HEAD @{upstream} 2>/dev/null || git merge-base HEAD main)..HEAD\`
       to see the full net diff. If that base resolution fails, diff against the earliest commit that
       is clearly part of this run (inspect the log). Read the actual changed files as needed.`
  return `Mode: E — Reviewer (read-only adversarial verify; NO edits, NO git writes)

An autopilot run just reported its nested engine COMPLETE with all per-phase validators green. That
is necessary but NOT sufficient: per-phase checklist validators have repeatedly rationalized real
defects (data-corruption and state-refresh bugs) that only a whole-diff, code-tracing pass catches.
You are that pass. Be adversarial: assume the "green" result is hiding a defect until you prove otherwise.

STEPS:
1. Get the finished work via git IN THE CURRENT WORKING TREE (do NOT call EnterWorktree — this tree
   is already the run's tree, so switching would move you AWAY from the diff under review):
${baseBlock}
2. Read the plan/contract artifact at: ${artifact}
   Extract every concrete CLAIM / acceptance criterion it makes about behavior.
3. Trace each claim to the actual diff. For each, decide: does the code REALLY do what is claimed?
   Prioritize these two recurring failure classes (the ones prior AARs caught):
     (a) DATA-INTEGRITY / STATE-MUTATION bugs — e.g. a revert/undo/cascade that overwrites or wipes
         unrelated rows/fields; a write that clobbers concurrent state; an off-by-one on a batch.
     (b) REFRESH / REFLECTION gaps — the mutation succeeds but the UI, cache, query, or derived state
         is NOT refreshed/invalidated, so the change is invisible or stale to the next read.
   Also flag: claims with no supporting code, error/empty paths left unhandled, and swallowed failures.
4. Return VERIFY_FINDINGS_SCHEMA:
     - verified: true ONLY if you traced the claims and found no critical/high defect.
     - findings: one entry per real defect. Set severity honestly (critical = data loss / correctness
       break / security; high = a claimed behavior is broken or a refresh gap makes it non-functional;
       medium/low = smells worth noting). Include claim, code_location (file:line), and mismatch.
   Do NOT invent findings to look thorough; an empty findings array with verified:true is the right
   answer for a genuinely clean diff.

Request under review:
=== REQUEST ===
${parsed.request}
=== END REQUEST ===

Do NOT edit any files. Read only. Do NOT git add/commit/push/stash.`
}

// ─── verify-gate decision (pure) ──────────────────────────────────────────────
// Conservative bias (correctness over speed): downgrade on ANY confirmed critical, or when ≥2
// independent skeptics each raise a high-severity finding. Returns {failed, findings}.
function evaluateVerify(verdicts) {
  const findings = []
  let anyCritical = false
  let highVoters = 0
  for (const v of verdicts) {
    if (!v || !Array.isArray(v.findings)) continue
    const sevs = v.findings.map(f => f && f.severity)
    if (sevs.includes('critical')) anyCritical = true
    if (sevs.includes('high')) highVoters += 1
    findings.push(...v.findings.filter(Boolean))
  }
  return { failed: anyCritical || highVoters >= 2, findings }
}

// ─── nested-engine arg builders (pure — timestamp threaded from args) ─────────

function nestedBudget(plan) {
  const pts = typeof plan.effort_points === 'number' ? plan.effort_points : 4
  return Math.max(25000, Math.round(pts * 6250))
}

// The branch-placement fields are threaded VERBATIM from args into every nested engine. They were
// the missing link in the 2026-08-05 bypass: autopilot's Opus pre-flight created a run branch and
// recorded a base SHA, then passed neither, so the engines had nothing to check placement against
// and the structurer fell back to a `HEAD~10` guess for its diff base. Omitted when unset, so an
// un-updated caller produces exactly the previous envelope.
function placementArgs(parsed) {
  const out = {}
  if (parsed.run_branch) out.run_branch = parsed.run_branch
  if (parsed.parent_branch) out.parent_branch = parsed.parent_branch
  if (parsed.branch_base) out.branch_base = parsed.branch_base
  if (parsed.parent_tip_at_start) out.parent_tip_at_start = parsed.parent_tip_at_start
  if (parsed.session_repo) out.session_repo = parsed.session_repo
  if (parsed.target_repo) out.target_repo = parsed.target_repo
  return out
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
    ...placementArgs(parsed),
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
    ...placementArgs(parsed),
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

// ── repo-target guard ─────────────────────────────────────────────────────────
// Workflow agents run in the SESSION's cwd. They DO follow the session into a worktree it has
// entered (measured on Claude Code 2.1.224 and again on 2.1.226; decided per-run by the
// placement probe and never cached, node_01KZGQE6GVJTGXRSHA57FYKNDQ) — but only a
// worktree of the SAME repository, so this
// guard is unaffected by the worktree lane. An autopilot request whose work lives in a sibling
// repo still does not fail: every agent runs against the wrong repository and reports success.
// ⚠️ session_repo must be derived from the SHARED git dir
// (basename(dirname(git-common-dir))), not from basename(--show-toplevel): inside a worktree the
// latter is the worktree DIRECTORY name, which would trip this guard against the repo's own name. This is autopilot's own recorded failure (`.claude/worknotes/
// di294-outcome-consolidation/AAR.md` lesson 5 — "Autopilot's scripted lane cannot target a
// sibling repo", where an executor committed to `main` ignoring its worktree and still
// reported `complete`). The script cannot resolve either repo itself (no FS/shell), so Opus
// pre-flight passes both and this compares them. Full rationale + contract: the identical
// guard in execute-plan.js.
// Checked before the dry-run short-circuit: a dry run of a cross-repo request has nothing
// useful to report, and this is the one defect a graph-shape inspection cannot see.
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
      description: `Request declares target_repo '${parsed.target_repo}' but carries no session_repo, so the workflow cannot confirm it is running in the right repository. No agents were spawned.`,
      resolution_hint: 'In Opus pre-flight, resolve `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"` (not `--show-toplevel` — inside a worktree that basename is the worktree directory name, not the repo name) and pass it as session_repo. Do NOT drop target_repo to silence this.',
    }],
    autopilot: { execution_target: 'none', escalation_recommendation: 'Pass session_repo alongside target_repo, or hand-orchestrate in the target repo.' },
  }
}
if (_target && _session && _target !== _session) {
  log(`HALTING — cross_repo_target: plan targets '${parsed.target_repo}' but session is '${parsed.session_repo}'.`)
  return {
    status: 'blocked',
    reason: 'cross_repo_target',
    report: [],
    blockers: [{
      description: `Request targets repo '${parsed.target_repo}' but this session is in '${parsed.session_repo}'. Autopilot's agents always run in the session's cwd (or a worktree of that same repo), so every task would have executed against the wrong repository while reporting success. No agents were spawned. If '${parsed.session_repo}' looks like a WORKTREE DIRECTORY name rather than a repo name, the caller derived session_repo from \`basename "$(git rev-parse --show-toplevel)"\` — use \`basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"\` instead and re-invoke.`,
      resolution_hint: `Start a session in the '${parsed.target_repo}' checkout and re-run there, or hand-orchestrate and verify \`git rev-parse --show-toplevel\` + \`git branch --show-current\` + \`git diff\` yourself at each step (.claude/skills/dev-execution/git-worktree-pr-protocol.md).`,
    }],
    autopilot: { execution_target: 'none', escalation_recommendation: `Cross-repo autopilot is not supported. Re-run from the '${parsed.target_repo}' repo, or hand-orchestrate.` },
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
  plan = await agent(structurePrompt(planText), {
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

// ── Plan-identity gate (deterministic; runs BEFORE the feasibility gate) ─────
// The structurer must be describing the artifact the planner actually wrote. When it is not,
// every field below is about a different feature — and because the feasibility gate reads
// plan.tier / plan.effort_points, a drifted-down tier silently DISABLES that gate too.
//
// This is not hypothetical. It has fired twice in production, both times resolving to an
// unrelated already-shipped contract and dispatching the executor to "re-implement" it:
//   2026-08-03 — plan_artifact_path → enhancements/codex-effort-tier-ingestion.md
//   2026-08-04 — plan_artifact_path → harden-polish/op-story-scan-worktree-sweep-guard.md
//                (planner said tier 3 / 15 pts → would have escalated; structurer said tier 1
//                 / 5 pts → executed the wrong feature and reported 4/4 ACs met)
// Halting here costs one wasted planning stage. Not halting costs a full execution against the
// wrong feature plus a completion report asserting work that was never done.
if (!planTextClaimsArtifact(planText, plan.plan_artifact_path)) {
  log(`HALT: plan-identity mismatch. The structurer returned plan_artifact_path=` +
      `"${plan.plan_artifact_path}", which the planner's own report never names. ` +
      `Refusing to execute against an artifact this run may not have written.`)
  return {
    status: 'needs_opus',
    reason: 'plan_identity_mismatch',
    report: [],
    autopilot: autopilotAnnotation(
      plan,
      'none',
      `Stage-B structurer drifted off the planner's artifact (returned ` +
      `"${plan.plan_artifact_path}", unmentioned by the planner). The planner's own report is ` +
      `trustworthy and the artifact IS on disk — read the planner output, confirm the real path ` +
      `under docs/project_plans/, and either relaunch or execute it directly. Do NOT trust the ` +
      `tier/effort figures in this annotation: they describe the wrong artifact.`,
    ),
  }
}

// ── Feasibility gate (deterministic; authoritative over planner self-assessment) ──
// Order: boundary reasons (mode_d, spike) win over scope; plan_only is evaluated last.
const modeDIntent = hasModeDIntent(parsed.request) || hasModeDIntent(plan.summary)
const modeD = plan.mode_d === true || hasHighRiskPaths(plan.files_affected) || Boolean(modeDIntent)
if (modeD) {
  if (modeDIntent && plan.mode_d !== true && !hasHighRiskPaths(plan.files_affected)) {
    // The planner said this was not Mode D and its declared paths looked clean, but
    // the request itself is about Mode-D subject matter. Prefer the request text:
    // node_01KZC1AHEDYZ8FS9TAZSXQTTSB is the case where clean declarations licensed
    // an offload lane that then wrote its own HMAC signer.
    log(`Mode D detected from the REQUEST TEXT (${modeDIntent}) despite a clean plan self-assessment.`)
  }
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
// Placement provenance is the evidence the §4b post-flight guard reads. Dropping it here would make
// the outer report weaker than the inner one it wraps — and this is the report Opus acts on.
if (childReport.run_placement) result.run_placement = childReport.run_placement
if (childReport.blockers) result.blockers = childReport.blockers

// A nested engine that halted on placement must not be re-interpreted as merely "unfinished".
// Autopilot's §4b guard exists because the workflow used to report `complete` in exactly this
// situation; now that the engine detects it, the outer report must carry the reason through
// verbatim rather than flattening it into a generic escalation.
if (result.reason === 'wrong_branch' || result.reason === 'nothing_on_run_branch') {
  const hint = result.reason === 'wrong_branch'
    ? 'Commits landed off the assigned run branch — locate them with `git branch -a --contains <sha>` and cherry-pick onto the run branch before opening a PR. Do NOT merge from wherever they landed.'
    : 'Nothing was committed to the run branch — treat every past-tense claim in the nested report as unproven, and check `git status --porcelain` plus the reflog before re-running.'
  result.autopilot.escalation_recommendation = hint
  result.autopilot.post_verify = 'not_run_placement_failed'
  log(`Nested engine halted on placement (${result.reason}). Skipping the verify gate — there is no diff on the run branch to verify.`)
}

// ── Phase 4: Verify (post-execution adversarial claims-vs-code gate) ─────────
// Only meaningful when the nested engine reported complete. A non-complete result is already
// Opus's to own, so we leave it untouched. This gate turns "green per-phase" into "green diff".
if (result.status === 'complete') {
  phase('Verify')
  const VERIFY_FLOOR = 40000
  if (budget && budget.total && budget.remaining() < VERIFY_FLOOR) {
    // No silent caps: announce the skip so a buggy-but-green run is not mistaken for verified.
    log(`WARNING: skipping post-workflow verify — budget remaining (${Math.round(budget.remaining() / 1000)}k) below floor (${VERIFY_FLOOR / 1000}k). Opus MUST run an adversarial claims-vs-code pass before merging.`)
    result.autopilot.post_verify = 'skipped_budget'
  } else {
    log('Post-workflow adversarial verify: 2 skeptics tracing plan claims against the finished diff.')
    const verdicts = (await parallel(
      [0, 1].map(i => () =>
        agent(verifyPrompt(parsed, plan), {
          label: `verify-skeptic-${i}`,
          phase: 'Verify',
          agentType: 'senior-code-reviewer',
          model: 'sonnet',
          schema: VERIFY_FINDINGS_SCHEMA,
        })
      )
    )).filter(Boolean)

    if (verdicts.length === 0) {
      // Both skeptics failed to return — treat as unverified, not as a pass.
      log('WARNING: post-workflow verify produced no verdicts — escalating to Opus for manual verification.')
      result.status = 'needs_opus'
      result.reason = 'post_verify_failed'
      result.verify_findings = []
      result.autopilot.post_verify = 'inconclusive'
    } else {
      const { failed, findings } = evaluateVerify(verdicts)
      if (failed) {
        log(`Post-workflow verify FAILED: ${findings.length} finding(s), including confirmed critical/high defects. Downgrading complete → needs_opus.`)
        result.status = 'needs_opus'
        result.reason = 'post_verify_failed'
        result.verify_findings = findings
        result.autopilot.post_verify = 'failed'
      } else {
        log(`Post-workflow verify PASSED (${findings.length} advisory finding(s), none critical/high).`)
        result.verify_findings = findings
        result.autopilot.post_verify = 'passed'
      }
    }
  }
}

log(`Autopilot complete — nested ${plan.execution_target} returned status: ${result.status}.`)
return result
