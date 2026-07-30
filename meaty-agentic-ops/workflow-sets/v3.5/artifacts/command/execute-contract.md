---
description: Tier 1 Feature Contract autonomous sprint — single agent end-to-end with mandatory validator review
argument-hint: "<contract-path> [--budget=<tokens>] [--scope=backend|frontend|full]"
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(pytest:*), Bash(pnpm:*), Bash(python:*)
---

# Execute Feature Contract

**You are Opus.** This command runs a Tier 1 autonomous sprint against a single Feature Contract. Your job is to dispatch the sprint, surface results, drive the validator review, and (on approval) coordinate the commit. **Do not implement, do not explore the codebase yourself, do not read the full contract body** — the executor agent owns end-to-end delivery.

> **Git workflow & model routing.** This sprint follows the canonical [git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md): the executor works in a **worktree** under `.claude/worktrees/<slug>`, Opus records the **parent branch** (HEAD at run start) as the PR base, commits per logical unit, and on validator `APPROVED` + user confirmation (or an in-prompt merge override) opens a PR to the **parent branch** and **squash-merges** — never `--base main` hard-coded, never an unreviewed self-merge. Per [`MODEL-ROUTING`](../../../docs/agentic-operator/MODEL-ROUTING.md) the sprint executor runs on subscription **Sonnet 5** (`claude-sonnet-5`) by default — **Opus 5** for spine, **`xhigh`** for the hardest work; bounded, contract-clear waves may **offload to ICA Sonnet 4.6** (`claude-sonnet-5[1m]`, free-to-us; 4.6[1m]/Haiku for cheap fan-out) behind the mandatory validator gate, never Mode-D work.

## Scope Check

| Use this command when | Use something else when |
|---|---|
| Single Feature Contract, 3–8 pts | <3 pts atomic change → `/dev:quick-feature` |
| Tier 1 (`tier: 1` in frontmatter) | Tier 2/3 multi-phase work → `/dev:execute-phase` |
| Clear AC + Validation Requirements | Tier 0 trivial fix → direct edit |
| Single-agent sprint (no cross-team coordination) | Auth/payments/migrations at `risk_level: high` → Mode D handoff |
| All target files fit in one agent's context | **Large-file refactor** (any `files_affected` entry >~2K lines that is deleted / relocated / split / substantially rewritten) → Tier 2 `/dev:execute-phase` (see `.claude/specs/workflows/large-file-refactor-decomposition-spec.md`) |

## Actions

### 1. Resolve Contract Path

Treat `$ARGUMENTS` as the contract path (first positional arg). Verify:

```bash
test -f <contract-path> && head -30 <contract-path>
```

Fail fast with a clear message if:
- File does not exist.
- Frontmatter is missing `doc_type: feature_contract`.
- Frontmatter is missing `tier: 1`.

Parse out optional `--budget=<tokens>` and `--scope=backend|frontend|full` qualifiers from `$ARGUMENTS`.

### 2. Read Contract Header Only

Read **only** frontmatter + the `## Goal` section (~first 80 lines):

```bash
head -80 <contract-path>
```

Confirm: scope is sane, points ≤ 8, `files_affected` is enumerable. **Do not read the full contract body** — the executor reads it.

### 3. Pre-Flight Checks

| Check | Command | Action on failure |
|---|---|---|
| **Pre-execution artifact provisioning (best-effort, ON BY DEFAULT)** — run this FIRST | `PROVISION_PLAN_FILE="<contract-path>" PROVISION_SCOPE="plan:<slug>" .claude/skills/dev-execution/hooks/provision-artifacts.sh` | Non-fatal on infra (CLI missing / SkillMeat unreachable) — warn, continue. **One exception**: exit 2 (NEEDED+unsatisfiable artifact) → **stop**, do not dispatch the sprint. Silent no-op with no manifest + no `required_artifacts`. Gate: `.claude/rules/artifact-provisioning.md` |
| Working tree clean | `git status --porcelain` | Warn user; ask before proceeding |
| `prd_ref` / `plan_ref` exist | `test -f <ref>` if listed | Warn; do not block |
| Risk level | grep `risk_level:` in frontmatter | If `high` AND touches auth/payments/migrations → **stop**, surface Mode D handoff to user |
| **Large-file guard** | `wc -l` each `files_affected` entry that the contract deletes/relocates/splits/rewrites | If any such file is >~2K lines (and especially >5K) → **stop**; a single sprint agent cannot hold that source + its call-sites in context (it will blow context mid-sprint). Recommend Tier 2 promotion + decomposition per `.claude/specs/workflows/large-file-refactor-decomposition-spec.md` |

### 3b. Assemble the Delegation Context Bundle (once)

Assemble the four-part context bundle once, before dispatch, and thread its path into the
sprint executor (AOS constraint 4 — assemble once, never re-derive):

```bash
BUNDLE=$(op context pack --budget 6000 \
  --plan-ref <plan_ref or ""> --prd-ref <prd_ref or ""> \
  --project-root "$(git rev-parse --show-toplevel)" | head -1)
```

Thread `$BUNDLE` into the executor as its context channel: inline under
`<persona>…</persona>` in the Task prompt (claude subagent), or `--append-system-prompt-file
$BUNDLE` for an ICA leg. A single-agent Tier 1 sprint is a flat delegatable leg, so
`context_ref` is non-null. No model call on the assembly path.

### 4. Dispatch Sprint

Single `Task("feature-sprint-executor", "...")` call. Prompt template (keep under 200 words):

```text
Mode: C — Autonomous Feature Sprint

Feature Contract: <contract-path>
Budget: <tokens or "default ~50K">
Scope qualifier: <backend|frontend|full or "full">

Follow the Inputs Expected, Sprint Sequence, Outputs, and Hand-off
sections in .claude/agents/dev/feature-sprint-executor.md. Read the
contract first; explore via codebase-explorer rather than speculative
file reads; implement within declared scope; run validation per the
contract's Validation Requirements; produce the Completion Report;
return a one-line verdict.

Stop and return to Opus if you hit a Mode D boundary (auth, payments,
migrations) or scope creep past 8 pts.
```

**Do not** call `TaskOutput()` on the executor — verify Completion Report on disk after the agent returns (per `.claude/rules/context-budget.md`).

### 5. Receive Hand-Off

Expect one of:

| Verdict | Action |
|---|---|
| `SPRINT COMPLETE — all AC met` | Proceed to step 6 |
| `SPRINT PARTIAL — [blocker]` | Surface blocker to user; **stop**. Do not auto-validate. |

Locate the Completion Report (appended to contract or under `.claude/worknotes/[slug]/completion-report.md`).

### 6. Mandatory Validator Review

On COMPLETE only, dispatch:

```text
Task("task-completion-validator",
  "Review feature contract sprint at <contract-path>.
   Verify AC checklist, Validation Run results, Files Changed match
   git diff, no scope creep beyond files_affected.
   Read: contract, Completion Report, git diff. Report verdict.")
```

The validator runs in `plan` permissionMode (no edits). Expect verdict: `APPROVED` or `CHANGES_REQUESTED`.

### 7. Surface Results

| Validator verdict | Opus action |
|---|---|
| `APPROVED` | Present summary + suggested commit message. **Await user confirmation before committing.** |
| `CHANGES_REQUESTED` | Surface required follow-ups verbatim. **Do not commit.** User decides whether to re-dispatch sprint or accept partial. |

Opus **never auto-commits** for Tier 1 contracts.

Then close the response with the **Next Actions table** — spec: [.claude/skills/dev-execution/references/next-actions-table.md]. On `CHANGES_REQUESTED`, emit one row per required fix (next action = re-dispatch the sprint). On `APPROVED`, emit rows for the contract's follow-up recommendations, or the one-line empty state when the work is complete and merged.

### 8. Land & Update Tracking

Only after validator `APPROVED` AND user confirms (or an in-prompt merge override). Per the
[git worktree + PR protocol](../../skills/dev-execution/git-worktree-pr-protocol.md) §5–6, push the
run branch, open a PR to the **parent branch** (recorded at run start — not hard-coded `main`), and
**squash-merge only on approval/override** (Opus never auto-merges a Tier 1 contract absent that):

```bash
git commit -m "<message>"
git push -u origin "$BRANCH"
gh pr create --base "$PARENT_BRANCH" --head "$BRANCH" \
  --title "feat(<scope>): <summary>" --body-file .claude/pr-body.md
# On approval / in-prompt override only:
gh pr merge "$BRANCH" --squash --delete-branch
SHA=$(git rev-parse HEAD)

python .claude/skills/artifact-tracking/scripts/update-field.py \
  -f <contract-path> \
  --set "status=completed" \
  --append "commit_refs=${SHA}"
```

## Quality Gates

- [ ] Sprint returned `SPRINT COMPLETE` verdict
- [ ] Validator returned `APPROVED`
- [ ] All AC checked off in Completion Report
- [ ] Validation Run table shows passing commands (no `Not run` for required commands)
- [ ] Files changed match `files_affected` (no scope creep)
- [ ] User has reviewed and approved commit

## Token Discipline

- **Do not** read the full contract body — the executor reads it (head -80 only for sanity check).
- **Do not** explore the codebase yourself — delegation is the whole point of Tier 1.
- **Do not** call `TaskOutput()` on the sprint executor — verify on disk (Completion Report file, `git diff`, `git status`).
- **Do not** load symbols or run pattern queries before dispatch — the agent does this.

Reference: `.claude/rules/context-budget.md`.

## Skill References

- Executor agent: `.claude/agents/dev/feature-sprint-executor.md`
- Mode C definition: `.claude/rules/delegation-modes.md`
- Tier matrix (Tier 1 row): `.claude/plans/tiered-workflow-overhaul.md` §2.1
- Trial contract example: `docs/project_plans/feature_contracts/harden-polish/discovery-tier2-oauth-sdk-migration.md`
