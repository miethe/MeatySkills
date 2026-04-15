---
description: Debug and remediate bugs with severity-gated workflows via debug skill
argument-hint: "<bug-description> [--severity=critical|high|medium|low] [--component=name] [--triage-only]"
allowed-tools: Read, Grep, Glob, Edit, MultiEdit, Write, Skill,
  Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(npm:*), Bash(pytest:*),
  Bash(uv:*), Bash(pre-commit:*), Bash(ls:*), Bash(find:*), Bash(rm:*),
  Task, mcp__claude-in-chrome__*
---

# Debug and Remediation

Analyze and fix: `$ARGUMENTS`

## Step 0: Load Required Skills (MANDATORY)

**Execute this Skill tool call NOW before any other action:**

```
Skill("debugging")
```

Do NOT proceed past Step 0 until the debugging skill is loaded.

---

## Step 1: Severity Triage

If `--severity` was provided in `$ARGUMENTS`, use it directly and skip inline triage.

If `--triage-only` flag is set, load `[.claude/skills/debugging/modes/triage.md]` and stop after assessment.

Otherwise, perform inline severity assessment per `[.claude/skills/debugging/references/severity-assessment.md]`:

| Severity | Criteria | Mode |
|----------|----------|------|
| **Critical** | Production down, data loss, security breach | Comprehensive (urgent) |
| **Complex** | Multi-component, root cause unclear, cross-layer | Comprehensive |
| **Moderate** | Isolated, reproducible, 3-5 files | Quick Fix + validation |
| **Simple** | Clear cause, 1-2 files, low risk | Quick Fix |

After determining severity, if Complex or Critical:

```
Skill("planning")
Skill("artifact-tracking")
```

## Step 2: Route to Mode

Load the appropriate mode from the debug skill:

| Severity | Mode |
|----------|------|
| Simple / Moderate | [.claude/skills/debugging/modes/quick-fix.md] |
| Complex / Critical | [.claude/skills/debugging/modes/comprehensive-remediation.md] |

For domain-specific investigation, also load the relevant troubleshooting guide:
- Python/FastAPI → [.claude/skills/debugging/references/troubleshooting/api-backend.md]
- React/Next.js → [.claude/skills/debugging/references/troubleshooting/frontend-react.md]
- Database/SQLAlchemy → [.claude/skills/debugging/references/troubleshooting/database.md]
- Cross-layer → [.claude/skills/debugging/references/troubleshooting/cross-layer.md]

## Step 3: Execute Mode Workflow

Follow the loaded mode's workflow. All implementation is delegated to subagents per the debug skill's agent routing guide at `[.claude/skills/debugging/references/agent-routing.md]`.

## Git Context

!`git status --porcelain`

!`git log --oneline -5`

!`git branch --show-current`
