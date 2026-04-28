---
schema_version: 2
doc_type: skill_spec
skill_name: demo-foundry
skill_version: 0.1.0
status: draft
created: 2026-04-28
updated: 2026-04-28
owner: nick
source_docs:
  - .claude/skills/demo-foundry/SKILL.md
  - .claude/skills/demo-foundry/README.md
  - .claude/skills/demo-foundry/checklists/
  - .claude/skills/demo-foundry/templates/demo.yaml
related_skills: [chrome-devtools, nano-banana, sora, gemini-cli]
affects_commands: []
---

<!-- Convention reference: .claude/specs/artifact-structures/skill-spec-convention.md -->

# demo-foundry — Skill Specification

> **Reading this file**: Versioned capability contract for the `demo-foundry` skill. For invocation-time routing, see `SKILL.md` in this same directory.

---

## 1. Purpose & Scope

**Mission**: Treat application demos as versioned, executable product artifacts — generated from source-controlled scenario manifests, refreshable on every UI/product change, and reviewable for correctness and safety.

Application demos are usually built manually (screen recording, slide stitching, ad-hoc Loom walkthroughs). That approach is slow, drifts quickly, and is poorly suited to agentic workflows. Demo Foundry replaces it with a deterministic pipeline: `demo.yaml` → seeded state → Playwright capture → storyboard + narration → Remotion render → review gates.

**In scope**:

- Scaffolding Demo Foundry into a repo (dry-run plan + explicit-apply setup)
- Authoring `demo.yaml` scenario manifests (story, audience, flows, outputs, review)
- Deterministic browser capture via Playwright (screenshots, raw video, traces)
- Polished video composition via Remotion + FFmpeg (callouts, captions, browser chrome, intro/outro)
- Narrative artifacts: talking points, voiceover scripts, captions (SRT), short/standard/deep variants
- Review/quality gates: correctness, freshness, secret-safety, claim accuracy, audience fit
- Proposing project-context updates (CLAUDE.md, AGENTS.md, README, dev/demo workflow docs) without silently writing them
- Proposing workflow updates (npm scripts, CI, hooks) with previews

**Out of scope**:

- General-purpose AI video generation → use `sora` skill for Sora 2 outputs or `nano-banana` for image generation
- Human storytelling judgment / brand strategy
- Video editing UX (Demo Foundry is a code-driven pipeline, not an NLE)
- Silent modification of project context or CI — all such changes are proposals until explicit apply
- Product QA — Demo Foundry verifies demo correctness, not product correctness
- Generic browser automation outside the demo lifecycle → use `chrome-devtools` skill

---

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|--------|-------------------|---------------|
| Initialize Demo Foundry in a repo (dry-run) | `agents/demo-bootstrapper.md`; SKILL.md §"What to do on first run" | `.claude/skills/demo-foundry/README.md` |
| Apply Demo Foundry setup (write files) | `agents/demo-bootstrapper.md`; SKILL.md §"Setup behavior when explicitly prompted" | `.claude/skills/demo-foundry/README.md` |
| Author a demo manifest | `templates/demo.yaml`; SKILL.md §"Required outputs for a demo" | `.claude/skills/demo-foundry/templates/demo.yaml` |
| Define demo story / thesis / audience | `agents/demo-strategist.md` | — |
| Build deterministic browser capture | `agents/demo-flow-engineer.md`; SKILL.md §"When to use Playwright directly" | — |
| Exploratory capture / selector discovery | SKILL.md §"When to use Playwright MCP or Chrome DevTools MCP" | — |
| Compose polished video (callouts, captions, chrome) | `agents/demo-visual-director.md`; SKILL.md §"When to use Remotion" | — |
| Author talking points / voiceover / captions | `agents/demo-narrator.md` | — |
| Review demo for correctness, safety, audience fit | `agents/demo-reviewer.md`; SKILL.md §"Quality gates"; `checklists/` | — |
| Propose project-context updates | `agents/demo-context-curator.md`; SKILL.md §"Project context update policy" | — |
| Propose workflow / CI / package script updates | `agents/demo-context-curator.md`; SKILL.md §"Workflow update policy" | — |
| Use generative video for intros/B-roll | SKILL.md §"When to use generative video tools" | — |
| Update Demo Foundry itself | SKILL.md §"Self-update policy"; `VERSION`; `CHANGELOG.md` | — |

> Most intents have no canonical user/dev doc yet — Demo Foundry currently lives entirely under `.claude/skills/demo-foundry/`. See backlog **[BL-1]** for adding a top-level user guide under `docs/user/guides/`.

---

## 3. Invariants & Constraints

1. **Dry-run by default**: Without an explicit apply phrase ("apply it", "initialize this repo", "set it up", "write the files", "install the prerequisites", "update the project context", "modify the workflow"), the skill must not create, edit, install, or modify any project files. Ambiguous prompts ("what would this look like", "plan this") never authorize writes.

2. **Project-context files are proposal-only**: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, `README.md`, `docs/architecture.md`, `docs/dev-workflow.md`, `docs/demo-workflow.md`, NotebookLM seed docs, ChatGPT/Gemini Gem instructions must never be modified directly. The skill emits proposals into `demo/context-updates/` and waits for explicit user approval.

3. **CI/workflow files require preview**: `.github/workflows/*`, `package.json` scripts, `Makefile`, `Taskfile.yml`, `justfile`, pre-commit hooks, and Claude Code hooks must be previewed before any apply step. Silent CI alteration is forbidden.

4. **No secrets, no production data in demo capture**: Tokens, API keys, production credentials, customer data, private messages, real user information, sensitive infrastructure data, and internal-only content must never appear in screenshots, video, or trace artifacts. Default to seeded fake data.

5. **Playwright capture must be deterministic**: Capture scripts use `data-testid` selectors where possible, set viewport explicitly, seed demo data, mask secrets, and capture trace on failure. Non-deterministic flows are rejected as quality-gate failures.

6. **Generative video is not source of truth**: Generated video (Sora, Veo, Runway, etc.) may only be used for intro/outro, B-roll, atmospheric scenes, or social wrappers — never as a stand-in for actual product UI.

7. **Self-update never overwrites silently**: The skill may compare `VERSION` against an available pack version and propose an update plan, but must preserve local customizations and apply only on explicit instruction. Changes are recorded in `demo/DEMO_FOUNDRY_CHANGELOG.md`.

8. **Progressive disclosure**: First-run scaffolding writes only the minimal files needed for the current project. Advanced integrations stay in `/demo/docs` or proposal files until the user explicitly adopts them.

---

## 4. Enhancement Backlog

- **[BL-1] User-facing docs at `docs/user/guides/demo-foundry/`**: Promote SKILL.md narrative content into a canonical user/dev doc so the Capability Coverage table can reference stable doc anchors.
  _Status_: candidate
  _Rationale_: Demo Foundry is currently self-contained under `.claude/skills/`. Long-term agent routing benefits from canonical docs outside the skill directory.

- **[BL-2] CI freshness scoring**: Score demo freshness against the current `HEAD` (last capture commit, drift since, broken selectors) and surface in `demo:doctor`.
  _Status_: deferred
  _Rationale_: Listed as a future module in §14 of the prior SPEC. Requires telemetry plumbing; defer until at least one repo runs Demo Foundry continuously.

- **[BL-3] Demo catalog/search**: Index demos across multiple projects with a query surface (audience, feature, last-updated).
  _Status_: deferred
  _Rationale_: Useful only after multiple demos exist in production.

- **[BL-4] SkillMeat artifact registration**: Register Demo Foundry demos as SkillMeat artifacts so they participate in collection deployment, version history, and federation sync.
  _Status_: candidate
  _Rationale_: Natural fit for SkillMeat's collection model; requires a new artifact type tier.

- **[BL-5] CCDash telemetry ingestion**: Stream capture/render/review events to CCDash for retrospectives and feature forensics.
  _Status_: deferred
  _Rationale_: Depends on stable demo lifecycle events; revisit after first production demo lands.

- **[BL-6] External demo-platform exports**: Arcade, Navattic, Supademo, Synthesia/HeyGen narration, Veo/Runway B-roll.
  _Status_: candidate
  _Rationale_: Each export is independent; prioritize based on user demand.

- **[BL-7] NotebookLM source-packet export**: Bundle scenario manifest + screenshots + transcript into a NotebookLM-ready source pack for source-grounded Q&A.
  _Status_: candidate
  _Rationale_: Pairs well with the SkillMeat NotebookLM workflow.

- **[BL-8] Define demo lifecycle events for `meatycapture-capture` integration**: Emit standardized events when demos drift, capture fails, or review gates trip.
  _Status_: candidate
  _Rationale_: Lets agents triage demo regressions like any other bug.

---

## 5. Changelog

### v0.1.0 — 2026-04-28
- Initial SPEC.md drafted under the v2 skill-spec convention
- Capability Coverage matrix: 13 intents across 7 agent files + SKILL.md sections
- 8 invariants codified from prior SPEC + SKILL policy
- 8 backlog items captured (1 carried forward from §14 "Extensibility" of the legacy spec, 7 new)
- Status: draft (will promote to stable after first end-to-end demo run validates the matrix)

---

## 6. Integration Points

| Agent / Command | Invocation Pattern | Notes |
|-----------------|--------------------|-------|
| `demo-bootstrapper` | direct prompt or `Skill("demo-foundry")` then bootstrapper agent | First-run scaffolding; respects dry-run invariant |
| `demo-strategist` | direct prompt | Story/thesis/audience |
| `demo-flow-engineer` | direct prompt | Authors Playwright capture specs |
| `demo-visual-director` | direct prompt | Plans Remotion compositions |
| `demo-narrator` | direct prompt | Talking points, scripts, captions |
| `demo-reviewer` | direct prompt | Read-only review against §9 gates |
| `demo-context-curator` | direct prompt | Proposes (never writes) context/workflow updates |
| `Skill("chrome-devtools")` | co-loaded for exploratory capture | When selectors are unstable or runtime inspection is needed |
| `Skill("sora")` | co-loaded for generated video | Intro/outro/B-roll only — never product UI |
| `Skill("nano-banana")` / `nano-banana-pro` | co-loaded for stills | Thumbnails, abstract visuals, social wrappers |
| `Skill("gemini-cli")` | co-loaded for SVG/animation | Architecture overlays, callout SVGs |

**Co-loaded with**: `chrome-devtools` (capture debugging), `meatycapture-capture` (demo regressions as bugs).

---

## 7. Success Signals

- First-run analysis returns a complete dry-run plan (file list, prerequisites, context-update proposals) without writing anything to disk.
- Apply mode only fires on explicit phrases listed in SKILL.md §"Core operating rule"; the agent does not interpret "plan this" or "what would this look like" as authorization.
- Generated `capture.spec.ts` runs cleanly on the first attempt against a freshly-seeded environment, with `data-testid` selectors and explicit viewport.
- Review reports flag missing captions, claim mismatches, secret leaks, and stale screenshots before the user has to look at the video.
- Talking points / voiceover scripts match scene timing within ±10% on standard variants.
- No secrets, real user data, or production credentials appear in any committed demo artifact.
- When Demo Foundry's own `VERSION` lags an available pack, the skill surfaces an update plan rather than silently overwriting local customizations.
