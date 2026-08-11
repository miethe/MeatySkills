# Agent Assignments

> **Model policy:** [`docs/agentic-operator/MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md) (§1.5 scorecard) is canonical. Model/effort tables in this file are derived convenience copies — when they disagree, MODEL-ROUTING wins; update it first, then re-derive here. Resolve provider/model per leg via the `delegation-router` skill; the platform skills (`ica-delegate`, `codex`, `gemini-cli`) only execute the decision.

Complete guide for selecting the right agent for each task type.

## Quick Reference

| Task Type | Agent | Model |
|-----------|-------|-------|
| Find files/patterns | codebase-explorer | Haiku 4.5 |
| Deep analysis | explore | Haiku 4.5 |
| Debug investigation | ultrathink-debugger | Sonnet |
| React/UI components | ui-engineer-enhanced | Sonnet |
| TypeScript backend | backend-typescript-architect | Sonnet |
| Validation/review | task-completion-validator | Sonnet |
| Most docs (90%) | documentation-writer | Haiku 4.5 |
| Complex docs | documentation-complex | Sonnet |
| AI artifacts | ai-artifacts-engineer | Sonnet |

## Detailed Agent Descriptions

### Pattern Discovery & Analysis

#### codebase-explorer
**Use for**: Finding files, patterns, similar implementations
**Model**: Haiku 4.5 (fast, cheap)
**Examples**:
- Find existing auth patterns
- Locate component conventions
- Discover test patterns

#### explore
**Use for**: Deep analysis, understanding complex code
**Model**: Haiku 4.5
**Examples**:
- Understand data flow
- Analyze architecture decisions
- Research implementation approaches

### Implementation

#### ui-engineer-enhanced
**Use for**: React components, hooks, frontend logic
**Model**: Sonnet
**Examples**:
- Create Button component
- Implement useAuth hook
- Build form validation

#### backend-typescript-architect
**Use for**: TypeScript backend, services, APIs
**Model**: Sonnet
**Examples**:
- Implement API endpoint
- Create service layer
- Build repository pattern

### Debugging

#### ultrathink-debugger
**Use for**: Complex bugs, production issues, mysterious failures
**Model**: Sonnet
**Examples**:
- Debug intermittent test failures
- Investigate production errors
- Root cause analysis

### Validation

#### task-completion-validator
**Use for**: Validating implementations, checking criteria
**Model**: Sonnet
**Examples**:
- Validate task completion
- Check acceptance criteria
- Verify architecture compliance

### Documentation

#### documentation-writer
**Use for**: 90% of docs (READMEs, API docs, guides)
**Model**: Haiku 4.5 (fast, efficient)
**Examples**:
- Write README
- Document API endpoints
- Create setup guides

#### documentation-complex
**Use for**: Complex docs requiring deep analysis
**Model**: Sonnet
**Examples**:
- Multi-system integration docs
- Architecture decision records
- Strategic technical documentation

### Review

#### senior-code-reviewer
**Use for**: Comprehensive code review
**Model**: Sonnet
**Examples**:
- Final PR review
- Security review
- Architecture review

## Task-to-Agent Mapping

### Backend Tasks

| Task | Agent |
|------|-------|
| API endpoint implementation | backend-typescript-architect |
| Service layer logic | backend-typescript-architect |
| Repository patterns | backend-typescript-architect |
| Schema/DTO design | backend-typescript-architect |
| Database migrations | backend-typescript-architect |

### Frontend Tasks

| Task | Agent |
|------|-------|
| React component | ui-engineer-enhanced |
| Custom hook | ui-engineer-enhanced |
| Page/route | ui-engineer-enhanced |
| State management | ui-engineer-enhanced |
| Form handling | ui-engineer-enhanced |

### Testing Tasks

| Task | Agent |
|------|-------|
| Unit tests | Same as implementation agent |
| Integration tests | backend-typescript-architect |
| E2E tests | ui-engineer-enhanced |
| A11y tests | ui-engineer-enhanced |

### Research Tasks

| Task | Agent |
|------|-------|
| Find similar patterns | codebase-explorer |
| Understand existing code | explore |
| Locate configuration | codebase-explorer |
| Analyze dependencies | explore |

## Agent Selection Rules

### Rule 1: Match Domain to Expertise

- UI work → ui-engineer-enhanced
- Backend work → backend-typescript-architect
- Mixed → Use both agents for their respective parts

### Rule 2: Use Cheapest Sufficient Model

- Pattern discovery: Haiku 4.5 (codebase-explorer)
- Documentation: Haiku 4.5 (documentation-writer)
- Implementation: Sonnet (ui-engineer-enhanced, backend-typescript-architect)

### Rule 3: Escalate When Needed

- Simple issue → try direct fix
- Complex issue → ultrathink-debugger
- Critical review → senior-code-reviewer

### Rule 4: Never Skip Validation

Always use task-completion-validator after:
- Major feature completion
- Milestone completion
- Phase completion

## Delegation Template

> **The leg contract is mandatory, and the full template lives in one place.** Every delegated
> implementation leg carries the five leg-contract fields (file-ownership boundary, interface names,
> real endpoint/field names, verification path, budget + exit) plus the missing-name escape —
> [`../references/execution-doctrine.md`](../references/execution-doctrine.md) rule 6, rendered as a
> paste-ready template in [`batch-delegation.md`](./batch-delegation.md) § "Task Delegation
> Template". Use that template; the skeleton below is the agent-selection view of the same dispatch,
> not a lighter alternative to it.

```
@{agent}

Phase ${phase_num}, {task_id}: {task_title}

Context:
- Story/Feature: {context}
- Files you own (ONE ownership boundary; everything else read-only): {files}
- Interfaces / real field names (verbatim from the tree): {names}

Requirements:
{requirements}

Verification path (test through the path production takes; name the command):
{command} — an offline fake or a test-only code path is not evidence.

Project Patterns:
- Layered architecture
- ErrorResponse envelopes
- Cursor pagination
- Telemetry spans

Success Criteria:
- [ ] {criterion 1}
- [ ] {criterion 2}
```
