---
description: Tier 1 Feature Contract autonomous sprint — single agent end-to-end with mandatory validator review
argument-hint: "<contract-path> [--budget=<tokens>] [--scope=backend|frontend|full]"
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(pytest:*), Bash(pnpm:*), Bash(python:*)
---

# Execute Feature Contract

**You are Opus.** This command runs a Tier 1 autonomous sprint against a single Feature Contract. Your job is to dispatch the sprint, surface results, drive the validator review, and (on approval) coordinate the commit. **Do not implement, do not explore the codebase yourself, do not read the full contract body** — the executor agent owns end-to-end delivery.

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
| Working tree clean | `git status --porcelain` | Warn user; ask before proceeding |
| `prd_ref` / `plan_ref` exist | `test -f <ref>` if listed | Warn; do not block |
| Risk level | grep `risk_level:` in frontmatter | If `high` AND touches auth/payments/migrations → **stop**, surface Mode D handoff to user |
| **Large-file guard** | `wc -l` each `files_affected` entry that the contract deletes/relocates/splits/rewrites | If any such file is >~2K lines (and especially >5K) → **stop**; a single sprint agent cannot hold that source + its call-sites in context (it will blow context mid-sprint). Recommend Tier 2 promotion + decomposition per `.claude/specs/workflows/large-file-refactor-decomposition-spec.md` |

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

### 8. Update Tracking

Only after validator `APPROVED` AND user confirms commit:

```bash
git commit -m "<message>"
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
