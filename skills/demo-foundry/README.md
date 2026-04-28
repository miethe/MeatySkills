# Demo Foundry Skill Pack

Demo Foundry is a reusable agentic skill pack for creating demos of applications as durable project artifacts. It treats product demos like code: versioned, repeatable, reviewable, regenerable, and safe to run from agents such as Claude Code, Codex, Gemini, ChatGPT, or equivalent project-aware assistants.

The default pattern is:

```text
demo manifest -> seeded app state -> deterministic capture -> storyboard -> narration -> rendered assets -> review gates
```

The pack includes skill instructions, agents, workflow docs, templates, config examples, setup scripts, and a lightweight CLI scaffold.

## What this skill creates

A project can receive a `/demo` workspace containing:

```text
demo/
  README.md
  demo-foundry.config.yaml
  demos/
    <demo-id>/
      demo.yaml
      storyboard.md
      talking-points.md
      voiceover-script.md
      capture.spec.ts
      output/
        screenshots/
        video_raw/
        video_final/
        captions/
        thumbnails/
  components/
  fixtures/
  policy/
```

## Design principles

1. **Truthful UI capture first.** Real app screenshots and browser videos are the source of truth.
2. **Generated polish second.** AI video, avatar, or cinematic tools are wrappers, not evidence.
3. **Dry-run by default.** Setup scripts and agent workflows should preview changes before modifying a repo.
4. **Context updates require explicit approval.** Agents should propose project-context and workflow updates, but must not commit them unless prompted.
5. **Demos are testable.** A demo should fail clearly when selectors break, seeded data is missing, secrets leak, or claims drift.
6. **Multiple outputs from one scenario.** One scenario can generate screenshots, GIFs, MP4s, talking points, captions, slides, and GTM snippets.

## Quick start

From a target app repo:

```bash
# 1. Unzip or clone this skill pack somewhere local.
cd demo-foundry-skill-pack

# 2. Preview the project setup. This does not modify the target repo.
node bin/demo-foundry.mjs init --project /path/to/your-app

# 3. Apply setup after review.
node bin/demo-foundry.mjs init --project /path/to/your-app --apply

# 4. Install suggested prerequisites after reviewing the generated plan.
bash scripts/install-prereqs.sh /path/to/your-app --apply

# 5. Create a starter demo.
node bin/demo-foundry.mjs create --project /path/to/your-app --id first-demo --title "First Product Walkthrough" --apply
```

## Agent usage

Paste or reference `SKILL.md` in your agent environment. For Claude Code, place the pack in a skill directory or reference it as a project skill. For Codex or other coding agents, use `SKILL.md` plus the `agents/` and `workflows/` files as project instructions.

Useful prompts:

```text
Use the Demo Foundry skill. Initialize this repo for demo-as-code. Dry-run first and show the file changes before applying.
```

```text
Use Demo Foundry to create a 3-minute technical demo for the current feature branch. Generate the manifest, Playwright capture plan, talking points, and review checklist, but do not update project context until I approve.
```

```text
Use Demo Foundry to refresh the screenshots and talking points for demo id agentic-os-overview. Run review gates and summarize failures.
```

## Files included

- `SKILL.md` — primary skill instructions.
- `SPEC.md` — design spec and operating model.
- `agents/` — role-specific agent prompts.
- `workflows/` — operational procedures.
- `templates/` — demo manifests, scripts, Playwright, Remotion, and policy templates.
- `scripts/` — setup and prerequisite helpers.
- `bin/demo-foundry.mjs` — lightweight CLI for init/create/doctor/review scaffolding.
- `checklists/` — quality gates.
- `examples/` — example demo scenario.

## Safety model

The pack is intentionally conservative:

- default mode: **read and propose**
- modification mode: only with `--apply` or explicit user instruction
- project-context updates: generate update plans, but do not write them unless explicitly prompted
- workflow updates: propose diffs; do not silently modify CI or agent instructions
- secret handling: denylist checks plus user review

## Recommended stack

Minimum:

- Node.js 20+
- Playwright
- TypeScript
- FFmpeg, optional but recommended

Polished video:

- Remotion
- FFmpeg
- optional TTS provider

Agentic browser/debug:

- Playwright CLI or Playwright MCP
- Chrome DevTools MCP
- Stagehand/Browserbase for exploratory or external flows

## Version

See `VERSION` and `CHANGELOG.md`.
