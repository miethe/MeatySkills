# Demo Workspace

This directory contains Demo Foundry demo-as-code artifacts.

## Layout

```text
demo/
  demo-foundry.config.yaml
  demos/
  fixtures/
  policy/
  context-updates/
  workflow-updates/
  tools/
```

## Rules

- Use fake deterministic data.
- Keep demo scenario manifests under `demo/demos/<demo-id>/demo.yaml`.
- Keep generated outputs under the relevant demo's `output/` folder.
- Do not update project context or workflows without explicit approval.
- Review screenshots/videos for secrets before publishing.

## Common commands

```bash
node demo/tools/demo-foundry.mjs doctor
npm run demo:capture
npm run demo:review
```
