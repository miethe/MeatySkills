# Story Execution Mode

Guidance for implementing user stories with existing plans or creating plans on-the-fly.

> **Git workflow:** this mode follows the canonical worktree → PR-to-parent → squash-merge-on-approval
> protocol in [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md). Set up a run worktree
> at the start (don't `git checkout -b` in place), commit per logical unit inside it, and PR to the
> **parent branch** (not hard-coded `main`). Nested helpers and offloaded executors never touch git;
> batch task agents commit only their own assigned files by explicit pathspec and never rewrite
> history. The orchestrator/phase-owner orchestrates all commits.
>
> **Model selection** follows [`MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md):
> subscription default **Sonnet 5** (`claude-sonnet-5`) for implementation, **Opus 5** for spine,
> `xhigh` effort for the hardest work; bounded waves offload to **ICA Sonnet 5**
> (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the reviewer gate.

## When to Use

- User story implementation (from request-log or description)
- Feature work scoped to a single story
- Work that fits within a sprint

## Mode Variants

### /dev:implement-story

**Requires existing plan.** Use when:
- Plan exists at `.claude/plans/${story_id}-plan.md`
- Progress tracker initialized

### /dev:complete-user-story

**Creates plan if needed.** Use when:
- Story may not have plan yet
- Need end-to-end story completion

## Phase 0: Initialize Context

### 0.1 Extract Story ID

```bash
story_id="${ARGUMENTS}"
story_id="${story_id%.md}"  # Strip .md if present
```

### 0.2 Set Up Tracking

```bash
mkdir -p .claude/{progress,worknotes,plans}
progress_file=".claude/progress/${story_id}.md"
plan_file=".claude/plans/${story_id}-plan.md"

# Check for existing work
if [ -f "$progress_file" ]; then
  echo "Resuming from existing progress"
fi
```

## Phase 1: Load & Analyze Story

### 1.1 Find Story Specification

Search for story in:
1. Request-log files (`REQ-*-${story_id}`)
2. Story files (`.claude/stories/${story_id}.md`)
3. Attached file from user

### 1.2 Check for Existing Plan

If `/dev:implement-story`:
- Plan MUST exist at `${plan_file}`
- Error if missing: "No plan found. Run /plan-story ${story_id} first"

If `/dev:complete-user-story`:
- Check if plan exists
- If missing, create lightweight implementation plan

### 1.3 Generate Implementation Plan (if needed)

Create `${plan_file}` with:

```markdown
# Implementation Plan: ${story_id}

## Story Summary
- Epic: [epic_id]
- Scope: [Backend|Frontend|Full-Stack]
- Complexity: [S|M|L|XL]

## File Changes
### Create
- [ ] path/to/new/file1.py - [description]
- [ ] path/to/new/file2.tsx - [description]

### Modify
- [ ] path/to/existing/file1.py - [what to change]

## API Changes
- [ ] POST /api/v1/resource - [Create resource]
- [ ] GET /api/v1/resource/{id} - [Get resource]

## Test Coverage
- [ ] Unit: test_resource_service.py
- [ ] Integration: test_resource_api.py
- [ ] E2E: resource.spec.ts
```

### 1.4 Initialize Progress Tracker

```markdown
## Progress Tracker: ${story_id}

### Status
- Phase: Implementation
- Started: [timestamp]

### Completed
- [x] Planning
- [ ] Backend implementation
- [ ] Frontend implementation

### Decisions Log
- [timestamp]: Chose approach X because Y

### Files Updated/Added
- /api/v2/resource (A)
- /api/v1/resource (U)

### Tests
- [ ] Unit tests
- [ ] Integration tests
- [ ] End-to-end tests
```

## Phase 2: Implementation

### 2.1 Mark In-Progress (if from request-log)

```bash
meatycapture log item update DOC ${story_id} --status in-progress
```

### 2.2 Backend Implementation (if applicable)

Delegate to backend specialists:

```
Task("backend-architect", "Analyze requirements for ${story_id}")
Task("backend-typescript-architect", "Implement: ${file_path}")
```

Backend checklist per file:
- [ ] Schema/DTO in appropriate location
- [ ] Repository layer
- [ ] Service layer
- [ ] Router/endpoint layer
- [ ] Migration if schema changed
- [ ] Tests

### 2.3 Frontend Implementation (if applicable)

Delegate to frontend specialists:

```
Task("ui-designer", "Design component for ${story_id}")
Task("ui-engineer-enhanced", "Implement: ${file_path}")
```

Frontend checklist per component:
- [ ] Component in packages/ui if reusable
- [ ] Hook if needed
- [ ] Page/Route
- [ ] API client integration
- [ ] Tests
- [ ] Storybook story if in packages/ui

### 2.4 Commit After Each File

```bash
git add ${file}
git commit -m "feat(${story_id}): implement $(basename ${file})"
```

## Phase 3: Testing

### 3.1 Run Tests Continuously

```bash
# Backend
uv run --project services/api pytest -xvs app/tests/test_*.py

# Frontend
pnpm --filter "./packages/ui" test
pnpm --filter "./apps/web" test
```

### 3.2 Test Categories

- **Unit tests**: Core business logic
- **Integration tests**: API flows
- **E2E tests**: Critical user paths

## Phase 4: Validation & Review

### 4.1 Quality Checks

```bash
# Type checking
pnpm -r typecheck
uv run --project services/api mypy app

# Linting
pnpm -r lint
uv run --project services/api ruff check

# Tests
pnpm -r test
uv run --project services/api pytest

# A11y
pnpm --filter "./packages/ui" test:a11y
```

### 4.2 Code Review

```
Task("senior-code-reviewer", "Review story ${story_id} implementation")
```

### 4.3 Update Progress

Mark story complete in progress tracker.

## Phase 5: Complete

### 5.1 Update Request Log

```bash
# Mark complete
meatycapture log item update DOC ${story_id} --status done

# Add completion note
meatycapture log note add DOC ${story_id} -c "Completed: {summary}"
```

### 5.2 Create Pull Request

Per [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md), the story runs in a worktree
created at the start (do **not** `git checkout -b` in place), and the PR targets the **parent branch**
captured when the run began — not a hard-coded `main`. Squash-merge happens on approval or an in-prompt
override.

```bash
# PARENT_BRANCH was recorded at run start (the branch HEAD was on when the worktree was created);
# the story work lives on its own worktree branch ($BRANCH).
git push -u origin "$BRANCH"
gh pr create \
  --base "$PARENT_BRANCH" \          # parent branch, NOT hard-coded main
  --head "$BRANCH" \
  --title "feat(${story_id}): ${feature_description}" \
  --body-file .claude/pr-body.md \
  --draft

# On approval / in-prompt override only. Two steps — never --delete-branch (it aborts before the
# delete when the parent is checked out elsewhere, orphaning the remote branch):
gh pr merge "$BRANCH" --squash
gh pr view "$BRANCH" --json state,mergeCommit -q '.state'   # expect MERGED before deleting
git push origin --delete "$BRANCH"
```

## Error Recovery

### Recovery Strategies

**Test failures**: Fix or document as known issue
**Subagent failure**: Retry once, then proceed directly
**Build failure**: Clean and rebuild

### If Unrecoverable

1. Create PR with `[BLOCKED]` prefix
2. Document blockers in PR body
3. Tag with `needs-help` label

## Completion Checklist

- [ ] All acceptance criteria met
- [ ] Tests passing (unit, integration, e2e)
- [ ] Documentation updated
- [ ] Code reviewed
- [ ] PR created and linked to story
- [ ] Progress tracker shows "complete"
- [ ] Request-log item marked done
