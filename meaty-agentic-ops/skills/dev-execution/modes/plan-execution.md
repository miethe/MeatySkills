# Plan Execution Mode

Wave-driven orchestration for Tier 2/3 multi-phase plans via phase-owner agents.

> **The run executes in a git worktree by default** per
> [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md) (run branch → PR to the parent
> branch → squash-merge on approval, or an in-prompt override). The per-phase `isolation: worktree`
> directive below is a separate, finer-grained control: it governs **wave-level sub-worktrees** for
> individual phases *within* the run, not whether the run itself is isolated.

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

# 2a. Pre-Execution Artifact Provisioning (best-effort, ON BY DEFAULT)
#     Runs BEFORE the wave loop below constructs any phase-owner dispatch — resolves the
#     plan's required_artifacts frontmatter + the project manifest (.claude/aos-artifacts.yaml)
#     and deploys any in-catalog gap. On by default (disable with AOS_ARTIFACT_PROVISION=0);
#     silent no-op with no manifest and no required_artifacts. Non-fatal on infra failure;
#     a NEEDED+unsatisfiable artifact is the one hard gate — engine exit 2 halts the run before
#     any phase-owner spends budget. Gate + env resolution: .claude/rules/artifact-provisioning.md
Bash(f'PROVISION_PLAN_FILE="{plan_path}" PROVISION_SCOPE="plan:{plan_slug}" '
     f'.claude/skills/dev-execution/hooks/provision-artifacts.sh')

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

    # 3c-sync. IntentTree SDLC Sync — after wave merge (best-effort, ON BY DEFAULT)
    # Propagates all phase progress files in the just-completed wave to bound nodes.
    # On by default; disable with INTENTTREE_SDLC_SYNC=0. No-op without a binding.
    # Non-fatal: offline / CLI-missing → skip with warning, never block the wave loop.
    # Gate + env resolution: .claude/rules/intenttree-integration.md
    for phase_id in wave:
        progress_f=f".claude/progress/{plan_slug}/phase-{N}-progress.md"
        Bash(f'SDLC_SYNC_FILE="{progress_f}" INTENTTREE_TREE="${{INTENTTREE_TREE:-}}" '
             f'.claude/skills/dev-execution/hooks/sdlc-sync.sh')

    # 3d. Worktree merge-back (for any worktree-isolated phase in this wave)
    #     See §Worktree Merge Protocol
    #
    #     NOTE: the dossier no longer regenerates per wave (bookkeeping demotion,
    #     `references/execution-doctrine.md` — Bookkeeping demotions table: "every
    #     phase boundary + every wave" -> "end of plan"). Stage-authoring at phase
    #     close still happens inside the phase-owner (phase-execution.md §5.2b);
    #     the regeneration call itself moves to step 7 below.

# 4. Feature-level reviewer gate (after final wave) — ONE whole-tree pass, not a lens set.
#    Tier 3 → karen-final-tree-only; Tier 2 → validator.
#    Do not add a second plan-level lens: phase gates already ran, scoped to bounded
#    diffs, and a security-relevant surface carried its lens there.
#    Full gate matrix: ./validation/completion-criteria.md
#
#    Dispatched as a SCHEMA'D WORKFLOW STAGE, never a bare Task() — see ../SKILL.md
#    § "How a gate is dispatched". A bare Task blocks the main loop, forces no decision to
#    exist, and makes a dead reviewer indistinguishable from an approving one.
gate = Workflow({"name": "reviewer-gate", "args": {
    "scope": {"id": plan_slug, "title": feature_title, "kind": "plan", "tier": tier},
    "lenses": ["karen-final-tree-only"] if tier == 3 else ["validator"],
    "acceptance_criteria": plan_level_acs,
    "files_changed": files_touched_across_waves,
    "plan_ref": plan_path,
    "timestamp": iso8601_now,
}})

# `approved: false` means two different things. Branch on gate_ran, not on approved alone:
#   gate_ran=True  → a real rejection. Fix, re-invoke with failure_summary; counts against
#                    the gate budget (max 2 re-passes per scope x lens).
#   gate_ran=False → the gate DID NOT RUN (reviewer died after retries, or was skipped).
#                    Re-dispatch it, or record an explicit operator override. Do NOT run a
#                    fix cycle — nothing was found, so a cycle edits blind and then
#                    re-reviews unchanged code. Does not consume the gate budget.
# Steps 5-9 below run only after an approving verdict.

# 5. IntentTree SDLC Sync — plan done (best-effort, ON BY DEFAULT)
# After the reviewer approves, sync the plan file itself so the feature root node
# reflects the final status. On by default (disable with INTENTTREE_SDLC_SYNC=0);
# no-op without a binding. Non-fatal. Gate: .claude/rules/intenttree-integration.md
Bash(f'SDLC_SYNC_FILE="{plan_path}" INTENTTREE_TREE="${{INTENTTREE_TREE:-}}" '
     f'.claude/skills/dev-execution/hooks/sdlc-sync.sh')

# 6. Plan-level Completion Report — RETIRED (bookkeeping demotion,
#    `references/execution-doctrine.md` — Bookkeeping demotions table). The reviewer
#    verdict from step 4 plus `commit_refs` recorded in plan frontmatter (step 3c) IS
#    the record; nothing is written to `.claude/worknotes/{plan_slug}/completion-report.md`
#    anymore. (This is distinct from the phase-owner's per-phase Completion Note —
#    see §Phase-Owner Delegation Pattern — which survives unchanged.)

# 7. Delivery Dossier — plan done (best-effort, ON BY DEFAULT)
# Close the living dossier: the reviewer-approved plan-completion state and the
# `validate` stage should now be authored into the manifest (evidence, screenshots,
# the enforced-`feature`-report cross-link when applicable), then regenerated.
# Recommended / non-blocking; disable with AOS_DELIVERY_DOSSIER=0; no-op without a
# manifest. Spec: docs/skill-development/delivery-dossier/spec.md §A.6
Bash(f'DELIVERY_DOSSIER_MANIFEST=".claude/reports/dossier/{feature_slug}/report.json" '
     f'.claude/skills/dev-execution/hooks/update-dossier.sh')

# 8. Publish + link the dossier — plan done (best-effort, ON BY DEFAULT)
# Now that step 7 has rendered the dossier's HTML, host it (atlas) and link it into
# IntentTree (route `dossier`, collapsing on (route, subject) by design — D1). Must run
# AFTER step 7: publishing before the render would host a stale artifact. Recommended /
# non-blocking; disable with AOS_DELIVERY_REPORT_PUBLISH=0; no-op without a manifest AND
# an IntentTree binding. Spec: .claude/worknotes/delivery-report-hosting-and-linking/
# implementation-notes.md (D1-D5).
Bash(f'DELIVERY_REPORT_MANIFEST=".claude/reports/dossier/{feature_slug}/report.json" '
     f'ITT_NODE_ID="${{ITT_NODE_ID:-}}" INTENTTREE_TREE="${{INTENTTREE_TREE:-}}" '
     f'.claude/skills/dev-execution/hooks/publish-report.sh')

# 9. Finding sweep — plan done (backstop; best-effort, ON BY DEFAULT)
# Reconcile findings NAMED across the plan (the findings doc + the DOC-006 deferred-items
# triage table) against nodes actually FILED. This is the last net under the detection-time
# rule (.claude/rules/finding-capture.md): anything it reports was already missed in-session,
# so file it now rather than shipping a plan with untracked findings. Reports only — always
# exits 0; disable with AOS_FINDING_SWEEP=0; no-op when neither artifact exists.
Bash(f'FINDING_SWEEP_FINDINGS_DOC=".claude/findings/{feature_slug}-findings.md" '
     f'FINDING_SWEEP_PLAN_FILE="{plan_path}" FEATURE_SLUG="{feature_slug}" '
     f'.claude/skills/dev-execution/hooks/finding-sweep.sh')
```

### Implementation Notes Over Halt

Per `references/execution-doctrine.md` §"Implementation notes over halt-and-gate": phase-owners
log a deviation — a conservative choice, an assumption, a discovered constraint — to
`.claude/worknotes/<plan_slug>/implementation-notes.md` with its rationale and keep going, rather
than halting the wave loop. The orchestrator reviews accumulated notes at the plan milestone
boundary (not per-wave). This does **not** relax the three mid-milestone halt cases or the Mode-D
boundaries below — those are unchanged and non-negotiable.

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

**Delta context only.** When the orchestrator or a phase-owner assembles input for a validator/
reviewer gate dispatch (below, and in §Validator Gating), that packet carries the **delta** —
failure summary, touched files, AC in question — never the full plan, the cumulative diff, or the
progress file (`references/execution-doctrine.md` rule 2). If a reviewer needs the whole plan to
judge one AC, that is a signal the AC is under-specified — fix the AC, don't widen the packet.

### Dispatch-Time Routing

Under the doctrine there are no plan-time model/effort pins (`references/execution-doctrine.md` —
Bookkeeping demotions table, `orchestrator_model` row: "deleted — advisory, never read"). A
`wave_plan.phases[]` entry carries **routing constraints**, not a resolved model:

```yaml
wave_plan:
  phases:
    - id: P2
      routing_constraints:
        must_stay_primary: false   # true -> MUST-stay-primary class (Mode-D, above-Sonnet-5-bar work); never offloaded
        offload_eligible: true     # bounded, contract-clear work may resolve to ICA Sonnet 5
        capability_bar: standard   # standard | hardest — hardest implies xhigh effort / Opus-5-spine legs
```

**Resolution happens at dispatch, not at plan-authoring time.** For every implementer `Task()`
call, the phase-owner resolves provider + model through the `delegation-router` skill, passing
the phase's `routing_constraints` plus the task's own shape; the orchestrator does the same for
its own spine/cross-wave-merge legs. Forward whatever `delegation-router` returns for that
specific dispatch as `Task(model=...)` — never a value copied verbatim from plan frontmatter. See
[`MODEL-ROUTING.md`](../../../../docs/agentic-operator/MODEL-ROUTING.md) for the policy
`delegation-router` applies (MUST-stay classes, the Cost/Intelligence/Taste/Speed scorecard,
offload eligibility).

**Backward compatibility — in-flight plans only.** A plan authored before this doctrine may still
carry `phases[].model` / `phases[].effort` as a plan-time pin. Per
`references/execution-doctrine.md` ("Applies to runs of new doctrine plans... in-flight plans
finish under their own rules"), honor a legacy pin exactly as before — forward it as
`Task(model=...)`, inject `Effort: <value>` in the prompt. **New plans must not emit
`phases[].model` / `phases[].effort`** — author `routing_constraints` instead.

**Omission is correct**: `routing_constraints` is optional throughout. Absent it,
`delegation-router` applies its default resolution (subscription Sonnet 5 for implementation, Opus
5 for spine/hardest legs) with no plan-authored override.

## Validator Gating

**Per-phase (inside phase-owner) — one lens by default.** Each phase-owner runs the phase's assigned
reviewer at the end of its phase before writing its Completion Note. Internal to the phase-owner;
orchestrator does not run it directly. Gate input is delta context only (see above) — the failure
summary, touched files, and AC in question, never the full plan stack.

**Which reviewer: read the phase, not the tier.**

| Phase carries | Reviewer |
|---|---|
| `gate_lens` including `security` | `council-review` (the adversarial security lens) |
| `gate_lens` including `karen` / `karen-final-tree-only` | `karen` |
| anything else — **the default** | `task-completion-validator` |

`gate_lens` is assigned per phase by the three second-lens triggers (untrusted-input / authz-boundary /
irreversible-outward) — `references/gate-risk-classes.md` §2. **Tier does not select the reviewer and
does not add lenses.** A Tier 3 CRUD phase gets one `task-completion-validator`; a Tier 2 authorization
phase gets the security lens. A phase carrying two lenses must name its `gate_lens_reason`.

**Plan-level (after final wave) — one whole-tree pass:**

| Tier | Reviewer |
|------|----------|
| Tier 2 | `task-completion-validator` |
| Tier 3 | `karen` (final tree, once) |

Do not add a second plan-level lens. The phase gates already ran, scoped to bounded diffs; a
security-relevant surface carried its lens there.

A phase, wave, or plan is not complete until the applicable reviewer approves. **Gate budget**
(`references/execution-doctrine.md` rule 1): a reviewer/validator gate on the **same scope x
lens** gets at most **2 re-passes**. The original phase-owner addresses required fixes by
continuing its existing session (see §Worktree Merge Protocol — fix loops continue, they do not
re-dispatch). The **3rd failure against the same scope x lens does not escalate to "a human looks
at it"** — it auto-escalates to re-scope/redesign of that phase. Count re-passes per scope x lens,
not per dispatch: re-spawning the phase-owner does not reset the budget.

**Same-class stop rule** (`references/execution-doctrine.md` rule 1, hard): if two consecutive rounds
on the same scope surface the **same defect class**, stop — the next action is a **design change, not a
third review**, even with a re-pass left in the budget. Label each round's defect class in the
Completion Note as you go; without labels the rule is unenforceable. The design change is
`references/gate-risk-classes.md` §3b: make the unsafe state unrepresentable, or route callers through
one choke point, then re-enter the gate against the new shape (budget resets — the scope changed).
Different classes across rounds is normal progress and does not trigger this.

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

> **Canonical run-level protocol:** the run-wide git workflow (run branch → PR to the parent branch →
> squash-merge on approval) lives in [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md).
> This section is the **per-wave** detail that operates **one level below** that protocol: each
> worktree-isolated phase's wave branch is squash-merged back into the **run branch** here, and the run
> branch is what later PRs to the parent.

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

# 4b. If validator failed: continue the SAME phase-owner session on the SAME
# worktree branch — do NOT discard the branch or re-spawn. Per
# references/execution-doctrine.md rule 3 ("Continue; don't re-dispatch"), the
# phase-owner is cache-warm and already holds the context the fix depends on;
# a fresh re-dispatch re-ingests everything to relearn what it already knew.
# Hand the phase-owner the delta only (failure summary, touched files, AC in
# question — see §Validator Gating) and let it commit a fix on worktree-<slug>.
# git branch -D worktree-<slug> is NOT part of this path.
```

**Discarding the branch is reserved for auto-escalation, not routine fix loops.** The gate budget
(§Validator Gating) caps a scope x lens at 2 re-passes; only the **3rd failure** triggers
re-scope/redesign, and only *that* path may abandon `worktree-<slug>` and restart the phase from a
new scope. This is a different situation from **Resume Semantics** below (§Resume Semantics):
resuming after an interrupted *session* (checkpoint restore) re-spawns phase-owners with the same
prompt parameters because the prior in-flight session no longer exists to continue — it is not a
fix loop and does not consume gate-budget re-passes.

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

> **Not a fix loop.** The re-spawn below is a **crash-recovery** action — the in-flight session
> was killed by the checkpoint restore and no longer exists to continue. It is unrelated to the
> validator fix-loop path in §Worktree Merge Protocol, where the phase-owner session is still
> alive and continues on its own worktree branch. Do not conflate the two, and do not count a
> resume re-spawn against the §Validator Gating gate budget.

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
