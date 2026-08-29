# Batch Delegation

Patterns for delegating tasks to multiple agents in parallel.

## Core Principle

Execute independent tasks in parallel using a single message with multiple Task() tool calls.

## Batch Execution Strategy

### 1. Read Parallelization from YAML

Progress files contain pre-computed `parallelization` section:

```yaml
parallelization:
  batch_1: ["TASK-1.1", "TASK-1.2", "TASK-1.3"]  # No dependencies
  batch_2: ["TASK-2.1", "TASK-2.2"]              # Depends on batch_1
  batch_3: ["TASK-3.1"]                          # Depends on batch_2
  critical_path: ["TASK-1.1", "TASK-2.1", "TASK-3.1"]
```

### 2. Execute Batches

**Pattern:**
1. Execute ALL tasks in `batch_1` in **parallel** (single message)
2. **Wait** for batch to complete
3. Execute ALL tasks in `batch_2` in **parallel**
4. Continue sequentially through batches

### 3. Parallel Task() Syntax

```
# Single message with multiple parallel Task() calls
Task("ui-engineer-enhanced", "TASK-1.1: Implement Button component...")
Task("backend-typescript-architect", "TASK-1.2: Add API endpoint...")
Task("ui-engineer-enhanced", "TASK-1.3: Implement Form component...")
```

## Task Delegation Template

```
@{agent-from-assigned_to}

Phase ${phase_num}, {task_id}: {task_title}

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

## After Each Task Completes

**Re-verify before you mark complete — a delegate self-report is a claim, not evidence.**
Re-run the delegate's own gates in-session and inspect the on-disk result before
trusting "done". In the Command Center v3 run, one delegate wrote a wrong test
assertion, one hit `--max-turns` without reporting, and mypy errors landed in
delegate-authored code — nothing shipped broken **only** because every delegate gate
was re-run by the orchestrator. (Consistent with the `validator-confabulates-evidence`
memory: a `task-completion-validator` can even APPROVE with fabricated citations.)

- Re-run the relevant gates yourself (`tsc`/`pytest`/`ruff`/`eslint`), reading each
  stage's PASS/FAIL line from the log — not the delegate's summary and not a wrapper
  exit code (see [`../validation/quality-gates.md`](../validation/quality-gates.md) →
  "Chained Gate Verification").
- Verify changed files on disk (don't call `TaskOutput()` for file-writing delegates).
- Treat a delegate that finished silently or hit max-turns as **incomplete**, not done.

Then update status via artifact-tracker:

```
Task("artifact-tracker", "Update ${PRD_NAME} phase ${phase_num}: Mark TASK-1.1 completed with commit abc1234")
```

## Token-Efficient Delegation

### DO

- Read only YAML frontmatter for task metadata (~2KB)
- Copy Task() commands from "Orchestration Quick Reference" when available
- Use artifact-tracker for status updates
- Execute batches in parallel (single message with multiple Task calls)

### DO NOT

- Read entire progress file for delegation (~25KB)
- Re-analyze task dependencies (already computed)
- Manually construct Task() commands when Quick Reference exists
- Execute parallel tasks sequentially (wastes time)

## Example: Full Batch Execution

```bash
# 1. Extract YAML frontmatter
head -100 ${progress_file} | sed -n '/^---$/,/^---$/p'

# 2. From YAML, identify batch_1 tasks

# 3. Execute batch_1 in parallel (single message)
Task("ui-engineer-enhanced", "TASK-1.1: Create Button component per specs...")
Task("backend-typescript-architect", "TASK-1.2: Implement auth service...")
Task("codebase-explorer", "TASK-1.3: Find existing patterns for...")

# 4. Wait for batch completion

# 5. Update artifact tracking
Task("artifact-tracker", "Update ${PRD_NAME} phase 1: Mark TASK-1.1, TASK-1.2, TASK-1.3 complete")

# 6. Execute batch_2 (depends on batch_1)
Task("ui-engineer-enhanced", "TASK-2.1: Integrate Button with auth...")
Task("frontend-architect", "TASK-2.2: Wire up page routing...")

# 7. Continue through all batches
```

## Handling Subagent Failures

If a Task() call fails:

1. **Retry once** with same parameters
2. **If fails again**: Document in progress tracker and proceed with direct implementation
3. **Note** in decisions log why direct approach was taken:

```
Task("artifact-tracker", "Update ${PRD_NAME} phase 1:
- Mark TASK-1.2 as blocked
- Log: Subagent failed after retry, proceeding with direct implementation")
```
