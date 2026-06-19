# Completion Criteria

Definition of done for stories, features, and tasks.

## Mandatory Reviewer Gates

Tiered features require reviewer-agent gates at specific checkpoints. Phases and sprints are **not complete** without the reviewer pass listed below.

| Tier | Gate | Reviewer | Inputs |
|------|------|----------|--------|
| 1 | end of sprint | `task-completion-validator` | contract + diff + Completion Report |
| 2 | end of each phase | `task-completion-validator` | phase plan + diff + progress YAML |
| 2 | end of feature | `karen` | full plan + cumulative diff |
| 3 | end of each phase | `task-completion-validator` | phase plan + diff |
| 3 | mid-feature milestones | `karen` | plan + cumulative diff |
| 3 | end of feature | `karen` | full plan + cumulative diff |

**Invariant**: This is non-optional. A phase/sprint cannot be marked complete until the reviewer at the listed checkpoint has approved.

See `.claude/rules/delegation-modes.md` (Mode E: Reviewer) for reviewer agent specifications and constraints.

---

## Reviewer Output Template

Reviewer agents must produce a structured report using this template:

```markdown
# Review Report: [Feature/Branch Name]

## Recommendation
[Approve / Approve with minor fixes / Request changes / Block]

## Confidence
[High / Medium / Low] — Brief rationale for confidence level

## Summary
[Concise assessment of overall implementation quality and adherence.]

## Contract Adherence
- Status: [Pass / Partial / Fail]
- Notes: [Details on which acceptance criteria passed/failed, scope drift if any]

## Required Fixes
1. [Blocking issue and fix needed]
2. [Additional blocking issues]

## High-Risk Concerns
- [High-risk issue that may be non-blocking but requires attention]
- ["None identified." if applicable]

## Test/Validation Assessment
- Tests claimed: [List tests agent reported running]
- Tests verified: [Tests confirmed to exist and be relevant]
- Missing tests: [Gaps in coverage, edge cases without tests]

## Architecture / Maintainability Notes
- [Pattern conformance or drift]
- [Code quality observations]

## Scope Drift
- [None / Details of what was added/removed vs. contract]

## Documentation Updates Needed
- [README, CHANGELOG, context files, ADRs, or "None"]

## Final Decision
[One-line merge recommendation: "APPROVE" / "REQUEST CHANGES" / "BLOCK — <reason>"]
```

---

## Test-Rigor Acceptance Criteria (conditional)

These ACs are **mandatory** when the trigger applies; a phase/sprint is not complete without them.

**R1 — Real-session test (transaction/session/dedup tasks).** Any task touching DB transactions, sessions, savepoints, rollback, or dedup MUST ship ≥1 test against a **real session** (in-memory SQLite suffices for savepoint/rollback semantics), not only `MagicMock(spec=Session)`. Mocks have no transaction state and silently pass on `rollback()`-vs-`begin_nested()` bugs. *(Retro P1: a full-`rollback()` savepoint bug passed all mock tests; caught only by a real-SQLite savepoint test.)*

**R2 — Production-path presence (wiring/dual-surface tasks).** Any task whose AC is "feature X is reachable from surface Y" MUST ship a test that renders/exercises through the **real production entry point** (the actual parent component or call site) and asserts the feature is **present** — not only a component-in-isolation test. Validators MUST trace from the real entry point, not the leaf unit. **A test asserting the feature is *absent* is a smell**, not a passing case. *(Retro P4: an extract button was invisible in production because parents never threaded `parentArtifactId`; 64 isolated tests passed, one even asserted the broken behavior as correct.)*

---

## Story Completion

A user story is complete when:

### Implementation

- [ ] All acceptance criteria met
- [ ] All files in plan created/modified
- [ ] Code follows project architecture
- [ ] No `// TODO` comments left behind

### Testing

- [ ] Unit tests added for new logic
- [ ] Integration tests for API flows
- [ ] E2E tests for critical user paths
- [ ] Negative test cases included
- [ ] All tests passing

### Quality

- [ ] TypeScript strict mode, no `any`
- [ ] Lint errors resolved
- [ ] Build succeeds
- [ ] No regressions introduced

### Documentation

- [ ] API docs updated if endpoints added
- [ ] Code comments where logic isn't self-evident
- [ ] README updated if applicable

### Review

- [ ] Code reviewed by senior-code-reviewer
- [ ] Feedback addressed

### Tracking

- [ ] PR created and linked to story
- [ ] Progress tracker shows "complete"
- [ ] Request-log item marked done (if applicable)

## Feature Completion (Quick Feature)

A quick feature is complete when:

### Implementation

- [ ] Feature works as described
- [ ] Follows existing patterns
- [ ] No breaking changes

### Quality Gates

- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` succeeds

### Tracking

- [ ] Quick plan updated to `status: completed`
- [ ] Request-log item marked done (if from REQ-ID)
- [ ] Issues captured if discovered

## Task Completion

An individual task is complete when:

### Core Criteria

- [ ] Task description fulfilled
- [ ] Success criteria from plan met
- [ ] Files modified as expected

### Code Quality

- [ ] No TypeScript errors
- [ ] Lint clean
- [ ] Tests pass

### Architecture Compliance

- [ ] Follows layered architecture
- [ ] Uses proper patterns (DTOs, ErrorResponse, etc.)
- [ ] Telemetry/logging added where appropriate

### Commit

- [ ] Changes committed with descriptive message
- [ ] References task ID in commit

## Tier 1 Sprint Completion

A Tier 1 feature sprint is complete when:

### Implementation

- [ ] Feature Contract authored and approved
- [ ] All Acceptance Criteria from the contract are satisfied (verified)
- [ ] All Validation Requirements from the contract are satisfied

### Testing & Validation

- [ ] Unit tests added for new logic
- [ ] Integration tests for API flows (if applicable)
- [ ] All tests passing (`pnpm test`, `pytest`, etc.)
- [ ] TypeScript strict mode, no `any`
- [ ] Lint errors resolved
- [ ] Build succeeds
- [ ] No regressions introduced

### Documentation

- [ ] API docs updated if endpoints added
- [ ] Code comments where logic isn't self-evident
- [ ] README updated if applicable
- [ ] CHANGELOG entries added (if required by Feature Contract)

### Completion Report

- [ ] Completion Report appended to Feature Contract with:
  - Files changed
  - Tests run and results
  - Validation results
  - Deviations from contract (if any)
  - Risks/limitations
  - Follow-up recommendations

### Review & Merge

- [ ] `task-completion-validator` review completed and approved (mandatory gate)
- [ ] Review Report confirms all acceptance criteria passed
- [ ] Opus commits changes

---

## Phase Completion

See [./milestone-checks.md] for full phase completion criteria.

Summary:
- [ ] All tasks completed
- [ ] All success criteria met
- [ ] All tests passing
- [ ] Quality gates passed
- [ ] Documentation updated
- [ ] Progress tracker at 100%
- [ ] All commits pushed
- [ ] **Reviewer pass complete per the Mandatory Reviewer Gates matrix above** (Tier 2/3: `task-completion-validator` per phase; `karen` at feature end; Tier 1: already covered above)

## Validation Templates

### Task Validation

```
@task-completion-validator

Task: {task_id}

Expected outcomes:
- {outcome 1}
- {outcome 2}

Files changed:
- {file list}

Validate:
1. Acceptance criteria met
2. Architecture patterns followed
3. Tests exist and pass
4. No regression
```

### Story Validation

```
@task-completion-validator

Story: ${story_id}

Acceptance criteria from story:
- {criterion 1}
- {criterion 2}

Implementation summary:
- Backend: {what was done}
- Frontend: {what was done}
- Tests: {coverage}

Validate complete implementation.
```

### Phase Validation

```
@task-completion-validator

Phase ${phase_num} FINAL VALIDATION

Plan: ${plan_path}
Progress: ${progress_file}

Validate:
1. All tasks complete
2. Success criteria met
3. Tests passing
4. No critical issues
5. Ready for next phase
```

## Common Completion Blockers

### What Blocks Completion

| Issue | Resolution |
|-------|------------|
| Tests failing | Fix before marking complete |
| Type errors | Resolve all TypeScript issues |
| Missing acceptance criteria | Implement missing functionality |
| Unresolved comments | Address all review feedback |
| Breaking changes | Add migration or compatibility |

### When to NOT Mark Complete

Never mark complete if:
- Tests are failing for your changes
- Implementation is partial
- You encountered unresolved errors
- Required files/deps not found
- Review feedback not addressed

### When Blocked

If truly blocked:

1. Document blocker clearly
2. Keep status as `in_progress` or `blocked`
3. Create tracking issue
4. Report to user with:
   - What's blocking
   - What was attempted
   - What's needed to unblock
