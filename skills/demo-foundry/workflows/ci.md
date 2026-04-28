# Workflow: CI Integration

## Goal

Optionally generate and validate demo artifacts in CI.

## Default stance

Do not enable CI demo rendering automatically. Browser video generation can be slow, expensive, and brittle.

## Safer CI stages

1. Validate `demo.yaml` schema.
2. Run no-secret scan on committed outputs.
3. Run Playwright capture only for selected demos.
4. Upload artifacts only for manual or release workflows.
5. Render full videos only on release tags or manual dispatch.

## Suggested GitHub Actions shape

```yaml
name: demo-foundry
on:
  workflow_dispatch:
  pull_request:
    paths:
      - 'demo/**'

jobs:
  validate-demo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run demo:doctor
      - run: npm run demo:review
```

Apply only after explicit approval.
