# Proposed Project Context Update

## Why this update is proposed

Demo Foundry has been added or changed, and future agents should understand how to create and maintain demos in this project.

## Files affected

- `CLAUDE.md` or equivalent agent instructions
- `AGENTS.md` if present
- `docs/demo-workflow.md` if present or desired

## Proposed text

```markdown
## Demo Foundry

This project uses Demo Foundry for demo-as-code workflows. Demo scenarios live under `/demo/demos/<demo-id>`. Each demo should include `demo.yaml`, `storyboard.md`, `talking-points.md`, a deterministic capture script, and generated outputs under `output/`.

Agents should use Playwright for truthful browser capture and Remotion/FFmpeg for polished video generation when requested. Generated video models may be used for conceptual B-roll or wrappers, but not as the source of truth for product UI.

Project context and workflow updates must be proposed before being applied.
```

## Risk level

Low if added as a new section. Medium if merging into existing agent instructions.

## Apply instructions

Apply only after explicit approval.

## Rollback

Remove the added Demo Foundry section.
