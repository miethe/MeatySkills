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

> **Git workflow — canonical protocol.** This command follows
> [`.claude/skills/dev-execution/git-worktree-pr-protocol.md`](../../skills/dev-execution/git-worktree-pr-protocol.md):
> set up a git **worktree** under `.claude/worktrees/<slug>` (not an in-place feature branch), record
> the **parent branch** (HEAD at run start) as the PR base, commit per phase, open a PR to the
> **parent branch**, and **squash-merge only on approval or an in-prompt override** ("auto-merge" /
> "merge when done"). The per-wave worktree merge-back below operates one level under this (wave →
> run branch); the run-branch → parent hop is the PR.
>
> **Model routing.** Subscription-side execution defaults to **Sonnet 5** (`claude-sonnet-5`), with
> **Opus 5** for the spine (orchestration/architecture/adjudication) and **`xhigh`** effort for the
> hardest coding/agentic work; offload bounded, contract-clear waves to **ICA Sonnet 5**
> (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the reviewer gate — never offload MUST-stay-primary /
> Mode-D / Claude-Code-native work. Policy:
> [`docs/agentic-operator/MODEL-ROUTING.md`](../../../docs/agentic-operator/MODEL-ROUTING.md).

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

1. **Pre-Execution Artifact Provisioning (best-effort, ON BY DEFAULT)** — run this FIRST, before
   parsing frontmatter or building the graph below. Resolves the plan's `required_artifacts` +
   the project manifest (`.claude/aos-artifacts.yaml`) and deploys any in-catalog gap:
   ```bash
   PROVISION_PLAN_FILE="${PLAN_PATH}" PROVISION_SCOPE="plan:${PLAN_SLUG}" \
       .claude/skills/dev-execution/hooks/provision-artifacts.sh
   ```
   On by default (disable with `AOS_ARTIFACT_PROVISION=0`); silent no-op with no manifest and no
   `required_artifacts`; non-fatal on infra failure. **One exception**: a NEEDED+unsatisfiable
   artifact is a real halt (engine exit 2) — stop before spending any graph-build or execution
   budget. Gate + env resolution: `.claude/rules/artifact-provisioning.md`.

2. **Read frontmatter only** (~2–3K tokens):
   ```bash
   head -n 80 ${PLAN_PATH} | sed -n '/^---$/,/^---$/p'
   ```

3. **Build the `ExecutionGraph`** from `wave_plan` frontmatter:
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

4. **Dry-run validation** (strongly recommended before first run):
   Pass `dry_run: true` in `args` — the script returns the parsed graph for inspection without spawning agents.

5. **Record pre-run checkpoint**:
   ```bash
   git rev-parse HEAD
   ```

6. **Invoke the workflow** with the serialized graph as `args`.

### Delegation context bundle (assemble once at the plan gate)

Before fan-out — exactly once per run, at the plan gate — assemble the four-part Delegation
Context Bundle and thread its path to every delegated leg (AOS constraint 4: assemble once,
never re-derive per leg):

```bash
BUNDLE=$(op context pack --budget 6000 \
  --plan-ref ${PLAN_PATH} \
  --prd-ref ${PRD_PATH:-} \
  --project-root "$(git rev-parse --show-toplevel)" | head -1)
```

- Store `$BUNDLE` as `RoutingRecord.context_ref` for each delegatable leg. The router's
  `finalizeRoutingRecord` forces `context_ref: null` for MUST-stay classes (orchestration,
  verdict, mode-d, council-review, schema-recovery, cross-wave-merge, synthesis) and for bob —
  never override that.
- Every fan-out leg, in every wave, inherits the SAME `$BUNDLE` path. Do NOT call
  `op context pack` again per wave or per phase (single assembly per run).
- Per-transport injection (delegation-context.md v2): claude subagent → inline under
  `<persona>` in the spawn prompt; ICA → `--append-system-prompt-file $BUNDLE`; codex →
  `exec_task(context_ref=$BUNDLE)`.
- No model call on the assembly path — `op context pack` is deterministic.

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
- Perform final `git commit` from the merged run branch, then **push the run branch and open a PR to the parent branch**; **squash-merge only on approval or an in-prompt override** (per the [git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md) §5–6). Record the landing pointer (`merge_commit`, `merge_branch`) in plan frontmatter.
- Run `manage-plan-status.py --status completed`.
- Consume any `council_artifacts` paths from the ExecutionReport and attach them to the reviewer verdict record on the PR.
- **Plan-level completion record.** The reviewer verdict + `commit_refs` on the PR are the record of plan completion; the `${PLAN_DIR}/plan-completion.md` write retired per `.claude/skills/dev-execution/references/execution-doctrine.md` §Bookkeeping demotions.
- **Recommended — produce a `program` delivery-report** for a shareable, evidence-backed
  "where did this whole plan land" snapshot (every open/deferred item carries a copyable agent
  handoff). Recommended, **not blocking** — skip for a low-visibility internal plan. Invoke
  `Skill("delivery-report")`, pick route `program`, subject = the plan slug; record the rendered HTML
  path on the PR / in plan frontmatter (the standalone `plan-completion.md` retired per
  `.claude/skills/dev-execution/references/execution-doctrine.md` §Bookkeeping demotions).
  Lifecycle/route map: `.claude/skills/dev-execution/SKILL.md` § "Forward-Looking Status Reports".
- **Close with the Next Actions table** ([.claude/skills/dev-execution/references/next-actions-table.md]):
  deferred items, follow-ups, Mode-D escalations, and the recommended next effort as rows — front-and-center
  callout when the `program` report was produced, with the report path listed as an artifact.

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

Additionally, extract `wave_plan.phases[]` entries — legacy plans may carry optional `model` and `effort` fields that serve as the dispatch defaults for all implementer `Task()` calls within that phase. Build `PHASE_DEFAULTS[phase_id] → {model, effort}` (both fields may be absent).

> **DEPRECATED — legacy plans only.** `phases[].model`, `.provider`, `.profile`, and per-task agent/model pins in `wave_plan.phases[]` are honored so in-flight plans keep executing, but **NEW Tier 2/3 plans do NOT carry plan-time model or agent pins** (per `.claude/skills/planning/references/plan-doctrine.md`). For new plans, routing is resolved at dispatch time via `delegation-router` from the plan's routing CONSTRAINTS (which classes stay claude-primary, offload-eligibility, capability bar per milestone) — never from a plan-time model id.
>
> The `wave_plan.orchestrator_model` frontmatter (plan-level default + per-phase overrides) is **deleted** per `.claude/skills/dev-execution/references/execution-doctrine.md` §Bookkeeping demotions — it was advisory, never actually read, and the orchestration loop cannot switch its own main-loop model mid-run. Silently ignore the field on any plan that still carries it.

Refer to [.claude/skills/planning/references/wave-plan-guidance.md] for the full `phases[]` schema and effort vocabulary.

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

Resolve `PHASE_MODEL` and `PHASE_EFFORT` from `PHASE_DEFAULTS[N]` before each dispatch. Both may be absent (and MUST be absent on new plans — see the DEPRECATED note in §2 above).

```text
Task(
  subagent_type="phase-owner",
  name="P${N}-owner",
  description="Execute Phase ${N} per ${PLAN_PATH}",
  # Pass model= only when the phase has a model set in wave_plan.phases[].
  # Omit entirely when absent — lets phase-owner's frontmatter default
  # (subscription Sonnet 5, claude-sonnet-5) apply; Opus 5 for spine, xhigh for the
  # hardest coding. Policy: docs/agentic-operator/MODEL-ROUTING.md.
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
    Phase model default: ${PHASE_MODEL}    # DEPRECATED (legacy plans only). OMIT when PHASE_MODEL is absent — the norm for new plans.
    Phase effort default: ${PHASE_EFFORT}  # DEPRECATED (legacy plans only). OMIT when PHASE_EFFORT is absent — the norm for new plans.

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

After the final wave completes, dispatch **one** feature-level reviewer — the single whole-tree pass
(see `.claude/skills/dev-execution/validation/completion-criteria.md` for the full gate matrix):

- **Tier 2** → `Task("task-completion-validator", "Review plan ${PLAN_PATH} end-to-end. Verify all phase AC, git diff vs plan scope, validation runs.")`
- **Tier 3** → `Task("karen", "Review plan ${PLAN_PATH} end-to-end with full architectural lens. Surface risks and unresolved gaps.")`

Runs in `plan` permissionMode. Verdict: `APPROVED` or `CHANGES_REQUESTED`.

**This is one lens, and it is the last one.** Per-phase gates already ran inside their waves; do not
re-run them here, and do not add a second feature-level lens because the plan felt risky. A phase whose
surface needed a `security` lens carried it **at its own phase gate**, where it was scoped to a bounded
diff — that is the correct place for it, not the end, against the whole tree. The reviewer will not fan
out to other reviewers either (see the `karen` / `task-completion-validator` agent definitions).

**Same-class stop rule** (`references/execution-doctrine.md` rule 1): if this gate and the phase gate
before it surfaced the **same defect class**, do **not** dispatch a third review. Route to a design
change — `references/gate-risk-classes.md` §3b. The `ExecutionReport` surfaces this as
`needs_redesign: { defect_class, rounds }` when the scripted path detected it.

#### 9. Plan-Level Completion Record

The plan-level completion record is the reviewer verdict from §8 plus the `commit_refs` on the PR — the standalone `${PLAN_DIR}/plan-completion.md` write **retired** per `.claude/skills/dev-execution/references/execution-doctrine.md` §Bookkeeping demotions. Attach any `council_artifacts` from the reviewer verdict to the PR record; record Mode-D escalations and scope deviations in plan frontmatter alongside `merge_commit` / `merge_branch`. (The phase-owner **Completion Note** and the Tier 1 contract-appended **Completion Report** are unrelated artifacts and both remain in effect.)

**Recommended — produce a `program` delivery-report** for a shareable, evidence-backed snapshot (same
posture as the Workflow-path Post-run step above): `Skill("delivery-report")`, route `program`,
subject = plan slug. Recommended, **not blocking**. Record the rendered HTML path on the PR / in plan frontmatter.

Close the response with the **Next Actions table** — spec: [.claude/skills/dev-execution/references/next-actions-table.md]. Emit one row per deferred item (DOC-006 spec task), reviewer-recommended follow-up, and Mode-D escalation (`human decision`), plus the recommended next plan/execute effort. When a `program` delivery-report was produced, keep the table front-and-center in the response with the report path listed as an artifact. Empty state only when nothing was deferred and no follow-ups remain.

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
- [ ] PR opened to the parent branch; run-branch squash-merge gated on approval/override (no unreviewed self-merge)
- [ ] Feature-level reviewer gate returned `APPROVED` (verdict + PR `commit_refs` = the plan-level completion record; standalone `plan-completion.md` retired per execution-doctrine §Bookkeeping demotions)
- [ ] Plan frontmatter `status` updated to `completed`
- [ ] Next Actions table emitted (deferred items + follow-ups + recommended next effort, or empty state)
- [ ] *(Recommended, non-blocking)* `program` delivery-report produced + HTML path recorded, when a shareable status snapshot is wanted

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
