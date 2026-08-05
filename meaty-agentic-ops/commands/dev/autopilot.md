---
description: "Autopilot — Opus-orchestrated auto-feature workflow for request-driven feature delivery without a pre-authored contract or plan"
argument-hint: "[feature-text|REQ-ID] [--plan-only] [--dry-run] [--budget=<tokens>] [--category=features|enhancements|refactors|harden-polish|infrastructure] [--max-points=N]"
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(pytest:*), Bash(pnpm:*), Bash(python:*), Bash(meatycapture:*)
---

# Autopilot

**You are Opus.** This command is the zero-ceremony entry point for feature delivery: from raw request to merged code without a pre-authored Feature Contract or Implementation Plan. You invoke the `auto-feature` Dynamic Workflow, which auto-classifies scope, selects the right execution tier, generates planning artifacts on the fly, and delivers — all in a single workflow run.

> **Git workflow.** Autopilot follows the [git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md) **with the scripted-lane exception in its §1a**: the run happens on a **branch checked out in the session repo itself**, *not* in a separate worktree — the **parent branch** (HEAD at run start) is the PR base, work goes to a PR against the parent branch, and **squash-merge only happens on approval or an in-prompt override** (e.g. "auto-merge" / "merge when done"). Opus still orchestrates every git step.
>
> **Why not a worktree here.** Workflow agents run in the **session's cwd**; there is no per-agent cwd argument, `EnterWorktree` does not propagate to background workflow agents, and `isolation:'worktree'` makes the harness branch the *session* repo onto a branch the orchestrator never named. So a worktree created here is unreachable by the agents that do the work: they commit to whatever branch the session repo is on. This is not theoretical — on 2026-08-05 the assigned branch `autopilot/<slug>` received **zero** commits while both real commits landed on `main` and one was **pushed**, skipping the PR, review, and squash gates while the report read `status: complete`. Naming the branch and refusing to run anywhere else is the guarantee; a worktree path was never one. For parallel autopilot runs, start a **separate session inside a worktree directory** so that worktree *is* the session cwd.
>
> **Model routing.** Opus 5 orchestrates; subscription-side execution defaults to **Sonnet 5** (`claude-sonnet-5`, **`xhigh`** for the hardest work); offload bounded, contract-clear waves to **ICA Sonnet 5** (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the reviewer gate, never Mode-D work. Policy: [`MODEL-ROUTING`](../../../docs/agentic-operator/MODEL-ROUTING.md).

**Skill loading rule**: Do NOT load `Skill("workflow-authoring")` unless you need to modify the `auto-feature` workflow script itself. For normal runs this command requires no skill loads.

---

## When NOT to use

| Situation | Use instead |
|---|---|
| Request clearly touches auth, payments, billing, migrations, data deletion, secret rotation, or infra | Resolve interactively as **Mode D** (`.claude/rules/delegation-modes.md`) — no autopilot |
| Request is a large epic: multi-system rewrite, "redesign everything", 3+ independent features bundled | `/plan:explore` (speculative/risky) or `/plan:plan-feature` (large scoped work) |
| A Feature Contract or Implementation Plan **already exists** for this work | `/dev:execute-contract` (Tier 1) or `/dev:execute-plan` (Tier 2/3) |
| Request is Tier 0 (1–3 pts, single file, trivial) | `/dev:quick-feature` — autopilot overhead is not justified |
| User explicitly wants planning review before execution | Pass `--plan-only` flag and inspect before relaunching |

---

## Actions

### 1. Resolve the Request

Parse `$ARGUMENTS` to extract the raw feature text and optional modifiers.

| Input pattern | Type | Action |
|---|---|---|
| `REQ-YYYYMMDD-*-XX` or similar request-log ID | REQ-ID | Run `meatycapture log item view <ID>` (or `/mc view <ID>`) to retrieve request text; bind `request_id` |
| Any other text | Raw feature text | Use directly as `request` |
| Starts with `./`, `/`, `~` | File path | Read first 80 lines; use contents as `request` |

Parse optional modifiers from `$ARGUMENTS`:
- `--plan-only` → set `plan_only: true`
- `--dry-run` → set `dry_run: true`
- `--budget=<N>` → override `budget_total`
- `--category=<cat>` → set `category`
- `--max-points=<N>` → override `ceiling.max_points`

### 2. Pre-Flight Guard (Opus, before workflow invocation)

Scan the resolved request text for signals that make autopilot inappropriate. Do this yourself — do not delegate. Stop and surface a recommendation if any signal is clearly present.

**Workflow availability** (hard gate — check this FIRST, before any request-text signal):

```bash
test -f .claude/workflows/auto-feature.js && echo "auto-feature: present" || echo "auto-feature: MISSING"
```

If `.claude/workflows/auto-feature.js` is absent in the current repo, autopilot's scripted multi-agent lane **cannot run here** — `workflow('auto-feature', ...)` will not resolve. Do **not** attempt the invocation and do **not** silently fall back. Tell the user the workflow is not deployed to this repo, then route to the equivalent hand-orchestrated path:

- A Feature Contract or Implementation Plan already exists → `/dev:execute-contract` (Tier 1) or `/dev:execute-plan` (Tier 2/3)
- Otherwise → `/plan:plan-feature` (tier-aware planning) or `/dev:quick-feature` (Tier 0)

(Only SkillMeat's own repo and repos that have received the workflow via SkillMeat artifact provisioning carry `.claude/workflows/auto-feature.js` today. Until a repo is provisioned, the scripted lane is unavailable there — the hand-orchestrated commands above are the supported path.)

**Mode D signals** (stop — do not invoke autopilot):
- Auth, authentication, authorization, Clerk, JWT, session tokens, OAuth
- Payments, billing, Stripe, subscription
- Data deletion, purge, hard-delete, cascade drop
- Database migration, schema change, Alembic, `ALTER TABLE`
- Secret rotation, API key rotation, credential change
- Infrastructure, Docker, deployment, CI/CD pipeline changes

**Epic-scale signals** (stop — do not invoke autopilot):
- "Redesign everything", "rewrite the whole", "refactor the entire"
- Explicitly bundles 3+ unrelated features
- Mentions multiple teams or systems with no clear integration seam

If clearly **Mode D**: Respond with the specific boundary hit and instruct the user to proceed interactively under Mode D discipline. Do not invoke the workflow.

If clearly **epic-scale**: Recommend `/plan:explore` (for speculative/research-heavy) or `/plan:plan-feature` (for well-scoped but large). Do not invoke the workflow.

If borderline: proceed — the `auto-feature` workflow's scope-classifier handles fine-grained triage internally and will return `needs_opus` if it determines the request is too large.

Also check working tree cleanliness:

```bash
git status --porcelain
```

A dirty tree is **not** a warn-and-continue here: Action 3 checks out the run branch **in this repo**, and `git switch -c` carries uncommitted changes onto it, where the sprint will commit them as part of the feature. Surface the dirty paths and resolve them (commit or stash on the parent branch) before Action 3, or ask the user. Carrying someone else's work into a feature PR is not recoverable by re-reading the report.

### 3. Set Up the Run Branch (in the session repo — not a worktree)

The nested engines commit to whatever branch **the session repo** is on, so the run branch must be checked out *here*. Do not `git worktree add`: see the "Why not a worktree here" note above — a worktree the agents cannot reach is worse than no isolation at all, because it reads like isolation in the report.

```bash
# Resolve the CURRENT repo root — never hard-code a specific repo. Reused in §4b and Action 5.
REPO_ROOT="$(git rev-parse --show-toplevel)"
SESSION_REPO="$(basename "${REPO_ROOT}")"

# Record the PARENT branch (HEAD now) — the PR base and squash-merge target.
PARENT_BRANCH="$(git -C "${REPO_ROOT}" branch --show-current)"
PARENT_TIP="$(git -C "${REPO_ROOT}" rev-parse HEAD)"   # to detect a mid-run parent move

# Derive a slug from the request (kebab-case, max 40 chars).
BRANCH="autopilot/<request-slug>"

git -C "${REPO_ROOT}" switch -c "${BRANCH}"            # create + check out IN the session repo
BASE_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"     # pre-run checkpoint
git -C "${REPO_ROOT}" branch --show-current            # CONFIRM: must print ${BRANCH}
```

Verify that last line actually prints `${BRANCH}` before invoking. If the switch failed the run must not start — every downstream guard is checking placement against a branch that would not exist.

**Dirty tree is a decision, not a warning, at this point.** `git switch -c` carries uncommitted changes onto the new branch, so they will be swept into the sprint's commits and attributed to this feature. If Action 2's `git status --porcelain` was non-empty, either commit or stash those changes on the parent branch first, or ask the user — do not carry them silently.

If the branch already exists, check it out instead of creating it (`git -C "${REPO_ROOT}" switch "${BRANCH}"`), confirm its tip is where you expect, and log the reuse. Never proceed on the parent branch as a fallback.

### 4. Build Args Envelope and Invoke

Construct the args envelope (Opus computes `timestamp` here; never inside the workflow):

```json
{
  "request": "<resolved feature request text>",
  "request_id": "<REQ-ID if resolved from request log, else omit>",
  "timestamp": "<ISO 8601 datetime — Opus sets this>",
  "budget_total": 90000,
  "context_paths": ["<optional seed paths from user, else omit>"],
  "category": "<features|enhancements|refactors|harden-polish|infrastructure — if determinable, else omit>",
  "run_branch": "<BRANCH from Action 3 — REQUIRED>",
  "parent_branch": "<PARENT_BRANCH from Action 3 — REQUIRED>",
  "branch_base": "<BASE_SHA from Action 3 — REQUIRED>",
  "parent_tip_at_start": "<PARENT_TIP from Action 3>",
  "session_repo": "<SESSION_REPO from Action 3>",
  "ceiling": {
    "max_points": 13,
    "max_waves": 3,
    "max_phases": 8,
    "max_files": 25
  },
  "plan_only": false,
  "dry_run": false
}
```

**The four placement fields are what make the gates real — do not omit them.** `run_branch` arms the pre-dispatch branch guard (a mismatch halts with `blocked / wrong_branch` before any agent can commit) and the post-run empty-branch check (`needs_opus / nothing_on_run_branch` instead of `complete`). `branch_base` replaces a `HEAD~10` **guess** in the report structurer — that guess is why a past report disagreed with reality by 55 files. `parent_tip_at_start` is what lets the report say `parent_moved: true` rather than leaving you to infer a mid-run rebase from a SHA that no longer resolves. Omit them and the engines fall back to their pre-guard behaviour: they will run, and they will not check placement.

**Recommended: dry run first** on non-trivial requests to inspect the plan graph before committing to execution:

```text
workflow('auto-feature', { ...args, dry_run: true })
```

For planning review before execution: `plan_only: true` — the workflow plans, gates with Opus, and stops before dispatching implementation agents.

Invoke for full execution:

```text
workflow('auto-feature', args)
```

Run in background if the request is non-trivial (most cases). Monitor via `/workflows` TUI.

**Do not** call `TaskOutput()` on the workflow — verify outputs on disk after the workflow returns (`.claude/rules/context-budget.md`).

### 4b. MANDATORY post-flight: refute the report before reading it

**Do this before acting on any `status`, and before reading the report's prose.** The report is a
claim about work; it is not evidence of where that work landed or whether it exists. Autopilot has
returned `complete` / `approved: true` / *"N/N ACs met"* for a feature it never wrote **twice**
(AARs `2026-08-03`, `2026-08-04`), so this is a known-live failure mode, not a precaution.

The workflow now checks placement itself (`wrong_branch` / `nothing_on_run_branch`, and a
`run_placement` block on **every** report). That does not retire this section: the guards prove
what the engine observed, and this proves the engine. Read `run_placement` first — it answers most
of the questions below without a command — then confirm independently.

```bash
# 1. Did anything land on the branch we gave it?  This is the whole ballgame.
git -C "${REPO_ROOT}" log --oneline "${BASE_SHA}..${BRANCH}"
```

**Empty output means the feature does not exist on our branch.** Stop; ignore every past-tense claim in
the report. Do not proceed to §5. (Check step 3 before concluding the work was never written — it may
exist on the parent branch, unreviewed.)

```bash
# 2. Is the report's commit_sha actually ON our branch?  Name the BRANCH, not HEAD:
#    `--is-ancestor <sha> HEAD` passes for a commit on the parent branch whenever HEAD *is* the
#    parent branch — which is precisely the bypass case, so HEAD cannot detect it.
git -C "${REPO_ROOT}" merge-base --is-ancestor <commit_sha> "${BRANCH}" \
  && echo "on-branch" || echo "OFF-BRANCH — the executor committed somewhere else"

# 3. Where did it really go?  (usually: straight to the parent branch)
git -C "${REPO_ROOT}" branch -a --contains <commit_sha>

# 4. The true file set.  Ignore files_touched unless branch_base was passed.
git -C "${REPO_ROOT}" diff --name-status "${BASE_SHA}..${BRANCH}"
```

> ⚠️ **`commit_sha != BASE_SHA` is NOT sufficient**, and the 2026-08-03 AAR's guard said it was.
> On 2026-08-04 the executor produced a real, novel commit — `c111333`, genuinely different from
> `BASE_SHA` — on the **parent branch**, for a **different feature**. That guard passed while the
> run was entirely fabricated. Use *reachability from the run branch* (step 2), never inequality.

**A `commit_sha` that resolves to nothing is not automatically fabrication.** When the parent branch
moves mid-run and the branch is rebased, the reported SHA becomes an unreachable orphan while the real
work lives under a new SHA — identical diff, identical message. On 2026-08-05 the reported `8cd71d1`
was an orphan and the real commit was `952f379`. Distinguish them, because guessing wrong is expensive
in both directions (calling real work fabricated wastes a re-run; calling fabrication real ships
nothing):

```bash
# Did the parent move under us?  run_placement.parent_moved answers this directly; confirm:
git -C "${REPO_ROOT}" rev-parse "${PARENT_BRANCH}"    # compare against PARENT_TIP from Action 3

# Re-find the work by its rebase-stable identity (run_placement.patch_id):
git -C "${REPO_ROOT}" diff "${BASE_SHA}..${BRANCH}" | git patch-id --stable
```

Same `patch_id` (or same subject + diffstat) under a different SHA ⇒ **rebased, real**: use the new SHA
everywhere and never copy the reported one forward. No matching work anywhere ⇒ fabricated.

Then cross-check the report against itself. Each of these is free and each one independently
predicted the fabrication both times:

| Check | Fails when |
|---|---|
| `autopilot.plan_artifact_path` names the feature you asked for | it names an unrelated / already-shipped feature — the Stage-B drift signature |
| `autopilot.file_count == len(files_touched)` | the report assembler globbed a stale base (55-file disagreement in 2026-08-03) |
| `autopilot.tier` / `effort_points` match the planner's own stated figures | the structurer drifted, which also silently disables the feasibility gate |
| any symbol/function/flag the report says it created | `grep -rn "<symbol>" .` returns nothing |

`reason: plan_identity_mismatch` is the workflow now catching this itself — treat it as a **trusted
halt**, not an error: the planner's artifact on disk is good, only the structurer drifted.

⚠️ Run every command with an explicit `-C "${REPO_ROOT}"` or an absolute path. The Bash tool resets
cwd between calls, so a relative command after an earlier `cd` silently runs against wherever the
session started. In 2026-08-03 that printed a green suite which had never loaded the changed code,
converting a fabrication into an apparent verification. Assert the **content** you expect — the
symbol is present in the diff, the test names the new behaviour — never a bare PASS.

### 5. Handle the ExecutionReport

The workflow returns a standard `ExecutionReport` plus an `autopilot` annotation:

```json
{
  "status": "complete|needs_opus|blocked",
  "reason": "<see branches below>",
  "run_placement": {
    "run_branch": "autopilot/<slug>",
    "parent_branch": "main",
    "base_sha": "<BASE_SHA>",
    "current_branch": "<branch the tree ended on>",
    "commit_count": 3,
    "head_sha": "<re-resolved at report time>",
    "patch_id": "<rebase-stable identity>",
    "parent_moved": false
  },
  "autopilot": {
    "tier": 0 | 1 | 2,
    "effort_points": N,
    "wave_count": N,
    "plan_artifact_path": "<path to generated plan/contract>",
    "execution_target": "quick-feature|contract|plan"
  }
}
```

Handle each status/reason branch:

---

#### `status: complete`

All implementation, reviewer gates, and validation passed inside the workflow.

Opus actions:
1. **Open a PR to the parent branch; squash-merge on approval/override** (protocol §5–6):
   ```bash
   git -C "${REPO_ROOT}" branch --show-current   # CONFIRM ${BRANCH} before anything below
   git -C "${REPO_ROOT}" diff "${PARENT_BRANCH}"..."${BRANCH}"
   # Run the repo's applicable validation suite (commands vary by repo):
   pytest -v          # if Python changed (use the repo's own coverage target, e.g. --cov=<pkg>)
   pnpm test && pnpm type-check && pnpm lint   # if frontend changed

   git -C "${REPO_ROOT}" push -u origin "${BRANCH}"
   gh pr create --base "${PARENT_BRANCH}" --head "${BRANCH}" \
     --title "feat(<slug>): <summary from report>" --body-file .claude/pr-body.md
   # Default: STOP at the approval gate. On approval OR an in-prompt merge override
   # ("auto-merge" / "merge when done"), squash-merge into the parent branch:
   gh pr merge "${BRANCH}" --squash --delete-branch
   git -C "${REPO_ROOT}" switch "${PARENT_BRANCH}"   # restore the session's starting branch
   ```
   If `run_placement.parent_moved` is `true`, rebase onto the new parent tip before pushing — and
   re-resolve the SHA afterwards (`git -C "${REPO_ROOT}" rev-parse "${BRANCH}"`). The report's
   `commit_sha` is stale the moment you rebase; recording it in step 3 below would plant an orphan
   in the plan artifact that a fresh clone cannot resolve.
2. **Update tracking** (if `request_id` present):
   ```bash
   meatycapture log item update <DOC> <ITEM> --status done
   ```
3. **Update plan artifact** (if `autopilot.plan_artifact_path` present):
   ```bash
   python .claude/skills/artifact-tracking/scripts/update-field.py \
     -f "${PLAN_ARTIFACT_PATH}" \
     --set "status=completed" \
     --append "commit_refs=$(git rev-parse HEAD)"
   ```
4. **Report to user**: tier, effort points, wave count, files changed, validation results, commit SHA.
5. **Close with the Next Actions table** — spec: [.claude/skills/dev-execution/references/next-actions-table.md]. Emit rows for follow-ups/deferrals surfaced by the nested run, or the one-line empty state when it merged clean. This table is the standard final section of the response.

> **Every branch below closes the same way.** After its Opus actions, end the response with the Next Actions table: each `needs_opus` reason contributes at least one row for the recommended path (`/plan:plan-feature`, `/plan:explore` / `/plan:spike`, or a `human decision` row for the Mode-D boundary), carrying the draft `plan_artifact_path` as its Target when the workflow wrote one.

---

#### `status: blocked, reason: wrong_branch`

The session working tree was not on `run_branch` — either at dispatch (the guard fired before any
agent spawned, so **nothing was committed**) or after a fix cycle moved HEAD off it. Treat this as a
**trusted halt**: the guard did its job.

Opus actions:
- Read `run_placement.current_branch` for where the tree actually was.
- If the guard fired pre-dispatch: fix the branch and re-invoke. Nothing is lost.
  ```bash
  git -C "${REPO_ROOT}" switch "${BRANCH}" 2>/dev/null || git -C "${REPO_ROOT}" switch -c "${BRANCH}" "${PARENT_BRANCH}"
  git -C "${REPO_ROOT}" branch --show-current   # confirm before re-invoking
  ```
- If commits landed on the wrong branch, **recover them before anything else** — they are real work
  sitting outside any gate, and a re-run would duplicate them:
  ```bash
  git -C "${REPO_ROOT}" branch -a --contains <commit_sha>
  git -C "${REPO_ROOT}" switch "${BRANCH}" && git -C "${REPO_ROOT}" cherry-pick <commit_sha>
  ```
  Then check whether the wrong branch was **pushed** (`git -C "${REPO_ROOT}" log origin/${PARENT_BRANCH}..${PARENT_BRANCH}`). If a shared remote already has it, say so plainly to the user — that is a gate that was bypassed, not a detail, and unwinding a pushed branch is the user's call.
- Never re-invoke without fixing the branch: the guard will halt again, correctly.

---

#### `status: needs_opus, reason: nothing_on_run_branch`

The run finished with **zero commits** on the run branch. Every past-tense claim in the completion
report is unproven — this is the failure the report used to render as `complete`.

Opus actions:
- Do **not** read the report as evidence, and do not open a PR.
- Establish whether work exists anywhere before re-running:
  ```bash
  git -C "${REPO_ROOT}" status --porcelain                     # uncommitted work worth keeping?
  git -C "${REPO_ROOT}" log --oneline -5 "${PARENT_BRANCH}"    # did it land on the parent instead?
  git -C "${REPO_ROOT}" reflog --date=relative | head -20      # committed then lost?
  ```
- If uncommitted changes implement the feature, commit them on the run branch yourself and run the
  reviewer gate (`Workflow({name:'reviewer-gate', …})`) before the PR — the work never passed one.
- If nothing exists anywhere, report the run as producing nothing and offer a re-run or
  `/plan:plan-feature`. Do not describe the feature as delivered in any form.

---

#### `status: needs_opus, reason: scope_exceeds_single_pass`

The request is too large for the autopilot single-pass lane. The workflow wrote a draft plan artifact at `autopilot.plan_artifact_path` as a head start.

Opus actions:
- Surface the scope assessment to the user.
- Offer: "Run `/plan:plan-feature` to author a full Tier 2/3 PRD + Implementation Plan — the draft at `<plan_artifact_path>` gives a head start."
- **Do not auto-run full planning.** Await user confirmation.
- Clean up the run branch (it holds nothing — the workflow escalated before executing):
  ```bash
  git -C "${REPO_ROOT}" switch "${PARENT_BRANCH}"
  git -C "${REPO_ROOT}" branch -D "${BRANCH}"   # refuses if commits exist; then keep it and inspect
  ```

---

#### `status: needs_opus, reason: spike_required`

Unresolved research unknowns block reliable planning or implementation.

Opus actions:
- Surface the unknowns from `verdict.required_fixes` or report body.
- Recommend `/plan:explore` (open-ended discovery) or `/plan:spike` (targeted feasibility research) first.
- Surface `autopilot.plan_artifact_path` if the workflow wrote a partial plan.
- **Do not proceed with implementation.** Await user direction.
- Clean up the run branch as above.

---

#### `status: needs_opus, reason: mode_d` (or `status: blocked, reason: mode_d`)

A high-risk boundary (auth, payments, migrations, deletion, secrets) was detected inside the workflow after pre-flight passed.

Opus actions:
- Read the blocked phase/step from the report.
- Run the affected work **interactively under Mode D discipline**: explore the scope, propose the change, stop before edits, and await explicit human approval before any production file modification.
- Reference: `.claude/rules/delegation-modes.md` — Mode D definition and workflow-boundary invariant.
- After human approval, implement the Mode D work directly (Opus with `acceptEdits`) or delegate with explicit user sign-off documented.
- Once the Mode D work is done, relaunch the workflow with the Mode D boundary phase removed from `args.ceiling` scope (if applicable) to handle remaining non-Mode-D work.

---

#### `status: needs_opus, reason: reviewer_unresolved | budget_exhausted`

The nested execution engine's reviewer gate failed after its fix-loop iterations, or the token budget was exhausted before completion.

Opus actions:
- Read `verdict.required_fixes` from the report.
- Adjudicate: either fix directly (if simple, well-scoped) or re-scope to exclude the problematic AC and re-run.
- Do not auto-commit partial work — inspect `git -C "${REPO_ROOT}" diff "${PARENT_BRANCH}"..."${BRANCH}"` first.
- If substantial work landed on the run branch and is sound, open the PR with a partial-completion note in the body — do not merge past the gate on partial work without saying so.

---

#### `status: needs_opus, reason: plan_only`

`plan_only: true` was set; the workflow planned and gated without executing implementation.

Opus actions:
- Present the plan summary and `autopilot.plan_artifact_path` to the user.
- Await user go-ahead.
- On confirmation, relaunch with the same args but `plan_only: false` (and `dry_run: false`).

---

#### `status: needs_opus, reason: plan_structure_failed`

The plan-structuring stage inside the workflow failed; the partial plan artifact is still on disk at `autopilot.plan_artifact_path`.

Opus actions:
- Read the artifact (frontmatter + first 80 lines only to stay within budget).
- Decide: repair the plan directly (Opus-authored decisions block) and relaunch, or escalate to `/plan:plan-feature`.

---

## CLI Flags Summary

| Flag | Default | Effect |
|---|---|---|
| `--dry-run` | false | Print resolved plan graph and tier classification; no agents spawned |
| `--plan-only` | false | Plan + gate; stop before implementation dispatch |
| `--budget=<N>` | 90000 | Override `budget_total` token cap for the workflow run |
| `--category=<cat>` | auto-detected | Seed the category classifier; skips ambiguity resolution |
| `--max-points=<N>` | 13 | Override ceiling `max_points` |

---

## Token Discipline

- **Do not** read the full request artifact or plan artifact — use `head -80` for sanity checks.
- **Do not** explore the codebase before workflow invocation — the workflow's plan-structurer does this.
- **Do not** call `TaskOutput()` on the workflow — verify outputs on disk after the workflow returns.
- **Do not** load `Skill("workflow-authoring")` unless modifying the workflow script itself.
- Run-branch setup (Action 3) is the only Opus direct action before invocation.

Reference: `.claude/rules/context-budget.md`.

---

## Quality Gates (on `status: complete`)

- [ ] PR opened to the parent branch; squash-merge gated on approval/override, then merged cleanly (no conflicts)
- [ ] Tests pass for changed scope (`pytest` / `pnpm test`)
- [ ] Type check passes (`pnpm type-check` / `mypy`) for changed scope
- [ ] Lint passes for changed scope
- [ ] Request-log item updated if `request_id` present
- [ ] Plan artifact frontmatter updated: `status: completed`, `commit_refs`
- [ ] `run_placement.commit_count > 0` and every commit reachable from the run branch (`git merge-base --is-ancestor <sha> "${BRANCH}"`)
- [ ] Session restored to `${PARENT_BRANCH}`; run branch deleted after merge (no orphan branches)

---

## Skill References

- Auto-feature workflow spec: [.claude/specs/workflows/auto-feature-workflow-spec.md]
- Workflow authoring contract (load only to modify script): [.claude/specs/workflows/workflow-authoring-spec.md]
- Tier matrix and autopilot recalibration: [.claude/plans/tiered-workflow-overhaul.md] §2.1
- Delegation modes (Mode C sprint, Mode D boundary, Mode E reviewer): [.claude/rules/delegation-modes.md]
- Context budget discipline: [.claude/rules/context-budget.md]
- ExecutionReport schema: [.claude/specs/workflows/schemas/execution-report.schema.json]
- Feature Contract doc type: [.claude/skills/artifact-tracking/schemas/field-reference.md]
- Request log CLI: `meatycapture log item view <ID>` / `meatycapture log item update`
