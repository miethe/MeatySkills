# Context Update Guard

Use this guard when an agent wants to update project context.

## Required confirmation phrase

The user must explicitly request one of:

- update project context
- apply the context update
- merge the proposed context update
- write the agent instructions update

## Without confirmation

Create only proposal files under:

```text
demo/context-updates/
```

## With confirmation

Apply the smallest possible patch and summarize:

- file modified
- section added or changed
- rollback instructions
