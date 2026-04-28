# Workflow: Project Context Maintenance

## Purpose

Keep agents aware that the project uses Demo Foundry.

## What to update

Potential files:

- `CLAUDE.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`
- `README.md`
- `docs/dev-workflow.md`
- `docs/demo-workflow.md`
- NotebookLM seed docs
- ChatGPT project instructions
- Gemini Gem instructions

## Required behavior

Generate proposed updates first. Do not directly modify unless prompted.

## Suggested context block

```markdown
## Demo Foundry

This project uses Demo Foundry for demo-as-code workflows. Demo scenarios live under `/demo/demos/<demo-id>`. Each demo should include `demo.yaml`, `storyboard.md`, `talking-points.md`, a capture script, and generated outputs under `output/`.

Agents should treat demos as executable artifacts. Prefer Playwright for deterministic UI capture and Remotion for polished video assembly. Project context and workflow updates must be proposed before being applied.
```

## Maintenance cadence

Propose updates when:

- new demo conventions are added
- demo scripts change
- capture tooling changes
- project architecture changes
- a demo becomes part of release/GTM workflow
