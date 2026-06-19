---
title: "Agent Roster and Delegation Reference"
description: "Complete agent assignment tables, model selection guide, multi-model integration, and delegation patterns for SkillMeat orchestration."
type: reference
domain: ai-config
status: active
load_when: "When selecting agents, reviewing agent capabilities, or configuring delegation"
last_verified: 2026-05-26
related:
  - .claude/context/key-context/agent-teams-patterns.md
---

## Agent Delegation

**Mandatory**: All implementation work MUST be delegated. Opus orchestrates only.

### Model Selection (Post-Refactor)

| Model | Budget | Use When |
|-------|--------|----------|
| **Opus 4.6** | $15/$75/M | Orchestration, deep reasoning, architectural decisions |
| **Sonnet 4.6** | $3/$15/M | Implementation, review, moderate reasoning (DEFAULT for subagents) |
| **Haiku 4.5** | $0.80/$4/M | Mechanical search, extraction, simple queries |

**Default: Sonnet 4.6** — Sonnet is now near-Opus for coding (79.6% SWE-bench). Use Opus only for deep reasoning.

### Multi-Model Integration

External models (Codex, Gemini, Nano Banana) are available as **opt-in** supplements to Claude. For provider routing rules, defaults, and cost policy, see `.claude/specs/provider-routing-spec.md §2`. Configuration: `.claude/config/multi-model.toml`.

### Implementation Agents

| Agent | Model | Skills | Permission | Memory |
|-------|-------|--------|------------|--------|
| python-backend-engineer | sonnet | skillmeat-cli, artifact-tracking | acceptEdits | project |
| ui-engineer-enhanced | sonnet | frontend-design, aesthetic, artifact-tracking | acceptEdits | project |
| ui-engineer | sonnet | frontend-design, aesthetic | acceptEdits | - |
| frontend-developer | sonnet | frontend-design | acceptEdits | - |
| frontend-architect | sonnet | - | acceptEdits | - |
| backend-architect | sonnet | - | acceptEdits | - |
| backend-typescript-architect | sonnet | - | acceptEdits | - |
| nextjs-architecture-expert | sonnet | - | acceptEdits | - |
| data-layer-expert | sonnet | - | acceptEdits | - |
| refactoring-expert | sonnet | - | acceptEdits | - |
| openapi-expert | sonnet | artifact-tracking | acceptEdits | - |
| ai-engineer | sonnet | - | acceptEdits | - |
| documentation-complex | sonnet | - | acceptEdits | - |

### Exploration & Analysis

| Agent | Model | Skills | Permission | Memory |
|-------|-------|--------|------------|--------|
| codebase-explorer | haiku | symbols | plan | project |
| search-specialist | haiku | - | plan | - |
| symbols-engineer | haiku | - | plan | - |
| task-decomposition-expert | haiku | - | plan | - |
| implementation-planner | sonnet | planning | plan | - |

### Review & Validation

| Agent | Model | Permission | disallowedTools | Memory |
|-------|-------|------------|-----------------|--------|
| senior-code-reviewer | sonnet | plan | Write, Edit, MultiEdit, Bash | project |
| task-completion-validator | sonnet | plan | Write, Edit, MultiEdit | project |
| karen | opus | plan | Write, Edit, MultiEdit | - |
| api-librarian | sonnet | plan | Write, Edit, MultiEdit | - |
| telemetry-auditor | sonnet | plan | Write, Edit, MultiEdit | - |
| code-reviewer | - | plan | Write, Edit, MultiEdit, Bash | - |
| a11y-sheriff | - | plan | - | - |

### Orchestration (Opus Only)

| Agent | Model | Skills | Permission | Memory |
|-------|-------|--------|------------|--------|
| lead-architect | opus | planning | default | - |
| lead-pm | opus | planning, artifact-tracking, meatycapture-capture | default | project |
| spike-writer | opus | planning | default | - |
| ultrathink-debugger | opus | - | acceptEdits | project |
| documentation-planner | opus | - | plan | - |
| platform-engineer | opus | - | acceptEdits | - |

### Documentation

| Agent | Model | Permission |
|-------|-------|------------|
| documentation-writer | haiku | acceptEdits |
| documentation-expert | haiku | acceptEdits |
| api-documenter | haiku | acceptEdits |
| changelog-generator | haiku | acceptEdits |
| technical-writer | haiku | - |

### PM & Planning

| Agent | Model | Skills |
|-------|-------|--------|
| prd-writer | sonnet | planning |
| feature-planner | sonnet | planning, artifact-tracking |

### Agent Teams (Experimental)

For multi-component features, use Agent Teams instead of sequential subagents:

| Team Template | Lead | Teammates | Use When |
|---------------|------|-----------|----------|
| feature-team | Opus orchestrator | python-backend-engineer, ui-engineer-enhanced, task-completion-validator | Full feature (API + frontend + tests) |
| debug-team | ultrathink-debugger | codebase-explorer, python-backend-engineer | Complex debugging with parallel investigation |
| refactor-team | Opus orchestrator | python-backend-engineer, ui-engineer-enhanced, code-reviewer | Cross-layer refactoring |

**Use Subagents for**: Single-file fixes, batch ops, exploration, docs, review, quick features (< 3 files).
**Use Agent Teams for**: Full features (5+ files), cross-cutting refactors, multi-system integration, phase execution with 3+ batches.

### Background Execution

Subagents can run in the background, allowing parallel work:

| Parameter | Purpose |
|-----------|---------|
| `run_in_background: true` | Launch agent without blocking |
| `TaskOutput(task_id)` | Retrieve results (blocking by default) |
| `TaskOutput(task_id, block: false)` | Check status without waiting |

**When to Use Background Execution**:

- Large batch parallelization (5+ independent tasks)
- When Opus needs to do work between launching and collecting results
- Long-running tasks where Opus can productively continue

**When NOT to Use**:

- Small batches (2-3 tasks) - standard parallel is simpler
- When results are immediately needed
- When tasks have dependencies requiring sequential execution

### Context Budget Discipline

**Invariants**: `.claude/rules/context-budget.md` (auto-loaded every session)

**Budget**: ~52K baseline leaves ~148K for work. Budget ~25-30K per phase.

**Key rules**: No `TaskOutput()` for file-writing agents (verify on disk instead). Task prompts < 500 words (paths, not contents). Don't explore for work you'll delegate. Always scope Glob with `path`.

**Verification pattern for background agents**: See `dev-execution/orchestration/batch-delegation.md`.

### Example Delegation

```text
# Bug: API returns 422 error

1. DELEGATE exploration:
   Task("codebase-explorer", "Find ListItemCreate schema and where it's used")
   # codebase-explorer is pre-configured as haiku with plan permissionMode

2. DELEGATE fix:
   Task("python-backend-engineer", "Fix ListItemCreate schema - make list_id optional.
        File: services/api/app/schemas/list_item.py
        Change: list_id from required to optional (int | None = None)
        Reason: list_id comes from URL path, not request body")
   # python-backend-engineer is pre-configured as sonnet with acceptEdits

3. COMMIT (Opus does this directly):
   git add ... && git commit
```
