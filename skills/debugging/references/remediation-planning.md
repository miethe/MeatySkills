# Remediation Planning Reference

How to create formal remediation plans for complex bugs using the planning skill.

**When to use**: Complex or Critical bugs that require > 5 file changes, multi-phase work, API contract changes, dual-edition impact, rollback planning, or design gap resolution.
**When NOT to use**: Simple/Moderate bugs that can be fixed inline. Use quick-fix mode instead.

---

## Decision: Formal Plan vs Inline Fix

| Condition | Action |
|-----------|--------|
| <= 5 files, clear path, single session | Inline plan (table in commit/triage) |
| > 5 files | Formal plan |
| Multi-phase work needed | Formal plan |
| API contract change | Formal plan |
| Both editions affected | Formal plan |
| Rollback strategy needed | Formal plan |
| Design gap revealed | Formal plan + possible ADR |

---

## Creating a Formal Remediation Plan

### Step 1: Load Planning Skill

```
Skill("planning")
Skill("artifact-tracking")
```

### Step 2: Use Templates

- **Implementation plan template**: `.claude/skills/planning/templates/implementation-plan-template.md`
- **Phase breakdown template**: `.claude/skills/planning/templates/phase-breakdown-template.md`

### Step 3: Write the Plan

**Save to**: `docs/project_plans/implementation_plans/bugfix/[slug]-v1.md`

#### Required Frontmatter

```yaml
---
schema_version: 2
doc_type: implementation-plan
status: draft
created: [today YYYY-MM-DD]
updated: [today YYYY-MM-DD]
feature_slug: bugfix-[slug]
feature_version: 1
prd_ref: "[path to most relevant PRD]"
related_documents:
  - "[implementation plan path]"
  - "[ADR path]"
risk_level: [high | critical]
owner: "[agent or user]"
priority: [P0 | P1 | P2]
plan_structure: [unified | independent]
execution_model: "opus-orchestrated"
---
```

If no PRD exists: `prd_ref: "none — pattern-based fix"`

#### Required Sections

**1. Root Cause Analysis**

```markdown
## Root Cause Analysis

**Bug**: [description]
**Discovered via**: [stack trace | user report | test failure | monitoring]
**Root cause**: [detailed explanation]
**Reproduction**: [steps or test case]
**Impact**: [what breaks, who is affected]
```

**2. Design Intent**

```markdown
## Design Intent

**Related PRD**: [title] ([path])
**Original intent**: [what the PRD specified]
**Current state**: [how implementation diverges]
**Classification**: [implementation error | missing requirement | design gap]
```

**3. Architecture Alignment**

```markdown
## Architecture Alignment

**Affected layers**: [router | service | repository | DB | frontend]
**Existing patterns**: [paths to similar working code in the codebase]
**Fix approach**: [how the fix follows existing patterns]
**New patterns**: [none, or justify any new patterns]
**Edition impact**: [local-only | enterprise-only | both]
```

**4. Remediation Strategy**

```markdown
## Remediation Strategy

**Chosen approach**: [description]
**Rationale**: [why this approach]
**Alternatives considered**:
- [Alternative A] — rejected because [reason]
- [Alternative B] — rejected because [reason]
```

**5. Phase Breakdown**

Use the standard task table format:

```markdown
## Phase 1: [Phase Name]

**Entry criteria**: [what must be true before starting]
**Exit criteria**: [what must be true to mark complete]

| Task ID | Name | Description | Acceptance Criteria | Est | Agent | Model | Effort | Deps |
|---------|------|-------------|--------------------|----|-------|-------|--------|------|
| BF-1.1 | [name] | [desc] | [criteria] | [pts] | [agent] | sonnet | default | - |
| BF-1.2 | [name] | [desc] | [criteria] | [pts] | [agent] | sonnet | default | BF-1.1 |
```

**Parallelization** (YAML block for batch execution):

```yaml
parallelization:
  batch_1: [BF-1.1, BF-1.2]  # No file overlap
  batch_2: [BF-1.3]           # Depends on batch_1
```

**6. Risk Assessment**

```markdown
## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk] | [low/med/high] | [description] | [mitigation strategy] |

**Rollback strategy**: [how to undo if fix causes issues]
```

**7. Validation Plan**

```markdown
## Validation Plan

| Check | Command | Expected Result |
|-------|---------|----------------|
| Unit tests | `pytest tests/[specific]` | All pass |
| Type check | `mypy skillmeat/[module]` | No errors |
| API contract | `diff openapi.json` | Only expected changes |
| Integration | [specific test] | [specific result] |
```

### Step 4: Create Progress Tracking

**Save to**: `.claude/progress/bugfix-[slug]/phase-1-progress.md`

```yaml
---
schema_version: 2
doc_type: progress
prd: "bugfix-[slug]"
phase: 1
status: pending
created: [today]
updated: [today]
prd_ref: "[same as plan]"
plan_ref: "docs/project_plans/implementation_plans/bugfix/[slug]-v1.md"
tasks:
  - id: "BF-1.1"
    status: pending
    assigned_to: ["[agent]"]
    dependencies: []
  - id: "BF-1.2"
    status: pending
    assigned_to: ["[agent]"]
    dependencies: ["BF-1.1"]
parallelization:
  batch_1: ["BF-1.1", "BF-1.2"]
  batch_2: ["BF-1.3"]
---
```

---

## Handoff Format

When the plan is complete but implementation is for a future session:

```markdown
## Handoff

**Remediation plan**: docs/project_plans/implementation_plans/bugfix/[slug]-v1.md
**Progress tracking**: .claude/progress/bugfix-[slug]/phase-1-progress.md
**Request log**: [REQ-ID]

**To execute**: `/dev:execute-phase 1`
**PRD context**: [linked PRD path]
**Priority**: [P0 | P1 | P2]
**Estimated phases**: [N]
**Estimated total effort**: [points]

**Key decisions made**:
1. [decision with rationale]
2. [decision with rationale]

**Open questions** (if any):
- [question needing answer before execution]
```

---

## Inline Plan Format

For complex bugs that don't warrant a formal document but need more structure than a simple fix:

```markdown
## Inline Remediation Plan

**Root Cause**: [cause]
**Related PRD**: [path or "none"]
**Architecture Alignment**: [how fix fits existing patterns]

| Step | File | Change | Agent | Validation |
|------|------|--------|-------|------------|
| 1 | [path] | [change] | [agent] | [test] |
| 2 | [path] | [change] | [agent] | [test] |
| 3 | [path] | [change] | [agent] | [test] |

**Risks**: [assessment]
**Rollback**: [strategy or "not needed — isolated change"]
```
