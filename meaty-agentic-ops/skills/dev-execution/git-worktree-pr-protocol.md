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
| `/dev:execute-plan` (Tier 2/3) | **Yes** — hand-orchestrated via §2. Via the workflow script: **default-on** entered + probed worktree, falling back to a run branch in the session repo (§1a → the lane reference) | **Yes** |
| `/dev:execute-contract` (Tier 1 sprint) | **Yes** — hand-orchestrated via §2. Via the workflow script: **default-on** entered + probed worktree, same fallback (§1a) | **Yes** |
| `/dev:execute-phase` | **Yes** | **Yes** |
| `/dev:autopilot` | **Yes by default** — entered + probed worktree; falls back to a run branch in the session repo (§1a) | **Yes** |
| `/dev:implement-story` / `/dev:complete-user-story` | **Yes** | **Yes** |
| `/dev:quick-feature` | Yes when multi-step / >1 file; a true one-file one-commit change may commit in place on a short-lived branch | PR when worktree used |

Exception: a trivial single-file fix the user explicitly scoped as "just commit it" may skip the
worktree. When unsure, use the worktree — it is cheap and isolating.

### 1a. The scripted-workflow lane — a worktree is allowed, but only an *entered and verified* one

**When the work is executed by a Dynamic Workflow script (`auto-feature`, `execute-contract`,
`execute-plan` invoked via `Workflow(...)`), the run happens in a worktree **by default** — but only
one the session has actually `EnterWorktree`d into, and only after a placement probe confirms the
agents followed. On a failed or unverifiable probe, check the run branch out in the session repo, pass
its name to the workflow, and *say the isolation degraded*.**

All three engines follow the same procedure, from the same file:
[`references/worktree-isolation-lane.md`](references/worktree-isolation-lane.md). This section is the
doctrine behind it — read it once; follow that file every run.

Workflow agents run in the **session's cwd**. The operative question is therefore not "worktree or
not" but **"did the session's cwd move, and did the agents follow it"**.

**There is no stable answer to inherit — only a probe.** Two measurements to date:

| Spawn path | CC **2.1.224** (2026-08-07) | CC **2.1.226** (2026-08-08) |
|---|---|---|
| Session `Bash` | yes | yes |
| `Agent` subagent | yes | not re-measured |
| **Background `Workflow` agent** | **yes** | **yes** — 4 independent two-sided probes, all agreeing, all with a verified tool call |
| Main checkout meanwhile | untouched | untouched |

⚠️ **A contested 2.1.226 report is why the probe below was rebuilt.** `node_01KZGQE6GVJTGXRSHA57FYKNDQ`
reported the dangerous shape — `Workflow` agents giving the worktree as their `pwd` while filesystem
and git operations resolved against the **main checkout on `main`**, which a probe that trusts the
agent's self-reported git identity passes. It did **not** reproduce: four two-sided marker probes on
2.1.226 returned a clean `inherits`. Its own weaker probes had also contradicted each other, and one
reported a `HEAD_SHA` matching no ref in the repo — the same fabrication signature as the `tool_uses=0`
case recorded in the lane reference's probe section (§4). So the finding was answered by **rebuilding the probe**, not by
retiring the lane: whichever way that report was wrong, a probe that cannot tell a regression from a
fabrication is the actual defect.

⚠️ **No row above is doctrine, and this section has been wrong in both directions.** It once said
background workflow agents *ignore* `EnterWorktree` and prohibited the lane outright — an
over-generalization from the 2026-08-05 incident below, where the worktree was created with
`git worktree add` and the session's cwd **never moved**, so the agents were never in it (the
mechanism that failed was creating-without-entering, not the worktree). Treat every row as a dated
observation of one harness build on one machine; the probe is the only thing a run may rely on.

**The incident is still the reason for every guard here.** On 2026-08-05 (`wf_944c5c91-78e`)
autopilot created `.claude/worktrees/autopilot-op-story-backlog-drain` on
`autopilot/op-story-backlog-drain`; that branch received **zero** commits, both real commits landed
on **`main`**, and one was **pushed** — the PR, review, and squash gates were all skipped while the
report read `status: complete` and the validator's own evidence string quoted the wrong branch as
neutral context. A worktree the executors are not in is worse than no isolation, because it reads
as isolation in the report. So the lane is **verified, never assumed**: the harness behaviour above
is a measurement of one version, and a doctrine that froze at one harness version is exactly what
produced this section's previous error.

#### The five hazards that make a naive worktree wrong

1. **`git worktree add` is not entering.** Creating a worktree from Bash leaves the session cwd
   where it was, which is the 2026-08-05 failure verbatim. Use the `EnterWorktree` tool (or start
   the session inside the worktree). Creating and entering are different acts.
2. **`worktree.baseRef` defaults to `fresh`** (`~/.claude/settings.json`; verified set to `fresh`
   here) — a new worktree branches from **`origin/<default-branch>`, not local `HEAD`**. Run from a
   feature branch, or from a `main` with unpushed commits, and the worktree silently starts from the
   wrong base; the PR is then built on a parent that is not the parent you recorded. Always
   re-point the run branch at the recorded parent tip after entering
   (`git switch -C "$BRANCH" "$PARENT_TIP"`) rather than trusting the base you were given.
3. **`basename "$(git rev-parse --show-toplevel)"` is the *worktree dir* name inside a worktree**,
   not the repo name — so it trips the engines' `cross_repo_target` guard as a false positive.
   Derive repo identity from the shared git dir instead:
   `basename "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`.
4. **Entering a worktree does not sandbox absolute paths.** The session cwd moves; an absolute path
   (or `git -C <main-checkout>`) still reads and writes the main checkout, silently. Verified while
   authoring this section: `Edit` calls issued from inside a worktree against absolute
   main-checkout paths landed on `main`, with the worktree left clean. Re-point `REPO_ROOT` to the
   worktree and pass `-C "$REPO_ROOT"` everywhere — **the isolation you report is only as real as
   the paths you used.**
5. **An agent's reported cwd is a claim, not a measurement.** `pwd`, `--show-toplevel` and
   `--show-current` are all *self-reports*, and both observed failure modes defeat them: an agent has
   returned plausible values having made **zero tool calls**, and a 2.1.226 report (unreproduced —
   table above) described a `pwd` that pointed at the worktree while the reads went to `main`. Either
   way, none of those fields is evidence; only a planted two-sided discriminator (probe below)
   settles it. Note hazards 1 and 5 are different failures with the same symptom, so a fix for one
   is not a fix for the other.

#### Why the worktree lane is worth having — and why it is nevertheless probe-gated

Branching in place (below) mutates the **shared checkout every other session is standing in** —
`git switch -c` moves HEAD under any concurrent agent, which is the hazard
[`shared-checkout-safety.md`](../../rules/shared-checkout-safety.md) exists for. On a harness that
inherits, the worktree lane leaves the main checkout on its own branch and is the only lane that
supports concurrent autopilot runs in one repo. Prefer it when other sessions are live.

**The two lanes fail differently, and that asymmetry is why the probe is not optional.** In-place is
*noisy*: HEAD moves where other sessions can see it, and the damage is visible and recoverable. A
worktree the agents are not in is *silent*: the report says `isolation: worktree`, the commits land on
the parent branch, and nothing in the run says otherwise. A lane whose failure mode is silence may be
the default only while something keeps checking — so the lane is default-on **and** gated, and a probe
failure is a fallback, never an inconvenience to route around.

#### The procedure — one place, three consumers

**The five-step procedure lives in
[`references/worktree-isolation-lane.md`](references/worktree-isolation-lane.md)**: resolve identity
from the shared git dir *before* entering → `EnterWorktree` (never `git worktree add`) → force the run
branch onto the recorded `PARENT_TIP` and assert three invariants → the two-sided-marker placement
probe with its version+shape-keyed cache and fail-closed fallback → the placement fields the engines'
guards read. It also owns both dirty-tree tables, the post-flight baseline read-back, the in-place
fallback in the one order that works, the report-the-lane rule, and cleanup.

`/dev:autopilot`, `/dev:execute-contract`, and `/dev:execute-plan` all point at that file rather than
carrying their own copy. **This section deliberately does not restate the steps.** The procedure lived
in `autopilot.md` alone while this section permitted the lane for all three engines, so two commands
were documented as having a lane whose steps did not exist
(`node_01KZERZRYYKE43Q5D76RCC4T0Q`) — and the duplication cost was then paid in the open: rebuilding
the probe on 2026-08-08 had to land in *both* copies, and took two PRs to get there. A third copy here
would reopen exactly that.

Hand-orchestrated runs (`/dev:execute-phase`, the story modes, the plan-execution wave loop) are not
subject to the "agents inherit the session cwd" constraint that makes the procedure necessary; they
use §2 below.

Either lane, **§3–§7 below apply unchanged** (commit cadence, validation, PR to parent,
approval-gated squash-merge, cleanup) — substitute `git -C "$REPO_ROOT"` for `cd "$WORKTREE_PATH"`,
where `REPO_ROOT` is whichever tree the lane actually landed in.

**Parallelism is what the in-place lane trades away**, and it is recoverable two ways: the probed
worktree lane (same session), or a **separate session whose cwd is already a worktree directory**
(always safe, no probe needed — the session never had to move). What is never safe is reaching a
worktree from a session standing outside it; that is the 2026-08-05 failure.

---

## 1b. Main-line work — the class that cannot be worktree-isolated

§1 enumerates **execution** modes, and §1a covers the scripted-workflow exception to worktree
isolation. That left a third case unnamed: the classes below operate on `main` *by definition*, so a
worktree cannot isolate them either — and because they appeared nowhere, an agent doing them had no
protocol at all and defaulted to working directly in the shared checkout alongside whoever else was
there. Unlike §1a (which branches in place), these cannot use a run branch at all.

**The main-line class:**

| Work | Why a worktree can't isolate it |
|---|---|
| branch sync / prune (`fetch`, `pull --ff-only`, deleting merged branches) | the point is to update `main` and the branch set |
| **squash-merging a PR into the parent** (§6) | the merge target is the shared branch |
| `git worktree prune` / removing other runs' worktrees | operates on the repo's worktree registry |
| release / tag / changelog-on-`main` | mutates `main` and its refs |
| deploy-from-origin (`/redeploy`, `svc_repo_sync`) | reads and resets the primary checkout |

**These serialize instead of isolating.** Take the repository lease for the whole operation:

```bash
aos-git lease -t 120 -- git merge --squash "$BRANCH"
aos-git lease -t 120 -- bash scripts/sync-and-prune.sh
```

And before drawing any conclusion from repository content while other agents may be present:

```bash
aos-git pin                  # once, at the start — records BASE_SHA for this session
aos-git read <path>          # content claims go through the pinned ref, never the worktree file
aos-git refresh              # before any diff-derived conclusion (a stale index UNDER-reports)
aos-git drift                # before commit/push/merge, and before stating a finding
```

`git` protects the data — a non-fast-forward push is rejected — but it does not protect conclusions.
A stale index once reported an 8-insertion diff for a 49-insertion change here, and HEAD moving
mid-session produced PR #114, which claimed a defect was "still live" and had to be retracted.

Rule + rationale: [`.claude/rules/shared-checkout-safety.md`](../../rules/shared-checkout-safety.md).
Helper, hook, and install: [`infra/git-guard/README.md`](../../../infra/git-guard/README.md). The
`PreToolUse` guard denies a mutating git op once when HEAD has drifted since your pin, so the
`drift` check above is enforced rather than remembered.

---

## 2. Set up the worktree (start of run)

```bash
# Record the PARENT branch (where HEAD is now) — this is the PR base and squash-merge target.
PARENT_BRANCH="$(git branch --show-current)"   # e.g. main, or a feature branch (stacked work)
BASE_SHA="$(git rev-parse HEAD)"

# ASSERT THE BASE IS THE ONE YOU MEAN. In a shared checkout HEAD is not yours: a co-tenant can
# have left it on their branch, and the two lines above will faithfully record the WRONG parent.
INTENDED_PARENT="main"                          # or the stacked parent you actually meant
[ "$PARENT_BRANCH" = "$INTENDED_PARENT" ] || {
  echo "base is '$PARENT_BRANCH', expected '$INTENDED_PARENT' — another agent moved this checkout" >&2
  exit 2
}

# Derive a kebab-case slug from the plan/contract/request (≤ 40 chars).
SLUG="<mode>/<request-slug>"                    # e.g. exec/artifact-bulk-edit
BRANCH="$SLUG"
WORKTREE_PATH=".claude/worktrees/${BRANCH//\//-}"

# Base the worktree on the RECORDED SHA, not on HEAD again: HEAD can move between the rev-parse
# above and this line when other sessions share the checkout.
git worktree add "$WORKTREE_PATH" -b "$BRANCH" "$BASE_SHA"
cd "$WORKTREE_PATH"

# The branch must contain nothing its base did not. Non-empty output here means the base was not
# what you recorded, and the divergence will otherwise surface as a merge conflict much later.
if git log --oneline "$BASE_SHA..HEAD" | grep -q .; then
  echo "new branch already carries commits absent from its base — wrong base" >&2
  exit 2
fi
```

- **Path convention:** `.claude/worktrees/<branch-with-slashes-as-dashes>` (in-repo, harness-managed,
  auto-cleaned). Do **not** scatter sibling `../<repo>-<branch>` worktrees — that older autopilot
  convention is superseded by the in-repo path.
- Inside Claude Code, the harness `EnterWorktree` tool is the preferred way to create + enter the
  worktree (it tracks and cleans up), and it honours `worktree.baseRef` (hazard 2) so it does not
  inherit local HEAD at all. Use the shell form above when scripting (workflow engine, phase-owner
  subagents, Codex/Hermes) where the harness tool isn't available.
- ⚠️ **`git worktree add` inherits HEAD, and HEAD is not yours in a shared checkout.** This is why
  the snippet asserts `INTENDED_PARENT` and bases the worktree on `$BASE_SHA` rather than on HEAD a
  second time. The guard in `.claude/rules/shared-checkout-safety.md` catches HEAD *moving* under a
  session; it cannot catch HEAD *already being somewhere unexpected* when you branch, because there
  is no movement to detect. Observed 2026-08-10 (`node_01KZP8TFGA2VK85ETBQ7328MSJ`): a worktree
  intended to branch from `main` was created off a co-tenant's `upstream-tmp-fixes-followup`,
  silently carried two foreign commits into a PR, and surfaced only as `gh pr merge` reporting a
  conflict — which a second agent then mis-attributed to the PR's own diff. `git worktree add`
  printed a plausible launchpad commit message as it did so, which is what made the wrong base look
  right. `aos-git who` had reported 6 other live sessions in that checkout.
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
- **Single committer (nested children):** nested helpers (depth-1 subagents spawned by a phase-owner) never `git add/commit/stash/push`. Batch task agents within a parallel phase MAY commit their own assigned files by explicit pathspec (no wildcard adds) and may never rewrite history. The orchestrator/phase-owner orchestrates all commits.
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
  --body-file .claude/pr-body.md      # AC checklist + reviewer verdict + commit refs
```

- **PR base is the parent branch** captured in §2 — usually `main`, but for stacked work it's the
  feature branch you started from. Do not assume `main`.
- The PR body carries the passing reviewer verdict, the acceptance-criteria checklist, and the
  work-history commit SHAs (`commit_refs`). (The plan-level Completion Report is retired —
  `references/execution-doctrine.md`, Bookkeeping demotions — so the reviewer verdict + `commit_refs`
  is the record here, not a separate report file. The Tier 1 sprint's contract-appended Completion
  Report is a different, still-live artifact; see `SKILL.md` § Tier 1 Autonomous Sprint.)

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

On approval/override (and only then) — this is **main-line work** (§1b), so hold the repo lease and
re-check drift first; another agent may have moved the parent branch since your run started:

```bash
aos-git drift || aos-git pin --repin               # re-derive if the parent moved

# Merge and delete as TWO steps — never `--delete-branch`. See the note below.
aos-git lease -t 120 -- gh pr merge "$BRANCH" --squash

# Confirm the merge from repository STATE, not from the exit code or the visible output:
gh pr view "$PR" --json state,mergeCommit -q '.state + " " + (.mergeCommit.oid // "none")'
# expect: MERGED <sha>.   Anything else = not merged; stop and investigate.

# Only once MERGED is confirmed, delete the remote branch explicitly:
git push origin --delete "$BRANCH"

# or, when merging locally without the PR API:
aos-git lease -t 120 -- bash -c '
  git switch "$PARENT_BRANCH" &&
  git merge --squash "$BRANCH" &&
  git commit -m "feat(<scope>): <summary> (#<pr>)" &&
  git push origin "$PARENT_BRANCH"'
```

> ⚠️ **Why not `--delete-branch`, and why the merge is confirmed from state.** In this layout the
> parent branch is checked out in the primary checkout, so `gh`'s post-merge step — switch to the
> parent locally, then delete — cannot switch, and prints:
>
> ```
> failed to run git: fatal: 'main' is already used by worktree at '<primary checkout>'
> ```
>
> This fails **after** the merge has already landed, and produces two distinct hazards:
>
> 1. **It reads like a merge failure.** The `fatal:` is the most prominent output, so an agent that
>    trusts it will report a false failure or retry an already-merged PR. Under this two-step form
>    the message is *expected and benign* — but the merge is still confirmed via `gh pr view`, so
>    the conclusion never rests on interpreting output at all.
> 2. **The remote branch silently survives.** Because `gh` aborted before its delete step,
>    `--delete-branch` never ran against the remote. Origin then accumulates merged branches that
>    later have to be told apart from genuinely-unmerged ones — and squash-merge makes ancestry
>    useless for that judgement, so it is manual work every time.
>
> Recorded three times in this repo (PR #116 2026-08-05, PR #201 and PR #208 2026-08-09); each
> leftover was deleted by hand after the fact. `node_01KZ97XA10D09CKTS1E178KEWQ`.

Then record the landing pointer (`merge_commit` ← post-squash SHA, `merge_branch` ← parent) in the
plan/contract frontmatter, so the orphaned per-phase SHAs in `commit_refs` remain resolvable.

**Then fire the post-merge evidence hook** — it turns those frontmatter fields into typed
`ExternalLink(github)` + `CompletionEvidence(delivery_class=shipped)` rows on the bound IntentTree
node, so "what shipped in project X" stays answerable by one query instead of by re-reading prose:

```bash
POST_MERGE_PLAN_FILE="${PLAN_PATH}" \
POST_MERGE_MERGE_COMMIT="$(git rev-parse HEAD)" \
POST_MERGE_APPLY=1 \
    .claude/skills/dev-execution/hooks/post-merge-evidence.sh
```

Default-on, binding-gated (a true no-op with no `ITT_NODE_ID`/`INTENTTREE_TREE` and no
`itt_node_id:`/`intenttree_tree:`/`feature_slug:` frontmatter), and **always exits 0** — it is a
best-effort recorder, never a gate, so it can never block a merge. Disable with
`AOS_POST_MERGE_EVIDENCE=0`. Contract: the hook's own header comment; rule:
[`.claude/rules/intenttree-integration.md`](../../rules/intenttree-integration.md).

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
git branch -D "$BRANCH"        # local ref — §6 deleted the REMOTE one explicitly

# Confirm no leftover on origin (belt-and-braces; §6's explicit delete should have handled it):
git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null \
  && echo "LEFTOVER: origin/$BRANCH still exists — delete it or report it explicitly" \
  || echo "clean: no origin/$BRANCH"

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
