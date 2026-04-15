# Comprehensive Remediation Mode

For Complex and Critical severity bugs. Full architecture review, PRD discovery, and formal remediation planning.

**When to use**: Severity is Complex or Critical. Root cause is unclear, fix crosses layers, changes contracts, or requires rollback planning.
**When NOT to use**: Severity is Simple/Moderate with clear root cause. Use [quick-fix.md](./quick-fix.md) instead.

**Prerequisites**: Triage completed with severity = Complex or Critical. Load additional skills:

```
Skill("planning")         # For remediation plan creation
Skill("artifact-tracking") # For progress tracking
```

---

## Phase 1: Architecture Review

### 1.1 Discover Related PRDs and Plans

Follow the full process in `../references/prd-discovery.md`. Quick version:

```bash
# Symbol-based: find the module/layer
grep "[affected_component]" ai/symbols-*.json

# Path-based: search PRDs for component name
grep -rl "[component_name]" docs/project_plans/PRDs/

# Search implementation plans
grep -rl "[component_name]" docs/project_plans/implementation_plans/

# Check ADRs for architectural decisions
grep -rl "[component_name]" docs/dev/architecture/

# Git-based: find commits referencing plans
git log --oneline --all -- [affected_file] | head -20

# Plan status query
python .claude/skills/artifact-tracking/scripts/query_artifacts.py --type prd --search "[keyword]"
```

**Extract from discovered PRDs**:
- Intended design for this component
- Business requirements constraining the fix
- Related implementation plans
- ADRs explaining pattern choices

### 1.2 Assess Architectural Impact

Delegate to `codebase-explorer` for pattern analysis:

```
Task("codebase-explorer", "Analyze architectural impact of bug in [COMPONENT]:

1. How is [COMPONENT] structured in the layered architecture?
   (router → service → repository → DB)
2. What patterns does similar code follow? Find 2-3 examples.
3. Does this component have enterprise/local edition differences?
4. Are there API contracts affected? Check skillmeat/api/openapi.json
5. What tests cover this area?

Files to focus on: [paths from triage]")
```

**Key questions to answer**:

| Question | Implication |
|----------|------------|
| Does the fix change the architectural pattern? | May need ADR |
| Does it affect API contracts? | Must update openapi.json |
| Does it cross layer boundaries? | Needs lead-architect input |
| Enterprise vs local edition impact? | Needs edition-aware testing |
| Does it introduce a new pattern? | Must justify vs existing patterns |

### 1.3 Review Existing Patterns

The fix MUST follow existing patterns. Before designing a solution:

```
Task("codebase-explorer", "Find how [PATTERN_TYPE] is implemented elsewhere:
- Look for 2-3 examples of [similar functionality]
- Note the file structure, naming conventions, error handling
- Identify the canonical pattern for this layer
Report: file paths + brief pattern description")
```

**Principle**: Don't introduce novel patterns to fix a bug. If the bug reveals a design flaw, the remediation plan should document the design gap and propose a pattern change as a separate concern.

---

## Phase 2: Remediation Planning

### 2.1 Determine Scope

| Condition | Action |
|-----------|--------|
| <= 5 files, clear path, single session | Plan inline, implement now |
| > 5 files, or multi-phase | Create formal remediation plan |
| API contract change | Formal plan required |
| Both editions affected | Formal plan required |
| Rollback strategy needed | Formal plan required |
| Design gap revealed | Formal plan + possible ADR |

### 2.2 Formal Remediation Plan

When a formal plan is needed, use the planning skill templates:

**Template**: `.claude/skills/planning/templates/implementation-plan-template.md`
**Phase template**: `.claude/skills/planning/templates/phase-breakdown-template.md`

**Required frontmatter**:

```yaml
---
schema_version: 2
doc_type: implementation-plan
status: draft
feature_slug: bugfix-[slug]
created: [today]
updated: [today]
prd_ref: [path to most relevant PRD, or "none — pattern-based fix"]
related_documents:
  - [implementation plan paths]
  - [ADR paths]
risk_level: [high | critical]
owner: [agent or user]
priority: [from severity]
---
```

**Required sections**:

1. **Root Cause Analysis**
   - What went wrong and why
   - How it was discovered
   - Stack trace or reproduction steps

2. **Design Intent**
   - What the related PRD intended for this component
   - How the current implementation diverges from intent
   - Whether the bug is in the implementation or the design

3. **Architecture Alignment**
   - How the fix fits existing patterns (router → service → repository → DB)
   - Which layer(s) the fix touches
   - Pattern references from codebase (paths to similar working code)

4. **Remediation Strategy**
   - Chosen approach with justification
   - Alternatives considered and why they were rejected
   - Whether this is a targeted fix or a pattern correction

5. **Phase Breakdown**
   - Standard task table with: Task ID, name, description, acceptance criteria, estimate, assigned agent, model, effort, dependencies
   - Batch parallelization strategy (file-ownership-first)
   - Entry/exit criteria per phase

6. **Risk Assessment**
   - What could go wrong with the fix
   - Rollback strategy (if applicable)
   - Affected downstream components

7. **Validation Plan**
   - Specific tests to run (not generic "run tests")
   - Edge cases to verify
   - Regression checks

**Save locations**:
- Plan: `docs/project_plans/implementation_plans/bugfix/[slug]-v1.md`
- Progress: `.claude/progress/bugfix-[slug]/phase-1-progress.md`

### 2.3 Inline Plan (for smaller complex fixes)

When formal plan isn't needed but fix is still complex:

```
## Inline Remediation Plan

**Root Cause**: [cause]
**Related PRD**: [path or "none"]
**Architecture Alignment**: [how fix fits existing patterns]

| Step | File | Change | Agent | Validation |
|------|------|--------|-------|------------|
| 1 | [path] | [change] | [agent] | [test] |
| 2 | [path] | [change] | [agent] | [test] |

**Risks**: [brief risk assessment]
```

---

## Phase 3: Implementation

### 3.1 Execute via Delegation

Select agents from `../references/agent-routing.md`. Follow batch delegation patterns:

**Batch execution** (parallel within batch, sequential across batches):

```
# Batch 1: Core fix (parallel — no file overlap)
Task("[AGENT_A]", "Fix [part]: Location: [path], Root cause: [cause], ...")
Task("[AGENT_B]", "Fix [part]: Location: [path], Root cause: [cause], ...")

# Batch 2: Dependent changes (after batch 1 completes)
Task("[AGENT_C]", "Update [dependent]: Location: [path], ...")

# Batch 3: Tests (after batch 2)
Task("[AGENT_D]", "Add/update tests: Location: [test_path], ...")
```

**Rules**:
- File-ownership-first batching — 1 agent per file
- Task prompt < 500 words — paths not contents
- Don't call `TaskOutput()` — verify on disk
- Follow patterns from `.claude/skills/dev-execution/orchestration/batch-delegation.md`

### 3.2 Comprehensive Validation

For complex fixes, always delegate validation:

```
Task("senior-code-reviewer", "Review fix for [BUG]:
Files changed: [list]
Root cause: [cause]
Related PRD: [path]
Verify:
- Fix follows existing architectural patterns
- No new patterns introduced unnecessarily
- API contracts maintained (check openapi.json)
- Enterprise/local edition parity preserved
- Test coverage adequate")
```

For API changes, also:

```
Task("api-librarian", "Validate API changes for [BUG] fix:
Changed files: [list]
OpenAPI spec: skillmeat/api/openapi.json
Check: error envelope compliance, cursor pagination, contract consistency")
```

### 3.3 Update Progress

Use CLI-first updates (0 agent tokens):

```bash
# Batch update
python .claude/skills/artifact-tracking/scripts/update-batch.py \
  -f .claude/progress/bugfix-[slug]/phase-1-progress.md \
  --updates "TASK-1.1:completed,TASK-1.2:completed"
```

---

## Phase 4: Documentation and Handoff

### 4.1 If Fix Was Completed

```bash
# Update bug-fixes doc + request log
.claude/scripts/update-bug-docs.py --commits <sha1,sha2> --req-log REQ-YYYYMMDD-skillmeat

# Commit with full context
git add [specific files]
git commit -m "fix([component]): [brief description]

Root cause: [explanation]
Architecture: [how fix aligns with existing patterns]
Related PRD: [path if applicable]
Resolves: [REQ-ID]"
```

### 4.2 If Creating Plan for Next Agent (Handoff)

When the fix is too large for this session:

1. Ensure remediation plan is saved with all phases, task IDs, and agent assignments
2. Create progress tracking YAML at `.claude/progress/bugfix-[slug]/phase-1-progress.md`
3. Update request log with plan reference
4. Output handoff instructions:

```
## Handoff

Remediation plan created: docs/project_plans/implementation_plans/bugfix/[slug]-v1.md
Progress tracking: .claude/progress/bugfix-[slug]/phase-1-progress.md

To execute: /dev:execute-phase 1
PRD context: [linked PRD path]
Priority: [from severity assessment]
Estimated phases: [N]

Key decisions made:
- [decision 1 with rationale]
- [decision 2 with rationale]
```

---

## Escalation

If the bug cannot be resolved even with comprehensive analysis:

1. Document all findings in the remediation plan with status: `blocked`
2. Create detailed request log entry with specific blockers
3. Note questions or dependencies needed to unblock
4. Consider whether an ADR is needed for the architectural decision
5. Suggest escalation path (e.g., lead-architect review, spike investigation)

## Quality Checklist

- [ ] Related PRDs/plans discovered and linked
- [ ] Architecture alignment verified
- [ ] Fix follows existing patterns (no novel introductions)
- [ ] Remediation plan created (formal or inline)
- [ ] Implementation delegated to appropriate agents
- [ ] Comprehensive validation completed (senior-code-reviewer)
- [ ] API contracts verified (if applicable)
- [ ] Progress tracking updated
- [ ] Bug-fixes document updated
- [ ] Request log updated
- [ ] Clear commit message with architecture context
