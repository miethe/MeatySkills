# Agent Routing Reference

Comprehensive agent selection and delegation guide for all debug modes.

**When to use**: Any debug workflow that requires delegating investigation or implementation.
**When NOT to use**: N/A — always reference this for delegation decisions.

---

## Agent Selection by Domain

### Investigation Agents

| Domain | Agent | Model | Cost | Use When |
|--------|-------|-------|------|----------|
| Any (first pass) | codebase-explorer | Haiku | Low | Pattern discovery, file location, architecture mapping |
| Any (deep analysis) | ultrathink-debugger | Opus | High | Root cause unclear after initial investigation, complex interactions |
| Symbols only | (direct query) | — | Minimal | `grep "[name]" ai/symbols-*.json` — always try this first |

**Escalation path**: Symbols → codebase-explorer → ultrathink-debugger

### Implementation Agents

| Domain | Agent | Model | Use When |
|--------|-------|-------|----------|
| Python/FastAPI backend | python-backend-engineer | Sonnet | Routers, services, repositories, schemas, middleware |
| React/Next.js frontend | ui-engineer-enhanced | Sonnet | Components, hooks, pages, styles |
| TypeScript backend | backend-typescript-architect | Sonnet | TS server code, API clients |
| Database/SQLAlchemy | data-layer-expert | Sonnet | Models, migrations, queries, ORM patterns |
| API contracts/OpenAPI | python-backend-engineer | Sonnet | OpenAPI spec, schema alignment |
| Build/CI/Deploy | platform-engineer | Opus | Dockerfiles, compose, CI pipelines |
| Performance (React) | react-performance-optimizer | Sonnet | Rendering, bundle, Core Web Vitals |
| Accessibility | ui-engineer-enhanced | Sonnet | ARIA, keyboard nav, screen readers |

### Decision Agents (Complex/Cross-Layer)

| Scenario | Agent | Model | Role |
|----------|-------|-------|------|
| Cross-layer fix | lead-architect | Opus | Makes architectural decision, then delegates to specialists |
| Design gap found | lead-architect | Opus | Decides whether to fix implementation or revise design |
| Pattern conflict | lead-architect | Opus | Chooses which pattern should be canonical |

### Validation Agents

| Scenario | Agent | Model | Use When |
|----------|-------|-------|----------|
| General validation | task-completion-validator | Sonnet | 3+ files changed, verify acceptance criteria |
| Architecture review | senior-code-reviewer | Sonnet | Complex/Critical fixes, pattern compliance |
| API compliance | api-librarian | Sonnet | API contract changes, error envelope, pagination |
| Accessibility | a11y-sheriff | Sonnet | UI changes affecting accessibility |
| Code quality | code-reviewer | — | Post-fix quality check |

**Validation routing**:
- 1-2 files changed → Opus runs tests directly
- 3+ files changed → delegate to task-completion-validator
- Architectural changes → delegate to senior-code-reviewer
- API changes → delegate to api-librarian
- Never run type-check/lint/test as Opus for > 2 file changes

---

## Delegation Templates

### Standard Fix Delegation

```
Task("[AGENT]", "Fix [BUG_DESCRIPTION]:

Context: [brief bug context + root cause from triage]
Location: [file paths — NOT contents]
Root Cause: [identified cause]

Required Changes:
- [change 1 with specific details]
- [change 2 with specific details]

Pattern Reference: [path to similar existing code to follow]

Constraints:
- Follow existing patterns (don't introduce new ones)
- No validation reports or temp scripts
- No temp test files

Acceptance Criteria:
- [specific testable criterion 1]
- [specific testable criterion 2]")
```

### Deep Investigation Delegation

```
Task("ultrathink-debugger", "Deep analysis of [BUG]:

Symbol context: [relevant symbol query results]
Files identified so far: [paths from codebase-explorer]
Initial hypothesis: [your current hypothesis]
What's unclear: [specific questions]

Provide:
1. Root cause confirmation or alternative hypothesis
2. Full affected code path chain
3. Fix strategies ranked by risk (prefer existing patterns)
4. Risk assessment for each strategy
5. Recommended approach with justification")
```

### Validation Delegation

```
Task("task-completion-validator", "Validate fix for [BUG]:

Files changed: [list of paths]
Expected behavior: [what should work now]
Root cause was: [brief cause]

Verify:
- [specific test command and expected result]
- [specific assertion to check]
- No regressions in [related area]

Do NOT create validation reports or temp scripts.")
```

### Architectural Review Delegation

```
Task("senior-code-reviewer", "Review fix for [BUG]:

Files changed: [list of paths]
Root cause: [cause]
Related PRD: [path]
Fix approach: [brief description]

Verify:
- Fix follows existing architectural patterns
- No new patterns introduced unnecessarily
- Layer boundaries respected (router → service → repository → DB)
- API contracts maintained
- Enterprise/local edition parity preserved
- Test coverage adequate for the change")
```

---

## Batch Delegation Rules

For multi-file fixes, follow file-ownership-first batching:

### Rule 1: One Agent Per File

Never assign 2 agents to edit the same file in parallel. Even if they edit different sections, file contention risks merge conflicts.

### Rule 2: Group by File Ownership

```
# GOOD: Each agent owns distinct files
Batch 1 (parallel):
  Agent A → file_a.py
  Agent B → file_b.tsx

# BAD: Two agents touch the same file
Batch 1 (parallel):
  Agent A → file_a.py (lines 1-50)
  Agent B → file_a.py (lines 100-150)  # CONFLICT RISK
```

### Rule 3: Sequential Across Batches

```
Batch 1 (parallel): [independent changes, no file overlap]
  ↓ wait for completion
Batch 2 (parallel): [changes depending on batch 1]
  ↓ wait for completion
Batch 3 (parallel): [tests and validation]
```

### Rule 4: Verify on Disk, Not via TaskOutput

Don't call `TaskOutput()` for file-writing agents (~7.5K tokens wasted). Instead:

```bash
# Check files exist and were modified
git diff --stat

# Run type checking to verify correctness
pnpm type-check  # or mypy
```

### Rule 5: Task Prompts Under 500 Words

Provide file paths, not file contents. The subagent reads files itself. Reference patterns by path: "follow the pattern in `skillmeat/api/routers/artifacts.py`".

---

## Domain-Specific Troubleshooting References

Load the relevant guide for deeper investigation:

| Domain | Reference |
|--------|-----------|
| Python/FastAPI | [troubleshooting/api-backend.md](./troubleshooting/api-backend.md) |
| React/Next.js | [troubleshooting/frontend-react.md](./troubleshooting/frontend-react.md) |
| Database/SQLAlchemy | [troubleshooting/database.md](./troubleshooting/database.md) |
| Cross-layer integration | [troubleshooting/cross-layer.md](./troubleshooting/cross-layer.md) |
