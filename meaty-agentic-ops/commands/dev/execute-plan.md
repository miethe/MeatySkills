---
description: "Execute full Tier 2/3 implementation plan — workflow script (recommended) or wave-driven phase-owner loop (deprecated fallback)"
allowed-tools: Task, Skill, Read, Edit, Write, Bash, Grep, Glob
argument-hint: "[plan-path] [--from-phase=N] [--dry-run] [--no-isolation] [--max-parallel=N]"
---

# Execute Plan

Execute a full Tier 2/3 implementation plan end-to-end.

> **Execution via workflow (recommended)** — see §"Workflow Path" below.
>
> **Manual wave-driven phase-owner loop** — see §"Manual Loop (Deprecated Fallback)" below.
> Status: DEPRECATED — retained as fallback pending the Phase-1 pilot adoption decision.
> Use only for: plans without a `wave_plan`, phases marked `phase_strategy: adaptive`,
> or until the workflow pilot is validated.
>
> **Bootstrap exception (non-deprecated)** — when any plan phase edits the workflow
> orchestrator scripts themselves (`.claude/workflows/*.js`, esp. `execute-plan.js` /
> `execute-contract.js`), use the manual wave loop, NOT the workflow path — editing the
> running orchestrator mid-plan breaks resume. See
> `.claude/specs/workflows/workflow-authoring-spec.md` §17.

---

## Workflow Path (Recommended)

This path replaces the manual Opus dispatch-and-poll wave loop with `.claude/workflows/execute-plan.js` — a deterministic background script that holds the wave loop, phase fan-out, file-ownership batching, reviewer gates, fix-loops, and Mode-D boundary detection. Opus pre-flight builds the execution graph; the workflow carries it forward.

**Full contract**: `.claude/specs/workflows/execute-plan-workflow-spec.md`

### When to use

- The plan has a `wave_plan` with `waves[]` defined.
- All phases are `phase_strategy: static` (or absent — defaults to static).
- No Phase is known Mode D in advance (Mode D phases are detected and returned as workflow boundaries — safe to let the script find them).
- You are in an active session (workflow resume is same-session only per constraint 4).

### Opus pre-flight (required before invoking the workflow)

The workflow script cannot read plan files directly (constraint 1 — no FS/shell in script). Opus must build the execution graph first:

1. **Read frontmatter only** (~2–3K tokens):
   ```bash
   head -n 80 ${PLAN_PATH} | sed -n '/^---$/,/^---$/p'
   ```

2. **Build the `ExecutionGraph`** from `wave_plan` frontmatter:
   - Map each `wave_plan.waves[]` entry to `Wave { id, phases[] }`.
   - Map each phase to `Phase { id, title, mode, review_intensity, isolation, phase_strategy, fix_agent, tasks[], batches[] }`.
   - Compute `batches[][]` per phase: group tasks by `files_affected` disjointness (tasks sharing a file run serially; disjoint tasks go in the same batch).
   - Detect Mode D: flag phases whose `files_affected` touches auth/payments/migrations/deletion signals.
   - Set `tier` from plan frontmatter; `plan_ref` as relative repo path; `timestamp` from current time.
   - Set `budget_total` from `effort_estimate × 25000` (default).
   - Resolve `progressFile` via discovery-first:
     ```bash
     BASE_SLUG=$(echo "${PLAN_SLUG}" | sed -E 's/-v[0-9]+$//')
     ls -d .claude/progress/${BASE_SLUG}*/ 2>/dev/null
     ```

3. **Dry-run validation** (strongly recommended before first run):
   Pass `dry_run: true` in `args` — the script returns the parsed graph for inspection without spawning agents.

4. **Record pre-run checkpoint**:
   ```bash
   git rev-parse HEAD
   ```

5. **Invoke the workflow** with the serialized graph as `args`.

### During the workflow run

Monitor via `/workflows` TUI (phases, agent counts, token totals, elapsed time).

The script handles:
- Sequential wave progression.
- Parallel phase fan-out within each wave.
- File-ownership batching (serial batches, parallel within).
- Reviewer gate + budget-guarded fix-loop per phase.
- Mode D boundary detection → returns `{status:'blocked', reason:'mode_d', blocked_phase}`.
- Progress YAML updates via `agentType:'artifact-tracker'`.

Opus is responsible **between and after** waves (never inside the script):
- Cross-wave worktree merges (`git merge --squash`).
- Recording wave checkpoints (`git rev-parse HEAD > ${PLAN_DIR}/.wave-N-checkpoint`).
- Mode D phases: run interactively, then relaunch workflow with trimmed `args.waves`.
- `needs_opus` escalations: inspect `verdict.required_fixes`, adjudicate, relaunch from failed phase.

### Post-run

When the workflow returns `status: 'complete'`:
- Perform final `git commit` / push from the merged working tree.
- Run `manage-plan-status.py --status completed`.
- Consume any `council_artifacts` paths from the ExecutionReport and update the plan-completion artifact.
- Write `${PLAN_DIR}/plan-completion.md` (see §"Plan-Level Completion Report" in the manual loop section for required content).

### Dry-run flag (`--dry-run`)

Pass `dry_run: true` in `args` to print the resolved graph and exit without spawning agents. Use before every non-trivial run to verify batch groupings, Mode D annotations, and reviewer routing.

---

## Step 0: Load Required Skills (MANDATORY — both paths)

**Execute these Skill tool calls NOW before any other action:**

```text
Skill("dev-execution")
Skill("artifact-tracking")
```

⚠️ **DO NOT PROCEED** until both skills are loaded. The guidance below depends on skill content.

---

## CLI Flags

| Flag | Overrides | Purpose |
|------|-----------|---------|
| `--plan=<path>` | `$ARGUMENTS` first positional | Explicit path to implementation plan |
| `--from-phase=N` | (runtime only) | Resume execution starting at the wave containing phase N |
| `--dry-run` | (runtime only) | Print resolved wave plan / execution graph and exit without dispatching |
| `--no-isolation` | `wave_plan.waves[].isolation` | Force all phases to run on the current branch (skip worktree isolation) |
| `--max-parallel=N` | `wave_plan.max_parallel` | Cap concurrent phase-owner dispatches per wave (manual loop only) |

---

## Manual Loop (Deprecated Fallback)

> **DEPRECATED** — retained as fallback pending the Phase-1 pilot adoption decision.
> Use this path only when:
> - The plan has no `wave_plan.waves` (sequential fallback).
> - One or more phases are `phase_strategy: adaptive` (LLM-driven sub-dispatch needed).
> - The workflow pilot has not yet been validated for the current plan type.
> - The workflow script is unavailable or the session cannot support it.
>
> The manual loop content below is unchanged and fully functional.

### Execution Mode

Reference: [.claude/skills/dev-execution/modes/plan-execution.md]

This command is a thin orchestrator. The canonical workflow — wave parsing, phase-owner dispatch, worktree merge protocol, inter-wave checkpoints, and reviewer gating — lives in the plan-execution mode doc. Read that file when reasoning about edge cases; this command only encodes the entry point and CLI surface.

### Preconditions (Manual Loop)

- Plan path exists and has parseable YAML frontmatter (`doc_type: implementation_plan`).
- Plan has `wave_plan.waves` defined OR falls back to phase-number-ordered sequential dispatch.
- No hard Claude Code version gate — this command uses **plain `Task()` invocations only** per the P15 invariant. It does NOT use Agent Teams primitives.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag is **NOT required**. The SendMessage continuity path inside individual phase-owners has its own fallback to file-based handoff.

**Log at start:** `Preconditions OK — running plain Task() workflow (Agent Teams flag NOT required)`

### Manual Loop Actions

#### 1. Initialize Context

Resolve `{PLAN_PATH}` from `--plan=<path>` or the first positional arg in `$ARGUMENTS`. Verify and read frontmatter:

```bash
test -f ${PLAN_PATH} && head -100 ${PLAN_PATH} | sed -n '/^---$/,/^---$/p'
```

Extract `slug`, `tier`, `phases`, `wave_plan` from frontmatter. Derive `{PLAN_SLUG}` and resolve the progress directory (discovery-first):

```bash
BASE_SLUG=$(echo "${PLAN_SLUG}" | sed -E 's/-v[0-9]+$//')
ls -d .claude/progress/${BASE_SLUG}*/ 2>/dev/null
```

- Exactly one match → use as `{PLAN_DIR}`.
- Multiple → prefer the variant matching the version in `${PLAN_SLUG}`; default to versionless.
- None → `{PLAN_DIR}=.claude/progress/${PLAN_SLUG}/` (create on first wave write).

#### 2. Read Wave Plan

Extract `wave_plan.waves` from frontmatter. Each wave entry must provide `phases: [N, M, ...]`, optional `isolation: worktree|none`, and optional `owner_skills: [...]`.

Additionally, extract `wave_plan.phases[]` entries — each phase entry may carry optional `model` and `effort` fields that serve as the dispatch defaults for all implementer `Task()` calls within that phase. Build a lookup map `PHASE_DEFAULTS[phase_id] → {model, effort}` (both fields may be absent if not specified in the plan). Refer to [.claude/skills/planning/references/wave-plan-guidance.md] for the full `phases[]` schema and effort vocabulary.

**Fallback** when `wave_plan.waves` is absent: build sequential `[[P1], [P2], ..., [PN]]` from the `phases:` array (one phase per wave, no isolation).

Apply `--from-phase=N` by dropping waves whose phase ids are all < N. Apply `--no-isolation` by stripping `isolation` from every wave. Apply `--max-parallel=N` as the per-wave dispatch cap.

#### 3. Dry-Run Short-Circuit (Manual Loop)

If `--dry-run` is set, print the resolved wave plan as a table and EXIT:

| Wave | Phases | Isolation | Owner Skills |
|------|--------|-----------|--------------|
| 1 | [1] | none | dev-execution |
| 2 | [2, 3] | worktree | dev-execution, artifact-tracking |

No Task() dispatches. No progress writes.

#### 4. Per-Wave Phase-Owner Dispatch

For each wave (in order), launch all phase-owners in **a single message with multiple `Task()` calls** (parallel within wave). Per phase:

Resolve `PHASE_MODEL` and `PHASE_EFFORT` from `PHASE_DEFAULTS[N]` before each dispatch. Both may be absent.

```text
Task(
  subagent_type="phase-owner",
  name="P${N}-owner",
  description="Execute Phase ${N} per ${PLAN_PATH}",
  # Pass model= only when the phase has a model set in wave_plan.phases[].
  # Omit entirely when absent — lets phase-owner's frontmatter default (sonnet) apply.
  model=${PHASE_MODEL},           # OMIT this line when PHASE_MODEL is absent
  prompt="""
    Mode: C — Autonomous Phase Sprint (orchestration only; no direct implementation)

    DELEGATION CONTRACT — read before any tool call.
    You are a phase ORCHESTRATOR, not an implementer. Even though your tool
    whitelist includes Edit/Write/Bash, you MAY NOT use them to implement
    task work. Every TASK-ID in the progress file MUST be dispatched via a
    Task() call to the specialist subagent named in its `assigned_to`
    field (python-backend-engineer, ui-engineer-enhanced, data-layer-expert,
    openapi-expert, etc.).

    Permitted direct writes (NOT task implementation):
      - Completion Note at ${PLAN_DIR}/phase-${N}-completion.md
      - update-batch.py / update-status.py via Bash
      - git diff / git rev-parse / head / grep for state inspection
      - git add -A && git commit when Isolation = worktree

    Forbidden — these MUST be delegated via Task():
      - Editing any file in any task's `files_affected`
      - Writing new source/test files declared by any task
      - Running pnpm test / pytest / tsc to "check" (delegate to
        task-completion-validator instead)
      - "Quick fixes" to a partially-complete delegated result
        (re-dispatch the implementer with remediation instructions)

    If the Agent column in your status table ever reads `phase-owner`,
    you have violated this contract — stop and re-route via Task().
    See §Delegation Mandate in the phase-owner agent definition for the
    full self-check gate.

    Plan: ${PLAN_PATH}
    Phase: ${N}
    File-ownership slots (from wave_plan): ${SLOTS}
    Progress file: ${PLAN_DIR}/phase-${N}-progress.md
    Isolation: ${ISOLATION}  # 'worktree' or 'none'
    Phase model default: ${PHASE_MODEL}    # OMIT this line when PHASE_MODEL is absent
    Phase effort default: ${PHASE_EFFORT}  # OMIT this line when PHASE_EFFORT is absent

    Follow .claude/skills/dev-execution/modes/plan-execution.md §Phase-Owner Delegation Pattern.
    Write Completion Note to .claude/progress/${PLAN_SLUG}/phase-${PHASE_NUM}-completion.md before signaling done. Caller derives the path deterministically; no return value needed.
  """,
  run_in_background=${WAVE_SIZE_GT_1}
)
```

**Invariants:**

- **Phase-owners orchestrate, never implement.** The prompt above includes a DELEGATION CONTRACT block — do not omit, paraphrase, or shorten it. Phase-owners have `Edit`/`Write`/`Bash` in their tool whitelist for Completion Note + progress CLI + worktree commit only. All task implementation goes through `Task()` to the specialist named in each task's `assigned_to` field. This bullet exists because phase-owners empirically slip into direct implementation when handed concrete file lists; the contract block in the prompt is the mitigation.
- Use `subagent_type="phase-owner"` only. **NEVER** pass `team_name=` (P15 invariant — plain Task() workflow; see `.claude/rules/delegation-modes.md` L5 and `.claude/skills/dev-execution/modes/plan-execution.md`).
- `isolation="worktree"` ONLY when the wave entry declares it AND `--no-isolation` is not set.
- `run_in_background=true` for any wave of size > 1; `false` for single-phase waves.
- Respect `--max-parallel=N` — slice the wave into chunks if it exceeds the cap, and dispatch each chunk in a separate parallel batch.
- Per-phase model/effort from wave_plan are defaults; per-task overrides in the phase table take precedence (handled by phase-owner).

#### 5. Wait for Wave Members

**Do not call `TaskOutput()`** on phase-owners (P20: phase completion is eventual, not synchronous, and `TaskOutput()` would consume ~7.5K tokens per call). Instead, poll the progress YAML status:

```bash
head -100 ${PLAN_DIR}/phase-${N}-progress.md | grep '^status:'
```

A wave member is complete when its progress file's frontmatter shows `status: completed`. Apply retry/timeout guidance from `.claude/skills/dev-execution/modes/plan-execution.md` § "Wave Wait Protocol" (exponential backoff; hard timeout escalates to user).

#### 6. Inter-Wave Checkpoint

After all members of wave N return `status: completed`, record a rollback checkpoint:

```bash
git rev-parse HEAD > ${PLAN_DIR}/.wave-${N}-checkpoint
```

Log the SHA. This is the rollback target if a later wave fails validation.

#### 7. Worktree Merge (When Wave Used Isolation)

For each phase in the wave that ran with `isolation: worktree`, the phase-owner returns a worktree branch and path. For each returned `<branch>`:

```bash
git diff <branch>..HEAD
pnpm test && pnpm typecheck && pnpm lint   # or equivalent for changed scope
git merge --squash <branch>                # on validator pass
# OR
git worktree remove <path> && git branch -D <branch>   # on validator fail
```

Full merge protocol — conflict handling, sequencing within a wave, abort/rollback rules — lives in `.claude/skills/dev-execution/modes/plan-execution.md` § "Worktree Merge Protocol". Cite that doc; do not re-derive.

#### 8. Feature-Level Reviewer Gate

After the final wave completes, dispatch the tier-appropriate reviewer (tier from plan frontmatter; see `.claude/skills/dev-execution/validation/completion-criteria.md` for tier-detection logic):

- **Tier 2** → `Task("task-completion-validator", "Review plan ${PLAN_PATH} end-to-end. Verify all phase AC, git diff vs plan scope, validation runs.")`
- **Tier 3** → `Task("karen", "Review plan ${PLAN_PATH} end-to-end with full architectural lens. Surface risks and unresolved gaps.")`

Both reviewers run in `plan` permissionMode. Verdict: `APPROVED` or `CHANGES_REQUESTED`.

#### 9. Plan-Level Completion Report

Write `${PLAN_DIR}/plan-completion.md` with:

- Per-wave summary (phases, duration, isolation used, validator verdict if interim).
- Total wall-clock from first dispatch to final reviewer verdict.
- Reviewer verdict + recommended follow-ups.
- Any Mode D escalations or scope deviations encountered.

Update plan frontmatter status:

```bash
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file ${PLAN_PATH} --status completed
```

## Quality Gates (Both Paths)

- [ ] All waves completed (`status: complete` in ExecutionReport or `status: completed` in progress YAML)
- [ ] Tests, typecheck, and lint pass after final wave
- [ ] Per-wave checkpoints recorded under `${PLAN_DIR}/.wave-*-checkpoint`
- [ ] Worktree merges complete or cleanly discarded (no orphan branches)
- [ ] Feature-level reviewer gate returned `APPROVED`
- [ ] Plan-level Completion Report written to `${PLAN_DIR}/plan-completion.md`
- [ ] Plan frontmatter `status` updated to `completed`

## Skill References

Detail lives in the skill files and specs; this command is the entry point.

**Workflow path**:
- Workflow spec (authoritative): [.claude/specs/workflows/execute-plan-workflow-spec.md]
- Workflow authoring master contract: [.claude/specs/workflows/workflow-authoring-spec.md]
- ExecutionGraph schema: [.claude/specs/workflows/schemas/execution-graph.schema.json]
- ExecutionReport schema: [.claude/specs/workflows/schemas/execution-report.schema.json]
- Workflow pattern library: [.claude/skills/dev-execution/orchestration/workflow-patterns.md]

**Manual loop (deprecated fallback)**:
- Plan execution mode: [.claude/skills/dev-execution/modes/plan-execution.md]
- Phase execution mode: [.claude/skills/dev-execution/modes/phase-execution.md]
- Wave plan authoring: [.claude/skills/planning/references/wave-plan-guidance.md]
- Reviewer gate / tier detection: [.claude/skills/dev-execution/validation/completion-criteria.md]

**Shared**:
- Delegation modes (Mode C boundary, Mode D boundary, P15 plain-Task() invariant): [.claude/rules/delegation-modes.md]
- Context budget (no `TaskOutput()` for file-writing agents): [.claude/rules/context-budget.md]
