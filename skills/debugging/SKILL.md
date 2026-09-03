---
name: debugging
description: "Debug and remediate bugs with severity-gated workflows. Progressive disclosure from quick triage through comprehensive remediation planning. Integrates with planning skill for complex fixes and artifact-tracking for progress. Also provides a post-incident retrospective mode: classifies post-merge gaps against a failure taxonomy and emits a patch-plan addendum. Use when running /fix:debug or /fix:bugfix-commit commands. /fix:debug auto-invokes the retrospective workflow when the prompt contains: 'Codex had to patch', 'gaps after merge', 'we missed', or 'regression after phase'."
---

# Debug Skill

Severity-gated debugging and remediation with token-efficient progressive disclosure.

## Quick Start

| Mode | When to Use | Guide |
|------|-------------|-------|
| Triage | Investigation only, no fix needed yet | [modes/triage.md](./modes/triage.md) |
| Quick Fix | Simple/Moderate bugs (1-5 files, clear root cause) | [modes/quick-fix.md](./modes/quick-fix.md) |
| Comprehensive | Complex/Critical bugs (cross-layer, architectural, unclear cause) | [modes/comprehensive-remediation.md](./modes/comprehensive-remediation.md) |
| Post-Incident Retrospective | Post-merge gaps, regressions that shipped despite being in scope | [modes/post-incident-retrospective.md](./modes/post-incident-retrospective.md) |

## Mode Selection

Assess severity first, then route:

```
Bug / incident reported
  ├─ Prompt contains post-incident phrase? → Post-Incident Retrospective (auto via /fix:debug)
  │     Trigger phrases (case-insensitive substring):
  │       "codex had to patch" | "gaps after merge" | "we missed" | "regression after phase"
  │
  ├─ --triage-only flag? → Triage mode (stop after assessment)
  ├─ --severity provided? → Use directly
  └─ No severity? → Run inline assessment (see references/severity-assessment.md)
       │
       ├─ Simple (1-2 files, clear cause, no arch impact) → Quick Fix
       ├─ Moderate (3-5 files, clear cause, follows patterns) → Quick Fix + validation
       ├─ Complex (5+ files, cross-layer, unclear cause) → Comprehensive
       └─ Critical (production impact, rollback needed) → Comprehensive (urgent)
```

**Upgrade triggers** (any one bumps severity):
- API contract change → at least Complex
- Enterprise/local edition divergence → at least Complex
- New pattern introduction → at least Complex
- Data migration or rollback needed → Critical

## Core Principles

### 1. Delegate Everything

Opus orchestrates; subagents implement. Never write fix code directly. See [references/agent-routing.md](./references/agent-routing.md) for agent selection.

### 2. Severity-First

Always assess severity before choosing an approach. A misclassified bug wastes tokens (too heavy) or misses issues (too light).

### 3. Architecture-Aware

Complex fixes must align with the app's existing design. Don't introduce novel patterns to fix a bug. Find the relevant PRD to understand intended design and fix toward that design.

### 4. PRD-Linked

Comprehensive fixes discover and link to relevant PRDs, implementation plans, and ADRs. The fix should serve the original design intent. See [references/prd-discovery.md](./references/prd-discovery.md).

### 5. Symbol-First Investigation

Start with `ai/symbols-*.json` (150 tokens) before file exploration (5-15K tokens). See `.claude/context/key-context/debugging-patterns.md` for full methodology.

## Agent Assignment Quick Reference

| Task | Agent | Model |
|------|-------|-------|
| Find patterns/files | codebase-explorer | Haiku |
| Deep root cause analysis | ultrathink-debugger | Opus |
| React/UI fixes | ui-engineer-enhanced | Sonnet |
| TypeScript backend | backend-typescript-architect | Sonnet |
| Python/FastAPI backend | python-backend-engineer | Sonnet |
| Database/SQLAlchemy | data-layer-expert | Sonnet |
| API contract fixes | python-backend-engineer | Sonnet |
| Build/CI/Deploy | platform-engineer | Opus |
| Cross-layer (decision) | lead-architect | Opus |
| Code review | senior-code-reviewer | Sonnet |
| Validation | task-completion-validator | Sonnet |
| API validation | api-librarian | Sonnet |
| Accessibility | a11y-sheriff | Sonnet |
| Performance (React) | react-performance-optimizer | Sonnet |

Full routing guide: [references/agent-routing.md](./references/agent-routing.md)

## References

Load only what's needed for the current mode:

| Reference | Purpose | When to Load |
|-----------|---------|--------------|
| [Severity Assessment](./references/severity-assessment.md) | Classification criteria + decision tree | During triage |
| [PRD Discovery](./references/prd-discovery.md) | Finding related PRDs/plans for affected code | Comprehensive mode |
| [Remediation Planning](./references/remediation-planning.md) | Creating formal plans for complex fixes | Comprehensive mode |
| [Agent Routing](./references/agent-routing.md) | Agent selection + delegation patterns | All modes |
| [API/Backend Troubleshooting](./references/troubleshooting/api-backend.md) | Python/FastAPI debugging patterns | Backend bugs |
| [Frontend/React Troubleshooting](./references/troubleshooting/frontend-react.md) | React/Next.js debugging patterns | Frontend bugs |
| [Database Troubleshooting](./references/troubleshooting/database.md) | SQLAlchemy/Alembic debugging patterns | DB bugs |
| [Cross-Layer Troubleshooting](./references/troubleshooting/cross-layer.md) | Integration debugging patterns | Cross-cutting bugs |

## External References

These existing context files provide deep investigation methodology:
- `.claude/context/key-context/debugging-patterns.md` — Symbol-first methodology, bug categories, investigation commands
- `.claude/context/key-context/symbols-query-playbook.md` — Symbol query recipes
- `.claude/skills/dev-execution/orchestration/batch-delegation.md` — Batch delegation patterns
- `.claude/skills/dev-execution/orchestration/agent-assignments.md` — Full agent selection guide

## Quality Gates

All modes share these gates — run after each significant change:

```bash
# TypeScript/Frontend
pnpm test && pnpm type-check && pnpm lint

# Python/Backend
pytest -x && mypy skillmeat --ignore-missing-imports

# Check for temp artifacts (must be clean)
git status --porcelain | grep "^??"
```

## Integration Points

| System | How Debug Skill Uses It |
|--------|------------------------|
| MeatyCapture | Request log entries via `mc-quick.sh` (~50 tokens) |
| Planning Skill | Formal remediation plans for Complex/Critical bugs |
| Artifact Tracking | Progress tracking for multi-phase fixes |
| Bug-Fixes Doc | `.claude/scripts/update-bug-docs.py` for documentation |
