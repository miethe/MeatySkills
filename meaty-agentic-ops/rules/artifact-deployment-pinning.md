# Rule — artifact deployment is SkillMeat's job, and a symlink into a working tree is not a deploy

> **Status:** decided 2026-08-12 · `node_01KZS86MTR0WDPXT10EEXNVC2D`
> **Scope:** every artifact deployed to `~/.claude` on this machine, not just `delegation-router`.

## The decision (AC1)

**SkillMeat owns deployment of all artifacts, including to the global/system level, which is
registered as a distinct SkillMeat project.** Deployed artifacts are therefore *tracked copies*
attributable to a collection version — never symlinks into a live git working tree.

```
skillmeat system show                       # ~ is registered: name "home", profile claude_code
skillmeat deploy <artifact> --project ~ --apply-recipe
skillmeat project reconcile                 # detect drift against what SHOULD be deployed
```

This was chosen over the two alternatives that were on the table:

| Option | Why not |
|---|---|
| **(b)** keep the symlink but point it at a worktree pinned to the trunk ref | Removes branch-roulette but keeps a bespoke deploy path, and adds a worktree per repo to maintain. A second mechanism SkillMeat would later have to replace. |
| **(c)** keep the symlink plus a deploy-time assertion that the target's HEAD contains the deployed ref | Cheapest, and does **not close the bug**: between deploys any `git checkout` still repins the live artifact. It only narrows the window in which you are told. |

Option **(a)** — immutable copies deployed from a versioned source — is the decision, with the
correction that the versioned source and the copy mechanism are **SkillMeat's**, not a
hand-rolled `git archive` in a shell script. Hand-rolling it would have added a third deploy
path to a system that already had one too many.

### The convenience trade-off, stated explicitly (AC1)

The symlink bought **edit-and-see-it-live**: a change to the skill in the repo was instantly what
every project loaded, with no deploy step. That is now gone, deliberately. After this change an
edit requires a deploy to take effect globally:

```
skillmeat deploy delegation-router --project ~ --apply-recipe
```

This is the same trade already accepted for `~/.claude/config/model-registry.yaml`, a deployed
(explicitly *not* hand-editable) artifact since 2026-07-09. What it buys: the deployed artifact
is attributable to a version, a `git checkout` is no longer an undeclared global deploy, and
`skillmeat project reconcile` can say what drifted. What it costs: one command between editing
and seeing the effect, and the discipline to remember it.

## The mechanism it replaces, and why it was worse than it looked

`~/.claude/skills/delegation-router` was a symlink to this repo's **live working tree**, so the
globally deployed router — for every project and agent on this machine — was whatever branch
happened to be checked out here. Three incidents trace to that one shape:

1. **2026-07-29** — `~/.claude/config/model-registry.yaml` froze while the resolver kept reading it.
2. **2026-08-11** — the DI-1 entry-key fix was merged but not deployed, because the symlinked
   working tree sat on an unrelated branch. `entry-key.js` did not reach the trunk until
   2026-08-12.
3. **2026-08-11** — `sync-to-global.sh` run from a *worktree* would `cp -f` and
   `rm -rf references/ scripts/` **into** the primary checkout, and its model-playbook block
   (`rm -rf "${DEST_PLAYBOOK_DIR:?}"/*`) had **no symlink guard at all**, so it fired even when
   `SKIP_CODE_COPY=1`. Both would delete and replace *tracked* files on another agent's branch.

The old guard set `SKIP_CODE_COPY=1` when the destination resolved to the source and reported
`code already live`. True only in the sense that the symlink target *is* the deployed code; it
said nothing about **which ref** the target held. A guard added to stop a `cp` failure from
aborting the registry deploy had quietly converted *"deploy the code"* into *"assume the code is
right"*.

**Compounding, now removed:** the script's hand-maintained `SKILL_FILES` array omitted
`routing-feedback.js`, `log-cli.js`, `entry-key.js`, and `feedback-cli.js`. Anyone who replaced
the symlink with real copies using that list would have shipped a router with **no feedback
engine at all**. The array is deleted rather than corrected — SkillMeat deploys the artifact
*directory*, so a hand-maintained file list is pure drift surface.

## What `sync-to-global.sh` does now

- **Refuses** to write to any destination that resolves inside a git working tree, naming the
  worktree and branch, and exits non-zero (AC4).
- **Does not deploy engine code or `model-playbook` at all.** It prints the SkillMeat command.
- Still deploys the tracked registry + rankings to `~/.claude/config/` as a manual path. The same
  placement is carried declaratively by `delegation-router/recipe.toml`, so a SkillMeat deploy is
  self-sufficient.

`recipe.toml` exists because the resolver reads its registry from `~/.claude/config/`
(`resolver.js:216-217`), one directory outside where a skill deploy lands files. Recipe ops are
declarative — there is no run-a-script op — so it `file_copy`s the **tracked**
`model-registry.generated.json` rather than rebuilding it. That tracked JSON was verified
byte-identical to a fresh regeneration from the tracked YAML on 2026-08-12, apart from a
`_generated_from` absolute-path stamp.

> WARNING: if you edit `model-registry.yaml`, regenerate and commit the JSON in the same change:
> `python3 scripts/build-model-registry.py --in model-registry.yaml --out model-registry.generated.json`

## The audit (AC2)

Total symlinks under ~/.claude resolving into a git working tree: **69**, across **6** repos.

| Owning repo | Count |
|---|---|
| `~/dev/homelab/development/agentic_meta_dev` | 59 |
| `~/dev/homelab/development/research-foundry` | 3 |
| `~/dev/homelab/development/MeatySkills` | 2 |
| `~/dev/homelab/development/skillmeat` | 2 |
| `~/dev/homelab/development/agentic-research` | 2 |
| `~/dev/homelab/development/intenttree` | 1 |

<details><summary>Full inventory (AC2)</summary>


**`~/dev/homelab/development/agentic_meta_dev`** — 59

- `~/.claude/agents/agent-expert.md`
- `~/.claude/agents/ai-artifacts-engineer.md`
- `~/.claude/agents/ai-engineer.md`
- `~/.claude/agents/api-documenter.md`
- `~/.claude/agents/artifact-tracker.md`
- `~/.claude/agents/artifact-validator.md`
- `~/.claude/agents/backend-architect.md`
- `~/.claude/agents/backend-typescript-architect.md`
- `~/.claude/agents/changelog-generator.md`
- `~/.claude/agents/codebase-explorer.md`
- `~/.claude/agents/command-creator.md`
- `~/.claude/agents/data-layer-expert.md`
- `~/.claude/agents/devops-architect.md`
- `~/.claude/agents/documentation-complex.md`
- `~/.claude/agents/documentation-expert.md`
- `~/.claude/agents/documentation-planner.md`
- `~/.claude/agents/documentation-writer.md`
- `~/.claude/agents/feature-planner.md`
- `~/.claude/agents/feature-sprint-executor.md`
- `~/.claude/agents/frontend-architect.md`
- `~/.claude/agents/gemini-orchestrator.md`
- `~/.claude/agents/implementation-planner.md`
- `~/.claude/agents/karen.md`
- `~/.claude/agents/lead-architect.md`
- `~/.claude/agents/lead-pm.md`
- `~/.claude/agents/nextjs-architecture-expert.md`
- `~/.claude/agents/openapi-expert.md`
- `~/.claude/agents/phase-owner.md`
- `~/.claude/agents/prd-writer.md`
- `~/.claude/agents/prompt-engineer.md`
- `~/.claude/agents/python-backend-engineer.md`
- `~/.claude/agents/research-technical-spike.md`
- `~/.claude/agents/search-specialist.md`
- `~/.claude/agents/senior-code-reviewer.md`
- `~/.claude/agents/spike-writer.md`
- `~/.claude/agents/symbols-engineer.md`
- `~/.claude/agents/system-architect.md`
- `~/.claude/agents/task-completion-validator.md`
- `~/.claude/agents/task-decomposition-expert.md`
- `~/.claude/agents/technical-writer.md`
- `~/.claude/agents/ui-designer.md`
- `~/.claude/agents/ui-engineer-enhanced.md`
- `~/.claude/agents/ui-engineer.md`
- `~/.claude/commands/dev`
- `~/.claude/commands/itt`
- `~/.claude/commands/plan`
- `~/.claude/commands/redeploy.md`
- `~/.claude/skills/aos-operator`
- `~/.claude/skills/codex`
- `~/.claude/skills/delivery-report`
- `~/.claude/skills/dev-execution`
- `~/.claude/skills/gemini-cli`
- `~/.claude/skills/intenttree`
- `~/.claude/skills/meatywiki`
- `~/.claude/skills/op`
- `~/.claude/skills/planning`
- `~/.claude/skills/rf`
- `~/.claude/skills/skill-dev`
- `~/.claude/skills/skillmeat-cli`

**`~/dev/homelab/development/research-foundry`** — 3

- `~/.claude/skills/research-foundry`
- `~/.claude/skills/research-foundry-swarm`
- `~/.claude/skills/rf-knowledge`

**`~/dev/homelab/development/MeatySkills`** — 2

- `~/.claude/skills/delegation-router`
- `~/.claude/skills/model-playbook`

**`~/dev/homelab/development/skillmeat`** — 2

- `~/.claude/agents/gemini-executor.md`
- `~/.claude/skills/ica-delegate`

**`~/dev/homelab/development/agentic-research`** — 2

- `~/.claude/skills/council-review`
- `~/.claude/skills/council-run`

**`~/dev/homelab/development/intenttree`** — 1

- `~/.claude/skills/intenttree-cli`

</details>

Only the **2** `MeatySkills` symlinks are retired by this change. The other **67** are owned by
five other repos and are tracked separately — the pinning defect is live for all of them, and the
8 artifacts that `skillmeat status --project ~` reports as *"Locally modified"* read that way
precisely because their deployed path is a symlink into a working tree.

## Rules

1. **Never symlink anything under `~/.claude` at a git working tree.** Deploy a copy via SkillMeat.
2. **Never hand-edit a deployed artifact** under `~/.claude`. Edit the upstream, then deploy.
3. **A deploy script must refuse to write into a git working tree**, not warn about it.
4. **Do not hand-maintain a per-file list** of what to deploy; deploy the artifact directory.
5. `~` is the SkillMeat **system project** (`skillmeat system show`). Treat it as a deploy target
   like any other project, with `project reconcile` as the drift check.
