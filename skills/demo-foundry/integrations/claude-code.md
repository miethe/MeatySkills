# Integration: Claude Code

## Recommended usage

Reference `SKILL.md` and the relevant agent file.

Prompts:

```text
Use the Demo Foundry skill to inspect this repo and produce a dry-run setup plan. Do not modify files yet.
```

```text
Apply the Demo Foundry setup plan. Create the /demo workspace and starter files, but do not update CLAUDE.md or workflows unless you show me the patch first.
```

## Suggested Claude Code workflow

1. Use Demo Bootstrapper for setup.
2. Use Demo Strategist to produce the manifest.
3. Use Demo Flow Engineer to write Playwright capture.
4. Use Demo Narrator for talking points.
5. Use Demo Reviewer before publishing.

## Hooks

Agent hooks can be useful for review but should be adopted cautiously. Prefer explicit commands until the workflow is stable.
