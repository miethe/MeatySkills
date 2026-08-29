# Phase Execution Mode

Detailed guidance for multi-phase YAML-driven development with batch delegation.

> **Git workflow:** this mode follows the canonical worktree → PR-to-parent → squash-merge-on-approval
> protocol in [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md). The per-task `git add`/
> `git commit` calls below run **inside the run's worktree**; the orchestrator/phase-owner is the only
> committer (offloaded/nested executors never touch git), and the run branch PRs to the **parent
> branch** (not hard-coded `main`), squash-merging on approval or an in-prompt override.
>
> **Model selection** follows [`MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md):
> subscription default **Sonnet 5** (`claude-sonnet-5`) for implementation, **Opus 5** for spine,
> `xhigh` effort for the hardest work; bounded waves offload to **ICA Sonnet 5**
> (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the reviewer gate.

> **Execution Model Routing** — Before using this mode for a Tier 2/3 plan, check whether
> the workflow path applies:
>
> | Condition | Recommended path |
> |---|---|
> | Plan has `wave_plan.waves`, all phases `phase_strategy: static`, active session | `/dev:execute-plan` → **workflow path** (`.claude/workflows/execute-plan.js`) |
> | No `wave_plan` or `phase_strategy: adaptive` phases | This mode (sequential / phase-owner fallback) |
>
> The workflow is the **recommended** execution model for `execute-plan` / `execute-contract`.
> This mode documents the `sequential` and `adaptive` fallback paths, retained pending the
> Phase-1 pilot adoption decision.
> Reference: `.claude/skills/dev-execution/SKILL.md` §"Execution Model Routing".

## When to Use

- Multi-phase implementation plans (>1 day of work) without a `wave_plan`, or with adaptive phases
- Features requiring PRD and progress tracking where the workflow path does not apply
- Cross-cutting concerns affecting multiple layers
- Work tracked in `.claude/progress/{PRD_NAME}/phase-N-progress.md`

## Phase 1: Initialize Context & Tracking

### 1.1 Extract Phase Information

From `$ARGUMENTS`, extract:
- `{PRD_NAME}`: From plan or PRD filename
- `{PHASE_NUM}`: Phase number to execute

### 1.2 Validate Tracking Infrastructure

```bash
progress_file=".claude/progress/${PRD_NAME}/phase-${PHASE_NUM}-progress.md"

# Check if progress file exists
if [ ! -f "$progress_file" ]; then
  Task("artifact-tracker", "Create Phase ${PHASE_NUM} progress for ${PRD_NAME}")
fi
```

### 1.3 Pre-Execution Artifact Provisioning (best-effort, ON BY DEFAULT)

Before building the batch/task graph in Phase 2, run the provisioning gate so every artifact this
phase's plan declares (`required_artifacts` frontmatter) or the project manifest
(`.claude/aos-artifacts.yaml`) expects is present. **On by default** — mirrors the IntentTree sync
hooks' default-on/binding/non-fatal posture (`.claude/rules/artifact-provisioning.md`); silent
no-op when there is no manifest and no plan `required_artifacts`. Disable per-run with
`AOS_ARTIFACT_PROVISION=0`.

```bash
PROVISION_PLAN_FILE="<plan-path-for-${PRD_NAME}>" PROVISION_SCOPE="plan:${PRD_NAME}" \
    .claude/skills/dev-execution/hooks/provision-artifacts.sh
```

**Non-fatal contract**: CLI/infra failure → logged warning, continue (exit 0). **One exception**: a
NEEDED artifact that is unsatisfiable anywhere → the gate exits 2 and this phase halts before Phase
2 spends any execution budget on tasks it cannot complete.

## Phase 2: Execute Using Orchestration

### 2.1 Read Progress YAML Only (Token-Efficient)

**Critical**: Do NOT read entire progress file. Extract only YAML frontmatter:

```bash
# Extract YAML frontmatter (~2KB vs ~25KB for full file)
head -100 ${progress_file} | sed -n '/^---$/,/^---$/p'
```

From YAML, identify:
- Current `tasks` array with `assigned_to`, `dependencies`, `status`
- `parallelization` section with batch groupings
- Tasks ready to execute (dependencies have `status: completed`)

### 2.2 Delegate in Batches

**Use pre-computed Task() commands from "Orchestration Quick Reference" section when available.**

#### Batch Execution Strategy

1. **Batch 1** (No dependencies):
   - Execute ALL tasks in `parallelization.batch_1` in **parallel**
   - Use single message with multiple Task() tool calls:
   ```
   Task("ui-engineer-enhanced", "TASK-1.1: Implement X component...")
   Task("backend-typescript-architect", "TASK-1.2: Add API endpoint...")
   ```

2. **Wait** for Batch 1 to complete

3. **Batch 2+**: Continue batch-by-batch, tasks within batches in parallel

4. **Update Task Status** after each task completes:
   ```
   Task("artifact-tracker", "Update ${PRD_NAME} phase ${PHASE_NUM}: Mark TASK-1.1 completed")
   ```

### 2.3 Task Delegation Template

```
@{agent-from-assigned_to}

Phase ${PHASE_NUM}, {task_id}: {task_title}

{task_description}

Project Patterns to Follow:
- Layered architecture: routers → services → repositories → DB
- ErrorResponse envelopes for errors
- Cursor pagination for lists
- Telemetry spans and structured JSON logs
- DTOs separate from ORM models

Success criteria:
- [What defines completion]
```

**If subagent invocation fails**: Document in progress tracker and proceed with direct implementation.

### 2.3a IntentTree SDLC Sync — Task Start (best-effort, ON BY DEFAULT)

The sync is **on by default** — do three gated/non-fatal steps at task start. All skip silently if
the CLI is absent, the API is unreachable, or there is no binding — never block execution. The gate,
default-on policy, and env resolution (`INTENTTREE_SDLC_SYNC`, `ITT_NODE_ID`, `INTENTTREE_TREE`,
`INTENTTREE_ACTOR`) are defined once in **`.claude/rules/intenttree-integration.md`**. `${ITT_NODE_ID}`
is the bound node for the task (from the project env / `.claude` context, or the progress/plan
frontmatter `intenttree_node`/`itt_node_id`). Disable per-run with `INTENTTREE_SDLC_SYNC=0`.

**(1) Lookup — pull node context before delegating (P2).** Surface the node's acceptance criteria,
prior runs, and `agent_context` so they inform the delegation prompt:
```bash
if case "$(printf '%s' "${INTENTTREE_SDLC_SYNC:-auto}" | tr '[:upper:]' '[:lower:]')" in 0|false|no|off) false;; *) true;; esac && [ -n "${ITT_NODE_ID:-}" ]; then
    itt --json node get "${ITT_NODE_ID}" --include ancestors,agent_runs,artifacts 2>/dev/null \
        | head -40 || echo "[sdlc-lookup] node context unavailable — skipping (non-fatal)"
fi
```

**(2) Claim + in_progress (P3).** Claim the node for the executing actor and set `in_progress`.
Set a real `INTENTTREE_ACTOR` handle (`agent:<handle>`) per `.claude/rules/agent-coordination.md` so
the claim is attributable; `agent:operator` is only a fallback default.
```bash
if case "$(printf '%s' "${INTENTTREE_SDLC_SYNC:-auto}" | tr '[:upper:]' '[:lower:]')" in 0|false|no|off) false;; *) true;; esac && [ -n "${ITT_NODE_ID:-}" ]; then
    # --actor and --json are GLOBAL flags — they precede the subcommand.
    itt --actor "${INTENTTREE_ACTOR:-agent:operator}" --json node assign "${ITT_NODE_ID}" --mode agent \
        2>/dev/null || echo "[sdlc-update] claim skipped (non-fatal)"
    itt --actor "${INTENTTREE_ACTOR:-agent:operator}" --json node update "${ITT_NODE_ID}" --status in_progress \
        2>/dev/null || echo "[sdlc-update] status skipped (non-fatal)"
fi
```

**(3) Status sync from the progress file.** Propagate the task's `in_progress` status to its bound
node via the canonical hook (owns the default-on + binding + non-fatal logic; idempotent):
```bash
SDLC_SYNC_FILE="${progress_file}" INTENTTREE_TREE="${INTENTTREE_TREE:-}" \
    .claude/skills/dev-execution/hooks/sdlc-sync.sh
```

> **Non-fatal contract**: any non-zero exit, missing CLI, or network error is logged and ignored.
> The `itt sync import` call is idempotent — re-running after partial sync is safe.

### 2.4 Validate Task Completion

After each major task:

```
@task-completion-validator

Phase ${PHASE_NUM}, Task: {task_id}

Expected outcomes:
- [Outcome 1 from task description]
- [Outcome 2 from task description]

Files changed:
- {list files}

Validate:
1. Acceptance criteria met
2. Project architecture patterns followed
3. Tests exist and pass
4. No regression introduced
```

### 2.5 Commit After Each Task

```bash
git add {files}
git commit -m "feat(scope): implement {feature}

- Added {component/service/etc}
- Wired telemetry spans
- Added tests with {coverage}%

Refs: Phase ${PHASE_NUM}, {task_id}"
```

### 2.5a IntentTree SDLC Sync — Task Done (best-effort, ON BY DEFAULT)

After the commit, re-sync the progress file so the completed task's node reflects `completed`
status. On by default (disable with `INTENTTREE_SDLC_SYNC=0`); non-fatal. See
`.claude/rules/intenttree-integration.md`.

```bash
SDLC_SYNC_FILE="${progress_file}" INTENTTREE_TREE="${INTENTTREE_TREE:-}" \
    .claude/skills/dev-execution/hooks/sdlc-sync.sh
```

## Phase 3: Continuous Testing

Run after each significant change:

### Backend Tests

```bash
uv run --project services/api pytest app/tests/test_X.py -v
uv run --project services/api mypy app
uv run --project services/api ruff check
```

### Frontend Tests

```bash
pnpm --filter "./apps/web" test -- --testPathPattern="ComponentName"
pnpm --filter "./apps/web" typecheck
pnpm --filter "./apps/web" lint
```

**Test failure protocol:**
1. Fix immediately if related to current work
2. Document in progress tracker if unrelated
3. DO NOT proceed to next task if tests fail for current work

## Phase 4: Milestone Validation

At each major milestone (after completing a batch):

### 4.1 Run Full Validation

```bash
# Type checking
pnpm -r typecheck
uv run --project services/api mypy app

# Linting
pnpm -r lint
uv run --project services/api ruff check

# Tests
pnpm -r test
uv run --project services/api pytest

# Build check
pnpm --filter "./apps/web" build
```

### 4.2 Milestone Validation with Subagent

```
@task-completion-validator

Phase ${PHASE_NUM} Milestone: Batch {batch_num} Complete

Completed tasks:
- {task_id_1}
- {task_id_2}

Validate:
1. All batch tasks complete
2. Success criteria met
3. No regressions
4. Tests comprehensive
```

## Phase 5: Final Validation

When ALL tasks complete:

### 5.1 Quality Gates

All must pass:
- [ ] All tests passing (backend + frontend + e2e)
- [ ] Type checking clean
- [ ] Linting clean
- [ ] Build succeeds
- [ ] A11y tests pass (if UI phase)

### 5.2 Final Progress Update

```
Task("artifact-tracker", "Finalize ${PRD_NAME} phase ${PHASE_NUM}:
- Mark phase as completed
- Update completion to 100%
- Generate phase completion summary")
```

### 5.2a IntentTree SDLC Sync — Phase Done (best-effort, ON BY DEFAULT)

After the phase tracker transitions to `completed`, sync the final state to IntentTree. On by
default (disable with `INTENTTREE_SDLC_SYNC=0`); see `.claude/rules/intenttree-integration.md`. Then
optionally invoke the capsule hook (gated separately by `SKILLMEAT_CAPSULES_ENABLED=1`).

```bash
# SDLC sync: propagate phase-completed status to bound nodes (canonical hook).
SDLC_SYNC_FILE="${progress_file}" INTENTTREE_TREE="${INTENTTREE_TREE:-}" \
    .claude/skills/dev-execution/hooks/sdlc-sync.sh
# Explicit completion of the bound node (P3) — by id, no --tree needed; idempotent.
if case "$(printf '%s' "${INTENTTREE_SDLC_SYNC:-auto}" | tr '[:upper:]' '[:lower:]')" in 0|false|no|off) false;; *) true;; esac && [ -n "${ITT_NODE_ID:-}" ]; then
    itt --json node complete "${ITT_NODE_ID}" 2>/dev/null \
        || echo "[sdlc-update] node complete skipped (non-fatal)"
fi

# Capsule hook (independent guard: SKILLMEAT_CAPSULES_ENABLED=1)
PROGRESS_FILE="${progress_file}" PHASE_NUM="${PHASE_NUM}" PRD="${PRD_NAME}" \
    .claude/skills/dev-execution/hooks/phase-complete-capsule.sh
```

> **Reference**: `docs/project_plans/implementation_plans/features/awpr-v2-task-node-contract.md`
> (field projection + writeback policy). CLI: `client/src/intenttree_client/cli/commands/sync_cmd.py`.
> Plan task: TASK-6.2 (FR-11, dev-execution skill wiring).

### 5.2b Delivery Dossier — Phase Boundary (best-effort, ON BY DEFAULT)

If a living **delivery dossier** is bound for this feature (a manifest at
`.claude/reports/dossier/${feature_slug}/report.json`), record this phase into it and regenerate. On
by default (disable with `AOS_DELIVERY_DOSSIER=0`); a true no-op when no dossier is bound. The dossier
is **recommended / non-blocking** — never a completion gate (the enforced end-of-feature artifact is
the `feature` DoD report). Spec: `docs/skill-development/delivery-dossier/spec.md` §A.6.

1. **Author the stage** (only if a dossier manifest exists): update this phase's `stages[]` entry —
   flip `state` to `done` (or `blocked`), write its `narrative` (what was done and why) + `outcome`,
   append any `decisions[]` / `open_questions[]` raised, add `evidence` + screenshot `media`, flip the
   next phase's stage to `active`, and bump `report.revision`. Reuse the completion-note content you
   just produced — do not re-derive. (No model call is on the render path: authoring happens here, at
   the phase close; the hook below only renders + validates.)
2. **Regenerate** (deterministic, offline):

```bash
DELIVERY_DOSSIER_MANIFEST=".claude/reports/dossier/${feature_slug}/report.json" \
    .claude/skills/dev-execution/hooks/update-dossier.sh
```

### 5.3 Push All Changes

```bash
git push origin ${branch_name}
```

## Error Recovery

### Common Recovery Strategies

**Git conflicts:**
```bash
git stash
git pull --rebase origin ${branch_name}
git stash pop
# Resolve conflicts
git add .
git rebase --continue
```

**Build failures:**
```bash
rm -rf .next node_modules/.cache
pnpm install
pnpm build
```

**Subagent failures:**
- Retry once
- If fails again, document and proceed with direct implementation

### If Unrecoverable

Update progress file:
```yaml
---
status: blocked
---

**Blocker Details:**
- Task: {task_id}
- Issue: {description}
- Attempted Solutions: {list}
- Needs: {what's needed to unblock}
```

Stop and report to user with:
- Clear description of blocker
- What was attempted
- What's needed to proceed
- Current state of work (all committed)
