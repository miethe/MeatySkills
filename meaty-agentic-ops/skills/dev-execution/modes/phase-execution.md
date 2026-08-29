# Phase Execution Mode

Detailed guidance for multi-phase YAML-driven development with batch delegation.

> **Git workflow:** this mode follows the canonical worktree → PR-to-parent → squash-merge-on-approval
> protocol in [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md). The per-task `git add`/
> `git commit` calls below run **inside the run's worktree**; nested helpers and offloaded executors
> never touch git, while a phase's batch task agents commit only their own assigned files by explicit
> pathspec and never rewrite history (no `git add -A`/`git add .`, no `reset`/`rebase`/`amend`/
> force-push) — they share one index with their concurrently-running batch-mates. The
> orchestrator/phase-owner orchestrates all commits, and the run branch PRs to the **parent
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

### 1.4 IntentTree SDLC Sync — Milestone Start (best-effort, ON BY DEFAULT)

**Demoted from every task start to once per plan milestone** (`references/execution-doctrine.md`
— Bookkeeping demotions table: "IntentTree lookup/claim/sync 3-step | every task start | once per
milestone"). Run this 3-step **once**, when execution enters a new plan milestone — in practice, at
the start of that milestone's first phase. If this phase is not the first phase of its plan
milestone (a prior phase in the same milestone already ran this block), **skip it** — do not repeat
it per phase and never repeat it per task.

The sync is **on by default** — do three gated/non-fatal steps at milestone start. All skip
silently if the CLI is absent, the API is unreachable, or there is no binding — never block
execution. The gate, default-on policy, and env resolution (`INTENTTREE_SDLC_SYNC`, `ITT_NODE_ID`,
`INTENTTREE_TREE`, `INTENTTREE_ACTOR`) are defined once in
**`.claude/rules/intenttree-integration.md`**. `${ITT_NODE_ID}` is the bound node for the milestone
(from the project env / `.claude` context, or the progress/plan frontmatter
`intenttree_node`/`itt_node_id`). Disable per-run with `INTENTTREE_SDLC_SYNC=0`.

**(1) Lookup — pull node context before delegating (P2).** Surface the node's acceptance criteria,
prior runs, and `agent_context` so they inform the milestone's delegation prompts:
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

**(3) Status sync from the progress file.** Propagate the milestone's `in_progress` status to its
bound node via the canonical hook (owns the default-on + binding + non-fatal logic; idempotent):
```bash
SDLC_SYNC_FILE="${progress_file}" INTENTTREE_TREE="${INTENTTREE_TREE:-}" \
    .claude/skills/dev-execution/hooks/sdlc-sync.sh
```

> **Non-fatal contract**: any non-zero exit, missing CLI, or network error is logged and ignored.
> The `itt sync import` call is idempotent — re-running after partial sync is safe.

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

> **IntentTree sync moved.** The lookup/claim/status-sync 3-step no longer runs here at every task
> start — it is demoted to once per plan milestone; see §1.4. Do not re-add a per-task sync call.

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

**This is the delta-context shape** (`references/execution-doctrine.md` rule 2): expected outcomes
+ files changed + the AC in question — not the full plan, not the cumulative diff, not the progress
file. Any validator/reviewer gate dispatched from this mode (task-level here, batch-checkpoint in
Phase 4, final in Phase 5) should assemble its input packet the same way. If a reviewer needs more
than this to judge the task, the task description is under-specified — fix it rather than widening
the packet.

**One lens, unless the phase carries a trigger.** `task-completion-validator` above is the default and
usually the only reviewer. Substitute or add the `security` lens (`council-review`) **only** when this
phase's `gate_lens` says so — i.e. its surface **parses untrusted input**, **is an
authorization/identity boundary**, or has an **irreversible/outward-facing effect**
(`references/gate-risk-classes.md` §2). **Tier does not add a lens**, and neither does the reviewer
itself: `task-completion-validator` returns a verdict, it does not dispatch follow-on reviewers.

Where a `security` lens does run, run the cheap ~30k pre-gate sweep first and escalate only what
survives it (`modes/plan-optimization.md` §6). The pre-gate exists **only** on the security path —
never add it to a one-lens phase.

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

- **A failing test on the current work is a real blocker — still a hard stop.** Fix it before
  proceeding; DO NOT proceed to the next task while tests fail for the work you are actively on.
  This is one of the doctrine's mid-milestone halt cases (`references/execution-doctrine.md`
  §"Implementation notes over halt-and-gate"), not something the implementation-notes policy below
  relaxes.
- **A failure unrelated to current work** (pre-existing, flaky, or surfaced by a conservative
  choice you made) is a **note, not a stop**: log it with rationale to
  `.claude/worknotes/${PRD_NAME}/implementation-notes.md` and continue; it is reviewed at the next
  milestone boundary rather than halting execution here.

## Phase 4: Batch Checkpoint Validation

> **Terminology — do not conflate with "plan milestone."** "Milestone" in this Phase 4 heading (and
> §4.2 below) is the **older, finer-grained sense**: a validation checkpoint after a batch of tasks
> *inside* this phase, which can recur several times within one phase. The doctrine's **plan
> milestone** (`references/execution-doctrine.md` §Terminology) is a different, coarser unit — a
> reviewable state of the system, above phases — and is what §1.4's demoted IntentTree sync and the
> doctrine's bookkeeping-demotion table mean by "milestone." This section is renamed **Batch
> Checkpoint** to keep the two apart; where you see "milestone" below, read "batch checkpoint."

At each batch checkpoint (after completing a batch):

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

### 4.2 Batch Checkpoint Validation with Subagent

```
@task-completion-validator

Phase ${PHASE_NUM} Batch Checkpoint: Batch {batch_num} Complete

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

# Publish + link this phase's delivery-report (route `phase`) — best-effort, ON BY DEFAULT.
# A true no-op unless PHASE_REPORT_MANIFEST points at an already-rendered `phase`-route report
# manifest for this plan (authoring one is out of this hook's scope). instance_key derives from
# PHASE_NUM — the field that distinguishes one phase close from the next — so two successive
# phase closes never collapse onto one IntentTree link row (D1/D5, risk R1b / DI-283); disable
# with AOS_DELIVERY_REPORT_PUBLISH=0.
DELIVERY_REPORT_MANIFEST="${PHASE_REPORT_MANIFEST:-}" ITT_NODE_ID="${ITT_NODE_ID:-}" \
    PHASE_NUM="${PHASE_NUM}" \
    .claude/skills/dev-execution/hooks/publish-report.sh
```

> **Reference**: `docs/project_plans/implementation_plans/awpr-v2-task-node-contract.md`
> (field projection + writeback policy). CLI: `client/src/intenttree_client/cli/commands/sync_cmd.py`.
> Plan task: TASK-6.2 (FR-11, dev-execution skill wiring).

### 5.2b Delivery Dossier — Phase Boundary (stage authoring only; best-effort, ON BY DEFAULT)

**Demoted: regeneration moves to end of plan.** Per `references/execution-doctrine.md` —
Bookkeeping demotions table ("Delivery-dossier regeneration | every phase boundary + every wave |
end of plan") — this phase boundary **authors** the stage delta into the dossier manifest but no
longer **regenerates** the HTML. If a living **delivery dossier** is bound for this feature (a
manifest at `.claude/reports/dossier/${feature_slug}/report.json`), on by default (disable with
`AOS_DELIVERY_DOSSIER=0`; a true no-op when no dossier is bound):

1. **Author the stage** (only if a dossier manifest exists): update this phase's `stages[]` entry —
   flip `state` to `done` (or `blocked`), write its `narrative` (what was done and why) + `outcome`,
   append any `decisions[]` / `open_questions[]` raised, add `evidence` + screenshot `media`, flip the
   next phase's stage to `active`, and bump `report.revision`. Reuse the completion-note content you
   just produced — do not re-derive. (No model call is on the render path: authoring happens here, at
   the phase close.)
2. **Do NOT regenerate here.** Leave the authored delta sitting in the manifest. The
   `update-dossier.sh` render call fires exactly once, at end of plan (the plan's final phase, or
   the caller orchestrating this plan — e.g. `plan-execution.md` §7) — never per phase boundary.
   The dossier is **recommended / non-blocking** — never a completion gate (the enforced
   end-of-feature artifact is the `feature` DoD report). Spec:
   `docs/skill-development/delivery-dossier/spec.md` §A.6.

### 5.2c Finding Sweep — Phase Done (backstop; best-effort, ON BY DEFAULT)

Reconcile the findings this phase *named* against the nodes actually *filed* for them. On by
default (disable with `AOS_FINDING_SWEEP=0`); a true no-op when the phase produced no findings doc
and no plan file is bound. Reports only — always exits 0, never gates the phase.

**This is a backstop, not the mechanism.** The rule is that you file a node the moment you detect a
deferral/bug/gap, ungated (`.claude/rules/finding-capture.md`). An item surfacing in this sweep
means that already got missed — so when it reports something, file the node before closing the
phase rather than deferring it to the plan close.

```bash
# Reconcile findings named this phase against nodes actually filed. Catches BOTH shapes of
# miss: an entry with no node id, and an id that does not exist (a fabricated id reads as
# satisfied, which makes it the worse of the two).
FINDING_SWEEP_FINDINGS_DOC="${findings_doc:-}" FINDING_SWEEP_PLAN_FILE="${plan_file:-}" \
    FEATURE_SLUG="${FEATURE_SLUG:-}" \
    .claude/skills/dev-execution/hooks/finding-sweep.sh
```

### 5.2d Mode-D Output Scan — Phase Done (GATES the phase when an offload lane breached)

Scan what any **delegated/offloaded** leg in this phase actually *wrote* for Mode-D signatures —
generated key material, an auth/migration/deletion path, a history rewrite. On by default (disable
with `AOS_MODE_D_SCAN=0`); a true no-op when no range/diff/paths are given.

**Unlike every other hook in this section, this one can gate.** Exit 2 means an offload lane crossed
the Mode-D boundary: do not merge that output, and re-run the leg on claude-primary. Infra failures
(no python, bad range) are still swallowed to exit 0 — only a *detected breach* halts.

This is the check no declaration can substitute for. The pre-dispatch guards read what a leg said it
would touch; on 2026-08-06 a leg declared nothing crypto-shaped, was routed to an offload lane on
that clean declaration, and then invented HMAC signing — minting a key with `secrets.token_bytes(32)`
(`.claude/rules/mode-d-enforcement.md`). Skip this and the leg's own report is your only evidence,
which is exactly what failed.

```bash
# Only meaningful when this phase delegated to an offload lane. Set the provider to the lane
# that produced the commits; on claude-primary the scan reports but never fails.
MODE_D_SCAN_PROVIDER="${PHASE_OFFLOAD_PROVIDER:-claude}" \
    MODE_D_SCAN_RANGE="${phase_base_sha:-HEAD~1}..HEAD" \
    .claude/skills/dev-execution/hooks/mode-d-scan.sh
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

This path is for a genuine blocker, not a deviation — recovery strategies above exhausted, a
destructive action, a real scope change, or input only the operator has
(`references/execution-doctrine.md` §"Implementation notes over halt-and-gate" — the three
mid-milestone halt cases). A conservative choice or discovered constraint that does **not** block
progress is a note, not a stop: log it to `.claude/worknotes/${PRD_NAME}/implementation-notes.md`
with its rationale and keep going instead of invoking this section.

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
