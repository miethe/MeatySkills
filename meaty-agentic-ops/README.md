# meaty-agentic-ops

A curated, self-contained bundle of the **agentic planning & execution operating system** — the
skills, commands, specs, rules, and roster that turn a human request into a typed, reviewable,
resumable artifact graph (exploration → tier classification → contract/PRD/plan → execution →
review gates → progress + evidence).

This bundle is distilled from SkillMeat's day-to-day agentic SDLC. The mental model:

```text
Human intent
  -> exploration & tier classification
  -> contract / PRD / plan / wave graph
  -> delegated agents
  -> reviewer gates & bounded fix loops
  -> progress YAML + evidence
  -> reusable artifacts
```

## What's here

| Path | Contents |
|------|----------|
| `skills/` | The core control-loop skills: `planning`, `dev-execution`, `artifact-tracking`, `workflow-authoring`. |
| `commands/` | Human-operable entrypoints — `plan/` (explore, spike, plan-feature), `dev/` (autopilot, execute-contract, execute-plan, execute-phase, quick-feature), `review/code-review`, and `mc`. |
| `specs/workflows/` | Workflow authoring contract, per-workflow specs, the workflow registry, and the `ExecutionGraph` / `ExecutionReport` JSON schemas. |
| `rules/delegation-modes.md` | The five delegation modes (A–E) that calibrate agent autonomy and safety boundaries. |
| `context/agent-roster.md` | The staffing model: orchestration, exploration, planning, implementation, review, and documentation layers. |

The **three-skill core** is `planning -> dev-execution -> artifact-tracking`: planning produces the
decision packet, dev-execution delegates the work, artifact-tracking preserves state and evidence.
`workflow-authoring` governs how the executable workflow graphs are written.

## How to use it

1. Copy the `skills/` and `commands/` directories into your agent environment (e.g. `.claude/skills/`
   and `.claude/commands/`). Keep directory names stable so internal references resolve.
2. Invoke a command file as the user-facing entrypoint, or load a skill directly for the lower-level
   workflow.
3. Reuse the templates, schemas, and references when you want structured artifacts instead of ad hoc
   markdown.

These follow Claude Code's command/skill layout because it is compact and easy to wire into agent
tooling, but the patterns are platform-agnostic: any system that supports prompt files, task routing,
structured artifacts, and small automation scripts can adapt them.

## Notes

- The executable workflow `.js` engine, the model/provider delegation router, and the per-provider
  executor agents are environment-specific and are not part of this public bundle. The workflow
  *specs* under `specs/workflows/` document their shape and contract.
- Some skills reference companion tooling (SkillMeat, CCDash). Those references are optional; the
  planning/execution methodology stands on its own.
