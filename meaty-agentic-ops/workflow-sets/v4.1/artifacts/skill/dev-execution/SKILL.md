---
name: dev-execution
description: "Unified execution engine for all development workflows. Progressive disclosure for phase execution, quick features, story completion, scaffolding, and plan optimization (risk-classed reviewer-gate selection at the plan/execute boundary). Integrates with artifact-tracking and meatycapture-capture. Use when running /dev:execute-phase, /dev:quick-feature, /dev:implement-story, /dev:complete-user-story, or /dev:create-feature commands."
version: 1.3
app_version: "2026-07-31"
updated: 2026-07-31
---

# Dev Execution Skill

Unified guidance for executing development workflows with token-efficient progressive disclosure.

> **Execution doctrine (Claude-5 generation)**: gate budgets, delta-context dispatch,
> continue-vs-redispatch, the context tripwire, and implementation-notes-over-halt are governed by
> [`references/execution-doctrine.md`](./references/execution-doctrine.md) — cited throughout this
> file, not restated. Applies to runs of new doctrine plans; in-flight plans finish under their own
> rules.

## Quick Start

| Mode | When to Use | Command |
|------|-------------|---------|
| **Workflow (recommended)** | Tier 2/3 plan with `wave_plan`; static phases; active session | `/dev:execute-plan` → workflow path |
| Tier 1 Sprint | Feature Contract approved (3–8 pts); ready for autonomous implementation | `feature-sprint-executor` agent (TBD: `/dev:tier1-sprint`) |
| Phase | Multi-phase plans with YAML tracking | `/dev:execute-phase` |
| Quick | Simple features, single-session | `/dev:quick-feature` |
| Story | User story with existing plan | `/dev:implement-story` |
| Full Story | Complete story end-to-end | `/dev:complete-user-story` |
| Scaffold | New feature structure | `/dev:create-feature` |

## Git Workflow (worktree → PR → squash-merge)

**All orchestrated execution runs in a git worktree, commits per phase, opens a PR to the parent
branch, and squash-merges on approval (or an in-prompt override).** This is the standard for every
mode below — not opt-in. Canonical spec: [`./git-worktree-pr-protocol.md`](./git-worktree-pr-protocol.md).

- Set up `.claude/worktrees/<slug>` at run start; record the **parent branch** (where HEAD was) as
  the PR base and squash-merge target. Don't just `git checkout -b` in place.
- Commit per phase / logical unit. **Single committer** = the orchestrator/phase-owner; offloaded
  executors and nested helpers never touch git.
- Open the PR to the **parent branch** (usually `main`, but the feature branch for stacked work).
- **Squash-merge is approval-gated** — open the PR and stop, unless the originating prompt overrode it
  ("auto-merge", "merge when done", "land it", …). Then `gh pr merge --squash --delete-branch` and
  record `merge_commit`/`merge_branch`.

## Model Routing

Model × provider × effort is governed by [`MODEL-ROUTING.md`](../../../docs/agentic-operator/MODEL-ROUTING.md).
For execution: **Opus 5** (`claude-opus-5`) = spine/architecture/adjudication (flagship as of 2026-07-24; Opus 4.8 now legacy); **Sonnet 5** (`claude-sonnet-5`) =
default subscription implementation tier (`xhigh` effort for the hardest coding/agentic work);
**Haiku 4.5** = mechanical/classify. **Offload by default when feasible** — bounded, contract-clear
waves go to **ICA Sonnet 5** (`claude-sonnet-5[1m]`, free-to-us shared pool — ICA now serves Sonnet 5
since 2026-07-08; 4.6 = older fallback) behind the reviewer gate, or to **Codex `gpt-5.6-terra`** (or
`gpt-5.6-sol` for the hardest, `gpt-5.6-luna` for cheap) for AC-validation/review — but **never** offload
MUST-stay-primary / Mode-D / Claude-Code-native-orchestration work. Set per-phase `model`/`effort` in
`wave_plan.phases[]`; the subscription-side default when unset is Sonnet 5. Model IDs use the
registry short form (`opus-5`, `sonnet-5`, `fable-5`).

## Execution Model Routing

### execute-plan / execute-contract (Tier 2/3)

The execution model for full Tier 2/3 plans is **workflow** (`.claude/workflows/execute-plan.js`) once the Phase-1 pilot is validated. Until then, both models are available; the workflow is the recommended route for new runs.

| Model | When to use | Status |
|---|---|---|
| **`workflow`** | Plan has `wave_plan.waves`, all phases `phase_strategy: static`, active session | **Recommended** (default once piloted) |
| `sequential` | No `wave_plan`; fall back to one-wave-per-phase phase-owner dispatch | Fallback — documented, retained |
| `adaptive` (agentType:'phase-owner') | Phase has `phase_strategy: adaptive`; task list cannot be enumerated up-front | Narrow fallback — retained |

> **Cutover is pilot-gated.** The `workflow` model becomes the hard default only after the Phase-1
> execute-plan pilot passes its A/B gate (tokens ≤ manual baseline; quality ≥; wall-clock improved).
> Pilots are deferred to the user. Until that decision, `sequential`/`adaptive` remain fully supported
> fallback paths.
>
> Reference: `.claude/plans/workflow-orchestration-integration-v1.md` §7 (Phase 6 row + Phase 1 gate)
> and §9 (retirement risk/mitigation).

### Nesting as a within-workflow decomposition tool (pilot)

The `adaptive` path's `phase-owner` agentType MAY nest its own implementers via the `Agent` tool,
gated by the opt-in, default-OFF `phase_owner_nesting_enabled` args flag on the `execute-plan`
workflow. This is a pilot capability; it is not auto-promoted.

**Nesting is for decomposition, not throughput.** A single nested `Agent` call blocks until the
child returns; batched nested spawns get ungoverned concurrency (no `parallel()` cap+queue). Keep
governed parallelism at the workflow `parallel()`/`pipeline()` level. Use nesting only when the
phase-owner cannot enumerate its sub-tasks up front and needs runtime judgment to break down its
slice.

**Hard rules** (full rationale in `.claude/specs/subagent-nesting-spec.md`; do not re-derive here):

| Rule | Summary |
|---|---|
| Depth cap | Max 1 level of nesting below the phase-owner (phase-owner → helper; no deeper). |
| Bounded helpers | Nested helpers must be bounded — < ~40 tool uses per level. |
| Single committer | The phase-owner is the **only** committer. Children never `git add/commit/push/stash`. |
| Mode-D at depth | Nested agents are prohibited from auth/payments/migrations/deletion/force-push/secret-rotation. On hitting Mode-D territory: STOP and bubble `{needs_opus, mode_d}` up the chain unchanged until Opus handles it interactively. |
| Claude-primary only | Nesting runs on the primary subscription only. Router-offloaded executors (`ica-executor`, `codex-executor`, `gemini-executor`) never nest. |

**Durability caveat.** The workflow caches the phase-owner's FINAL result only. A mid-nest blow-up
re-runs the entire phase — there is no partial-subtree resume. Keep nests shallow.

Canonical rules: `.claude/specs/subagent-nesting-spec.md`.

## Execution Modes

Load only the mode-specific content you need:

| Mode | Guide | When to Load |
|------|-------|--------------|
| [Workflow Execution](#execution-model-routing) | Tier 2/3 plans via `.claude/workflows/execute-plan.js`; see `/dev:execute-plan` §"Workflow Path" |
| [Tier 1 Autonomous Sprint](#tier-1-autonomous-sprint) | Approved Feature Contract (3–8 pts); single autonomous sprint |
| [Phase Execution](./modes/phase-execution.md) | Multi-phase YAML-driven work with batch delegation |
| [Quick Execution](./modes/quick-execution.md) | Simple single-session features (~1-3 files) |
| [Story Execution](./modes/story-execution.md) | User story implementation with plan |
| [Scaffold Execution](./modes/scaffold-execution.md) | New feature structure creation |
| [Plan Optimization](./modes/plan-optimization.md) | **Pre-dispatch** pass at the plan/execute boundary — risk-classes each phase and emits a per-phase reviewer-gate plan (`gate_lens`/`gate_shared_with`), duplicate-lens report, defect checklist, pre-gate sweep, and cost/inversion projection before the first implementer runs |

## Tier 1 Autonomous Sprint

Use this mode when a Feature Contract has been approved for a Tier 1 feature (3–8 pts). It replaces phase-by-phase batch orchestration with a single autonomous sprint followed by a mandatory reviewer gate.

**Reference**: Overhaul plan §4.4 and §4.5.

### When to Use

- A Feature Contract (`doc_type: feature_contract`) exists at `docs/project_plans/feature_contracts/[slug].md`.
- Contract status is `approved`.
- Estimated points are in the 3–8 range.
- Feature does not touch auth, payments, production migrations, or multi-tenant data boundaries (those require Mode D; escalate to Opus).

Do NOT use for Tier 0 (use `/dev:quick-feature`) or Tier 2/3 (use Phase Execution).

### Driver Agent

`feature-sprint-executor` — sonnet, `acceptEdits`, operates under **Mode C: Autonomous Feature Sprint**. See `.claude/agents/dev/feature-sprint-executor.md`.

### Inputs to Provide

| Input | Required | Notes |
|---|---|---|
| Feature Contract path | Yes | Full path to the `.md` contract file |
| Budget hint | Optional | Default ~50K tokens; alert Opus if exceeded |
| Relevant codebase context paths | Recommended | Key router, model, or component files relevant to the contract |

### Sprint Flow

```
1. Opus delegates the full contract to feature-sprint-executor
   Task("feature-sprint-executor", "Mode C: Autonomous Feature Sprint.
        Contract: docs/project_plans/feature_contracts/[slug].md
        Budget: ~50K tokens
        Context paths: [relevant files]")

2. Sprint runs autonomously (no Opus intervention unless blocker escalated):
   explore → implement → tests → validation → Completion Report

3. Mandatory reviewer pass (Mode E):
   Task("task-completion-validator", "Mode E: Reviewer.
        Review sprint output against Feature Contract AC.
        Contract: [path]  Diff: [branch or commit range]
        Completion Report: appended to contract")

4. If reviewer approves → Opus commits and closes contract.
   If reviewer finds issues → feature-sprint-executor fixes in the SAME session (continue, don't
   re-dispatch — cache-warm, context-live). Gate budget: max 2 re-passes on this scope x lens; the
   3rd failure auto-escalates to re-scope/redesign, not to "Opus looks at it" (execution-doctrine.md
   rule 1). Re-passes count per scope x lens, not per dispatch — re-spawning the executor does not
   reset the budget. The reviewer pass itself stays fresh-context per re-pass (rule 3) — it is the
   executor's session that continues, never the verifier's.
```

### Exit Criteria

> **This Completion Report is a different artifact from the retired plan-level one.** Tier 2/3
> execution's plan-level Completion Report (`.claude/worknotes/<slug>/completion-report.md`) is
> **retired** — the reviewer verdict + `commit_refs` is the record (execution-doctrine.md, Bookkeeping
> demotions). The Tier 1 sprint's **contract-appended** Completion Report below **survives**: Tier 1
> has no wave/phase record to fall back on, so the AC-by-AC narrative stays appended to the contract
> file itself, not in a separate worknotes file.

All of the following must hold before Opus commits:

- [ ] All contract Acceptance Criteria marked met in Completion Report.
- [ ] `task-completion-validator` review passes (no required fixes outstanding).
- [ ] All validation commands run and pass (pytest / pnpm test + type-check + lint as applicable).
- [ ] Completion Report appended to contract file (the sole location — the separate `.claude/worknotes/[slug]/completion-report.md` plan-level pattern is retired).
- [ ] Contract frontmatter updated: `status: completed`, `files_affected`, `commit_refs` (work-history SHAs, appended after each commit).
- [ ] After merge to destination branch: `merge_commit` set to the post-squash SHA and `merge_branch` set (typically `main`). This is the canonical landing pointer — required for direct squash-merges (no PR) so the orphaned branch SHAs in `commit_refs` remain resolvable in retrospect.

### Delegation Example

```python
# Step 1: Delegate sprint
Task("feature-sprint-executor",
     "Mode C: Autonomous Feature Sprint.\n"
     "Contract: docs/project_plans/feature_contracts/artifact-tag-bulk-edit.md\n"
     "Budget: ~50K tokens\n"
     "Context: skillmeat/api/routers/artifacts.py, skillmeat/web/components/entity/artifact-card.tsx")

# Step 2 (after sprint): Mandatory reviewer
Task("task-completion-validator",
     "Mode E: Reviewer.\n"
     "Contract: docs/project_plans/feature_contracts/artifact-tag-bulk-edit.md\n"
     "Completion Report: appended to contract\n"
     "Review the diff on branch feat/artifact-tag-bulk-edit against all Acceptance Criteria.")

# Step 3: Opus commits if review passes
```

---

## Token Discipline

Token efficiency is a first-order constraint across all execution modes. These rules codify existing practice; violations compound quickly across multi-session work.

**Cross-reference**: `.claude/rules/context-budget.md` (authoritative; this section is the execution-skill pointer).

### Core Rules

1. **Task prompts < 500 words.** Provide file paths and contract paths, not file contents. Subagents read files themselves.
2. **Provide paths, not contents.** Never paste file contents into a Task() prompt. Reference patterns by path: "follow pattern in `path/to/example.tsx`".
3. **Don't read files you're about to delegate.** Let the delegated agent own its own exploration. Opus reads files only when a planning decision requires understanding current state before delegation.
4. **No `TaskOutput()` for file-writing agents.** These agents write to disk; verify on disk with Glob or `tsc --noEmit` instead (~7.5K tokens saved per call avoided).
5. **Scope Glob with `path`.** Unscopied Glob hits `node_modules` and returns thousands of irrelevant tokens.
6. **Feature Contract is the delta.** Architecture context lives in durable docs (`CLAUDE.md`, `intents/intent.md`, `docs/current-state.md`, `docs/dev/architecture/*`). Don't restate architecture in prompts — link to those files.
7. **Progressive disclosure.** Load context in layers: contract → relevant file paths → deep context only when blocked. Don't pre-load full implementation files for exploratory work.

### Budget Targets

| Phase | Target |
|---|---|
| Orchestration context (system + CLAUDE.md + skills) | ~52K baseline |
| Available for work in 200K context | ~148K |
| Per execution phase (Tier 2/3) | ~25–30K |
| Tier 1 sprint total (all in) | ≤80K |

### Context tripwire

Above **150% context utilization in one session**, split or summarize-forward **before continuing**
— this is a live execution signal an executor watches for during the run, not a post-hoc AAR
observation (execution-doctrine.md rule 4). Carrying on past the tripwire is how a fix loop becomes a
retry storm. Honesty check: the live CCDash `context_ballooning` signal is a **follow-up**, not
today's mechanism — today this is an executor-observed check the agent applies to itself, not an
automated gate.

---

## Mandatory Reviewer Gates

Reviewer passes are non-optional at tier-appropriate checkpoints. A phase, sprint, or feature is **not complete** until the applicable reviewer approves. **What is mandatory is that a gate fires — not that a fixed set of lenses fires at it.** The lens count is risk-tiered.

**Full gate matrix (base gate + the three second-lens triggers)**: `./validation/completion-criteria.md`

Summary — the base gate, **one lens, every tier**:

| Tier | Gate | Reviewer |
|------|------|----------|
| 0 | End of the change | `task-completion-validator` |
| 1 | End of sprint | `task-completion-validator` |
| 2 | End of each phase | `task-completion-validator` |
| 2 | End of feature | `karen` (final tree, once) |
| 3 | End of each phase | `task-completion-validator` |
| 3 | End of feature | `karen` (final tree, once) |
| 3 | Plan-milestone boundary — **`context_class` C3/C4 only** | `karen` |

**The ordinary shape is: implement → tests → one review → ship.** For CRUD, UI, reporting, read paths
and mechanical refactors, that table is the *entire* gate structure — no pre-gate, no second lens, no
per-phase `karen`.

A **second** lens (`security`, via `council-review`) is added to a phase only when it matches one of
three triggers: the surface **parses untrusted input**, **is an authorization/identity boundary**, or
its effect is **irreversible or leaves the system**. Nothing else adds a lens — **tier does not**, and
neither do the reviewers themselves (`karen` and `task-completion-validator` return verdicts; they do
not dispatch follow-on reviewers). Recorded per phase as `gate_lens` + `gate_lens_reason`; a two-lens
phase with no named trigger is a classification error. Once a trigger assigns the `security` lens it is
**never removable**. Ruleset: `references/gate-risk-classes.md` §2.

Do not commit or mark a phase/feature complete without a passing reviewer verdict. **Gate budget: max
2 re-passes per scope x lens.** The original executor addresses required fixes by continuing its
existing session — not a fresh re-dispatch, so the fix-relevant context stays cache-warm (see
"Continue, don't re-dispatch" below). The 3rd failure against the same lens does **not** escalate to
"a human/Opus looks at it" — it **auto-escalates to re-scope/redesign**: three failures is evidence
the scope is wrong, not that the fix was sloppy. Re-passes count per **scope x lens**, not per
dispatch — re-spawning the executor never resets the budget.

**Same-class stop rule (hard).** Two consecutive rounds surfacing the **same defect class** ⇒ the next
action is a **design change, not a third review** — even with a re-pass left. Label each round's defect
class as you go, or you cannot apply this. What the design change is:
`references/gate-risk-classes.md` §3b. Full rationale for both rules:
`references/execution-doctrine.md` rule 1.

**Continue, don't re-dispatch; reserve fresh context for verification.** Fix loops continue the
existing executor session — it is cache-warm and already holds the context the fix depends on. Fresh
context belongs on the **verifier**: a fresh-context reviewer outperforms self-critique, and an
inherited-context validator rubber-stamps. Today's default in most of this engine is the exact
inverse (implementers get re-spawned per fix cycle, validators inherit stale context across
re-passes) — invert it: keep the implementer's session alive across fix cycles, and dispatch each
reviewer re-pass with fresh context on the delta below. Doctrine: `references/execution-doctrine.md`
rule 3.

**Delta context, not the full stack.** A gate dispatch — including every re-pass — carries the
**delta**: the failure summary, the touched files, and the acceptance criterion actually in question.
It never carries the full plan, the cumulative diff, or the progress file. A reviewer that needs the
whole plan to judge one AC is a signal the AC itself is under-specified — fix the AC, don't widen the
packet. Doctrine: `references/execution-doctrine.md` rule 2.

**Which lens(es) per phase — the plan-optimization pass.** The table above is the tier-default *floor*.
For a Tier 2/3 plan with a `wave_plan`, run the [Plan Optimization](./modes/plan-optimization.md) pass
once at the plan/execute boundary (before the graph is built) to choose per-phase reviewer lenses by
**risk class** rather than uniformly — it writes advisory `gate_lens`/`gate_shared_with` keys onto each
phase, front-loads a defect checklist into implementer prompts, inserts a cheap pre-gate before each
expensive security lens, and flags any phase whose projected review cost exceeds its implementation
cost. It **never** removes the only lens a phase's risk class requires — it collapses *duplicate*
coverage, never *distinct* coverage. Ruleset: [`references/gate-risk-classes.md`](./references/gate-risk-classes.md).

---

## Core Principles

### 1. Delegate Everything

- **Opus orchestrates; subagents execute**
- Never write implementation code directly
- Use batch delegation for parallel work
- Reference @CLAUDE.md for agent assignments

### 2. Token Efficiency

- Load only mode-specific content when needed
- Use YAML head extraction for large files
- Request-log operations via `/mc` (token-efficient)
- Read progress YAML only (~2KB), not full files (~25KB)

### 3. Quality Gates

All modes share these gates - run after each significant change:

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Detailed gate requirements: [./validation/quality-gates.md]

### 4. Implementation Notes Over Halt-and-Gate

Executors **log deviations and keep going**, rather than stopping the run to ask. A conservative
choice, an assumption, or a discovered constraint gets a dated entry (choice + rationale) in
`.claude/worknotes/<slug>/implementation-notes.md`; these are reviewed at the **milestone boundary**,
not chased mid-run. Mid-milestone halts are reserved for exactly three cases:

1. a **destructive** action (deletion, force-push, migration, secret rotation),
2. a **real scope change** (the work is not what the plan describes), or
3. **input only the operator has**.

Everything else is a note, not a stop. **Mode-D boundaries are unchanged and non-negotiable** — auth,
payments, billing, schema migrations, data deletion, secret rotation, infrastructure still halt and
bubble to Opus exactly as today (see the Nesting "Mode-D at depth" rule above and "When NOT To Use"
below). This section governs judgment-call deviations inside an already-authorized scope; it does not
loosen Mode-D in any way. Doctrine: `references/execution-doctrine.md` "Implementation notes over
halt-and-gate".

## Agent Assignment Quick Reference

| Task Type | Agent |
|-----------|-------|
| Find files/patterns | codebase-explorer |
| Deep analysis | explore |
| React/UI components | ui-engineer-enhanced |
| TypeScript backend | backend-typescript-architect |
| Deep debugging | ultrathink-debugger |
| Validation/review | task-completion-validator |
| Most docs (90%) | documentation-writer |

For detailed assignments: [./orchestration/agent-assignments.md]

## Orchestration References

| Reference | Purpose |
|-----------|---------|
| [Batch Delegation](./orchestration/batch-delegation.md) | Parallel Task() patterns and execution |
| [Parallel Patterns](./orchestration/parallel-patterns.md) | Dependency-aware batching strategy |
| [Agent Assignments](./orchestration/agent-assignments.md) | Complete agent selection guide |

## Validation References

| Reference | Purpose |
|-----------|---------|
| [Quality Gates](./validation/quality-gates.md) | Test, lint, typecheck requirements |
| [Visual Fidelity](./validation/visual-fidelity.md) | Sketch/mockup-faithful UI gate: capture → crop → adjudicate (when `ui_touched` + a visual reference exists) |
| [Milestone Checks](./validation/milestone-checks.md) | Phase completion criteria |
| [Completion Criteria](./validation/completion-criteria.md) | Story/feature done definition |

## Skill Integrations

### artifact-tracking

For phase execution, use artifact-tracking skill for:

- CREATE progress files for new phases
- UPDATE task status after completion
- QUERY pending/blocked tasks
- ORCHESTRATE batch delegation

Integration patterns: [./integrations/artifact-tracking.md]

### IntentTree SDLC Sync (AWPR v2 — FR-11) — ON BY DEFAULT

The execution flow re-runs `itt sync import <file> --apply --tree <tree>` at status hook points to
propagate task/phase status to bound IntentTree nodes. **This is on by default** (AOS
integration-remediation P1.2 — integration must be automatic, not opt-in prose that decays). It is
disabled only when `INTENTTREE_SDLC_SYNC` is explicitly falsy (`0`/`false`/`no`/`off`), and is a
**silent no-op when there is no binding** (no `ITT_NODE_ID`/`INTENTTREE_TREE` and no `intenttree_tree`
frontmatter) — so default-on never becomes noise in repos with no IntentTree presence. Targets the
node under the standing `aos-target set node` default. Gate + env resolution are defined once in
**`.claude/rules/intenttree-integration.md`**.

**Demoted frequency (execution-doctrine.md, Bookkeeping demotions):** the task-start lookup/claim/
status-sync 3-step was measured as pure overhead at task granularity; it now fires **once per
milestone** rather than at every task start. Task-done and phase-done syncs are real value at their
existing granularity and stay unchanged.

| Hook point | Location | What syncs |
|---|---|---|
| Milestone start | phase-execution.md §2.3a | progress file → task node lookup/claim/status-sync, **once per plan milestone** (demoted from every task start) |
| Task done | phase-execution.md §2.5a | progress file → task node set to `completed` |
| Phase done | phase-execution.md §5.2a | progress file → phase node set to `completed` |
| Inter-wave merge | plan-execution.md §3c-sync | all wave progress files; plan file at end |
| **Post-merge (evidence)** | git-worktree-pr-protocol.md §6, right after the landing pointer | plan frontmatter `commit_refs`/`pr_refs` + the merge SHA → typed `ExternalLink(github)` + `CompletionEvidence(delivery_class=shipped)` rows on the bound node — `hooks/post-merge-evidence.sh`, env `AOS_POST_MERGE_EVIDENCE` |

**Non-fatal contract**: offline / CLI-missing / no-binding / non-zero exit → log warning and continue.
Never blocks execution. All sync calls are idempotent (re-running unchanged source is a no-op).

**Thin hook script**: `.claude/skills/dev-execution/hooks/sdlc-sync.sh` — owns the default-on gate,
the binding check, and the non-fatal contract (always exits 0). Set `INTENTTREE_TREE=<tree-id>` or
let the CLI infer from artifact frontmatter.

**References**:
- Contract: `docs/project_plans/implementation_plans/awpr-v2-task-node-contract.md`
- CLI: `client/src/intenttree_client/cli/commands/sync_cmd.py`
- P0 contract task: TASK-6.2 (FR-11)
- Planning skill pattern: `.claude/skills/planning/SKILL.md` §10 (analogous planning-time sync)

### SkillMeat Look-First (executor/phase-owner contract) — instruct-only, not gated here

**Before building a new skill/agent/context/workflow artifact**, the executor/phase-owner MUST
check for an existing SkillMeat entry (`skillmeat list --type <type>` / `skillmeat show <name>`
against the enterprise endpoint) and **reuse or extend it rather than duplicate it**. This is
**look-first (D2: instruct-only, never mechanically gated)** — an agent judgment call the executor
makes before spending build effort, exactly the same posture as the MeatyWiki/SkillMeat checks in
`.claude/skills/planning/SKILL.md`'s "Before You Scope" section (the planning-time analog).

This instruction is **not the enforced check**. The **save-after** side — did the new artifact
actually land in SkillMeat enterprise — is a real reviewer gate: see the "AOS Writeback DoD"
(SkillMeat row) in [`./validation/completion-criteria.md`](./validation/completion-criteria.md) and
the [`verify-skillmeat-writeback.sh`](./hooks/verify-skillmeat-writeback.sh) hook it runs. Do not
duplicate that gate here — this section is instruction only; the DoD is where it's enforced.

### Pre-Execution Artifact Provisioning — ON BY DEFAULT, mechanically gated

Complementary to look-first above, but the opposite direction: **look-first is reuse-before-BUILD**
(an instruct-only judgment call the executor makes before spending build effort on a *new*
artifact); **provisioning is present-before-RUN** (a mechanically enforced gate that makes sure
every artifact a plan/phase *already declares it needs* is actually deployed into the repo before
execution starts). Look-first stops duplicate builds; provisioning stops a wave from discovering
mid-run that a skill/agent/command/context/MCP/workflow it depends on was never deployed.

The gate runs `provision-artifacts.sh` **before the execution graph or task list is built** — i.e.
before Opus pre-flight assembles the `ExecutionGraph` (execute-plan) or the wave/batch loop starts
(phase-execution, plan-execution). It is **on by default** (mirrors `INTENTTREE_SDLC_SYNC`'s
default-on posture) and resolves two sources of need: the per-project manifest
(`.claude/aos-artifacts.yaml`) and the plan's own `required_artifacts` frontmatter. It composes only
existing SkillMeat CLI primitives (`show`/`deploy`/`undeploy`) — no new provisioning intelligence.

```bash
PROVISION_PLAN_FILE="<plan-path>" PROVISION_SCOPE="plan:<slug>" \
    .claude/skills/dev-execution/hooks/provision-artifacts.sh
```

**Contract** (mirrors `sdlc-sync.sh`'s non-fatal discipline, with one deliberate exception):

- **Default-on**: only an explicit falsy `AOS_ARTIFACT_PROVISION` (`0`/`false`/`no`/`off`) disables it.
- **Silent no-op with no binding**: no manifest AND no plan `required_artifacts` → exit 0, zero calls.
- **Non-fatal on infra**: CLI missing, SkillMeat unreachable, engine crash → logged warning, exit 0.
  A provisioning-infra failure never blocks a run — same posture as the IntentTree sync hooks.
- **Correctness hard-gate (the one exception)**: a NEEDED artifact that is unsatisfiable anywhere
  (not in the manifest, not in the SkillMeat catalog) — or any gap surfaced under `sign-off`/`off`
  mode or `PROVISION_CHECK=1` — is a real halt: the engine exits 2 and the orchestrator stops before
  spending execution budget on a run it cannot complete.

At end-of-plan/feature, run the same gate in **teardown** mode to undeploy plan-scoped ephemerals
(artifacts marked `lifecycle: ephemeral` and `scope: plan:<slug>` in the manifest, unless also
referenced elsewhere as `permanent`):

```bash
PROVISION_TEARDOWN=1 PROVISION_SCOPE="plan:<slug>" \
    .claude/skills/dev-execution/hooks/provision-artifacts.sh
```

**Wiring**: see phase-execution.md and plan-execution.md pre-flight sub-steps, and the
provisioning-gate row in the three `/dev:execute-*` command pre-flight sections. **Manifest schema +
rule**: `.claude/rules/artifact-provisioning.md` (mirrors `intenttree-integration.md`'s
gate/env/non-fatal structure); canonical manifest exemplar `templates/aos-artifacts.yaml.tmpl`;
`required_artifacts` frontmatter field: `.claude/skills/planning/references/plan-frontmatter-schema.md` §5.7.

### Bundle drift check (warn-only, ON BY DEFAULT)

Provisioning answers *"is the artifact deployed?"*. It does not answer *"is the deployed copy the
same as its upstream?"* — and a per-project copy is a **derived** copy that goes stale silently.
`bundle-drift-check.sh` closes that gap. Run it alongside the provisioning gate at the same
pre-flight moment:

```bash
DRIFT_PROJECT="." DRIFT_REGISTRY="<launchpad>/docs/ARTIFACT-UPSTREAM-REGISTRY.md" \
DRIFT_SCOPE="plan:<slug>" \
    .claude/skills/dev-execution/hooks/bundle-drift-check.sh
```

**Contract**: default-on (`AOS_BUNDLE_DRIFT_CHECK`, only an explicit falsy value disables);
**always exits 0** — it never blocks a run; resolves each deployed skill to its canonical upstream
via the registry table and reports `IN-SYNC | DRIFTED | MISSING-UPSTREAM | UNMAPPED`.

The column that matters most is **`global-resolution`**: `SYMLINK (always-current)` vs
`COPY (can drift)` vs `ABSENT`. The hazard this hook exists for is not staleness but *split-brain
resolution* — one session resolving `dev-execution` through an always-current global symlink while
`artifact-tracking` resolves to a stale project-local copy, invisible unless a human reads the
"Base directory for this skill" line each skill prints on load.

Policy + decision record: `docs/bundle-currency-policy.md`. `.claude/bundle-manifest.toml` is
**provenance of the last full deploy, not truth** — this hook is the live signal.

### Plan status-hygiene hooks (DI-135) — opt-in

The IntentTree plan-lens reads `status`/`planning_maturity` from **plan-file frontmatter** (markdown
is canonical). When a phase or feature ships, keep that frontmatter current so the lens does not show
stale `not_started`/`in_progress` on completed work. Two opt-in, comment-preserving, dry-run-by-default
hooks live in `.claude/skills/dev-execution/scripts/`:

| Hook | What it does | Invocation |
|---|---|---|
| `complete-phase.py` | Rewrites plan `status` → `completed` and `planning_maturity` → `shipped` (idempotent no-op if already current) | `python .claude/skills/dev-execution/scripts/complete-phase.py <plan.md> [--apply]` |
| `complete-task.py` | Updates one task's `status` inside a frontmatter `tasks:` list (preserves indentation/comments) | `python .claude/skills/dev-execution/scripts/complete-task.py <file> --task <id> --status completed [--apply]` |

**Contract**: opt-in (no silent background mutation — dry-run is the default; you must pass `--apply`).
For `.claude/progress/*` task completion, `update-status.py` (artifact-tracking) remains canonical —
it enforces the completion gate (timestamps/evidence); `complete-task.py` is the lighter companion for
keeping a plan-file `tasks[]` status current. After `--apply`, re-running `intenttree_capture.py
--apply` propagates the new status to the bound node with no agent involvement (DI-135 closed at source).

### meatycapture-capture

For request-log operations during any execution mode:

- **Capture new issues**: Use `mc-quick.sh` (~50 tokens vs ~200+ for JSON)
- **Update status**: `meatycapture log item update DOC ITEM --status done`
- **Add notes**: `meatycapture log note add DOC ITEM -c "text"`
- **Search logs**: `meatycapture log search "query" PROJECT`

**Quick capture script**:
```bash
mc-quick.sh bug api validation "Issue title" "What's wrong" "Expected behavior"
```

**Script location**: `.claude/skills/meatycapture-capture/scripts/mc-quick.sh`

Integration patterns: [./integrations/request-log-workflow.md]

## Common Patterns

### Start Work on Logged Item

```bash
# Mark item in-progress
meatycapture log item update DOC.md ITEM-01 --status in-progress

# Execute work via appropriate agents...

# Mark complete with note
meatycapture log item update DOC.md ITEM-01 --status done
meatycapture log note add DOC.md ITEM-01 -c "Completed in PR #123"
```

### Phase Execution with Artifact Tracking

```bash
# 1. Read progress YAML (token-efficient)
head -100 ${progress_file} | sed -n '/^---$/,/^---$/p'

# 2. Identify batch from parallelization field

# 3. Delegate batch (parallel Task() calls in single message)
Task("ui-engineer-enhanced", "TASK-1.1: ...")
Task("backend-typescript-architect", "TASK-1.2: ...")

# 4. Update artifact tracking
Task("artifact-tracker", "Update phase N: Mark TASK-1.1, TASK-1.2 complete")

# 5. Update request-log if applicable
meatycapture log item update REQ-*.md REQ-ITEM --status done
```

**Tier 2/3 batch autonomy (per overhaul §4.6)**: Agents have wider autonomy *within* their batch. For a given file-owner boundary, combine "implement X" and "add tests for X" into one task — don't split them into separate sequential delegations. The executor has full context in one session and produces better-integrated output. File-ownership-first batching (one agent per file, no parallel edits to the same file) remains the hard parallel-safety rule and is unchanged.

### Quick Feature Flow

```bash
# 1. Resolve input (REQ-ID, file path, or text)
# 2. codebase-explorer for pattern discovery
# 3. Create lightweight plan
# 4. Delegate to agents
# 5. Quality gates: pnpm test && pnpm typecheck && pnpm lint
# 6. Update request-log if from REQ-ID
```

## Error Recovery

This section is for genuine blockers — the run cannot proceed at all. A conservative choice or an
assumption that does *not* block progress is an implementation note, not a blocker: see "Core
Principles → 4. Implementation Notes Over Halt-and-Gate" above; only destructive actions, real scope
changes, or operator-only input warrant a mid-run stop.

When blocked on any task:

1. **Document** the blocker in progress tracker
2. **Attempt** standard recovery (see mode-specific guidance)
3. **If unrecoverable**: Stop, report to user with clear next steps
4. **Track** issue in request-log if it warrants separate tracking:
   ```bash
   MC_STATUS=blocked mc-quick.sh bug [DOMAIN] [COMPONENT] "Blocked: [title]" "[What's blocking]" "[What's needed]"
   ```

## Architecture Compliance

All implementations must follow the project's established patterns. Check `CLAUDE.md` for project-specific conventions.

### General Principles

- **Follow existing patterns**: Match conventions already in the codebase
- **Separation of concerns**: Keep layers distinct (API, business logic, data access)
- **Type safety**: Use TypeScript/Python types; avoid `any` or untyped code
- **Error handling**: Consistent error responses and proper exception handling
- **Observability**: Logging, metrics, and tracing where appropriate

### Backend Standards

- **Layered architecture**: Controllers/routers → services → repositories → data store
- **DTOs/schemas**: Separate API contracts from internal models
- **Validation**: Input validation at API boundaries
- **Pagination**: Use cursor or offset pagination for list endpoints
- **Documentation**: OpenAPI/Swagger specs for APIs

### Frontend Standards

- **Component library**: Use project's designated UI library consistently
- **State management**: Follow project's chosen pattern (React Query, Redux, etc.)
- **Error boundaries**: Graceful error handling in UI
- **Loading states**: Proper feedback during async operations
- **Accessibility**: WCAG compliance, keyboard navigation, ARIA labels
- **Responsive design**: Support required viewport sizes

### Testing Standards

- **Unit tests**: Business logic and utility functions
- **Integration tests**: API endpoints and service interactions
- **E2E tests**: Critical user flows
- **Accessibility tests**: Automated a11y checks for UI
- **Coverage**: Meet project's minimum coverage requirements

## Phase Completion Definition

A phase is **ONLY** complete when:

1. All tasks in plan completed
2. All success criteria met (verified)
3. All tests passing
4. Quality gates passed (types, lint, build)
5. Progress tracker updated to `status: completed`
6. All commits pushed
7. **AOS writeback DoD passed** (audit P3.9) — when the run is bound to IntentTree, the reviewer's
   `verify-writeback.sh` gate confirms the node is `completed` + AAR/story captured + decisions
   ingested. A FAIL blocks completion. No-op (N/A) when there is no AOS binding. **Alongside it**,
   when the phase built/updated an AI artifact, the reviewer's `verify-skillmeat-writeback.sh` gate
   confirms it is checked-for-reuse + saved/updated in SkillMeat enterprise — same FAIL/N-A/WARN
   semantics, own row in the same DoD section. See
   `validation/completion-criteria.md` § "AOS Writeback Definition-of-Done".
8. **End-of-feature rich report DoD passed** — dev-execution Tier 2/3 features require a validated
   `delivery-report` (route `feature`) manifest + self-contained HTML artifact; substantial Tier 1
   features are recommended. The reviewer runs `hooks/verify-delivery-report.sh` and withholds
   approval on a required missing/invalid report. Phase-only completion does not duplicate the parent
   feature report.

**Never mark phase complete if any criterion is unmet.**

## Forward-Looking Status Reports (`delivery-report` `program` / `phase` routes)

The `feature` route above answers *"what did we finish, and how do we know?"* at end-of-feature (a
**required** gate). Its three sibling routes answer the **forward-looking** questions that come up
*during* a plan — and each maps to a lifecycle moment in this engine. These are **recommended /
on-request, never blocking** (a point-in-time snapshot is not a completion gate — a missing forward
report never withholds `APPROVED`). Author on request or at the milestone; skip for a quick
conversational "what's the status?".

| Route | Lifecycle moment | When to reach for it |
|---|---|---|
| `program` | End of a full plan / epic (`/dev:execute-plan` post-run; `plan-status` full report) | A shareable, evidence-backed "where is this whole effort" snapshot — every open item carries a copyable agent handoff |
| `phase` | End of a wave / phase (`/dev:execute-phase`) | A wave recap: what landed, what's next, what's blocked |
| `readiness` | A go/no-go decision (feeds from `/plan:explore`; see the planning skill) | Should we invest further — go or no-go |

Invoke the skill (`Skill("delivery-report")`) and pick the route; the skill owns the manifest
authoring, render, and validate CLI — do not restate it here. Full route policy + section matrix:
`delivery-report/references/route-policy.md`. Forward routes are recommended in the reviewer DoD, not
enforced — see `./validation/completion-criteria.md` § "Forward Status Reports (recommended)".

### The living dossier (`delivery-report` route `dossier`) — hooks, not authoring

This engine hosts both hooks of the dossier lifecycle. Neither one authors narrative, neither one
gates, and both always exit 0:

| Hook | Fires | What it does |
|---|---|---|
| `hooks/seed-dossier.sh` | **Plan time**, called by the `planning` skill (Workflow 2 step 10) | Deterministically creates the manifest from the plan — stage spine from its phases, OQs/decisions from its frontmatter. Tier 2/3 auto; Tier 0/1 via `DOSSIER_SEED_FORCE=1`. |
| `hooks/update-dossier.sh` | **End of plan** (demoted from every phase boundary + every wave — `execution-doctrine.md` Bookkeeping demotions; see `modes/phase-execution.md` §5.2b, `modes/plan-execution.md` §3c-dossier / §7 for the wiring) | Re-renders + re-validates the manifest against the stage(s) the closing agent wrote. |
| `hooks/publish-report.sh` (PF-3 M3) | **Plan/phase close, after the route's HTML is already rendered** — wired at `modes/plan-execution.md` §8 (after §7's dossier render, route `dossier`) and `modes/phase-execution.md` §5.2a (route `phase`, gated on `$PHASE_REPORT_MANIFEST`) | Composes `delivery-report`'s `export --target atlas` with `scripts/publish_report.py` (atlas ingest → IntentTree scope resolution → the R1 misattribution guardrail → `itt link report`). Default-on (`AOS_DELIVERY_REPORT_PUBLISH`), binding-gated (a rendered manifest AND an IntentTree binding), non-fatal, always exits 0 — mirrors `seed-dossier.sh`/`update-dossier.sh` exactly. **`dossier` is the only route that fires this automatically today**; `phase` is armed but a true no-op until a per-phase report manifest exists (none is produced anywhere in this repo yet); `feature`/`program`/`readiness` have no close-hook wiring at all. Recommended/non-blocking — never a completion gate. Design contract: `.claude/worknotes/delivery-report-hosting-and-linking/implementation-notes.md` (D1–D5). |

Your job at a phase close is still the **stage delta** — write this phase's `narrative` / `outcome` /
`decisions` / `evidence` into the manifest as you write the completion note (a decision point, so no
model call sits on the render path); those writes accumulate across phases. What changed is *when the
hook renders*: `update-dossier.sh` now fires once at end of plan, not after every phase/wave, so the
render+validate itself is a single end-of-plan pass over the accumulated stage deltas. If no manifest
exists the hooks no-op silently: the feature was planned without a seed, which is not an error to
chase mid-run. Spec: `docs/skill-development/delivery-dossier/spec.md`.

## Next Actions Table (the standard close — every completion output)

Every execution response ends with a **Next Actions table** — the compact, copy-pasteable map of
what to do next (target command · path/ITT node/project · what it achieves · gates/blockers ·
recommended model · priority order). It is the flat-markdown projection of the `delivery-report`
handoff vocabulary, always emitted inline (no HTML render required), with a one-line empty state
when nothing follows. When a `delivery-report` is *also* produced, the table stays **front-and-center
in the response** as a brief callout and the report path is listed as an artifact — the table is not
absorbed into the HTML. This is a standing requirement, not a per-command opt-in.

Full format, per-command row semantics, and the callout rule: **`references/next-actions-table.md`**.

## Output Format

Provide structured status updates:

```
Phase N Execution Update

Orchestration Status:
- Batch 1: ✅ Complete (3/3)
- Batch 2: 🔄 In Progress (1/2)
- Batch 3: ⏳ Pending

Current Work:
- ✅ TASK-2.1 → ui-engineer-enhanced
- 🔄 TASK-2.2 → backend-typescript-architect

Recent Commits:
- abc1234 feat(web): implement X component

Progress: 60% (6/10 tasks)
```

---

## When NOT To Use

Do NOT use this skill for:

- **Authoring plans, PRDs, or tier classification** — that is `planning` / `plan:plan-feature`. This
  engine *executes* an existing plan; the plan-optimization mode *consumes* a `wave_plan`, it never
  authors one or decides tier.
- **Content-quality / safety review of a skill or agent you just wrote** — use `asdlc-skill-review-board`.
  For authoring/validating a skill itself, use `skill-dev`.
- **SkillMeat packaging, enterprise registration, or deploy mechanics** — use `skillmeat-cli`.
- **Mode-D work** (auth, payments, production migrations, data deletion, secret rotation, multi-tenant
  boundaries) — those are resolved interactively by Opus under Mode-D discipline, never dispatched
  autonomously through these modes.
- **Tier 0 trivia** (1–3 pts, single trivial file) — `/dev:quick-feature` overhead is lower.

## Deferred / Do Not Say

The following are **not yet implemented** or are **weaker than they may sound**. Do NOT tell users
these work:

| Feature | Status | What NOT to say |
|---|---|---|
| `workflow` execute-plan model as the hard default | Pilot-gated (A/B not yet passed) | "execute-plan runs on the workflow engine by default" — `sequential`/`adaptive` remain supported until the Phase-1 pilot passes. |
| `phase_owner_nesting_enabled` | Opt-in, default-OFF pilot | "phase-owners nest implementers" — only under the explicit flag, depth-1, Claude-primary only. |
| plan-optimization risk classifier | Calibrated at **n=1** (RF Operator MCP P1) | "the gate classifier is validated" — it is a strong first-pass default an orchestrator reviews, not an authority; it has not been validated against a plan whose actual review outcome diverged from its prediction. |
| plan-optimization pre-gate budget | Fixed ~30k first-pass default | "the pre-gate budget is tuned per phase" — per-phase sizing is deferred to the cost model once more retros exist. |
| 150% context tripwire | Executor-observed instruction, not automated | "the context tripwire fires automatically" — there is no CCDash-fed enforcement wired to this engine yet; the live CCDash `context_ballooning` signal is a **follow-up**, not today's mechanism. An executor watches its own utilization and acts; nothing else checks it for them. |
| Gate budget (2 re-passes → re-scope) | Instruction, not a mechanism | "the gate budget is enforced" — there is no counter hook that tracks re-passes per scope x lens and blocks a 3rd. The orchestrator/reviewer is trusted to count and honor the budget; nothing currently rejects a 3rd re-pass programmatically. |

**Known gaps:**

- The plan-optimization pass is authored (mode + reference); a mechanical hook that auto-runs it at
  the plan/execute boundary (alongside `provision-artifacts.sh` / `seed-dossier.sh`) is not yet wired —
  today it is an orchestrator-invoked procedure, not a default-on gate.
- The risk classifier accumulates evidence only as fast as retros are captured via `op story capture`;
  at n=1 its cost model and rule thresholds are starting points, not settled values.
- The gate-budget count (2 re-passes per scope x lens) and the 150% context tripwire are both
  execution-doctrine.md rules with no enforcing hook — they rely on the orchestrator/executor applying
  them honestly each run.

## Key References

All paths below are absolute and resolve on disk:

- /Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/references/execution-doctrine.md — the Claude-5-generation execution doctrine (gate budget, delta context, continue-vs-redispatch, context tripwire, implementation notes, bookkeeping demotions)
- /Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/modes/plan-optimization.md — the plan-optimization procedure
- /Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/references/gate-risk-classes.md — risk-class → lens ruleset, defect checklist, cost calibration
- /Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/git-worktree-pr-protocol.md — the worktree → PR → squash-merge protocol
- /Users/miethe/dev/homelab/development/agentic_meta_dev/.claude/skills/dev-execution/validation/completion-criteria.md — the enforced reviewer/writeback DoD
- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md — model × provider × effort policy

---

**Remember**: Follow @CLAUDE.md delegation rules. Orchestrate; don't implement directly. Load only the guidance you need.
