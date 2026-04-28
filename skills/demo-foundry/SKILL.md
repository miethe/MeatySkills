---
name: demo-foundry
description: |
  Create, maintain, and review software application demos as versioned, executable
  product artifacts. Generates repeatable screenshots, browser walkthrough videos,
  animations, voiceover scripts, captions, thumbnails, talking points, and review
  reports from scenario manifests using Playwright + Remotion + FFmpeg pipelines.
  Use when the user asks to build/refresh/review a demo, capture screenshots or a
  walkthrough video, scaffold demo infrastructure, or wire demo workflows into CI.
  Dry-run first; only writes files on explicit apply/setup/initialize requests.
version: 0.1.0
updated: 2026-04-28
spec: ./SPEC.md
---

# Demo Foundry Skill

## Purpose

Use this skill to create, maintain, and review demos for software applications in an agent-native way. A demo should be treated as a versioned, executable product artifact, not a one-off recording.

The skill helps generate:

- repeatable screenshots
- browser walkthrough videos
- animations and polished videos
- talking points
- voiceover scripts
- captions
- thumbnails
- slide-ready inserts
- social clips
- review reports
- project-context update proposals
- workflow update proposals

## Core operating rule

**Dry-run first. Apply only when explicitly instructed.**

When a project has not been initialized for Demo Foundry, first inspect the repo and produce a setup plan. Do not create, edit, install, or update project context unless the user explicitly asks to apply/setup/initialize/write/install.

Explicit apply prompts include phrases like:

- "apply it"
- "initialize this repo"
- "set it up"
- "write the files"
- "install the prerequisites"
- "update the project context"
- "modify the workflow"

Ambiguous prompts such as "what would this look like" or "plan this" are **not** permission to write files.

## What to do on first run

When invoked in a repo for the first time:

1. Identify project type:
   - web app framework
   - package manager
   - test runner
   - existing Playwright/Cypress/Selenium usage
   - existing video/storybook/docs tooling
   - existing project context files
   - existing agent instructions
   - CI provider
2. Determine safest Demo Foundry layout.
3. Generate a dry-run setup plan.
4. Identify prerequisites.
5. Identify context/workflow update recommendations.
6. Ask for explicit permission before modifying anything.

Do not directly update project context or workflows during first-run analysis. Instead, create or display a proposed update plan.

## Setup behavior when explicitly prompted

When the user explicitly asks to set up or initialize Demo Foundry:

1. Create `/demo` workspace if missing.
2. Create starter `demo-foundry.config.yaml` from template.
3. Create `/demo/demos/example-demo` only if no demos exist.
4. Add package scripts only after checking for conflicts.
5. Install or propose dependencies depending on user instruction.
6. Create `.demoignore` if missing.
7. Create `demo/policy` files from checklists.
8. Create context-update and workflow-update proposal files, but do not merge them into existing project docs unless the user explicitly requested context/workflow updates.

## Project context update policy

Project context should stay current, but updates must be controlled.

The skill may propose updates to:

- `CLAUDE.md`
- `AGENTS.md`
- `.cursorrules`
- `.github/copilot-instructions.md`
- `README.md`
- `docs/architecture.md`
- `docs/dev-workflow.md`
- `docs/demo-workflow.md`
- project-specific planning docs
- NotebookLM seed docs
- ChatGPT project instructions
- Gemini Gem instructions

The skill must not directly update these unless prompted.

When proposing project-context updates, output:

1. **Why update is needed**
2. **Files affected**
3. **Exact proposed text or patch**
4. **Risk level**
5. **Rollback note**
6. **Whether the update is required or optional**

## Workflow update policy

Workflow updates include CI, hooks, npm scripts, Makefiles, task runners, and agent workflows.

The skill may propose updates to:

- `.github/workflows/*`
- `package.json`
- `Makefile`
- `Taskfile.yml`
- `justfile`
- pre-commit hooks
- Claude Code hooks
- Codex instructions
- local agent commands

The skill must preview workflow changes before applying. Do not silently alter CI.

## Default demo architecture

Use this pipeline:

```text
scenario manifest
  -> seeded state
  -> Playwright capture
  -> raw screenshots/video/trace
  -> storyboard and narration
  -> Remotion composition
  -> rendered video/captions/thumbnails
  -> quality review
```

## Preferred tools

Use these defaults unless the project clearly suggests otherwise:

- browser capture: Playwright
- trace/debug: Playwright Trace Viewer and Chrome DevTools MCP
- video composition: Remotion
- final media operations: FFmpeg
- exploratory browser automation: Stagehand or Browserbase, optional
- narration: generated talking points first, TTS optional
- CI: generate artifacts only when deterministic and safe

## When to use Playwright directly

Use Playwright for app demos where the project owns the UI and can add stable selectors.

Requirements:

- prefer `data-testid` selectors
- seed demo data deterministically
- set viewport explicitly
- mask secrets and personal data
- capture trace on failure
- output screenshots and raw video to a stable path

## When to use Playwright MCP or Chrome DevTools MCP

Use MCP browser tooling when:

- selectors are unknown
- the agent needs to inspect runtime UI
- capture fails and needs debugging
- console/network/performance state matters
- visual state is unclear from source alone

Do not overuse MCP for stable, repeatable flows. For repeatability, convert successful exploration into code.

## When to use Remotion

Use Remotion when the user wants polished output:

- zooms
- callouts
- captions
- browser chrome frames
- animated overlays
- architecture overlays
- intro/outro
- multiple durations from the same source

Keep Remotion components reusable and simple.

## When to use generative video tools

Use generative video models only for:

- conceptual intro/outro
- abstract B-roll
- atmospheric scenes
- product vision teasers
- social media wrappers

Do not use generated video as the source of truth for product UI.

## Required outputs for a demo

At minimum:

```text
demo.yaml
storyboard.md
talking-points.md
capture.spec.ts
output/screenshots/
output/video_raw/
review-report.md
```

For polished demos:

```text
voiceover-script.md
captions.srt
output/video_final/demo-short.mp4
output/video_final/demo-standard.mp4
output/thumbnails/thumbnail.png
```

## Quality gates

Before declaring a demo complete, check:

- scenario runs successfully
- screenshots are current
- no secrets or private data visible
- claims match actual UI behavior
- capture resolution is appropriate
- timing is reasonable
- talking points match target audience
- captions exist if video has narration
- outputs are stored under the correct demo folder
- known limitations are documented

## Agent behavior

Be direct and operational.

For ambiguous requests:

- make reasonable assumptions
- state them briefly
- produce a useful artifact
- do not block unless a missing decision would cause unsafe writes

For setup requests:

- dry-run first unless explicit apply is present
- show planned file changes
- then apply if allowed

For demo generation requests:

- create the manifest first
- create or update capture script second
- generate talking points and storyboard third
- render/polish only after source capture is working

## Progressive disclosure

Start with the minimal files needed for the current project. Do not dump every possible integration into the target repo. Keep advanced integrations in `/demo/docs` or proposal files until the user asks to adopt them.

## Self-update policy

The skill may check its own local version file and propose updates when newer instructions are available in the project. It must not fetch remote code or overwrite itself without explicit user approval.

When updating itself, it should:

1. Read `VERSION`.
2. Compare against available pack version if provided.
3. Generate an update plan.
4. Preserve local customizations.
5. Apply only when explicitly instructed.
6. Record changes in `demo/DEMO_FOUNDRY_CHANGELOG.md`.

## Completion format

When done, provide:

- what was created or changed
- what was intentionally not changed
- commands to run next
- risks or manual checks
- artifact locations
