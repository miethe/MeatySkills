# Reference — The Worktree Isolation Lane (the one procedure, for every scripted-workflow run)

**This file owns the *procedure*.** [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md)
§1a owns the *doctrine* — when the lane applies, why it is worth having, the five hazards that make a
naive worktree wrong, the dated inheritance observations, and the 2026-08-05 incident that is the
reason for every guard below. Read §1a once; follow this file every run.

**Who consumes it.** Every command that hands work to a Dynamic Workflow script, because those
scripts have no cwd of their own — their agents run in **the session's cwd**:

| Command | Engine | Branch prefix (`${MODE}`) |
|---|---|---|
| [`/dev:autopilot`](../../../commands/dev/autopilot.md) | `auto-feature` | `autopilot` |
| [`/dev:execute-contract`](../../../commands/dev/execute-contract.md) | `execute-contract` | `contract` |
| [`/dev:execute-plan`](../../../commands/dev/execute-plan.md) | `execute-plan` | `exec` |

Hand-orchestrated runs (`/dev:execute-phase`, the story modes, the plan-execution wave loop) use the
protocol's own §2 setup instead — they own their git operations directly and are not subject to the
"agents inherit the session cwd" constraint that makes this procedure necessary.

> **Do not restate any step of this procedure in a consuming command.** Triplicating it is three
> chances to drift, and the drift this file exists to end was exactly that: the lane was permitted by
> protocol §1a for all three engines and implemented in `autopilot.md` only
> (`node_01KZERZRYYKE43Q5D76RCC4T0Q`). The cost was measured immediately — when the probe was rebuilt
> on 2026-08-08 the change had to land in **two** places — what were then `autopilot.md` §3d and
> protocol §1a, both since collapsed into this file — and it took two PRs to get both. One copy, three
> readers.

---

## The two lanes

The nested engines commit to whatever branch **the session's cwd** is on. So there are exactly two
valid arrangements, and both end with the session standing on `${BRANCH}`:

- **worktree lane (default)** — the session *enters* a worktree; agents inherit it (probed, per §4).
  The main checkout is never touched, and concurrent runs in one repo are possible.
- **in-repo lane** — the run branch is checked out in the session repo itself, moving HEAD for every
  other session standing in that checkout. This is the fallback (probe failure) and the explicit
  opt-out (`--no-worktree`), never the default.

There is no third arrangement. In particular, `git worktree add` **without** entering is not a lane:
the session cwd never moves, the agents commit where they already were, and the report reads as
isolated. That is the 2026-08-05 incident verbatim (protocol §1a).

---

## 1. Resolve identity BEFORE entering (order matters)

Inside a worktree, `PARENT_BRANCH` is no longer readable from HEAD and `basename` of the toplevel is
the *worktree directory* name, not the repo. Capture all of this first, in the session repo:

```bash
# Repo identity from the SHARED git dir — correct in the main checkout AND inside any worktree.
# `basename "$(git rev-parse --show-toplevel)"` is WRONG here: inside a worktree it yields the
# worktree dir name, which trips the engines' cross_repo_target guard as a false positive.
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
SESSION_REPO="$(basename "${MAIN_ROOT}")"

# The PARENT branch (HEAD now) — the PR base and squash-merge target.
PARENT_BRANCH="$(git branch --show-current)"
PARENT_TIP="$(git rev-parse HEAD)"     # the base the run MUST have, and mid-run-move detection

# Baseline the main checkout's dirty set, so §5b can tell a stray write from pre-existing clutter.
# Entering a worktree does NOT sandbox an agent that writes to an absolute main-checkout path (§3);
# this snapshot is what makes that detectable rather than discovered much later.
#
# The sentinel line is load-bearing: a genuinely CLEAN main checkout produces empty output, which is
# indistinguishable from a baseline that was never written or got clobbered. §5b keys on the
# sentinel, so "clean tree" and "lost baseline" stay two different answers.
#
# ⚠️ The path is RUN-SCOPED, and a fixed `/tmp/${MODE}-main-before.txt` is not good enough. That name
# is shared by every run of this mode on the machine — including runs in OTHER repositories.
# Measured 2026-08-08: a baseline written by a different repo's run was read back here and produced a
# false STRAY (its sentinel named a SHA that does not exist in this repo). The noisy direction trains
# an operator to wave the check through; the quiet direction is worse — another run's baseline whose
# dirty set happens to match ours post-run reports CLEAN and hides a real stray write.
BASELINE="/tmp/${MODE}-main-before.$(basename "${MAIN_ROOT}").${PARENT_TIP:0:12}.txt"
{ echo "# ${MODE}-baseline ${PARENT_TIP}"; git status --porcelain; } > "${BASELINE}"

# Derive a slug from the request/contract/plan (kebab-case, max 40 chars).
SLUG="<slug>"
BRANCH="${MODE}/${SLUG}"
```

If `PARENT_BRANCH` is empty (detached HEAD) **stop** — there is no PR base to target.

`SESSION_REPO` resolved this way is the value every engine's `session_repo` field must carry. All
three scripts compare it against `target_repo` and halt `blocked / cross_repo_target` on a mismatch;
pass the `--show-toplevel` basename from inside a worktree and that guard false-positives against
your own repo. The engines' `resolution_hint` strings now name this same shared-git-dir derivation,
so the guidance and the scripts agree.

### Dirty-tree handling depends on the lane

| Lane | Meaning of a dirty tree |
|---|---|
| **worktree** | Uncommitted changes **stay behind** in the main checkout — a fresh worktree does not carry them. Report the paths and continue. ⚠️ But if the dirty paths are files the run needs, the run will not see them: say so, and offer to commit them on the parent branch first (the worktree branches from `PARENT_TIP`, so only *committed* work is visible). |
| **in-repo** | **Not** warn-and-continue. `git switch -c` carries uncommitted changes onto the run branch, where the engine commits them as part of the feature. Resolve them (commit or stash on the parent branch) first, or ask the user. Carrying another session's work into a feature PR is not recoverable by re-reading the report. |

Name the dirty paths either way — in a shared checkout they may be another session's in-flight work,
and `aos-git who` will say whether anyone else is here.

---

## 2. Enter the worktree (skip entirely in the in-repo lane)

Use the **`EnterWorktree` tool**, never `git worktree add`. Creating without entering fails silently.

| Case | Call |
|---|---|
| new worktree (default) | `EnterWorktree` with `name: "${MODE}-${SLUG}"` |
| reuse an existing one (`--worktree=<path>`) | `EnterWorktree` with `path: "<path>"` |

To reuse a path, verify the target first — the tool requires a worktree of this repo under
`.claude/worktrees/`, and a path that is merely *a directory* will fail:

```bash
git worktree list --porcelain | grep -F "worktree <path>" || echo "NOT A REGISTERED WORKTREE of this repo"
git -C "<path>" status --porcelain    # reusing a dirty worktree carries its changes into the feature
```

A reused worktree that is dirty or sitting on unrelated commits is a decision, not a warning: those
changes will be attributed to this run. Report them and resolve before continuing.

### 2a. The one sanctioned `git worktree add --detach` — a read-only baseline measurement

The "`EnterWorktree`, never `git worktree add`" rule above governs **run** worktrees — the isolated
tree an agent edits and commits in. There is exactly one exception, and it is not a run worktree at
all: a **detached, SHA-pinned, read-only** tree used to measure a base commit's test results
(reviewer-gate's baseline delta, `.claude/skills/dev-execution/hooks/validation_scope.py measure`,
plan §3.2 of `reviewer-gate-validation-scope-hardening-v1.md`).

`EnterWorktree` is the **wrong** tool here for the precise reason §3 warns about: `worktree.baseRef`
defaults to `fresh`, so it would branch from `origin/<default-branch>` and measure a tree that is
neither the base nor the head — silently inverting the delta. The baseline must be pinned to an exact
SHA:

```bash
BASE_SHA="$(git rev-parse "${BASE}")"                     # resolve ONCE; use the SHA everywhere
WT=".claude/worktrees/gate-baseline-${BASE_SHA:0:12}"
git worktree add --detach "${WT}" "${BASE_SHA}"           # NOT EnterWorktree — see above
test "$(git -C "${WT}" rev-parse HEAD)" = "${BASE_SHA}" || exit 1   # fail closed on any drift
```

This is sanctioned **only** because the tree is detached (touches no branch), read-only (never
committed into), throwaway, and never a run branch — so none of the silent-mis-base or
cross-contamination failures the main rule prevents can occur. Cleanup is guarded, never a blind
`--force`: the path must match `.claude/worktrees/gate-baseline-<sha>`, `git -C <wt> status
--porcelain` must be empty first, and the repo root / the caller's own worktree are refused. Do not
generalize this exception to run worktrees, and do not "correct" the `git worktree add` above back to
`EnterWorktree` — the SHA pin is the whole point.

---

## 3. Force the run branch onto the recorded parent tip

⚠️ **`worktree.baseRef` defaults to `fresh`, so a new worktree branches from `origin/<default-branch>`
— not from your `HEAD`.** Run from a feature branch, or from a `main` carrying unpushed commits, and
the worktree silently starts on the wrong base; the PR is then built against a parent that is not the
parent you recorded, and nothing in the report says so. Do not trust the base you were handed:

```bash
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"

git switch -C "${BRANCH}" "${PARENT_TIP}"   # -C: re-point even if the branch already exists
BASE_SHA="$(git rev-parse HEAD)"

# All three MUST hold. Any mismatch => do not invoke the workflow.
test "${BASE_SHA}" = "${PARENT_TIP}"                      && echo "base ok"     || echo "BASE MISMATCH"
test "$(git symbolic-ref -q --short HEAD)" = "${BRANCH}"   && echo "branch ok"   || echo "BRANCH MISMATCH"
test "${WORKTREE_ROOT}" != "${MAIN_ROOT}"                 && echo "isolated ok" || echo "NOT IN A WORKTREE"
```

The `BASE_SHA == PARENT_TIP` assertion is what makes `baseRef: fresh` unable to silently re-base the
run; it is not optional, and it is cheap. Assert it in **both** lanes.

⚠️ `EnterWorktree name: "${MODE}-${SLUG}"` creates its own branch named **`worktree-${MODE}-${SLUG}`**
and checks that out. The `switch -C` above moves the worktree onto `${BRANCH}` (the name the engines'
placement guards check), leaving that harness-created branch behind, pointing at the same base and
holding nothing. Delete it at cleanup so it does not accumulate:
`git -C "${MAIN_ROOT}" branch -D "worktree-${MODE}-${SLUG}"` (safe — it has no unique commits; `-D`
rather than `-d` because it was never merged anywhere). Do this **after** `ExitWorktree`.

In the **in-repo lane**, substitute `git switch -c "${BRANCH}"` (create in place) and expect
`WORKTREE_ROOT == MAIN_ROOT`; assert the branch, and if it already exists check it out rather than
creating it, confirm its tip, and log the reuse. Never proceed on the parent branch as a fallback in
either lane — every downstream guard checks placement against a branch that would not exist.

Set `REPO_ROOT="${WORKTREE_ROOT}"` from here on (or `"${MAIN_ROOT}"` in the in-repo lane): the
caller's post-flight and landing steps must run their git commands against the tree the work actually
landed in.

⚠️ **Entering a worktree does not sandbox absolute paths.** The session cwd moves, but an absolute
path — or a `git -C <main-checkout>` — still reads and writes the main checkout, with no warning.
Measured twice: `Edit` calls issued from inside a worktree against absolute main-checkout paths
landed on `main`, and the `auto-feature` planner wrote its plan artifact to an absolute main-checkout
path while its cwd was the worktree. So every git command from here on must pass
`-C "${REPO_ROOT}"`, and **the isolation you report is only as real as the paths you used.** The
`/tmp/${MODE}-main-before.txt` snapshot from §1 is the §5b discriminator for exactly this.

---

## 4. Probe placement — the gate that makes the isolation claim real

Protocol §1a's inheritance table is a set of **dated observations of particular harness builds**, not
doctrine — that section has been wrong in *both* directions. So verify rather than inherit, in either
direction: a reported regression this probe cannot reproduce is as much a reason to re-measure as a
version bump is. Skip this entirely in the in-repo lane — there is nothing to verify, the session repo
*is* the tree.

**Why the probe is not optional even though the lane is the default.** The two lanes fail
*differently*. In-place is **noisy**: HEAD moves where other sessions can see it, and the damage is
visible and recoverable. A worktree the agents are not in is **silent**: the report says
`isolation: worktree`, the commits land on the parent branch, and nothing in the run says otherwise. A
lane whose failure mode is silence may be the default only while something keeps checking. So a probe
failure is a fallback, never an inconvenience to route around.

Check the cache first; it costs one cheap agent per Claude Code upgrade, not one per run. It is keyed
on the CC version **and the probe shape** — a verdict is only as trustworthy as the probe that produced
it, and the pre-2026-08-08 self-report probe could mint a false `inherits` on a broken harness. Bump
`PROBE_SHAPE` on any change to the probe and every older verdict silently stops counting:

```bash
CC_VERSION="$(claude --version 2>/dev/null | awk '{print $1}')"
PROBE_SHAPE="two-sided-marker-v1"          # bump on any change to the probe below
CACHE="${MAIN_ROOT}/.claude/.autopilot-worktree-capability.json"   # shared by all three engines
```

Read it with a small script that reports fresh-or-not (`CACHED:<verdict>` only when **both** the
version and the probe shape match; anything else is `PROBE_NEEDED`). `CACHED:inherits` → proceed.

The cache is **per-machine and gitignored** — one host's measurement of one CC version by one probe
shape. Never commit it: a wrong `inherits` propagated to other machines suppresses the very probe that
would catch a regression.

⚠️ **The probe must be self-authenticating. A returned string is a claim, not a measurement.** Do not
spawn an agent that reports its own `pwd` / `--show-toplevel` / `--show-current` and call that a probe.
That was the prescription until 2026-08-08 and it is too weak in two *measured* ways: a probe agent has
returned plausible values having made **zero tool calls**, inferring them from context; and a 2.1.226
report described `pwd` naming the worktree while the reads resolved to the main checkout — a shape the
placement assertion passes. The failure is **bidirectional**: an agent that guesses correctly mints a
false `inherits`, and verdicts are cached, so one fabricated probe poisons every later run on that
version and shape.

So the probe carries **discriminators the agent cannot produce by reasoning**: nonce files the
orchestrator plants, read back through **relative** paths.

⚠️ **Plant BOTH sides — one marker cannot tell a regression from a fabrication.** A worktree-only
marker answers "did it see the worktree?" and nothing else, so every failure collapses into one
undifferentiated `ABSENT`: a fabricating agent and a genuinely-mislocated one become
indistinguishable, and a genuine regression can then never be *recorded* — only endlessly re-probed and
fallen back from. A second marker in the main checkout makes the answer two-sided, and two-sided is
what makes it decisive: seeing the main marker while missing the worktree one is a **positive
measurement of where the agent actually is**, not merely the absence of one.

```bash
NONCE="$(python3 -c 'import secrets;print(secrets.token_hex(8))')"
printf '%s\n' "${NONCE}" > "${WORKTREE_ROOT}/.claude/.probe-nonce"        # ONLY in the worktree
printf '%s\n' "${NONCE}" > "${MAIN_ROOT}/.claude/.probe-nonce-main"       # ONLY in the main checkout
```

Both are gitignored, and the second is why `MAIN_ROOT` is still needed here. The two filenames must
**differ** — a same-named file in both trees is invisible to the test.

Then dispatch a **one-agent `Workflow`** (the real dispatch path — an `Agent` subagent is not the same
spawn path and is not a substitute) whose agent runs exactly

```bash
echo "WT=$(cat .claude/.probe-nonce 2>/dev/null || echo ABSENT)" \
     "MAIN=$(cat .claude/.probe-nonce-main 2>/dev/null || echo ABSENT)" \
     "TOPLEVEL=$(git rev-parse --show-toplevel)" \
     "HEAD_REF=$(git symbolic-ref -q --short HEAD || echo DETACHED)"
```

and returns it verbatim, with nothing else. Note what each field is doing, and do not "simplify" any of
them away:

| Field | Why |
|---|---|
| `WT` read from a **relative** path | unguessable, and the file exists only in the worktree — so the nonce proves *both* execution and placement |
| `MAIN` read from a **relative** path | the other side. Present means the agent's relative reads resolve to the **main checkout** — the failure stated positively, rather than inferred from an absence that fabrication also produces |
| `TOPLEVEL` | **diagnostic only.** The reported 2.1.226 failure had it naming the worktree while the reads allegedly went to `main`, so it cannot be part of the decision |
| `HEAD_REF` via `git symbolic-ref -q --short HEAD` | also diagnostic; unambiguous, and `DETACHED` is a distinguishable answer rather than the empty string `git branch --show-current` returns |

**The two markers decide; `TOPLEVEL`/`HEAD_REF` only corroborate.** That ordering is the whole point —
the previous probe made the self-reported git identity the decision and was passed by a broken harness.

The probe is **read-only by construction** — the agent reads files someone else planted. A write-probe
was tried and is worse twice over: an agent may simply refuse the write (observed), and a successful
write proves only where *that* agent's writes go, which is the weaker half of the question.

**Verdict rules — three outcomes, not two.** Read the marker pair first; it alone can produce a
cacheable verdict:

| `WT` | `MAIN` | Verdict |
|---|---|---|
| nonce | `ABSENT` | **`inherits`** — the only pass. It saw the worktree and could **not** see the main checkout |
| `ABSENT` | nonce | **`does_not_inherit`** — executed, resolving against the main checkout. The shape reported on 2.1.226, and the one failure here that is a real measurement worth caching |
| `ABSENT` | `ABSENT` | **`inconclusive`** — in neither tree, or it never ran. Re-probe once |
| nonce | nonce | **`inconclusive`** — impossible for one agent running once in one tree; treat as fabrication |

Then these, in order — any one of them overrides a marker pass:

| Observation | Verdict |
|---|---|
| `tool_uses` / `toolCalls` for the probe agent is **0** | **`inconclusive`** — the agent fabricated. Re-probe once with the requirement stated explicitly ("you MUST call Bash; report its raw stdout"). Never read this as `does_not_inherit` |
| either nonce value is present but ≠ the planted value | **`inconclusive`** — it did not read the file it was told to read; re-probe once |
| **`TOPLEVEL` and `HEAD_REF` disagree about which tree the agent is in**, or either disagrees with the marker verdict | **`does_not_inherit`** — see below. Never a partial pass |
| two probes **disagree** with each other | **`inconclusive`** — trust neither (observed: two probes contradicted, one inventing a field that was never asked for) |
| re-probe still `inconclusive` | fall back, and say the probe could not be verified — **do not cache** |

⚠️ **A self-contradictory probe is `does_not_inherit`, not "one field passed".** On 2026-08-08 a probe
returned `TOPLEVEL`=worktree with `BRANCH=main` — internally inconsistent, and caught only because the
*branch* field happened to be implausible. A rule that ANDs two fields it is willing to believe
individually will pass a sandbox that reports a plausible branch, which is exactly how a run reaches
`main` while reporting `isolation: worktree`. A tree that cannot give one consistent account of where
it is does not get the benefit of the doubt: **contradiction is failure.** In the same spirit,
`HEAD_SHA`-style fields resolving to no real ref (also observed) are contradictions, not curiosities.

**Never write a verdict that is not backed by a verified tool call.** `inconclusive` is not a cacheable
value; the cache holds `inherits` / `does_not_inherit` only, and only from a probe whose markers were
read and were mutually consistent. "I couldn't measure it" must never be recorded as "I measured a
regression" — that is the same silent degradation as treating an unreachable catalog as a missing
artifact ([`../../../rules/artifact-provisioning.md`](../../../rules/artifact-provisioning.md)).

Delete **both** markers when done, verdict or not
(`rm -f "${WORKTREE_ROOT}/.claude/.probe-nonce" "${MAIN_ROOT}/.claude/.probe-nonce-main"`). Then write
the cache entry — `{cc_version, probe, verdict}` — and only for a marker-verified, non-contradictory
probe. Assert the verdict is one of the two cacheable values *in the write itself*, so `inconclusive`
cannot be recorded by accident.

### 4b. Fail closed — the fallback, in the one order that works

**On `does_not_inherit`, or an `inconclusive` verdict that survives one re-probe, fall back — do not
proceed in the worktree.** The agents would commit somewhere the report will describe as isolated.

**Order matters.** `${BRANCH}` is currently checked out *in the worktree*, and git refuses to check
the same branch out in a second tree (`fatal: ... is already used by worktree`). So tear the worktree
down **first**, then create the branch in the main checkout:

```bash
# 1. ExitWorktree  action: "remove"   — nothing has been committed in it yet, so this succeeds
#                                       and releases ${BRANCH}. If it REFUSES, commits exist:
#                                       stop and inspect rather than forcing discard_changes.
# 2. then, in the main checkout:
git -C "${MAIN_ROOT}" switch -c "${BRANCH}" "${PARENT_TIP}" 2>/dev/null \
  || git -C "${MAIN_ROOT}" switch -C "${BRANCH}" "${PARENT_TIP}"
git -C "${MAIN_ROOT}" symbolic-ref -q --short HEAD    # CONFIRM before invoking
```

Then set `REPO_ROOT="${MAIN_ROOT}"`, set `isolation: "branch_in_place"` in the args envelope, re-run
the **in-repo** row of §1's dirty-tree table (it now applies, and it did not before), and **tell the
user the isolation degraded and why** (§6). Do not cache a `does_not_inherit` verdict as if it were a
user preference — it is a harness regression worth reporting.

---

## 5. What the run must pass to the engine

Whatever the lane, pass these in the args envelope / execution graph. All three engines read them by
the same names, and they are what arm the fail-closed placement guards:

| Field | Value | What it arms |
|---|---|---|
| `run_branch` | `${BRANCH}` | pre-dispatch branch guard (`blocked / wrong_branch` **before any agent commits**) and the post-run empty-branch check (`needs_opus / nothing_on_run_branch` instead of `complete`) |
| `parent_branch` | `${PARENT_BRANCH}` | the PR base and squash target — never a hard-coded `main` |
| `branch_base` | `${BASE_SHA}` | replaces a `HEAD~10` **guess** in the report structurer (that guess once made a report disagree with reality by 55 files); must resolve as a commit or the run halts |
| `parent_tip_at_start` | `${PARENT_TIP}` | lets the report say `parent_moved: true` rather than leaving a reader to infer a mid-run rebase from a SHA that no longer resolves |
| `session_repo` | `${SESSION_REPO}` (§1) | `cross_repo_target` / `cross_repo_unverified` guards |
| `isolation` | `"worktree"` or `"branch_in_place"` | **descriptive only** — see the caveat below |
| `worktree_path` | `${WORKTREE_ROOT}`, omitted in the in-repo lane | ditto |

**Omit the first five and the engines run with their guards disarmed** — they will run, and they will
not check placement.

The top-level `graph.isolation` here names the run's lane and is unrelated to a phase/task's
`p.isolation` / `t.isolation`, which controls the Workflow runtime's per-agent
`agent({isolation:'worktree'})` option; passing this envelope field does not set that option.

⚠️ **`isolation` and `worktree_path` are descriptive, not instructive.** Both engines now echo them
into `run_placement`: `execute-contract.js` includes them in `placementFacts()`, `execute-plan.js`
now emits a `run_placement` block on every terminal return, and `auto-feature.js` forwards its
child's block. The scripts still have no FS or shell, so an echo is the caller's own unverified claim
about which lane ran — not evidence that isolation held, not a filesystem check, and never a basis for
inferring one field from the other. **The mechanism for §6 remains the orchestrator's own statement,
not the report field.**

---

## 5b. Post-flight — read the baseline you wrote in §1

Commits on the run branch are only **half** the isolation claim. An agent that wrote to an absolute
main-checkout path left no commit anywhere and no trace on the run branch (§3) — the §1 snapshot is the
only thing that detects it. So every consumer must actually read it back:

```bash
# Recompute the SAME run-scoped path as §1 — never a fixed /tmp name (see §1's warning).
BASELINE="/tmp/${MODE}-main-before.$(basename "${MAIN_ROOT}").${PARENT_TIP:0:12}.txt"

# The sentinel must name OUR PARENT_TIP, not merely exist. A sentinel alone proves *a* baseline was
# written, not that it was written by *this* run — and a stale or foreign baseline that passes a
# presence-only check can report CLEAN over a real stray.
if ! grep -q "^# ${MODE}-baseline ${PARENT_TIP}$" "${BASELINE}" 2>/dev/null; then
  if [ -f "${BASELINE}" ]; then
    echo "POST-FLIGHT INCONCLUSIVE — ${BASELINE} exists but its sentinel does not name ${PARENT_TIP}:"
    head -1 "${BASELINE}"
    echo "  It belongs to a different run (or a previous run at a different base)."
  else
    echo "POST-FLIGHT INCONCLUSIVE — ${BASELINE} is absent; the §1 baseline was never written."
  fi
  echo "  Compare by hand against the dirty set you reported in pre-flight, and do NOT read this as"
  echo "  'no stray writes'."
else
  { echo "# ${MODE}-baseline ${PARENT_TIP}"; git -C "${MAIN_ROOT}" status --porcelain; } \
    > "/tmp/${MODE}-main-after.$(basename "${MAIN_ROOT}").${PARENT_TIP:0:12}.txt"
  diff "${BASELINE}" "/tmp/${MODE}-main-after.$(basename "${MAIN_ROOT}").${PARENT_TIP:0:12}.txt" \
    && echo "main checkout clean of stray writes" \
    || echo "STRAY WRITES INTO THE MAIN CHECKOUT — lines above prefixed > are new"
fi
```

**Validate the baseline before trusting the diff, and never collapse the failure modes.** There are
now three, and only one of them means "no stray writes": ours-and-matching (trust the diff),
absent (never written), and present-but-foreign (another run's, or ours from a different base). A
missing or sentinel-less baseline reports every pre-existing untracked file as a stray; a check that
cries wolf is one an operator learns to wave through, which is how a guard gets hollowed out. "I lost
the baseline" and "nothing was written" are different answers.

Also confirm the main checkout did not move, which the baseline cannot tell you:

```bash
git -C "${MAIN_ROOT}" symbolic-ref -q --short HEAD              # must STILL be ${PARENT_BRANCH}
git -C "${MAIN_ROOT}" log --oneline -3 "${PARENT_BRANCH}"       # must NOT carry this run's commits
```

If either fails, the isolation claim is false no matter what the report says — say so plainly, and
treat the probe cache as suspect (delete it so the next run re-probes).

A new entry is a **real finding, not noise**: resolve it before opening the PR. The worse shape is an
absolute write over a *tracked* file, which lands outside the run branch, the PR, and every gate.

---

## 6. Report the lane — degradation is never implicit

**Any run that ends in the in-repo lane must say so in its final response**, whether it got there by
`--no-worktree` or by falling back from a failed probe. State the lane, and on a fallback state the
reason (`does_not_inherit` with the measurement, or `inconclusive` after a re-probe).

This is the whole point of the section. A run that reads as isolated without being it is worse than
one that was never isolated: the 2026-08-05 incident's most expensive property was not the bypassed
gates but that the report said `status: complete` while they were bypassed. Silence about a
degradation reproduces exactly that.

The engines now echo `isolation` (§5), but the value is the caller's own unverified claim, not an
independent attestation of where the run executed. The lane therefore remains the orchestrator's
sentence to write, not something delegated to the report.

---

## 7. Cleanup

| Lane | Ending |
|---|---|
| **worktree** | `ExitWorktree` — `action: "remove"` after a successful squash-merge (the branch is merged; the remote ref was deleted explicitly by the two-step merge in `git-worktree-pr-protocol.md` §6 — **never** assume `--delete-branch` removed anything, it does not run in this layout); `action: "keep"` if the PR is still open at the approval gate or anything is unmerged. `remove` **refuses** on unmerged commits; do not reach for `discard_changes: true` to force past that refusal without asking — that discards real work. Then delete the harness branch (§3). |
| **in-repo** | `git -C "${MAIN_ROOT}" switch "${PARENT_BRANCH}"` to restore the session's starting branch, then delete the run branch after the merge (no orphan branches). |

⚠️ In the worktree lane, do **not** `git switch "${PARENT_BRANCH}"` inside the worktree — that checks
the parent branch out in a second tree and is exactly the ground-shifting this lane avoids.
`ExitWorktree` is the way back.

Squash-merging the PR is **main-line work** and cannot be worktree-isolated: take the repository
lease for it (protocol §1b).

---

## Related

- Doctrine, the five hazards, the dated inheritance observations, the 2026-08-05 incident:
  [`../git-worktree-pr-protocol.md`](../git-worktree-pr-protocol.md) §1a
- Main-line work that no worktree can isolate (sync, squash-merge, release): same file, §1b
- Shared-checkout reasoning hazards + the `PreToolUse` drift guard:
  [`../../../rules/shared-checkout-safety.md`](../../../rules/shared-checkout-safety.md)
