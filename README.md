# BoxBoat's Agentic Artifacts Library

This is BoxBoat's portable library of agent workflow assets: command prompts, reusable skills, markdown artifact formats, schemas, and helper scripts for planning, execution, debugging, recovery, and project intelligence. This is to be considered the upstream source for all custom artifacts from BoxBoat, which are in-turn managed in the Team's SkillMeat Collection.

The repository follows the Claude Code command and skill layout because that format is compact, readable, and easy to wire into agent tooling. The assets are not Claude-specific in principle. Most of the patterns here can be adapted to other agentic platforms that support prompt files, task routing, structured artifacts, and small automation scripts.

Notably, these are fully custom agentic artifacts. This is NOT yet another "awesome repo" of collected artifacts. Also note, some of these are specific to our other agentic projects, ie [CCDash](https://github.com/miethe/ccdash) and [SkillMeat](https://skillmeat-docs.pages.dev/), and require those tools to be installed for functionality.

## What Is In This Repo

This repo is organized around three layers:

- `commands/`: entrypoint prompts for common operator workflows such as planning, development execution, debugging, analysis, and artifact maintenance
- `skills/`: reusable capability packs with progressive-disclosure instructions, references, templates, and scripts
- `artifact files`: markdown-plus-frontmatter specs, JSON/YAML schemas, and utilities that make planning and execution state queryable by agents

Representative capabilities include:

- phased development orchestration with slim command wrappers and deeper skill references
- token-efficient artifact tracking for PRDs, plans, progress docs, bug fixes, and reports
- request logging and quick capture workflows
- project-context distillation for downstream research agents
- interrupted-session recovery and resumable handoffs
- CCDash-oriented operational analysis
- README and documentation maintenance workflows

## Repository Structure

```text
.
├── commands/
│   ├── analyze/
│   ├── artifacts/
│   ├── dev/
│   └── planning/
└── skills/
    ├── artifact-tracking/
    ├── ccdash/
    ├── debugging/
    ├── dev-execution/
    ├── managing-readmes/
    ├── meatycapture-capture/
    ├── notebooklm-sync/
    ├── plan-status/
    ├── planning/
    ├── project-context-distiller/
    └── recovering-sessions/
```

## How To Use It

The intended usage model is simple:

1. Mount or copy the command and skill directories into your agent environment.
2. Keep the directory names stable so internal references continue to resolve.
3. Invoke a command file as the user-facing entrypoint, or load a skill directly when you want the lower-level workflow.
4. Reuse the included templates, schemas, and scripts when you want structured artifacts instead of ad hoc markdown.

If you are using Claude Code-style conventions, the mapping is direct:

- `commands/*.md` act as slash-command definitions
- `skills/*/SKILL.md` act as skill entrypoints
- adjacent `references/`, `templates/`, `scripts/`, and `schemas/` provide the deeper implementation details

If you are using another agent framework, treat this repo as a source library:

- prompts and workflows can be rehosted as tool instructions or system prompts
- schemas can validate agent-authored planning and progress artifacts
- scripts can be called from your own orchestration layer
- frontmatter-based docs can serve as portable handoff artifacts across models and runtimes

## Core Workflow Areas

### Planning

The planning assets generate AI-oriented PRDs, implementation plans, quick-feature plans, and spikes. They emphasize progressive disclosure, bounded file sizes, and subagent-aware execution planning.

Start with:

- `commands/planning/plan-feature.md`
- `commands/planning/quick-feature.md`
- `commands/planning/spike.md`
- `skills/planning/SKILL.md`

### Development Execution

The development layer turns plans into execution workflows. The command files stay thin, while `skills/dev-execution/` holds mode-specific guidance for phase execution, quick tasks, story completion, and scaffolding.

Start with:

- `commands/dev/execute-phase.md`
- `commands/dev/quick-feature.md`
- `skills/dev-execution/SKILL.md`

### Debugging And Recovery

The debugging skill provides severity-gated remediation flows. The recovery skill helps reconstruct interrupted agent sessions and generate resumable next steps.

Start with:

- `commands/dev/debug.md`
- `skills/debugging/SKILL.md`
- `skills/recovering-sessions/SKILL.md`

### Artifact Management

This repo includes a structured artifact system for plans, progress, observations, context docs, bug-fix logs, design specs, reports, and related metadata. The design goal is agent-readable state with low token overhead and scriptable updates.

Start with:

- `skills/artifact-tracking/SKILL.md`
- `skills/artifact-tracking/schemas/README.md`
- `commands/artifacts/README.md`

## Why The Artifact Format Matters

Most agent workflows degrade when state is trapped in long chat histories. This repo pushes important context into files that agents can read, validate, update, and hand off:

- YAML frontmatter carries structured status and traceability
- markdown bodies remain readable for humans
- schemas keep the format stable
- CLI helpers make common updates cheap enough to use constantly

That combination makes the artifacts useful both inside Claude Code-style sessions and inside other orchestration stacks that need durable project memory.

## Portability Notes

These assets were custom-developed for a personal workflow, but the patterns are intentionally general:

- command wrappers can be adapted into prompt registries or slash-command systems
- skills map cleanly to modular capability packs in other agents
- file-based artifacts work across models, vendors, and local automation
- the scripts are small enough to lift into another repo or invoke from CI

What is platform-specific is mostly the wiring layer, not the workflow design.

## Contributing And Customizing

This repository is best treated as a working toolkit:

- adjust prompts to fit your own agent-routing model
- extend schemas when you need additional metadata
- add scripts when a repeated manual artifact update becomes mechanical
- keep command files thin and move durable detail into skills or references

When adding new material, prefer the existing pattern:

- `SKILL.md` as the entrypoint
- supporting docs in `references/`, `workflows/`, or `modes/`
- reusable content in `templates/`
- automation in `scripts/`
- validation rules in `schemas/`

## Suggested Starting Points

If you are exploring the repo for the first time, read these in order:

1. `skills/planning/README.md`
2. `skills/dev-execution/README.md`
3. `skills/artifact-tracking/SKILL.md`
4. `commands/artifacts/README.md`
5. `skills/project-context-distiller/SKILL.md`

## Status

This is a workflow asset repository, not a packaged application. There is no single install command or runtime entrypoint at the root. The value is in the prompts, structures, and automation pieces you can compose into your own agent environment.
