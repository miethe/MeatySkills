# Workflow Scripts — Authoring Context

This directory contains SkillMeat Dynamic Workflow scripts (`.claude/workflows/*.js`).
Before editing any script here, load `Skill("workflow-authoring")` and read the master contract.

## Quick-reference: durability invariants

Detailed spec: `.claude/specs/workflows/workflow-authoring-spec.md` §16

| Rule | Detail |
|---|---|
| Resume caches results, not files | Re-running replays cached agent return values; uncommitted edits are lost after a squash-merge or session exit. Commits are the durability mechanism. |
| Implementation agents MUST commit | Every implementation/sprint/fix agent must commit each logical unit to its isolated worktree branch. Do NOT push, merge, stash, or touch other branches. |
| Reviewers/trackers NEVER commit | Edit-less agents (`task-completion-validator`, `karen`, `council-review`, etc.) and `artifact-tracker` have no write permission and must not commit. |
| Heavy executor → two-stage | A heavy top-level executor (e.g. `feature-sprint-executor`) must NOT carry `schema:` directly. Use Stage A (no schema, commits + writes report) + Stage B (cheap haiku structurer, schema). A Stage B miss never discards Stage A's committed work. |
| Write report before schema step | Completion Report (or equivalent artifact) must be on disk before the Stage B structurer runs. If Stage B fails, Opus can inspect the report manually. |
| run-in-worktree is a precondition | Opus sets up the isolated worktree branch before invoking execute-contract or execute-plan. |

## Quick-reference: four constraints

Full checklist: `.claude/specs/workflows/workflow-authoring-spec.md` §5

1. No FS/shell in script body (no `import fs`, `exec`, `readFile`, etc.)
2. Mode D phases → early return before any agents spawn
3. Reviewer agents always edit-less `agentType`
4. No `Date.now()` / `Math.random()` / argless `new Date()`

## Syntax check

```bash
node .claude/skills/workflow-authoring/syntax-check-helper.js .claude/workflows/<name>.js
```

## Master contract

`.claude/specs/workflows/workflow-authoring-spec.md`
