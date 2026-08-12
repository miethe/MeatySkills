# Quick Execution Mode

Streamlined planning and execution for simple, single-session features.

> **Git workflow:** multi-step / multi-file quick features follow the canonical worktree →
> PR-to-parent → squash-merge-on-approval protocol in
> [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md); a **true single-file,
> single-commit change** may commit in place on a short-lived branch (the protocol's trivial
> exception). The orchestrator is the only committer, and any PR targets the **parent branch**, not
> hard-coded `main`.
>
> **Model selection** follows [`MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md):
> subscription default **Sonnet 5** (`claude-sonnet-5`) for implementation, **Opus 5** for spine,
> `xhigh` effort for the hardest work; bounded waves offload to **ICA Sonnet 5**
> (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the reviewer gate.

## When to Use

- Single-session implementation (~1-3 hours)
- 1-3 files affected
- No cross-cutting concerns
- Clear requirements, no discovery needed

## When NOT to Use

Use `/dev:execute-phase` instead when:
- Multi-phase features (>1 day estimated work)
- Features requiring PRD/stakeholder review
- Cross-cutting concerns affecting >5 files per layer
- Features with unclear requirements needing discovery
- Database migrations requiring careful planning

## Input Resolution

Parse `$ARGUMENTS` to determine input type:

| Pattern | Type | Action |
|---------|------|--------|
| `REQ-YYYYMMDD-*-XX` | Request Log ID | Use `/mc view` or `/mc search` |
| Starts with `./`, `/`, or `~` | File path | Read file contents directly |
| Other | Direct text | Use as feature description |

### For Request Log Input

Use `/mc` command (token-efficient):

```bash
# Get full details
meatycapture log search "REQ-ID" PROJECT

# Mark as in-progress when starting
meatycapture log item update DOC ITEM --status in-progress
```

## Phase 1: Minimal Planning

### 1.1 Pattern Discovery

Delegate to **codebase-explorer** agent:

> Find existing patterns related to the feature. Look for similar implementations, relevant file locations, import conventions, and test patterns.

### 1.2 Create Quick Plan

Generate slug from feature description (lowercase, hyphens, max 30 chars).

Write plan to `.claude/progress/quick-features/{feature-slug}.md`:

```markdown
---
type: quick-feature-plan
feature_slug: {slug}
request_log_id: {id if from REQ input, else null}
status: in-progress
created: {ISO date}
estimated_scope: small|medium
---

# {Feature Title}

## Scope
{1-2 sentences describing what this implements}

## Affected Files
- {file1}: {change description}
- {file2}: {change description}

## Implementation Steps
1. {step} → @{agent-name}
2. {step} → @{agent-name}

## Testing
- {test approach}

## Completion Criteria
- [ ] Implementation complete
- [ ] Tests pass
- [ ] Build succeeds
```

## Phase 2: Execution

### 2.1 Agent Selection

| Task Type | Agent |
|-----------|-------|
| React/UI components | ui-engineer-enhanced |
| TypeScript backend/core | backend-typescript-architect |
| Pattern discovery | codebase-explorer |
| Deep analysis | explore |
| Debugging issues | ultrathink-debugger |
| Validation/review | task-completion-validator |

### 2.2 Delegate Implementation

For each step in plan:
- Provide feature context and requirements
- Include patterns discovered by codebase-explorer
- Specify files to modify/create
- Reference @CLAUDE.md architecture patterns

Execute steps that can be parallelized together (single message, multiple Task() calls).

### 2.3 Incremental Verification

After each major step:

```bash
pnpm typecheck  # No TypeScript errors
pnpm test       # Tests pass
pnpm lint       # Lint clean
```

### 2.4 Commit Progress

After logical units of work:

```bash
git add {files}
git commit -m "feat({scope}): {description}

Refs: quick-feature/{feature-slug}"
```

## Phase 3: Quality Gates

All gates must pass before completion:

| Gate | Command |
|------|---------|
| Type checking | `pnpm typecheck` |
| Tests | `pnpm test` |
| Lint | `pnpm lint` |
| Build | `pnpm build` |

If any fail, fix before proceeding.

### 3.1 Reviewer Gate — one lens (mandatory)

Tier 0 gets **one** reviewer pass. Cheap, and it is the whole gate:

```
Workflow({ name: 'reviewer-gate', args: {
  scope:               { id: '${feature-slug}', title: '${description}', kind: 'tier0-change', tier: 0 },
  lenses:              ['validator'],
  acceptance_criteria: ${ac_list},
  files_changed:       ${files_changed},
  evidence_refs:       ['${test_command_transcript_path}'],
  timestamp:           '${ISO-8601}',
}})
```

The reviewer runs edit-less (constraint 3, enforced by the agent definition). The verdict is a
**validated tool call**, not prose — see `../SKILL.md` § "How a gate is dispatched" for why a bare
`Task("task-completion-validator", "… Verdict: APPROVED or CHANGES_REQUESTED")` (the form this section
used until 2026-08-03) is not acceptable: it blocks the main loop, forces nothing to be decided, and
makes a dead reviewer indistinguishable from a passing one.

Read the envelope, not the prose:

- `approved: true` → commit.
- `approved: false`, `gate_ran: true` → a real rejection. Fix and re-invoke with `failure_summary`.
- `approved: false`, `gate_ran: false` → **the gate did not run.** Re-dispatch it. Do not commit, and
  do not "fix" anything — nothing was found.

**Why Tier 0 has a gate at all.** The ordinary shape everywhere in this engine is *implement → tests →
**one review** → ship* (`references/gate-risk-classes.md` §2, step 1). Tier 0 previously had a green
suite and nothing else — and a green suite is not evidence: it can sit over a defect on a path nobody
tested. One cheap lens is the floor, not an escalation.

**No second lens, no pre-gate — with one exception.** If a Tier 0 change touches a second-lens trigger
surface (parses untrusted input · authorization/identity boundary · irreversible or outward-facing
effect), **it is not Tier 0.** Re-tier it rather than bolting a security lens onto the fast path.

## Phase 4: Completion

### 4.1 Update Quick Plan

Edit `.claude/progress/quick-features/{feature-slug}.md`:
- Set `status: completed` and `completed_at: {ISO date}`
- Check all completion criteria boxes

### 4.2 Commit All Changes

**Required:** Opus commits directly (never delegate this step).

```bash
git add -A
git commit -m "feat({scope}): {description}

{Detailed commit body describing changes}

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### 4.3 Update Request Log (if applicable)

If input was a REQ ID:

```bash
# Mark item as done
meatycapture log item update DOC ITEM --status done

# Add completion note
meatycapture log note add DOC ITEM -c "Completed in quick-feature/{feature-slug}"
```

### 4.4 Capture Issues (if any)

If issues arose during implementation, use `mc-quick.sh` for token-efficient capture:

```bash
# Quick capture (~50 tokens vs ~200+ for JSON)
mc-quick.sh bug [DOMAIN] [COMPONENT] "Issue title" "What went wrong" "How to fix" "[Context]"

# Examples:
mc-quick.sh bug api validation "Missing null check" "API crashes on null input" "Add validation"
mc-quick.sh enhancement web ux "Add loading feedback" "No indication of progress" "Show spinner during fetch"
```

**Script location**: `.claude/skills/meatycapture-capture/scripts/mc-quick.sh`

## Error Recovery

If blocked:

1. Document blocker in quick plan under `## Blockers`
2. Do NOT mark as completed
3. Report to user with clear next steps needed
4. Track blocker if warranted:
   ```bash
   MC_STATUS=blocked mc-quick.sh bug [DOMAIN] [COMPONENT] "Blocked: [title]" "[What's blocking]" "[What's needed]"
   ```

## Output Summary

```
Quick Feature Complete: {feature title}

Plan: .claude/progress/quick-features/{feature-slug}.md
Files Changed: {count}
Tests: {pass count}/{total count}
Commits: {commit count}

{If from REQ: "Request log item {REQ-ID} marked as done"}
```
