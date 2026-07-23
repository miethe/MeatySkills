---
title: "Phase [N]: [Phase Name]" # Human-readable phase plan title
schema_version: 2 # CCDash frontmatter schema version
doc_type: phase_plan # Must remain `phase_plan`
status: draft # draft|planning|in-progress|review|completed|blocked
created: YYYY-MM-DD # Initial creation date (YYYY-MM-DD)
updated: YYYY-MM-DD # Last edit date (YYYY-MM-DD)
feature_slug: "feature-name" # Kebab-case feature identifier
feature_version: "v1" # Version label for this feature document set
phase: [N] # Numeric phase identifier (integer)
phase_title: "[Phase Name]" # Short phase name for dashboards
prd_ref: /docs/project_plans/PRDs/category/feature-name-v1.md # Parent PRD path
plan_ref: /docs/project_plans/implementation_plans/category/feature-name-v1.md # Parent implementation plan path
entry_criteria: [] # Preconditions required to start this phase
exit_criteria: [] # Conditions that define phase completion
related_documents: [] # Related docs (phase siblings, ADRs, specs)
spike_ref: null          # Set after SPIKE research
adr_refs: []             # Add as decisions are made
charter_ref: null        # Set if charter-driven SPIKE
changelog_ref: null      # Set during doc finalization
test_plan_ref: null      # Set if formal test plan created
integration_owner: null  # NEW (§4.2) — required when phase has ≥2 owner specialties with overlapping files_affected; set to the agent/role responsible for cross-owner seam verification (R-P3)
ui_touched: false        # NEW (§4.2) — set true when any *.tsx file appears in files_affected; auto-derived by generator; triggers R-P4 smoke gate
target_surfaces: []      # NEW (§4.2) — union of all task target_surfaces for this phase; path strings relative to repo root (see references/ac-schema.md §aq1)
seam_tasks: []           # NEW (§4.2) — task IDs that span owner boundaries; gated on all upstream tasks being completed (R-P3)
owner: null # Single accountable owner (name or agent)
contributors: [] # Supporting contributors
priority: medium # low|medium|high|critical
risk_level: medium # low|medium|high|critical
category: "product-planning" # Planning taxonomy label
tags: [phase-plan, implementation] # Search/filter tags
milestone: null # Optional release/milestone marker
commit_refs: [] # Commit SHAs added during implementation
pr_refs: [] # Pull request refs (e.g., #123)
files_affected: [] # Key files expected to change
---

# Phase [N]: [Phase Name]

**Parent Plan**: [Link to parent implementation plan]
**Duration**: [X] days
**Effort**: [X] story points
**Dependencies**: [Phase N-1 complete | None]
**Team Members**: [Developer roles needed]

---

## Phase Overview

[Brief description of what this phase accomplishes and why it's needed]

### Goals

- [Goal 1]
- [Goal 2]
- [Goal 3]

### Architecture Focus

This phase implements the [layer name] following MeatyPrompts architecture:
- **Layer**: [Database | Repository | Service | API | UI | Testing | Documentation | Deployment]
- **Patterns**: [Specific patterns used]
- **Standards**: [Relevant standards]

---

## Task Breakdown

### Epic: [Epic Name]

| Task ID | Task Name | Description | Acceptance Criteria | Estimate | Assigned Subagent(s) | Model | Effort | Dependencies |
|---------|-----------|-------------|-------------------|----------|---------------------|-------|--------|--------------|
| [ID-001] | [Task Name] | [Description] | [Criteria] | [X] pts | [subagent-1, subagent-2] | sonnet | adaptive | [None or ID] |
| [ID-002] | API Documentation | [Description] | [Criteria] | [0.5] pts | documentation-writer | haiku | adaptive | [ID-001] |
| [ID-003] | Image Generation | [Description] | [Criteria] | [X] pts | [subagent-1] | nano-banana-pro | standard | [ID-001] |

**Model Selection Guidance**: Refer to `.claude/config/multi-model.toml` for valid model values and effort policies:
- **Sonnet** (default implementation): Complex features, multi-file changes, moderate reasoning
- **Haiku** (default docs/extraction): Documentation, mechanical search, simple queries
- **External models**: Use as specified in task (e.g., `nano-banana-pro` for images, `gemini-3.1-pro-preview` for web research)

**Effort Policy** (see `.claude/config/multi-model.toml`):
- **adaptive**: Default reasoning for most tasks; model uses graduated thinking as needed
- **standard**: Fixed, lighter reasoning mode (use for simple/mechanical tasks)
- **medium/high**: Explicit reasoning gates (use for complex debugging, design decisions)

---

## Detailed Task Specifications

### Task [ID-001]: [Task Name]

**Estimate**: [X] points
**Assigned Subagent(s)**: [subagent-1, subagent-2]
**Model**: sonnet (or specify external model if applicable)
**Effort**: adaptive (or: standard, medium, high per `.claude/config/multi-model.toml`)
**Dependencies**: [None or other task IDs]
**started**: null         # NEW (§4.2) — ISO-8601 timestamp; must be non-null when status != pending
**completed**: null       # NEW (§4.2) — ISO-8601 timestamp; must be non-null when status == completed
**verified_by**: []       # NEW (§4.2) — verification-phase task IDs that signed off this task
**evidence**: []          # NEW (§4.2) — file refs, commit SHAs, screenshot paths; e.g. {commit: abc123}, {screenshot: .claude/evidence/phase-N/foo.png}, {test: path/to/test.tsx}

**Description**:
[Detailed description of what needs to be done]

**Acceptance Criteria**:
- [ ] [Criterion 1 with specific, measurable outcome]
- [ ] [Criterion 2 with specific, measurable outcome]
- [ ] [Criterion 3 with specific, measurable outcome]

**Implementation Notes**:
- [Note 1: Technical approach or pattern to use]
- [Note 2: Files to modify or create]
- [Note 3: Integration points to consider]

**Files Involved**:
- `path/to/file1.py` - [What changes are needed]
- `path/to/file2.tsx` - [What changes are needed]

---

### Task [ID-002]: [Task Name]

**Estimate**: [X] points
**Assigned Subagent(s)**: [subagent-1]
**Model**: sonnet (or haiku for documentation)
**Effort**: adaptive
**Dependencies**: [ID-001]
**started**: null
**completed**: null
**verified_by**: []
**evidence**: []

**Description**:
[Detailed description]

**Acceptance Criteria**:
- [ ] [Criterion 1]
- [ ] [Criterion 2]

**Implementation Notes**:
- [Note 1]

**Files Involved**:
- `path/to/file.py` - [Changes needed]

---

## Quality Gates

This phase is complete when:

- [ ] **Functional**: [All features working as specified]
- [ ] **Testing**: [Required test coverage achieved]
- [ ] **Performance**: [Performance benchmarks met]
- [ ] **Security**: [Security requirements met]
- [ ] **Documentation**: [Documentation complete]
- [ ] **Code Quality**: [Linting and quality checks pass]
- [ ] **Architecture**: [Follows MeatyPrompts patterns]
- [ ] **Seam verification** (if `integration_owner` set): seam task(s) listed in `seam_tasks` are completed and `verified_by` references are populated (R-P3)
- [ ] **Runtime smoke** (if `ui_touched: true`): screenshot evidence in `.claude/evidence/phase-[N]/` OR `runtime_smoke: skipped` field with reason recorded — a clean unit-test pass is not a substitute (R-P4)

---

## Integration Points

### External Systems

- **System 1**: [How this phase integrates]
- **System 2**: [How this phase integrates]

### Internal Systems

- **Component 1**: [Integration details]
- **Component 2**: [Integration details]

---

## Key Files Modified

| File Path | Lines | Purpose | Subagent |
|-----------|-------|---------|----------|
| `path/to/file1.py` | 100-150 | [Purpose] | [subagent-1] |
| `path/to/file2.tsx` | 50-80 | [Purpose] | [subagent-2] |
| `path/to/file3.sql` | - | [Purpose] | [subagent-1] |

---

## Testing Strategy

### Unit Tests

- [What unit tests are needed]
- [Coverage targets]

### Integration Tests

- [What integration tests are needed]
- [What scenarios to cover]

### E2E Tests (if applicable)

- [What E2E tests are needed]
- [What user journeys to cover]

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| [Risk 1] | [High/Med/Low] | [How to mitigate] |
| [Risk 2] | [High/Med/Low] | [How to mitigate] |

---

## Success Metrics

- **Completion**: All tasks checked off
- **Quality**: All quality gates passed
- **Performance**: [Specific performance targets]
- **Testing**: [Coverage and passing tests]

---

## Notes

### Implementation Approach

[Notes about the overall approach for this phase]

### Gotchas

- [Gotcha 1]: [What to watch out for]
- [Gotcha 2]: [What to watch out for]

### Learnings

[Capture learnings as phase progresses]

### Findings Captured This Phase

*If any discoveries, plan/reality mismatches, bugs, or schema gaps were found during this phase, append them here AND to the plan's findings doc (`findings_doc_ref`). Create the findings doc lazily on first finding — do not pre-create.*

- [ ] No new findings this phase (default)
- OR
- **Discoveries**: [brief summary + link to findings doc entry]
- **Plan / Reality Mismatches**: [...]
- **Bugs / Gotchas**: [file:line or commit ref]
- **Schema / Data Gaps**: [...]

---

**Phase Version**: 1.0
**Last Updated**: YYYY-MM-DD

[Return to Parent Plan](../[feature-name]-v1.md)
