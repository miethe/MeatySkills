---
description: "Autopilot — Opus-orchestrated auto-feature workflow for request-driven feature delivery without a pre-authored contract or plan"
argument-hint: "[feature-text|REQ-ID] [--plan-only] [--dry-run] [--budget=<tokens>] [--category=features|enhancements|refactors|harden-polish|infrastructure] [--max-points=N]"
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(pytest:*), Bash(pnpm:*), Bash(python:*), Bash(meatycapture:*)
---

# Autopilot

**You are Opus.** This command is the zero-ceremony entry point for feature delivery: from raw request to merged code without a pre-authored Feature Contract or Implementation Plan. You invoke the `auto-feature` Dynamic Workflow, which auto-classifies scope, selects the right execution tier, generates planning artifacts on the fly, and delivers — all in a single workflow run.

> **Git workflow.** Autopilot follows the canonical [git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md): an in-repo **worktree** under `.claude/worktrees/<slug>` (not a sibling `../<repo>-<slug>` path), the **parent branch** (HEAD at run start) as the PR base, a PR to the **parent branch**, and **squash-merge only on approval or an in-prompt override** (e.g. "auto-merge" / "merge when done"). Opus still orchestrates every git step.
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

Warn (do not block) on a dirty tree. The workflow runs on an isolated branch, but a dirty working tree means uncommitted context may be missing.

### 3. Set Up Isolated Worktree Branch

The `auto-feature` workflow's nested engines require an isolated git branch. Opus creates this before workflow invocation, using the in-repo worktree path convention from the [git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md) §2.

```bash
# Record the PARENT branch (HEAD now) — this is the PR base and squash-merge target.
PARENT_BRANCH="$(git branch --show-current)"
# Resolve the CURRENT repo root — never hard-code a specific repo. Reused in Action 5.
REPO_ROOT="$(git rev-parse --show-toplevel)"
# Derive a slug from the request (kebab-case, max 40 chars)
SLUG="autopilot/<request-slug>"
BRANCH="autopilot/<request-slug>"
WORKTREE_PATH=".claude/worktrees/${BRANCH//\//-}"   # in-repo path convention (protocol §2)

git worktree add "${WORKTREE_PATH}" -b "${BRANCH}"
git rev-parse HEAD  # record pre-run checkpoint (BASE_SHA)
```

Note the parent branch, worktree path, and branch for the post-run PR. If worktree creation fails (branch already exists), use the existing branch and log the conflict.

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

### 5. Handle the ExecutionReport

The workflow returns a standard `ExecutionReport` plus an `autopilot` annotation:

```json
{
  "status": "complete|needs_opus|blocked",
  "reason": "<see branches below>",
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
   cd "${REPO_ROOT}"   # return to the CURRENT repo root (captured in Action 3) — never hard-code a specific repo
   git diff "${PARENT_BRANCH}"...HEAD
   # Run the repo's applicable validation suite (commands vary by repo):
   pytest -v          # if Python changed (use the repo's own coverage target, e.g. --cov=<pkg>)
   pnpm test && pnpm type-check && pnpm lint   # if frontend changed

   git push -u origin "${BRANCH}"
   gh pr create --base "${PARENT_BRANCH}" --head "${BRANCH}" \
     --title "feat(<slug>): <summary from report>" --body-file .claude/pr-body.md
   # Default: STOP at the approval gate. On approval OR an in-prompt merge override
   # ("auto-merge" / "merge when done"), squash-merge into the parent branch:
   gh pr merge "${BRANCH}" --squash --delete-branch
   git worktree remove "${WORKTREE_PATH}"
   ```
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

#### `status: needs_opus, reason: scope_exceeds_single_pass`

The request is too large for the autopilot single-pass lane. The workflow wrote a draft plan artifact at `autopilot.plan_artifact_path` as a head start.

Opus actions:
- Surface the scope assessment to the user.
- Offer: "Run `/plan:plan-feature` to author a full Tier 2/3 PRD + Implementation Plan — the draft at `<plan_artifact_path>` gives a head start."
- **Do not auto-run full planning.** Await user confirmation.
- Clean up the worktree branch:
  ```bash
  git worktree remove "${WORKTREE_PATH}"
  git branch -D "${BRANCH}"
  ```

---

#### `status: needs_opus, reason: spike_required`

Unresolved research unknowns block reliable planning or implementation.

Opus actions:
- Surface the unknowns from `verdict.required_fixes` or report body.
- Recommend `/plan:explore` (open-ended discovery) or `/plan:spike` (targeted feasibility research) first.
- Surface `autopilot.plan_artifact_path` if the workflow wrote a partial plan.
- **Do not proceed with implementation.** Await user direction.
- Clean up worktree as above.

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
- Do not auto-commit partial work — inspect `git diff "${BRANCH}"..HEAD` first.
- If substantial work landed on the worktree branch and is sound, merge it with a partial-completion note in the commit message.

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
- Worktree branch setup is the only Opus direct action before invocation.

Reference: `.claude/rules/context-budget.md`.

---

## Quality Gates (on `status: complete`)

- [ ] PR opened to the parent branch; squash-merge gated on approval/override, then merged cleanly (no conflicts)
- [ ] Tests pass for changed scope (`pytest` / `pnpm test`)
- [ ] Type check passes (`pnpm type-check` / `mypy`) for changed scope
- [ ] Lint passes for changed scope
- [ ] Request-log item updated if `request_id` present
- [ ] Plan artifact frontmatter updated: `status: completed`, `commit_refs`
- [ ] Worktree and branch cleaned up (no orphan branches)

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
