---
description: Create detailed implementation plan for a user story
argument-hint: "<story_id>"
allowed-tools: Read, Grep, Glob, Write
---

# /plan-story

You are Claude Code creating an implementation plan for story `$ARGUMENTS`.

<!-- MeatyCapture Integration - Project: skillmeat -->
## Discovery Phase

Search request-logs for related items to incorporate into the plan:
- `/mc search "story-keyword" skillmeat` - Find bugs/enhancements related to this story
- `/mc search "type:bug status:backlog" skillmeat` - Find backlog bugs that may be resolved

## Purpose

Generate a comprehensive, actionable plan WITHOUT implementing anything.
This command is useful when you want to review the approach before execution.

## Process

### 1. Load Story Requirements

- Follow guidance to load and analyze story from @load-analyze-story.md

### 2. Create Detailed Plan

Generate `.claude/plans/${story_id}-plan.md`:

```markdown
# Story ${story_id} Implementation Plan

## Executive Summary
- Complexity: [S|M|L|XL]
- Estimated Time: [2h|4h|1d|2d|1w]
- Risk Level: [Low|Medium|High]
- Dependencies: [list of story IDs]

## Architecture Impact
### Backend
- New endpoints: [list]
- Schema changes: [tables and columns]
- Service layer changes: [services affected]
- Repository changes: [repos affected]

### Frontend
- New routes: [pages/paths]
- New components: [component names]
- State management: [stores/contexts affected]
- API client changes: [new methods]

## Implementation Sequence
1. Backend schema and migrations
2. Backend repository layer
3. Backend service layer
4. Backend API endpoints
5. Frontend API client
6. Frontend components
7. Frontend pages/routes
8. Tests (unit → integration → e2e)
9. Documentation

## File-by-File Changes

### Backend Files
\`\`\`python
# services/api/app/schemas/resource.py
class ResourceCreate(BaseModel):
    name: str
    description: Optional[str]

class ResourceOut(ResourceCreate):
    id: UUID
    created_at: datetime
\`\`\`

### Frontend Files
\`\`\`typescript
// packages/api/src/resources.ts
export async function createResource(data: ResourceInput): Promise<Resource> {
  return apiClient.post('/api/v1/resources', data)
}
\`\`\`

## Test Strategy
- Unit tests: [list of test files]
- Integration tests: [list of test scenarios]
- E2E tests: [user journeys to test]

## Rollback Plan
1. Revert PR if issues found
2. Run rollback migration if schema changed
3. Clear caches if needed

## Success Metrics
- All ACs pass
- No performance regression
- Test coverage ≥ 80%
- Zero accessibility issues
```

### 3. Generate Decision Log

Document key decisions made during planning:

```markdown
## Decisions Made

1. **Use existing Button component vs create new**
   - Decision: Extend existing Button with new variant
   - Rationale: 85% feature overlap, maintains consistency

2. **API pagination approach**
   - Decision: Use cursor-based pagination
   - Rationale: Aligns with CLAUDE.md standards

3. **State management for new feature**
   - Decision: Use React Query for server state
   - Rationale: No complex client state needed
```

### 4. Output Summary

```bash
=================================================
PLAN COMPLETE FOR: ${story_id}

Files to change: ${file_count}
Complexity: ${complexity}
Estimated time: ${estimate}
Risk level: ${risk}

Full plan: .claude/plans/${story_id}-plan.md

Next steps:
- Review plan for completeness
- Run: /implement-story ${story_id}
=================================================
```
