# Git Worktree + PR Protocol — the canonical execution git workflow

> **The standard git workflow for all orchestrated execution.** Plan, contract, phase, autopilot,
> quick-feature (multi-step), and story modes all follow this: **work in a git worktree → commit per
> phase → open a PR to the parent branch → squash-merge on approval (or an in-prompt override).**
> This supersedes the older "checkout a feature branch in place" pattern and the opt-in-only worktree
> notion in `plan-execution.md` (that mode's Worktree Merge Protocol is now the per-wave detail under
> this standard).

This is the single source of truth; modes and `/dev:*` commands link here rather than restating it.
The orchestrator (Opus) owns every git operation below — **router-offloaded executors and nested
helpers never touch git** (single-committer rule, [`dev-execution` SKILL §Nesting]).

---

## 1. When it applies

| Mode / command | Worktree-first? | PR to parent? |
|---|---|---|
| `/dev:execute-plan` (Tier 2/3) | **Yes** | **Yes** |
| `/dev:execute-contract` (Tier 1 sprint) | **Yes** | **Yes** |
| `/dev:execute-phase` | **Yes** | **Yes** |
| `/dev:autopilot` | **Yes** (already mandated) | **Yes** |
| `/dev:implement-story` / `/dev:complete-user-story` | **Yes** | **Yes** |
| `/dev:quick-feature` | Yes when multi-step / >1 file; a true one-file one-commit change may commit in place on a short-lived branch | PR when worktree used |

Exception: a trivial single-file fix the user explicitly scoped as "just commit it" may skip the
worktree. When unsure, use the worktree — it is cheap and isolating.

---

## 2. Set up the worktree (start of run)

```bash
# Record the PARENT branch (where HEAD is now) — this is the PR base and squash-merge target.
PARENT_BRANCH="$(git branch --show-current)"   # e.g. main, or a feature branch (stacked work)
BASE_SHA="$(git rev-parse HEAD)"

# Derive a kebab-case slug from the plan/contract/request (≤ 40 chars).
SLUG="<mode>/<request-slug>"                    # e.g. exec/artifact-bulk-edit
BRANCH="$SLUG"
WORKTREE_PATH=".claude/worktrees/${BRANCH//\//-}"

git worktree add "$WORKTREE_PATH" -b "$BRANCH"  # branched off PARENT_BRANCH's HEAD
cd "$WORKTREE_PATH"
```

- **Path convention:** `.claude/worktrees/<branch-with-slashes-as-dashes>` (in-repo, harness-managed,
  auto-cleaned). Do **not** scatter sibling `../<repo>-<branch>` worktrees — that older autopilot
  convention is superseded by the in-repo path.
- Inside Claude Code, the harness `EnterWorktree` tool is the preferred way to create + enter the
  worktree (it tracks and cleans up). Use the shell form above when scripting (workflow engine,
  phase-owner subagents, Codex/Hermes) where the harness tool isn't available.
- Record `PARENT_BRANCH` and `BASE_SHA` in the plan/contract frontmatter (`merge_branch` ← parent;
  `base_sha`) so the PR target and the pre-run checkpoint survive across sessions.
- **Editable-install gotcha:** `python scripts/x.py` from a worktree imports the *installed* package
  (main repo), not the worktree copy → silent `ImportError` on worktree-only symbols. Prefix
  `PYTHONPATH=$(pwd)` or run `python -m`. (`python -m pytest` already shadows correctly via cwd.)

---

## 3. Commit cadence (during the run)

- **Commit per phase** (Tier 2/3 plan / phase execution) or **per logical unit** (a sprint's
  explore→implement→test slice; a story's per-file completion). The phase-owner commits everything
  intended to survive **before** emitting its completion signal (P3 safety contract — never rely on
  uncommitted state across sessions).
- **Single committer:** the orchestrator/phase-owner is the only one that runs `git add/commit`.
  Offloaded executors and nested helpers never commit, stash, or push.
- Conventional-commit messages, scoped, with a plan/contract/phase ref:
  ```
  feat(<scope>): <what landed this phase>

  Refs: <plan|contract|REQ id>, Phase N
  ```
- For per-phase worktree isolation *within* a multi-wave plan, the per-wave squash-merge-back into
  the run's worktree branch is the `plan-execution.md` Worktree Merge Protocol — that operates one
  level below this doc (wave → run branch); this doc governs run branch → parent.

---

## 4. Validate before integrating

Before opening the PR / merging, the run branch must pass the tier-appropriate gates:

```bash
# Inspect the full diff against the parent
git diff "$PARENT_BRANCH"...HEAD

# Run the applicable suite (delegate to task-completion-validator for Tier 1/2 phase gates)
pnpm test && pnpm typecheck && pnpm lint        # frontend scope
pytest -q                                        # python scope (PYTHONPATH=$(pwd) from worktree)
```

A phase/feature is **not complete** until the mandatory reviewer gate passes (see
`./validation/completion-criteria.md`). Offloaded (ICA 4.6 / Codex) work always passes through this
gate before it's trusted — offload is a cost lever, not a quality waiver
([MODEL-ROUTING §4](../../../docs/agentic-operator/MODEL-ROUTING.md#4-the-offload-policy--offload-when-feasible-never-when-it-needs-the-subscription)).

---

## 5. Open the PR to the parent branch

```bash
git push -u origin "$BRANCH"

gh pr create \
  --base "$PARENT_BRANCH" \          # the parent branch, NOT hard-coded main
  --head "$BRANCH" \
  --title "feat(<scope>): <summary>" \
  --body-file .claude/pr-body.md      # AC checklist + completion report + commit refs
```

- **PR base is the parent branch** captured in §2 — usually `main`, but for stacked work it's the
  feature branch you started from. Do not assume `main`.
- The PR body carries the completion report, the acceptance-criteria checklist, and the work-history
  commit SHAs (`commit_refs`).

---

## 6. Squash-merge — approval-gated, with in-prompt override

**Default: open the PR and STOP at the approval gate.** Squash-merge happens only when **either** of
these is true:

1. **Explicit approval** — the user (or a configured CI/approver) approves the PR, or replies to the
   run with go-ahead to merge.
2. **In-prompt override** — the originating request *pre-authorized* the merge. Treat as an override
   any clear merge directive in the user's prompt, e.g.: "auto-merge", "merge when done", "merge on
   green", "squash and merge", "land it", "no need to ask — merge". Absent such language, **do not
   self-merge** a run branch into the parent.

On approval/override (and only then):

```bash
gh pr merge "$BRANCH" --squash --delete-branch     # squash-merge into PARENT_BRANCH
# or, when merging locally without the PR API:
git switch "$PARENT_BRANCH"
git merge --squash "$BRANCH"
git commit -m "feat(<scope>): <summary> (#<pr>)"
git push origin "$PARENT_BRANCH"
```

Then record the landing pointer (`merge_commit` ← post-squash SHA, `merge_branch` ← parent) in the
plan/contract frontmatter, so the orphaned per-phase SHAs in `commit_refs` remain resolvable.

> This refines the universal git-workflow preference (commit + squash-merge on completion) for
> *orchestrated multi-phase execution*: the unit that merges is the **run branch**, the target is the
> **parent branch**, and the squash-merge is **approval-gated unless the prompt overrode it**. Pushing
> the run branch + opening the PR is always in-bounds; merging is the gated step.

---

## 7. Clean up

```bash
# After a successful merge:
cd "$PARENT_BRANCH worktree (repo root)"
git worktree remove "$WORKTREE_PATH"
git branch -D "$BRANCH"        # if not already deleted by --delete-branch

# If the run is abandoned / scope exceeded:
git worktree remove --force "$WORKTREE_PATH"
git branch -D "$BRANCH"
```

The harness `EnterWorktree`/`ExitWorktree` pair auto-removes an unchanged worktree; for script-created
worktrees, remove explicitly as above. Never leave orphaned worktrees under `.claude/worktrees/`.

---

## 8. Multi-platform note

This protocol is git-native, so it holds for Codex and Hermes executors too:

- **Claude Code:** prefer the `EnterWorktree` harness tool; fall back to the shell form for
  phase-owner subagents / the workflow engine.
- **Codex (`codex_headless`):** runs read-only by default; write-mode runs operate inside the worktree
  and the **orchestrator** (not the Codex adapter) owns the commit/PR/merge steps.
- **Hermes (node):** self-improvement already enforces worktree isolation (control G1) + PR gating
  (control G4). This protocol is the same shape; Hermes' approval gate is its HITL IntentTree gate.
