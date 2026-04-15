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

Update status via artifact-tracker:

```
Task("artifact-tracker", "Update ${PRD_NAME} phase ${phase_num}: Mark TASK-1.1 completed with commit abc1234")
```

## File Contention Rules

When multiple agents edit files in parallel, file ownership conflicts cause merge failures or subtle bugs.

**Rule: Group batch tasks by file ownership, not by semantic meaning.**

| Pattern | Risk | Recommendation |
|---------|------|----------------|
| 2+ agents editing same file, different sections | Medium — git may merge cleanly, but ordering is fragile | Assign all edits for one file to a single agent |
| 2+ agents editing same file, same class | High — near-certain conflict | Never do this; combine into one task |
| 1 agent per file | Safe | Preferred pattern |
| Agent creates a new file | Safe | Ideal for factories, new modules |

**When planning batches:**
1. Map each task to its target file(s)
2. Group tasks that touch the same file into one agent delegation
3. If a batch has 9 tasks across 3 files, use 3 agents (one per file), not 9 agents
4. Foundation classes (base classes, shared types) should always be in a prior batch — never in parallel with their consumers

**Example — wrong vs right grouping:**

```text
# WRONG: grouped by semantic meaning (3 agents touch enterprise_repositories.py)
Agent A: lookups (get, get_by_uuid)        → enterprise_repositories.py
Agent B: writes (create, update, delete)   → enterprise_repositories.py
Agent C: audit logging                     → enterprise_repositories.py

# RIGHT: grouped by file ownership (1 agent per file)
Agent A: all ArtifactRepository methods    → enterprise_repositories.py
Agent B: all CollectionRepository methods  → enterprise_repositories.py (new class at end)
Agent C: RepositoryFactory                 → repository_factory.py (new file)
```

## External Model Task Grouping

When batching includes external model tasks (GPT, Gemini, etc.), group them strategically:

1. **Separate pre-work batches** — External tasks with downstream consumers should run in `batch_0` before main implementation
2. **Pre-work pattern** — External tasks generate artifacts consumed by Claude implementation tasks
3. **Independent external tasks** — Can run in any batch alongside Claude tasks if no downstream dependencies

**Batch structure example:**

```
batch_0: [external model pre-work]
  - TASK-0.1: Generate app icon (nano-banana-pro/quality)
  - TASK-0.2: Research API patterns (gemini-3.1-pro/medium)

batch_1: [implementation consuming batch_0 outputs]
  - TASK-1.1: Icon component (uses generated icon from TASK-0.1)
  - TASK-1.2: API routes (applies patterns from TASK-0.2)

batch_2: [dependent implementation]
  - TASK-2.1: Integration tests
```

**Note:** External model tasks with no consumers in later batches can run alongside Claude tasks in any batch.

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

## Background Task Verification

When background agents write/modify files, do NOT use `TaskOutput()` to collect results.
`TaskOutput()` returns ~7.5K tokens of raw agent transcript — mostly metadata noise.

**Instead:**

1. Verify expected files exist: `Glob("path/to/expected-file.*")`
2. Run validation: `pnpm type-check`, `pnpm lint`
3. Mark task complete via CLI: `update-batch.py`
4. Only if errors suspected: `Read` the agent output file (last 20 lines only)

```text
# After launching background agents
Task("ui-engineer", "Create component...", run_in_background=true)  # Returns task_id

# DON'T (wastes ~7.5K tokens per call):
TaskOutput(task_id)

# DO (near-zero token cost):
Glob("path/to/expected-component.tsx")      # Verify file exists
Bash("cd skillmeat/web && pnpm type-check") # Verify it compiles
```

**When TaskOutput IS appropriate:**
- Agent was doing exploration/analysis (no files written) and you need the findings
- Agent hit an error and you need to diagnose what went wrong
- In these cases, prefer `TaskOutput(task_id, block: false)` to check status first

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
