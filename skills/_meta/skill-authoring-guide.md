---
name: skill-authoring-guide
description: >-
  Reference for agents creating or updating skills in this repo. Covers
  frontmatter schema, versioning, directory layout, canonical section order,
  authoring principles, update workflow, and anti-patterns.
version: 1.0
app_version: "2026-04-26"
updated: 2026-04-26
---

# Skill Authoring Guide

Reference for agents writing or updating skills under `.claude/skills/`. These files are consumed by AI agents, not humans. Optimize for parseability over readability.

## 1. Frontmatter Schema

```yaml
---
name: kebab-case-name        # required — matches directory name
description: >-              # required — 1-3 sentences, action-oriented, trigger keywords first
  When to invoke this skill and what it routes or does.
version: X.Y                 # required — semver-ish (major.minor)
app_version: "YYYY-MM-DD"    # recommended — date the skill was last verified against the running app
updated: YYYY-MM-DD          # recommended — last edit date
spec: ./SPEC.md              # optional — links to a detailed spec file
---
```

Fields NOT supported: `allowed-tools`, `tools`, `model`. Skills inherit CLI capabilities; do not restrict them.

## 2. Version Tagging Convention

| Field | Bump when |
|---|---|
| `version` major | Routing table, confidence anchors, or "Do Not Say" section changes |
| `version` minor | Prose updates, recipe additions, reference link fixes |
| `app_version` | Any SKILL.md edit — set to today's date after verifying against running app or repo code |
| `updated` | Any SKILL.md edit |

Track all changes with dated entries in `CHANGELOG.md` inside the skill directory.

## 3. Directory Structure

```
skills/skill-name/
├── SKILL.md              # Main skill guide (required, <500 lines)
├── CHANGELOG.md          # Skill-local change log (required)
├── SPEC.md               # Detailed spec (optional)
├── recipes/              # Multi-step workflow guides (optional)
├── references/           # Reference docs (optional)
├── scripts/              # CLI scripts and static data (optional)
└── modes/                # Mode-specific sub-guides (optional)
```

Supporting files are loaded on demand. Name them to reveal intent: `feature-retrospective.md`, not `helpers.md`.

## 4. SKILL.md Section Order

Adhere to this order. Omit sections that genuinely do not apply; do not add placeholder headings.

| # | Section | Purpose |
|---|---|---|
| 1 | H1 + 1-3 line intro | State scope in one breath |
| 2 | When To Use | Explicit trigger intents; list form |
| 3 | When NOT To Use | Explicit exclusions; equally required |
| 4 | Confidence Anchor | Repo-verified surfaces only (commands, endpoints, tool names) |
| 5 | Routing Posture | Transport preference order (MCP > CLI > HTTP, or whatever applies) |
| 6 | Routing Table | Intent → transport mapping as a Markdown table |
| 7 | Output Guidance | Format recommendations per context (JSON, --md, narrative) |
| 8 | Multi-Step Flows (Recipes) | Links to recipe files; one line each |
| 9 | Do Not Say | Stale or wrong statements agents must not repeat |
| 10 | Key References | Absolute file paths only |

"Quick Start" or mode-dispatch tables (see `dev-execution`) may precede section 2 for skills with multiple entry points.

## 5. Authoring Principles

- **Tables over prose.** Every section earns its bytes. If a table covers it, use a table.
- **Progressive disclosure.** SKILL.md holds routing logic. Details live in linked recipe/reference files.
- **Confidence anchors over aspirational features.** Document only what is shipped and repo-verified. Do not describe planned or deferred behavior as current.
- **"Do Not Say" is mandatory.** Every skill must list at least one stale claim. If nothing is stale, it means the skill has not been maintained.
- **Absolute paths in Key References.** Relative paths break when skills are loaded from arbitrary working directories.
- **No emojis.** Plain text only.
- **AI-first audience.** Write for parseability. Agents scan tables; they do not read narrative prose.
- **Transport-neutral business logic.** Skills describe routing to surfaces (CLI, MCP, REST). The underlying query service is shared; do not duplicate its logic in the skill.
- **Env vars over hardcoded values.** When a value is configurable, document the env var and its default; do not hardcode the default as if it were fixed.

## 6. Update Workflow

1. Read `CHANGELOG.md` (app-level) for changes since `app_version` in skill frontmatter.
2. Verify each affected feature against running app or repo code — not prior plans.
3. Edit SKILL.md sections: routing table, confidence anchor, Do Not Say.
4. Update `router-table.json` if the intent-to-surface mapping changed.
5. Bump `version`, `app_version`, `updated` in frontmatter.
6. Append a dated entry to the skill's `CHANGELOG.md`.
7. Audit "Do Not Say": remove entries that are no longer stale; add new ones for anything that shipped differently than documented.

## 7. Anti-Patterns

| Anti-pattern | Correct approach |
|---|---|
| Documenting deferred features as shipped | Use "Do Not Say" to flag them; document only what's in the repo |
| Prose paragraphs where a table would do | Convert to table |
| Duplicating content from recipe files in SKILL.md | Link to the recipe; one source of truth |
| "Phase N" language for shipped features | Remove phase references once the feature is merged |
| Hardcoding configurable values | Document the env var and its default |
| Omitting "When NOT To Use" | Always include scope exclusions |
| Generic supporting file names (`helpers.md`) | Use intention-revealing names (`feature-retrospective.md`) |
| SKILL.md over 500 lines | Move details to supporting files; link them |
| Relative paths in Key References | Use absolute paths |
