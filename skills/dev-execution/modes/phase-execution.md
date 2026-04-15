# Phase Execution Mode

Detailed guidance for multi-phase YAML-driven development with batch delegation.

## When to Use

- Multi-phase implementation plans (>1 day of work)
- Features requiring PRD and progress tracking
- Cross-cutting concerns affecting multiple layers
- Work tracked in `.claude/progress/{PRD_NAME}/phase-N-progress.md`

## Phase 1: Initialize Context & Tracking

### 1.1 Extract Phase Information

From `$ARGUMENTS`, extract:
- `{PRD_NAME}`: From plan or PRD filename (e.g., `metadata-persistence-v1`)
- `{PHASE_NUM}`: Phase number to execute

### 1.2 Resolve Progress Directory (Discovery-First)

Progress directories may or may not include version suffixes (e.g., `-v1`). The naming is inconsistent across features. **Always discover existing directories before constructing paths.**

```bash
# Step 1: Strip version suffix to get base slug
BASE_SLUG=$(echo "${PRD_NAME}" | sed 's/-v[0-9]\+\(\.[0-9]\+\)*$//')

# Step 2: Find existing progress directories matching either variant
matches=$(ls -d .claude/progress/${BASE_SLUG}*/ 2>/dev/null)

# Step 3: Resolve to single directory
# - Exactly one match → use it
# - Multiple matches → filter by version (prefer exact PRD_NAME match)
# - No match → will create using PRD_NAME as-is
```

**Resolution rules:**
1. If exactly one directory matches the `${BASE_SLUG}*` glob, use it regardless of version suffix
2. If multiple directories match (e.g., `foo/` and `foo-v1/`), prefer the one matching `${PRD_NAME}` exactly
3. If no directory exists, create new using `${PRD_NAME}` as-is

### 1.3 Validate Tracking Infrastructure

```bash
progress_file="${PROGRESS_DIR}/phase-${PHASE_NUM}-progress.md"

# Check if progress file exists
if [ ! -f "$progress_file" ]; then
  Task("artifact-tracker", "Create Phase ${PHASE_NUM} progress for ${PRD_NAME}")
fi
```

When creating or initializing a progress file, populate linkage fields immediately:
- `feature_slug`: match the resolved directory name (not necessarily `${PRD_NAME}`)
- `prd_ref`: path to parent PRD
- `plan_ref`: path to parent implementation plan

## Phase 2: Execute Using Orchestration

### 2.1 Read Progress YAML Only (Token-Efficient)

**Critical**: Do NOT read entire progress file. Extract only YAML frontmatter:

```bash
# Extract YAML frontmatter (~2KB vs ~25KB for full file)
head -100 ${progress_file} | sed -n '/^---$/,/^---$/p'
```

From YAML, identify:
- Current `tasks` array with `assigned_to`, `dependencies`, `status`
- `parallelization` section with batch groupings
- Tasks ready to execute (dependencies have `status: completed`)

## Typed Reference Auto-Loading

When reading YAML frontmatter, extract typed refs alongside task/batch data:

```yaml
# Expected frontmatter fields
spike_ref: .claude/worknotes/my-feature/spike-findings.md
adr_refs:
  - docs/adr/0042-event-sourcing.md
charter_ref: docs/project_plans/charters/my-feature-charter.md
test_plan_ref: docs/project_plans/test-plans/my-feature-tests.md
references:
  context:
    - .claude/context/key-context/data-flow-patterns.md
  specs:
    - .claude/specs/version-bump-spec.md
```

**How to use typed refs in subagent prompts:**

1. **`spike_ref`**: If set and file exists, add one context line to each subagent prompt:
   ```
   SPIKE research at {spike_ref} covers [topic — derive from filename or first heading]
   ```
   Do NOT read the spike file into orchestrator context. Pass the path; the subagent reads it if needed.

2. **`adr_refs`**: If entries exist, add a brief note per relevant ADR:
   ```
   Architectural alignment: see ADR at {adr_ref_path}
   ```
   Only include ADRs relevant to the task's domain (backend ADRs for backend tasks, etc.).

3. **`charter_ref`**: If set, reference for scope validation in the task-completion-validator prompt:
   ```
   Scope charter: {charter_ref} — validate task does not exceed chartered scope
   ```

4. **`test_plan_ref`**: If set, pass to testing-related tasks and the final validation prompt.

5. **`references`**: If the `references` object exists in frontmatter, selectively inject paths into subagent prompts based on task domain:
   - **Backend tasks** (data-layer-expert, python-backend-engineer, backend-architect): inject `references.context` and `references.specs`
   - **Frontend tasks** (ui-engineer-enhanced, frontend-developer, frontend-architect): inject `references.context` and `references.user_docs`
   - **Documentation tasks** (documentation-writer, changelog-generator): inject `references.user_docs` and `references.context`
   - **All tasks**: inject `references.related_prds` as cross-reference context
   
   Format in subagent prompt:
   ```
   Reference context (read if relevant to your task):
   - Context: {path1}, {path2}
   - Specs: {path1}
   - Related PRDs: {path1}
   ```
   
   Do NOT read reference files into orchestrator context. Provide paths only.

**Token rule**: Never read ref files into orchestrator context. Provide paths only — subagents read what they need.

## Execution Model Routing

Read `execution_model` from progress frontmatter (default: `batch-parallel` if absent). CLI flag `--execution-model` overrides frontmatter.

| Value | Behavior |
|-------|----------|
| `batch-parallel` | Default. Execute tasks within each batch in parallel (multiple Task() calls in one message), sequential across batches. |
| `sequential` | Execute all tasks one at a time. No parallel Task() calls. Use when tasks have implicit shared-state dependencies not captured in the YAML deps graph. |
| `agent-team` | Use Agent Teams pattern per CLAUDE.md guidance. Assign a lead agent with teammates. Use when the phase involves 5+ files or cross-cutting changes. |

**Routing decision**:
```
execution_model == "batch-parallel" → follow § 2.2 Batch Execution Strategy (existing)
execution_model == "sequential"     → run tasks one Task() per message, wait for each
execution_model == "agent-team"     → delegate to feature-team or debug-team per CLAUDE.md
```

For `agent-team`, reference: `.claude/context/key-context/agent-teams-patterns.md`

## Plan Structure Handling

Read `plan_structure` from implementation plan frontmatter (default: `unified` if absent). CLI flag `--plan-structure` overrides frontmatter.

| Value | Behavior |
|-------|----------|
| `unified` | All phases live in one plan file (current default). Use `plan_ref` from progress frontmatter to locate it. |
| `independent` | Each phase has its own plan file. Derive path as `{plan_dir}/phase-{N}-plan.md` where `plan_dir` is the directory of `plan_ref`. |

**Resolution for `independent`**:
```bash
# Given plan_ref = docs/project_plans/implementation_plans/my-feature.md
# Phase 2 plan lives at:
docs/project_plans/implementation_plans/my-feature/phase-2-plan.md
```

If the per-phase file does not exist, fall back to `unified` behavior and log a warning in progress notes.

### 2.2 Delegate in Batches

**Use pre-computed Task() commands from "Orchestration Quick Reference" section when available.**

#### Batch Execution Strategy

1. **Batch 1** (No dependencies):
   - Execute ALL tasks in `parallelization.batch_1` in **parallel**
   - Use single message with multiple Task() tool calls:
   ```
   Task("ui-engineer-enhanced", "TASK-1.1: Implement X component...")
   Task("backend-typescript-architect", "TASK-1.2: Add API endpoint...")
   ```

2. **Wait** for Batch 1 to complete

3. **Batch 2+**: Continue batch-by-batch, tasks within batches in parallel

4. **Update Task Status** after each batch completes (CLI only — never Edit/Write):
   ```bash
   # Single task
   python .claude/skills/artifact-tracking/scripts/update-status.py \
     -f ${progress_file} -t TASK-1.1 -s completed

   # After parallel batch (preferred)
   python .claude/skills/artifact-tracking/scripts/update-batch.py \
     -f ${progress_file} --updates "TASK-1.1:completed,TASK-1.2:completed"
   ```
   **Do NOT** use `Task("artifact-tracker", ...)` or direct `Edit()` for status changes.
   See `.claude/rules/progress-cli-only.md` for full routing rules.

#### Model Routing

When `assigned_model` or `model_effort` is present in task YAML:

1. **Pass model parameter to Task()** when non-default:
   ```
   # Default Claude routing (omit model parameter)
   Task("documentation-writer", "...")

   # Explicit non-default model
   Task("documentation-writer", "...", model="haiku")
   Task("gemini-orchestrator", "...", model="sonnet")
   ```

2. **Log external model batch groupings** for visibility:
   ```
   # External model tasks grouped in batch_0:
   # - TASK-0.1: Generate app icon (nano-banana-pro/quality)
   # - TASK-0.2: Research API patterns (gemini-3.1-pro/medium)
   ```

3. **Reference model routing details** at `.claude/skills/planning/references/multi-model-guidance.md`

### 2.3 Task Delegation Template

**Budget: < 500 words per prompt (~2K tokens).** Reference patterns by file path — never embed file contents or code blocks. Subagents read files themselves.

```
@{agent-from-assigned_to}

Phase ${PHASE_NUM}, {task_id}: {task_title}

{task_description — keep to 2-3 sentences}

Files to modify: {list file paths}
Pattern to follow: {path to example file, e.g. "follow components/settings/github-settings.tsx"}
Acceptance criteria:
- [Criterion 1]
- [Criterion 2]
Validation: Run `pnpm type-check` and `pnpm lint` from `skillmeat/web/`
```

**Anti-patterns in prompts** (waste 3-10K tokens each):
- Embedding file contents or code blocks
- Including import statements or boilerplate
- Repeating information the subagent can read from files
- Describing patterns that exist in a referenceable file

**If subagent invocation fails**: Document in progress tracker and proceed with direct implementation.

### 2.4 Validate Task Completion

After each major task:

```
@task-completion-validator

Phase ${PHASE_NUM}, Task: {task_id}

Expected outcomes:
- [Outcome 1 from task description]
- [Outcome 2 from task description]

Files changed:
- {list files}

Validate:
1. Acceptance criteria met
2. Project architecture patterns followed
3. Tests exist and pass
4. No regression introduced
```

### 2.5 Commit After Each Task

```bash
git add {files}
git commit -m "feat(scope): implement {feature}

- Added {component/service/etc}
- Wired telemetry spans
- Added tests with {coverage}%

Refs: Phase ${PHASE_NUM}, {task_id}"
```

After each commit, append the SHA to progress frontmatter:

```bash
python .claude/skills/artifact-tracking/scripts/update-field.py \
  -f ${progress_file} \
  --append "commit_refs=${commit_sha}"
```

## Phase 3: Continuous Testing

Run after each significant change:

### Backend Tests

```bash
uv run --project services/api pytest app/tests/test_X.py -v
uv run --project services/api mypy app
uv run --project services/api ruff check
```

### Frontend Tests

```bash
pnpm --filter "./apps/web" test -- --testPathPattern="ComponentName"
pnpm --filter "./apps/web" typecheck
pnpm --filter "./apps/web" lint
```

**Test failure protocol:**
1. Fix immediately if related to current work
2. Document in progress tracker if unrelated
3. DO NOT proceed to next task if tests fail for current work

## Phase 4: Milestone Validation

At each major milestone (after completing a batch):

### 4.1 Run Full Validation

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

# Build check
pnpm --filter "./apps/web" build
```

### 4.2 Milestone Validation with Subagent

```
@task-completion-validator

Phase ${PHASE_NUM} Milestone: Batch {batch_num} Complete

Completed tasks:
- {task_id_1}
- {task_id_2}

Validate:
1. All batch tasks complete
2. Success criteria met
3. No regressions
4. Tests comprehensive
```

## Phase 5: Final Validation

When ALL tasks complete:

### 5.1 Quality Gates

All must pass:
- [ ] All tests passing (backend + frontend + e2e)
- [ ] Type checking clean
- [ ] Linting clean
- [ ] Build succeeds
- [ ] A11y tests pass (if UI phase)

### 5.2 Final Progress Update

```bash
# Mark all remaining tasks and phase as completed via CLI
python .claude/skills/artifact-tracking/scripts/update-batch.py \
  -f ${progress_file} \
  --updates "TASK-X.1:completed,TASK-X.2:completed"

# Phase status auto-calculates to completed when all tasks are done
```

**Do NOT** delegate final status updates to `artifact-tracker` agent — use CLI scripts only.
For adding a phase completion summary (markdown notes), append below the `---` delimiter directly.

### 5.3 Push All Changes

```bash
git push origin ${branch_name}
```

## Stage 6: Wrap-Up (Final Phase Only)

When the **final phase** of an implementation plan is sealed (all quality gates pass), execute the following wrap-up steps before closing the branch. This is NOT triggered after intermediate phases.

### 6.1 Feature Guide Creation

Delegate to `documentation-writer` (haiku). Provide paths — do not read files into orchestrator context.

```
Task("documentation-writer", "Create feature guide at
.claude/worknotes/<feature-slug>/feature-guide.md.

Frontmatter: doc_type: feature_guide, feature_slug, prd_ref, plan_ref, spike_ref, adr_refs, created.
Plan: <plan path>
CHANGELOG entry (for context): CHANGELOG.md
ADR refs (if any): <adr paths from plan frontmatter>

Sections (≤200 lines total):
1. What Was Built — 2-4 sentences
2. Architecture Overview — key files/layers, link to ADRs
3. How to Test — per-edition (local + enterprise); include CLI/API examples
4. Test Coverage Summary
5. Known Limitations — deferred scope or intentional gaps")
```

Commit the feature guide once created:
```bash
git add .claude/worknotes/<feature-slug>/feature-guide.md
git commit -m "docs(<feature-slug>): add feature guide"
```

Append the commit SHA to the implementation plan's `commit_refs`:
```bash
python .claude/skills/artifact-tracking/scripts/update-field.py \
  -f <plan path> --append "commit_refs=$(git rev-parse HEAD)"
```

### 6.2 Open Pull Request

After the feature guide is committed, open the PR back to main:

```bash
gh pr create \
  --title "<concise feature title (≤70 chars)>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet 1 — from Executive Summary or CHANGELOG entry>
- <bullet 2>
- <bullet 3>

## Feature Guide
.claude/worknotes/<feature-slug>/feature-guide.md

## Test plan
- [ ] All unit + integration tests pass
- [ ] Smoke-tested locally (local edition)
- [ ] Smoke-tested in enterprise stack (if applicable)

🤖 Generated with Claude Code
EOF
)"
```

Derive PR bullets from the implementation plan's Executive Summary and the CHANGELOG entry authored during Documentation Finalization.

After the PR is created, append the PR reference to the implementation plan and all phase progress files:
```bash
PR_URL=$(gh pr view --json url -q .url)
python .claude/skills/artifact-tracking/scripts/update-field.py \
  -f <plan path> --append "pr_refs=${PR_URL}"
```

---

## Stage 7: Agent Findings Frontmatter

When phase execution produces a finding (investigation result, spike output, triage note, or
research artifact) that is stored under `.claude/findings/`, the agent that creates the file MUST
include the following frontmatter stub at the top:

```yaml
---
schema_version: 2
doc_type: report
report_category: finding
title: "<agent-provided title>"
status: draft
source: agent
created: <today>
feature_slug: <from phase context>
prd_ref: <from phase context>
plan_ref: <from phase context>
---
```

Fields supplied by the agent:
- `title`: Short, descriptive title for the finding
- `created`: Today's date in `YYYY-MM-DD` format
- `feature_slug`, `prd_ref`, `plan_ref`: Copied from the phase progress frontmatter

**Why this matters**: The Route 7 findings triage (`plan-status-report.py --route7`) scans
`.claude/findings/` and flags any files without valid frontmatter. Missing stubs block promotion
through the findings pipeline (see "Findings Promotion Pipeline" below).

### Findings Promotion Pipeline

Agent-generated findings flow through a defined lifecycle before becoming actionable:

```
.claude/findings/<finding>.md        (draft, source: agent)
        |
        v  [human triage via Route 7 — status set to "accepted"]
        |
        v  [promoted via manage-plan-status.py or manual edit]
        |
docs/project_plans/design-specs/<design-spec>.md    (doc_type: design-spec, status: idea → draft)
        |
        v  [design-spec approved / promoted]
        |
docs/project_plans/PRDs/<prd>.md                    (doc_type: prd)
```

**Promotion steps**:

1. **Triage** (Route 7): Run after every phase to review new findings:
   ```bash
   python .claude/skills/plan-status/scripts/plan-status-report.py --route7 --include-reports
   ```
   Accepted findings get `status: accepted` in their frontmatter.

2. **Design spec creation**: For accepted findings that warrant design work, create a design-spec
   under `docs/project_plans/design-specs/` using the `design-spec` frontmatter schema. Set
   `promoted_to` on the finding to record the link.

3. **PRD promotion**: For approved design specs, create or amend a PRD. Update the design-spec
   `status: promoted` and set `promoted_to` to the PRD path.

**Tool**: `python .claude/skills/artifact-tracking/scripts/manage-plan-status.py` handles
status transitions and `promoted_to` field updates at each stage.

## Stage 8: Documentation Finalization

When ALL implementation tasks complete, delegate documentation updates to skill-equipped agents.

### 8.1 Identify Changed Documentation Scope

From progress YAML `doc_tasks` array (if present) or evaluate:
- Did features change? → README rebuild needed
- Did CLI commands change? → CLI docs + README
- Was API contract modified? → OpenAPI + endpoint docs
- Did architecture shift? → CLAUDE.md context pointers
- Phase introduced new patterns? → Context file updates or new reference docs

### 8.2 Delegate Documentation Tasks

**Examples with skill invocation**:

```
# CHANGELOG entry
Task("changelog-generator", "Add CHANGELOG entry for Phase ${PHASE_NUM} features.
File: CHANGELOG.md. Follow Keep A Changelog format.
Features added: {list 2-3 key items}")

# README rebuild (if features/CLI changed)
Task("documentation-writer", "Rebuild README after Phase ${PHASE_NUM} changes.
Run: bash .claude/specs/script-usage/readme-build.md rebuild
Verify: pnpm test passes, features section matches current CLI")

# CLAUDE.md pointer update (if architecture changed)
Task("documentation-writer", "Update CLAUDE.md Multi-Model section —
add 1-line pointer to planning/references/multi-model-guidance.md.
Keep progressive disclosure: CLAUDE.md is pointer layer (≤3 lines detail)")

# API/Router documentation
Task("api-documenter", "Update API documentation for new Phase ${PHASE_NUM} endpoints.
File: docs/api/. Follow pattern in docs/api/artifacts.md")
```

### 8.3 Documentation Standards

- **Verbosity**: Concise, usage-focused. Examples preferred over explanation.
- **Progressive disclosure**: CLAUDE.md links to key-context files, not inline detail
- **Context rules**: Never add 50+ lines of architecture to CLAUDE.md — link instead
- **Skill delegation**: Always use appropriate skill-equipped agent (changelog-generator, documentation-writer, api-documenter)

**Reference**: `.claude/skills/planning/references/doc-finalization-guidance.md` for delegation heuristics.

## Error Recovery

### Common Recovery Strategies

**Git conflicts:**
```bash
git stash
git pull --rebase origin ${branch_name}
git stash pop
# Resolve conflicts
git add .
git rebase --continue
```

**Build failures:**
```bash
rm -rf .next node_modules/.cache
pnpm install
pnpm build
```

**Subagent failures:**
- Retry once
- If fails again, document and proceed with direct implementation

### If Unrecoverable

Mark the task as blocked via CLI, then report to user:

```bash
python .claude/skills/artifact-tracking/scripts/update-status.py \
  -f ${progress_file} -t TASK-X.X -s blocked \
  -n "Brief reason for blocker"
```

**Do NOT** directly edit the progress file YAML. See `.claude/rules/progress-cli-only.md`.

Stop and report to user with:
- Clear description of blocker
- What was attempted
- What's needed to proceed
- Current state of work (all committed)
