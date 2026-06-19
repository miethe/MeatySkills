# Plan Execution Mode

Wave-driven orchestration for Tier 2/3 multi-phase plans via phase-owner agents.

## When to Use

Use this mode when the implementation plan has a `wave_plan` frontmatter block (Tier 2/3 plans) or when executing a cross-cutting refactor where multiple phases can run in parallel. Tier 0 uses `/dev:quick-feature`; Tier 1 uses `feature-sprint-executor`. Graduate to this mode when the plan's phase-dependency graph justifies parallel execution or when any phase carries >15K tokens of pattern context that would pollute the orchestrator window.

**Tier × Plan decision table** (spec §2.1):

| Plan type | Use phase-owners? |
|-----------|-------------------|
| Tier 0 quick-feature | No — use `/dev:quick-feature` |
| Tier 1 Feature Contract (3–8 pts) | No — use `feature-sprint-executor` (Mode C) |
| Tier 2 PRD + plan (2–3 phases) | Optional — only if phases are independent enough to parallelize OR any phase carries >15K tokens of pattern context |
| Tier 3 SPIKE + PRD + plan (4+ phases) | Default — wave-plan-driven phase-owner dispatch |
| Cross-cutting refactor (any tier) | Yes — domain-flavored phase-owners (api-owner, web-owner, data-owner) in parallel |

## Inputs

| Input | Required | Notes |
|-------|----------|-------|
| Plan path | Yes | Full path to `implementation_plans/…/plan-vN.md` with `wave_plan` frontmatter |
| `--from-phase=N` | No | Skip earlier waves; resume from wave containing phase N |
| `--dry-run` | No | Print resolved wave schedule without spawning phase-owners |
| `--no-isolation` | No | Override `isolation: worktree` directives (debug / forced-shared) |
| `--max-parallel=N` | No | Cap concurrent phase-owners (default: unbounded per wave) |

## Wave Loop

```
# 1. Load required skills
Skill("dev-execution")
Skill("artifact-tracking")

# 2. Read plan frontmatter — YAML head only (token-efficient)
head -80 <plan_path> | sed -n '/^---$/,/^---$/p'
# → parse wave_plan.waves  (list of lists: [[P1], [P2, P3], [P4]])
# → if wave_plan absent → SEQUENTIAL FALLBACK (see §Sequential Fallback below)

# 3. For each wave in wave_plan.waves:
for wave in waves:

    # 3a. Launch all phase-owners in parallel
    #     run_in_background=true when wave has >1 member (P20: completion is eventual)
    #     ALL spawns MUST use plain Task() — NEVER team_name: / TeamCreate (P15 invariant)
    for phase_id in wave:
        Task(
            subagent_type="phase-owner",
            name=f"P{N}-owner",                    # addressable; no SendMessage needed unless flag set
            description=f"Execute phase {N} ({label})",
            prompt=<see Phase-Owner Delegation Pattern>,
            isolation="worktree",                  # ONLY if wave_plan.phases[id].isolation == "worktree"
            run_in_background=(len(wave) > 1)
        )

    # 3b. Wait for all wave members — poll progress YAML; NO TaskOutput()
    #     Completion is eventual (P20): a background phase-owner finishes its current tool call
    #     (could be a long test run) before progress YAML transitions to `completed`.
    #     Do not interpret brief "in-flight" as a hang.
    for phase_id in wave:
        poll_until_done(
            progress_file=f".claude/progress/{plan_slug}/phase-{N}-progress.md",
            field="status",
            target="completed"
        )

    # 3c. Inter-wave git checkpoint
    checkpoint_sha = Bash("git rev-parse HEAD")
    # Store in plan frontmatter commit_refs for rollback traceability

    # 3d. Worktree merge-back (for any worktree-isolated phase in this wave)
    #     See §Worktree Merge Protocol

# 4. Feature-level reviewer gate (after final wave)
#    Tier 3 → karen; Tier 2 → task-completion-validator
#    Full gate matrix: ./validation/completion-criteria.md
if tier == 3:
    Task("karen", "Mode E: Reviewer. Review plan-level completion …")
else:
    Task("task-completion-validator", "Mode E: Reviewer. Review plan-level completion …")

# 5. Write plan-level Completion Report
Write(
    path=f".claude/worknotes/{plan_slug}/completion-report.md",
    content=<wave summary, reviewer verdict, commit_refs>
)
```

## Phase-Owner Delegation Pattern

All phase-owner spawns MUST use plain `Task()`. `team_name:` MUST NOT be used — load-bearing invariant (P15): L5 "no nested teams" prevents teammates from spawning implementers; issue #33045 silently ignores `isolation: "worktree"` for team spawns; issue #29441 breaks `skills:` preload for team spawns.

**Phase-owner delegation contract (load-bearing).** Phase-owners are orchestrators. Their tool whitelist includes `Edit`/`Write`/`Bash` *only* for Completion Note authorship, progress CLI invocation, state inspection, and worktree commits — never for implementing tasks. Every TASK-ID in the phase progress file MUST be implemented via a `Task()` dispatch from the phase-owner to the specialist named in `assigned_to`. Phase-owners empirically slip into direct implementation when the spawn prompt is concrete enough (file paths + AC) — every prompt template below MUST include the delegation contract block to mitigate this. See `.claude/agents/dev/phase-owner.md` §Delegation Mandate.

```python
Task(
    subagent_type="phase-owner",
    name="P2-owner",
    description="Execute phase 2 (API layer)",
    prompt=(
        "Mode: C (within phase scope; escalate on Mode D triggers).\n"
        "\n"
        "DELEGATION CONTRACT — orchestrate only. Every TASK-ID in the progress\n"
        "file MUST be implemented via Task() to the specialist named in\n"
        "`assigned_to`. You MAY NOT use Edit/Write on any file in any task's\n"
        "`files_affected`. Edit/Write are reserved for the Completion Note.\n"
        "Bash is reserved for progress CLI, state inspection, and worktree\n"
        "commits. See §Delegation Mandate in your agent definition for the\n"
        "full self-check gate. If the Agent column in your status table ever\n"
        "reads `phase-owner`, you have violated this contract — stop and\n"
        "re-route via Task().\n"
        "\n"
        "Plan: docs/project_plans/implementation_plans/foo/feature-bar-v1.md\n"
        "Phase: 2 (API Layer)\n"
        "Progress file: .claude/progress/feature-bar/phase-2-progress.md\n"
        "Phase budget: 30K tokens\n"
        "Required skills (pre-loaded via frontmatter): dev-execution, artifact-tracking\n"
        "Validator gate: task-completion-validator at end of phase\n"
        "On Mode D triggers (auth, payments, schema migration not in the plan,\n"
        "  deletion of >N files, force-push, secret rotation), stop and escalate.\n"
        "\n"
        "FILE OWNERSHIP — do NOT modify files outside this phase's files_affected list,\n"
        "and do NOT touch files claimed by other phases in this wave:\n"
        "  - my files_affected: <enumerated by orchestrator from wave_plan.phases[P2].files_affected>\n"
        "  - other wave-members' files_affected (avoid): <enumerated by orchestrator>\n"
        "  - serialization barriers (avoid unless this phase owns them):\n"
        "      CLAUDE.md, skillmeat/api/openapi.json, .claude/settings.json\n"
    ),
    isolation="worktree",      # ONLY when wave_plan.phases[id].isolation == "worktree"
                               # MUST be plain Task() spawn — issue #33045
    run_in_background=True     # for waves of size > 1
    # team_name: MUST NOT be used — P15 invariant
)
```

The orchestrator enumerates `files_affected` and `serialization_barriers` from `wave_plan` frontmatter before spawning. Parallel phase-owners cannot coordinate at runtime, so the constraint is expressed in the prompt upfront (OQ-2 mitigation, P1).

### Per-Phase Model / Effort Propagation

`wave_plan.phases[]` entries may carry two optional fields that serve as dispatch defaults for all implementer `Task()` calls within that phase:

```yaml
wave_plan:
  phases:
    - id: P2
      model: sonnet      # Optional. Default model for this phase's implementer dispatches.
      effort: adaptive   # Optional. Default thinking budget for implementers in this phase.
```

**Override rule (per-task wins)**: Individual task rows in the phase task table carry `Model` and `Effort` columns. A per-task value overrides the phase default at dispatch time. The phase default overrides nothing above it — it is simply the fallback when no per-task value is set. If both are absent, the implementer's own agent frontmatter model applies and the model's built-in effort default is used.

**Forwarding mechanics**:

- `model` — forwarded as the `model=` parameter on the `Task()` tool call (hard model override at the platform level). Omit the parameter entirely when no model is set.
- `effort` — injected as `Effort: <value>` in the implementer prompt text, because `Task()` has no effort parameter today. The implementer reads it from the prompt and applies it to its own reasoning budget.

**Fallback chain** (phase-owner applies this when dispatching implementers):

| Priority | Source | Action |
|----------|--------|--------|
| 1 (highest) | Per-task `Model` / `Effort` column in task table | Use directly |
| 2 | Phase model/effort from prompt (`Phase model default:` / `Phase effort default:`) | Use as fallback |
| 3 (lowest) | Absent at both levels | Omit `model=`; omit `Effort:` line — implementer defaults apply |

**Effort vocabulary**: Valid values are model-keyed. See `.claude/skills/planning/references/multi-model-guidance.md` for the full vocabulary per model (e.g., Claude models use `adaptive` / `extended`; Codex uses `none` / `low` / `medium` / `high` / `xhigh`).

**Omission is correct**: Both fields are optional throughout. Plans that do not set them continue to work unchanged — phase-owners dispatch implementers at their pre-configured sonnet default with no effort override.

## Validator Gating

**Per-wave (inside phase-owner)**: Each phase-owner runs `task-completion-validator` at the end of its phase before writing its Completion Note. Internal to the phase-owner; orchestrator does not run it directly. Gate matrix: `./validation/completion-criteria.md`.

**Plan-level (after final wave)**:

| Tier | Reviewer |
|------|----------|
| Tier 2 | `task-completion-validator` |
| Tier 3 | `karen` |

A phase, wave, or plan is not complete until the applicable reviewer approves. If the reviewer finds required fixes, the original phase-owner addresses them; escalate to Opus only after 2+ failed fix cycles.

### Wave Wait Protocol

After dispatching all phase-owners in a wave (with `run_in_background=True`), poll each phase's progress YAML for `status: completed` using exponential backoff: start at 10 s, double on each poll, cap at 60 s. Hard timeout per wave is **30 minutes** (override via `WAVE_TIMEOUT_SECS` env var or `--wave-timeout=N` flag if supported by the caller).

**On timeout**: Do NOT call `TaskOutput()`. Inspect agent state via `claude agents` (Agent View, per SF-5) to confirm the phase-owner is still running. Options: wait further, escalate to Opus, or mark the wave BLOCKED and abort the plan.

**On apparent hang** (status stays `in_progress` for >5 minutes with no progress YAML `mtime` change): log the observation and continue polling. Background subagents finish their current tool call — which may be a long test run — before the progress YAML transitions to `completed` (P20). A silent interval is not a hang.

```bash
# Poll loop (illustrative — adapt to caller's shell context)
ELAPSED=0; INTERVAL=10
while [ "$(head -20 ${PLAN_DIR}/phase-${N}-progress.md | grep '^status:' | awk '{print $2}')" != "completed" ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  [ $ELAPSED -ge ${WAVE_TIMEOUT_SECS:-1800} ] && { echo "TIMEOUT: wave ${WAVE_NUM} exceeded ${WAVE_TIMEOUT_SECS:-1800}s"; break; }
  INTERVAL=$(( INTERVAL * 2 > 60 ? 60 : INTERVAL * 2 ))
done
```

## Worktree Merge Protocol

When a phase-owner returns after running with `isolation: "worktree"` (§2.5 + P3), the
orchestrator handles integration explicitly — merge-back is NOT automated by the platform.

**Safety contract (P3 / bug #46444)**: Phase-owners MUST `git commit` all intended-to-survive
work before emitting their completion signal. Never rely on uncommitted state across sessions.

**Orchestrator merge-back sequence**:

```bash
# 1. Verify the worktree branch has commits (phase-owner committed per P3)
git log HEAD..worktree-<slug> --oneline

# 2. Inspect the diff before merging
git diff HEAD..worktree-<slug>

# 3. Run tests and lint on the worktree branch
# (delegate to task-completion-validator or run inline if small)

# 4a. If validator passed: squash-merge into working branch
git merge --squash worktree-<slug>
git commit -m "feat(scope): merge phase N worktree"

# 4b. If validator failed: discard the worktree branch
git branch -D worktree-<slug>
# Re-spawn phase-owner with corrective prompt; or escalate to Opus
```

**Before next wave**: Verify the worktree's branch has been merged or explicitly preserved before
proceeding. Record the merge commit SHA in the plan's `commit_refs` frontmatter.

**Running scripts inside a worktree (editable install gotcha):** `python scripts/x.py` from a
worktree imports the **installed** package (where `pip install -e` points = the main repo), **not**
the worktree's copy — silent `ImportError` on worktree-only symbols. Prefix `PYTHONPATH=$(pwd)` or
run as `python -m`. (`python -m pytest` from the worktree root already shadows correctly via cwd on
`sys.path[0]`; bare `python scripts/x.py` does not.)

## Sequential Fallback

If the plan has no `wave_plan` frontmatter, fall back to phase-number-ordered sequential
execution for backward compatibility:

```
phases_in_order = sorted(discovered_phases_by_number)
for phase in phases_in_order:
    Task("phase-owner", name=f"P{N}-owner", …, run_in_background=False)
    poll_until_done(progress_file)
    git checkpoint
```

This mirrors the existing `/dev:execute-phase` loop, applied across all phases of a plan.
No parallelism; no wave dependencies. Full equivalence with running `/dev:execute-phase` manually
per phase. Logs a notice: "No wave_plan found — running sequential fallback."

## Token Discipline

Phase budget is ~25–30K tokens per phase-owner. The orchestrator's budget follows the same
invariants as all execution modes — see `./SKILL.md §Token Discipline` (authoritative; do not
re-read into this mode file). Core rules that apply specifically to plan execution:

- Task prompts to phase-owners < 500 words. Provide file paths, not file contents.
- Never call `TaskOutput()` for phase-owners — verify completion via progress YAML on disk (~7.5K tokens saved per call avoided).
- Opus reads only plan frontmatter (`wave_plan.waves`) and progress YAML status. Phase-owners own their own context exploration.
- Inter-wave git checkpoint is one `Bash("git rev-parse HEAD")` call — not a full diff read.

## Resume Semantics

After `claude checkpoint restore`, background phase-owners that were in-flight at checkpoint
time are NOT automatically resumed by the platform (P19 — canonical: L1). Phase-owners are
background subagents, not in-process Agent Teams teammates; the L1 "`/resume` and `/rewind`
do not restore in-process teammates" restriction does not apply, but the analogous behavior
holds — in-flight subagents are not resumed either.

**Reconstruction protocol**:

1. Read all `phase-N-progress.md` files for the plan.
2. Identify phases with `status: in-progress` — these were in-flight at checkpoint time.
3. Treat them as incomplete; re-spawn their phase-owners with the same prompt parameters.
4. Do NOT assume any partial work from the in-flight session survived (per P3 safety contract,
   work should have been committed before completion — if it was, the commits are on disk; if
   not, the work is lost and the re-spawn starts from the last committed state).

Progress YAML is the canonical truth (updated atomically by the phase-owner's `update-batch.py`
CLI calls). Use it — not the platform's task state or Agent View — as the source for wave
reconstruction.
