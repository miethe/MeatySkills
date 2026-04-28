# Proposed Workflow Update

## Why this update is proposed

Demo Foundry can be more useful when project scripts expose common demo actions.

## Proposed package scripts

```json
{
  "demo:doctor": "node demo/tools/demo-foundry.mjs doctor",
  "demo:create": "node demo/tools/demo-foundry.mjs create",
  "demo:capture": "playwright test demo/demos/**/*.spec.ts",
  "demo:review": "node demo/tools/demo-foundry.mjs review"
}
```

## Optional polished video scripts

```json
{
  "demo:render": "remotion render",
  "demo:render:preview": "remotion preview"
}
```

## CI recommendation

Do not enable full rendering in CI by default. Start with schema/review checks. Add capture/render only to manual workflows or release workflows.

## Apply instructions

Apply only after explicit approval.

## Rollback

Remove the added scripts or workflow file.
