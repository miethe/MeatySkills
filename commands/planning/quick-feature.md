---
description: Quick feature implementation - streamlined planning + execution for simple enhancements
allowed-tools: Read, Write, Edit, MultiEdit, Bash(git:*), Bash(pnpm:*), Grep, Glob, Task
argument-hint: "[feature-text|file-path|REQ-ID]"
---

# Quick Feature

**You are Opus. Tokens are expensive. Orchestrate; don't implement directly.**

Streamlined planning and execution for simple features: `$ARGUMENTS`

Utilize dev-execution skill for detailed guidance.

## Execution Mode

Load quick execution guidance: [.claude/skills/dev-execution/modes/quick-execution.md]

## Scope Check

**Use this command when:**
- Single-session implementation (~1-3 hours)
- 1-3 files affected
- No cross-cutting concerns

**Use `/dev:execute-phase` instead when:**
- Multi-phase work (>1 day)
- Requires PRD
- Cross-domain changes

## Actions

### 1. Resolve Input

| Pattern | Type | Action |
|---------|------|--------|
| `REQ-YYYYMMDD-*-XX` | Request Log ID | `/mc view` or `/mc search` |
| Starts with `./`, `/`, `~` | File path | Read directly |
| Other | Direct text | Use as description |

### 2. Pattern Discovery

Delegate to **codebase-explorer**: Find existing patterns related to the feature.

### 3. Create Quick Plan

Write to `.claude/progress/quick-features/{feature-slug}.md`

### 4. Execute

Delegate to appropriate agents per [.claude/skills/dev-execution/orchestration/agent-assignments.md]

### 5. Quality Gates

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

### 6. Complete

Update quick plan to `status: completed`.

If from REQ-ID:

```bash
meatycapture log item update DOC ITEM --status done
```

## Skill References

- Quick execution: [.claude/skills/dev-execution/modes/quick-execution.md]
- Agent assignments: [.claude/skills/dev-execution/orchestration/agent-assignments.md]
- Quality gates: [.claude/skills/dev-execution/validation/quality-gates.md]
