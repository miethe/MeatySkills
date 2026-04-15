---
description: Plan new features with PRD, implementation plan, and progress tracking using planning and artifact-tracking skills
allowed-tools: Task, Skill, Read, Write, Edit, Bash
argument-hint: "[request-or-file] [--impl-only|-i] [--plan-progress|-p] [--all|-a]"
---

**You are Opus. Tokens are expensive. You orchestrate; subagents execute.**

You must use subagents to perform all tasks, only delegating work. Use them wisely to optimize for reasoning, with all token-heavy work being delegated.

**Commit often.**

---

## Mode Selection

Parse mode from "$ARGUMENTS":

- `--impl-only` or `-i`: Implementation Plan only (skip PRD)
- `--plan-progress` or `-p`: Plan + Progress tracking artifacts only
- `--all` or `-a` (default if no flag): Full process - PRD (if complex), Implementation Plan, and tracking artifacts

## Understanding the Pattern

**The Pattern**:
1. You invoke a skill → skill expands with instructions/tools
2. You read the skill's instructions
3. You follow those instructions, which direct you to delegate to subagents

**Skills contain the logic; this command standardizes the invocation order.**

## Workflow

### Mode: --all (Default)

1. **Invoke planning skill**:
   - Skill expands with planning instructions
   - Skill directs you to delegate to subagents like `prd-writer`, `implementation-planner`
   - Follow skill's instructions to generate PRD (if complex) and Implementation Plan
   - Break plans >800 lines into phase files per skill guidance

2. **Invoke artifact-tracking skill**:
   - Skill expands with tracking artifact instructions
   - Skill provides YAML+Markdown format guidance
   - Follow skill's instructions to create progress files (ONE per phase) and context file (ONE per PRD)
   - Include assigned_to and dependencies per skill templates

### Mode: --impl-only

1. **Invoke planning skill**:
   - Skill expands with planning instructions
   - Follow skill's instructions to skip PRD, generate Implementation Plan only
   - Skill directs which subagents to use for plan generation
   - Break plans >800 lines into phase files per skill guidance

### Mode: --plan-progress

1. **Invoke planning skill**:
   - Skill expands with planning instructions
   - Follow skill's instructions to generate Implementation Plan
   - Break plans >800 lines into phase files per skill guidance

2. **Invoke artifact-tracking skill**:
   - Skill expands with tracking artifact instructions
   - Follow skill's instructions to create progress and context files
   - Include assigned_to and dependencies per skill templates

## Execution

For all modes:

```markdown
# Step 1: Planning
skill: "planning"
[Wait for skill to expand]
[Read skill's instructions]
[Follow instructions - they will direct you to delegate to subagents like ai-artifacts-engineer, prd-writer, implementation-planner]

# Step 2: Tracking (if not --impl-only)
skill: "artifact-tracking"
[Wait for skill to expand]
[Read skill's instructions]
[Follow instructions to create tracking artifacts with subagents]
```

**Your role**: Read skill instructions → follow them → delegate to subagents as directed.

## Input Handling

"$ARGUMENTS" may contain:
- Inline feature description
- Path to PRD file
- Path to feature request document
- Mode flags (--impl-only, --plan-progress, --all)

Pass the full input to the skills - they will parse appropriately.

<!-- MeatyCapture Integration - Project: skillmeat -->
## Discovery Phase

Before planning, search request-logs for related items:
- `/mc search "feature-keyword" skillmeat` - Find related bugs/enhancements
- `/mc search "type:bug domain:web" skillmeat` - Find domain-specific bugs to incorporate

## Token Discipline (Mandatory)

**Before reading ANY source document (SPIKE, ADR, design spec, research), ask: "Will a subagent also read this?"** If yes, don't read it — provide the path instead.

### Delegation-First Checklist

1. **OQ Assessment**: If you need to check whether open questions are resolved before deciding PRD-only vs full plan:
   - **DO**: Delegate to haiku: `"Check if OQs in [design-spec] §N are resolved by [spike-findings]. Table format, under 200 words."`
   - **DON'T**: Read both documents into Opus context (~7K tokens wasted)

2. **PRD Delegation**: Prompt = file paths + frontmatter + scope + deferred items
   - **Target**: 30-50 lines. Paths to template, SPIKE, ADR, design spec
   - **DON'T**: Extract model schemas, API surfaces, or design rationale into the prompt

3. **Implementation Plan Delegation**: Prompt = PRD path + template + phase hint
   - **Target**: 40-60 lines. Reference subagent-assignments and multi-model guidance by path
   - **DON'T**: Copy task descriptions, code snippets, or SPIKE content into the prompt

4. **Progress File Delegation**: Prompt = implementation plan path + template path + output dir
   - **Target**: 20-30 lines. Agent extracts task IDs, descriptions, and dependencies itself
   - **DON'T**: Manually extract 45 task IDs and dependency chains into the prompt

### What Opus MAY Read Directly

- Tracker/meta-plan entry (~5-10 lines) — to determine readiness and mode
- Implementation plan's phase overview table (~20 lines) — for cross-reference edits
- Frontmatter of docs being updated (~15 lines) — for surgical edits

### What Opus Must NOT Read

- Full SPIKE findings (delegate comprehension to prd-writer)
- Full ADRs (prd-writer references these)
- Full implementation plan body (progress agent reads this)
- Phase breakout files (progress agent reads these)

## Critical Reminders

- **Never write code directly** - delegate to specialized subagents
- **Never explore codebases yourself** - use codebase-explorer
- **Never read source docs subagents will also read** - provide paths only
- **Focus on reasoning** - all implementation is delegated
- **Update progress immediately** after task completion
- **Commit after changes** - don't batch commits
- **Plan for deferrals upfront** — scan the PRD for deferred items, backlog items, open questions, and research-needed items. Every deferred item must get a design-spec authoring task in the final phase (DOC-006) so nothing is lost. See `.claude/skills/planning/references/deferred-items-and-findings.md`.
- **Findings doc is lazy** — only created on the first real finding during execution. Initialize `findings_doc_ref: null` in plan frontmatter; populate only when a finding forces creation.

Use Task() commands from progress file Quick Reference sections for maximum efficiency.
