# MeatyWiki Suite Skill

Human maintenance guide. The other files in this directory are written for AI agents. This one is for you.

## What This Is

A comprehensive skill enabling AI agents to use the full MeatyWiki application suite — compilation engine CLI, Portal REST API, and MCP server — for knowledge management tasks. Agents can ingest content, compile artifacts, query knowledge, manage workflows, and maintain vault health on behalf of users.

## Relationship to `meatywiki` Skill

The existing `.claude/skills/meatywiki/` skill covers the engine CLI only (V1 commands, vault operations). This `meatywiki-suite` skill is a superset covering:

- Everything in the engine-only skill
- Portal REST API (75+ endpoints)
- MCP server (agent SDK integration)
- Cross-surface workflows
- Deployment for agentic usage

The engine-only skill remains valid for engine-only contexts. Use `meatywiki-suite` when a task involves Portal endpoints, MCP tools, or cross-surface recipes.

## Skill Structure

```
meatywiki-suite/
├── SKILL.md                          # Entry point (agent reads first)
├── SPEC.md                           # Durable contract (coverage matrix, invariants)
├── README.md                         # This file (human maintenance guide)
├── references/
│   ├── cli-reference.md              # CLI command reference
│   ├── portal-api-reference.md       # Portal REST API reference
│   ├── mcp-reference.md              # MCP server tools
│   ├── vault-layout.md               # Vault directory structure
│   ├── artifact-taxonomy.md          # Artifact types and workspaces
│   ├── workflow-patterns.md          # Multi-step recipes
│   ├── deployment-guide.md           # Agentic deployment setup
│   └── troubleshooting.md            # Error diagnosis
└── scripts/                          # (reserved for future helper scripts)
```

## How Agents Use This Skill

1. `SKILL.md` is loaded when the skill triggers — matching natural language requests against the description keywords.
2. The agent reads the surface selector (SKILL.md §2) to choose CLI vs. Portal API vs. MCP.
3. The agent follows the appropriate recipe or loads a reference file for detail.
4. Reference files are loaded on-demand (progressive disclosure); agents do not pre-load all of them.

## Version Pinning

| Field | Value |
|-------|-------|
| Package pin | `meatywiki==2.0.0` (Portal v2 line) |
| CLI range | `compilation-engine-v1 – v1.2` |
| Portal line | Portal v2 (active umbrella) |

When the app version changes, update these in order:

1. `SKILL.md` frontmatter `app_version_pin`
2. `SPEC.md` frontmatter `aligned_app_version`
3. Affected reference file `cli_version_range` fields
4. `SPEC.md` coverage matrix if capabilities changed

## Maintenance Cheat Sheet

| Change type | Files to update |
|-------------|-----------------|
| New CLI command | `references/cli-reference.md`, SPEC.md coverage matrix |
| New API endpoint | `references/portal-api-reference.md`, SPEC.md coverage matrix |
| New MCP tool | `references/mcp-reference.md`, SPEC.md coverage matrix |
| New recipe / workflow | `references/workflow-patterns.md` |
| Vault layout change | `references/vault-layout.md` |
| New artifact type | `references/artifact-taxonomy.md` |
| Breaking change | Bump SKILL.md `skill_version` MAJOR, full coverage matrix audit |
| Agent misbehavior | Check guardrails in SKILL.md §5; add a guardrail if missing |
| Deployment change | `references/deployment-guide.md` |
| New error pattern | `references/troubleshooting.md` |

## Design Principles

1. **Progressive disclosure** — SKILL.md stays under 500 lines; details live in `references/`.
2. **Agent-first** — all files except this README are written for agents, not humans.
3. **Table-driven** — prefer tables over prose for agent scanability.
4. **Version-aware** — per-file `cli_version_range` fields enable targeted updates without auditing the whole skill.
5. **No scripts** — direct CLI/API invocation is preferred over wrapper scripts (follows OQ-1 precedent from the engine-only skill).

## Invariants (do not break these)

These match the runtime invariants enforced in code. The skill must never guide an agent to violate them:

- **Write-through-engine**: all vault mutations must go through `EngineAdapter`. The skill must never suggest direct file writes into vault paths from Portal context.
- **Exact engine pin**: Portal requires an exact `meatywiki` version pin, not a range. The skill reflects the pinned version.
- **Local-only by default**: the skill must not suggest binding the Portal service to non-loopback addresses unless `PORTAL_ALLOW_NETWORK=1` is set explicitly.
- **Bearer auth**: all non-health routes require `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN`. The skill's API recipes include this header.

## Relationship to Other Docs

| Doc | Role |
|-----|------|
| `src/meatywiki/CLAUDE.md` | Engine package conventions (authoritative for CLI layer) |
| `src/meatywiki/portal/CLAUDE.md` | Portal package conventions (authoritative for API layer) |
| `docs/architecture/app-entity-schema.md` | Schema source of truth |
| `.claude/skills/meatywiki/` | Engine-only predecessor skill |
| `docs/project_plans/llm_wiki/portal/PRDs/portal-v2.md` | Active Portal v2 PRD |
