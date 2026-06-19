# Plan Status Management

Managing status fields in PRD and implementation plan frontmatter to track planning and execution lifecycle.

## Overview

Plan status indicates where a plan is in its lifecycle—from initial draft through approval, active development, completion, or supersession. Both PRDs (Product Requirements Documents) and Implementation Plans maintain status fields in their YAML frontmatter.

**Why Track Plan Status?**
- Know which plans are ready for development (approved)
- Find blocked or superseded plans quickly
- Maintain clear project roadmap visibility
- Support orchestration workflows with status-driven decisions

## Status Values

| Status | Meaning | Next State | Who Updates |
|--------|---------|-----------|-------------|
| `draft` | Initial planning, not approved yet | → `approved` | Planner/Author |
| `approved` | Ready for implementation planning or development | → `in-progress` | Dev lead |
| `in-progress` | Active development work underway | → `completed` or `blocked` | Dev lead |
| `completed` | Work finished, all criteria met, deployed | (final state) | Dev lead |
| `blocked` | Waiting on dependency or issue | → `in-progress` or `superseded` | Dev lead |
| `superseded` | Replaced by newer version, archived | (final state) | Planner |

## Quick Operations

### Read Plan Status

```bash
python .claude/skills/artifact-tracking/scripts/query_artifacts.py \
  --file docs/project_plans/PRDs/features/auth-v1.md \
  --format yaml
```

Extracts the YAML frontmatter and displays the `status` field.

### Update Plan Status

**Direct Edit (Small Changes)**:
```bash
# Edit the status field directly in frontmatter
vim docs/project_plans/implementation_plans/features/auth-v1.md
# Change: status: draft → status: approved
# Save and commit
```

**Batch Check Status**:
```bash
for f in docs/project_plans/PRDs/features/*.md; do
  status=$(grep "^status:" "$f" | cut -d: -f2 | xargs)
  echo "$(basename "$f"): $status"
done
```

### Query by Status

Find all draft PRDs:
```bash
for f in docs/project_plans/PRDs/**/*.md; do
  if grep -q "^status: draft$" "$f" 2>/dev/null; then
    echo "$f"
  fi
done
```

Find all in-progress implementation plans:
```bash
grep -r "^status: in-progress$" docs/project_plans/implementation_plans/ --include="*.md" \
  | cut -d: -f1 | sort -u
```

## Status Workflow

### Phase 1: Planning (Draft → Approved)

**Entry**: New plan created
**Status**: `draft`
**Activities**:
- Initial PRD written with requirements
- Design decisions documented
- Estimates and timelines provided
- Stakeholder review

**Exit Criteria**:
- PRD/plan approved by team lead
- Dependencies identified and resolved
- Resources committed

**Status Change**: `draft` → `approved`

### Phase 2: Preparation (Approved)

**Entry**: Plan approved
**Status**: `approved`
**Activities**:
- Implementation planning begins
- Breakdown into phases/stories
- Subagent assignments planned

**Exit Criteria**:
- Implementation plan complete
- Phase 1 tasks defined and estimated
- Ready to start development

**Status Change**: `approved` → `in-progress` (when development starts)

### Phase 3: Execution (In-Progress)

**Entry**: Development begins
**Status**: `in-progress`
**Activities**:
- Code implementation in phases
- Testing and integration
- Progress tracking and blockers logged
- Regular status updates

**Exit Criteria**:
- All acceptance criteria met
- Tests passing
- Code reviewed and merged
- Deployed to production

**Status Change**: `in-progress` → `completed`

### Phase 4: Complete or Blocked

**Completed**:
```
status: in-progress → status: completed
```
When all work is done and deployed.

**Blocked**:
```
status: in-progress → status: blocked
```
When waiting on external dependency.

Later, when unblocked:
```
status: blocked → status: in-progress
```

**Superseded**:
```
status: any → status: superseded
```
When replaced by newer version or approach.

## File Locations & Naming

### PRDs (Product Requirements Documents)

**Location**: `docs/project_plans/PRDs/[domain]/`

**Naming**: `[feature-name]-v[N].md` (e.g., `auth-system-v2.md`)

**Frontmatter**:
```yaml
---
title: "PRD: Feature Name"
description: "Product requirements for [feature]"
audience: [ai-agents, developers]
tags: [prd, planning, requirements]
created: 2025-02-07
updated: 2025-02-07
category: "product-planning"
status: draft  # ← Update this
related:
  - /docs/project_plans/implementation_plans/features/auth-system-v2.md
---
```

### Implementation Plans

**Location**: `docs/project_plans/implementation_plans/[type]/` (features, bugs, enhancements, etc.)

**Naming**: `[feature-name]-v[N].md` (e.g., `auth-system-v2.md`)

**Frontmatter**:
```yaml
---
title: "Implementation Plan: Feature Name"
description: "[feature] implementation with phases and task breakdown"
audience: [ai-agents, developers]
tags: [implementation, planning, phases, tasks]
created: 2025-02-07
updated: 2025-02-07
category: "product-planning"
status: draft  # ← Update this
related:
  - /docs/project_plans/PRDs/features/auth-system-v2.md
---
```

## Common Patterns

### Mark Plan Ready for Development

1. **Create PRD** with requirements and timeline
   ```yaml
   status: draft
   ```

2. **Get approval** from stakeholders

3. **Update status** when approved:
   ```yaml
   status: approved
   ```

4. **Create implementation plan** breaking down phases
   ```yaml
   status: approved
   ```

5. **Start development** - update when work begins:
   ```yaml
   status: in-progress
   ```

### Track Implementation Progress

While a plan is `in-progress`:
- Create `.claude/progress/[prd-name]/phase-N-progress.md` for detailed task tracking
- Reference implementation plan in progress file under "related" section
- Update implementation plan status only at major milestones (phase complete, blocked, etc.)

### Mark Plan Complete

When all work is finished and deployed:

1. **Update implementation plan**:
   ```yaml
   status: completed
   updated: 2025-02-15
   ```

2. **Create context notes** in `.claude/worknotes/[prd-name]/context.md`
   - Document decisions made
   - Record learnings and patterns
   - Note any technical debt

3. **Commit changes**:
   ```bash
   git add docs/project_plans/implementation_plans/features/auth-v2.md
   git commit -m "Mark auth-v2 implementation complete"
   ```

### Replace Superseded Plan

When a plan is replaced by a newer version:

1. **Update old plan**:
   ```yaml
   status: superseded
   updated: 2025-02-15
   related:
     - /docs/project_plans/PRDs/features/auth-v3.md
   ```

2. **Create new plan** for replacement version:
   ```yaml
   status: draft  # (or approved/in-progress if ready)
   ```

3. **Reference both** in related documents

## Integration with Workflows

### Planning Workflow

```
User Request
    ↓
Create PRD (status: draft)
    ↓
Get Approval
    ↓
Update status: approved
    ↓
Create Implementation Plan (status: approved)
    ↓
Start Development → status: in-progress
```

### Execution Workflow

```
Plan status: approved
    ↓
Create progress file (.claude/progress/...)
    ↓
Execute phases (update progress file)
    ↓
All criteria met
    ↓
Update plan status: completed
    ↓
Create context notes (.claude/worknotes/...)
```

### Command Workflow

The `/dev:execute-phase` and `/dev:implement-story` commands can query plan status to determine readiness:
- Only execute plans with `status: approved` or `status: in-progress`
- Skip or warn on `status: draft` or `status: blocked` plans

### Dashboard/Reporting

Status enables quick queries:
- **"What's our roadmap?"** → Find all `approved` plans
- **"What's being worked on?"** → Find all `in-progress` plans
- **"What got done?"** → Find all `completed` plans
- **"What's blocked?"** → Find all `blocked` plans

## Examples

### Example 1: Transition Draft → Approved

**Initial State**:
```yaml
title: "PRD: Multi-Platform Deployments"
status: draft
created: 2025-02-01
updated: 2025-02-01
```

**After Review & Approval** (2 days later):
```yaml
title: "PRD: Multi-Platform Deployments"
status: approved
created: 2025-02-01
updated: 2025-02-03
```

### Example 2: Track Implementation Progress

**Start Development**:
```yaml
title: "Implementation Plan: Multi-Platform Deployments v1"
status: approved → status: in-progress
created: 2025-02-03
updated: 2025-02-07
```

**Create Phase Progress**:
```
.claude/progress/multi-platform-deployments-v1/phase-1-progress.md
.claude/progress/multi-platform-deployments-v1/phase-2-progress.md
```

**Complete Implementation**:
```yaml
status: in-progress → status: completed
updated: 2025-02-20
```

**Create Context Notes**:
```
.claude/worknotes/multi-platform-deployments-v1/context.md
```

### Example 3: Replace Superseded Plan

**Original Plan**:
```yaml
title: "PRD: Authentication v2"
status: in-progress
```

**Later, newer approach discovered**:

**Update Original**:
```yaml
title: "PRD: Authentication v2"
status: superseded
related:
  - /docs/project_plans/PRDs/features/authentication-v3.md
```

**Create New Plan**:
```yaml
title: "PRD: Authentication v3"
status: draft
related:
  - /docs/project_plans/PRDs/features/authentication-v2.md
```

## Best Practices

1. **Update status immediately** when major transitions occur
   - Don't batch status updates; do them when change happens
   - Commit with clear message: "Mark auth-v2 as approved"

2. **Use frontmatter only for plan status** - don't duplicate in markdown body
   - YAML is the source of truth for status
   - Markdown body can reference status if needed for clarity

3. **Keep timestamps current**
   - Update the `updated` field when status changes
   - Helps track when decisions were made

4. **Link related documents**
   - When creating implementation plan from PRD, link both directions
   - When superseding, reference the newer version
   - Helps navigation and prevents orphaned documents

5. **Check status before delegating work**
   - Use status queries to find `approved` plans ready for development
   - Don't start work on `draft` plans without approval

6. **Archive superseded plans**
   - Don't delete old plans; mark as `superseded`
   - Keeps historical record of decisions
   - Helps understand why certain approaches were rejected

## Troubleshooting

### Can't find a plan by status?

**Check file format**:
```bash
head -20 docs/project_plans/PRDs/features/auth-v1.md
# Should show YAML frontmatter with status field
```

**Search for status field**:
```bash
grep -r "^status:" docs/project_plans/ | cut -d: -f3 | sort | uniq -c
# Shows count of plans by status
```

### Plan status not updating?

1. **Check file is saved** after editing
2. **Verify YAML syntax** - status must be on its own line: `status: approved`
3. **Run validation**:
   ```bash
   python -c "import yaml; yaml.safe_load(open('docs/project_plans/PRDs/features/auth-v1.md'))"
   # No output = valid YAML
   ```

### Status field missing?

Add to frontmatter manually:
```yaml
---
title: "..."
status: draft  # ← Add this line
---
```

Then commit the change.

## See Also

- **Progress Tracking**: `.claude/skills/artifact-tracking/updating-artifacts.md`
- **Query Patterns**: `.claude/skills/artifact-tracking/query-patterns.md`
- **Schema Validation**: `.claude/skills/artifact-tracking/schemas/`
- **Planning Workflow**: CLAUDE.md (Agent Delegation section)
