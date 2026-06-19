---
name: dev-execution
description: "Unified execution engine for all development workflows. Progressive disclosure for phase execution, quick features, story completion, and scaffolding. Integrates with artifact-tracking and meatycapture-capture. Use when running /dev:execute-phase, /dev:quick-feature, /dev:implement-story, /dev:complete-user-story, or /dev:create-feature commands."
---

# Dev Execution Skill

Unified guidance for executing development workflows with token-efficient progressive disclosure.

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
workflow. This is a pilot capability (strategy plan §4 Tier B); it is not auto-promoted.

**Nesting is for decomposition, not throughput.** A single nested `Agent` call blocks until the
child returns; batched nested spawns get ungoverned concurrency (no `parallel()` cap+queue). Keep
governed parallelism at the workflow `parallel()`/`pipeline()` level. Use nesting only when the
phase-owner cannot enumerate its sub-tasks up front and needs runtime judgment to break down its
slice.

**Hard rules** (full rationale in `.claude/specs/subagent-nesting-spec.md`; do not re-derive here):

| Rule | Summary |
|---|---|
| Depth cap | Max 1 level of nesting below the phase-owner (i.e. phase-owner → helper; no deeper). |
| Bounded helpers | Nested helpers must be bounded — < ~40 tool uses per level. |
| Single committer | The phase-owner is the **only** committer. Children never `git add/commit/push/stash`. |
| Mode-D at depth | Nested agents are prohibited from auth/payments/migrations/deletion/force-push/secret-rotation. On hitting Mode-D territory: STOP and bubble `{needs_opus, mode_d}` up the chain unchanged until Opus handles it interactively. |
| Claude-primary only | Nesting runs on the primary subscription only. Router-offloaded executors (`codex-executor`, `gemini-executor`) never nest. |

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

## Tier 1 Autonomous Sprint

Use this mode when a Feature Contract has been approved for a Tier 1 feature (3–8 pts). It replaces phase-by-phase batch orchestration with a single autonomous sprint followed by a mandatory reviewer gate.

**Reference**: Overhaul plan §4.4 and §4.5.

### When to Use

- A Feature Contract (`doc_type: feature_contract`) exists at `docs/project_plans/feature_contracts/[category]/[slug].md`.
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
        Contract: docs/project_plans/feature_contracts/[category]/[slug].md
        Budget: ~50K tokens
        Context paths: [relevant files]")

2. Sprint runs autonomously (no Opus intervention unless blocker escalated):
   explore → implement → tests → validation → Completion Report

3. Mandatory reviewer pass (Mode E):
   Task("task-completion-validator", "Mode E: Reviewer.
        Review sprint output against Feature Contract AC.
        Contract: [path]  Diff: [branch or commit range]
        Completion Report: [path or 'appended to contract'")

4. If reviewer approves → Opus commits and closes contract.
   If reviewer finds issues → feature-sprint-executor fixes (preserves session context).
   If 2+ fix cycles fail → escalate to Opus for intervention (OQ-5).
```

### Exit Criteria

All of the following must hold before Opus commits:

- [ ] All contract Acceptance Criteria marked met in Completion Report.
- [ ] `task-completion-validator` review passes (no required fixes outstanding).
- [ ] All validation commands run and pass (pytest / pnpm test + type-check + lint as applicable).
- [ ] Completion Report appended to contract file (or written to `.claude/worknotes/[slug]/completion-report.md`).
- [ ] Contract frontmatter updated: `status: completed`, `files_affected`, `commit_refs` (work-history SHAs, appended after each commit).
- [ ] After merge to destination branch: `merge_commit` set to the post-squash SHA and `merge_branch` set (typically `main`). This is the canonical landing pointer — required for direct squash-merges (no PR) so the orphaned branch SHAs in `commit_refs` remain resolvable in retrospect.

### Delegation Example

```python
# Step 1: Delegate sprint
Task("feature-sprint-executor",
     "Mode C: Autonomous Feature Sprint.\n"
     "Contract: docs/project_plans/feature_contracts/features/artifact-tag-bulk-edit.md\n"
     "Budget: ~50K tokens\n"
     "Context: skillmeat/api/routers/artifacts.py, skillmeat/web/components/entity/artifact-card.tsx")

# Step 2 (after sprint): Mandatory reviewer
Task("task-completion-validator",
     "Mode E: Reviewer.\n"
     "Contract: docs/project_plans/feature_contracts/features/artifact-tag-bulk-edit.md\n"
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

---

## Mandatory Reviewer Gates

Reviewer passes are non-optional at tier-appropriate checkpoints. A phase, sprint, or feature is **not complete** until the applicable reviewer approves.

**Full gate matrix (tier × checkpoint × reviewer)**: `./validation/completion-criteria.md`

Summary:

| Tier | Gate | Reviewer |
|------|------|----------|
| 1 | End of sprint | `task-completion-validator` |
| 2 | End of each phase | `task-completion-validator` |
| 2 | End of feature | `karen` |
| 3 | End of each phase | `task-completion-validator` |
| 3 | Mid-feature milestones | `karen` |
| 3 | End of feature | `karen` |

Do not commit or mark a phase/feature complete without a passing reviewer verdict. If the reviewer finds required fixes, the original executor addresses them (context is preserved); escalate to Opus only after 2+ failed fix cycles.

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

**Never mark phase complete if any criterion is unmet.**

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

**Remember**: Follow @CLAUDE.md delegation rules. Orchestrate; don't implement directly. Load only the guidance you need.
