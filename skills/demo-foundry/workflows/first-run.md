# Workflow: First Run Setup

## Goal

Initialize Demo Foundry safely inside a project.

## Default mode

Dry-run.

## Steps

1. Inspect the repo.
2. Detect framework and package manager.
3. Detect existing capture/test/video tools.
4. Create a setup plan.
5. Create prerequisite plan.
6. Create context update proposal.
7. Create workflow update proposal.
8. Wait for explicit approval before applying.

## Apply steps

After explicit approval:

1. Create `/demo` directory.
2. Write `demo/README.md`.
3. Write `demo/demo-foundry.config.yaml`.
4. Write starter policy files.
5. Optionally add demo scripts to `package.json`.
6. Optionally install prerequisites.
7. Optionally create example demo.
8. Leave project-context proposals as separate files unless explicitly asked to merge.

## Do not automatically modify

- `CLAUDE.md`
- `AGENTS.md`
- `.github/workflows/*`
- root `README.md`
- deployment scripts
- production configuration
