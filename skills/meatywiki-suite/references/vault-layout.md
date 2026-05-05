---
name: meatywiki-suite-vault-layout
description: Vault directory structure, ownership rules, Obsidian compatibility
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Vault Layout Reference

## Directory Tree

```
vault-root/
├── raw/                    # Ingested content (pre-compilation)
├── wiki/                   # Compiled knowledge artifacts
│   ├── concepts/           # Concept definitions
│   ├── entities/           # Named entities (people, orgs, tools)
│   ├── topics/             # Topic overviews
│   ├── summaries/          # Content summaries
│   ├── syntheses/          # Cross-artifact syntheses
│   ├── evidence/           # Evidence/citation artifacts
│   ├── glossary/           # Glossary entries
│   └── _index/             # Auto-generated index artifacts
├── blog/                   # Blog workspace
│   ├── drafts/
│   ├── published/
│   └── archived/
├── projects/               # Project-scoped artifacts
├── _meta/                  # ENGINE-OWNED (gitignored)
│   ├── meatywiki.db        # SQLite + FTS5 index
│   ├── compile_state.json  # Compilation state tracker
│   └── config.yaml         # Engine configuration
└── _prompts/               # Vault-local prompt overrides
    └── {prompt_name}.md    # Override for engine prompt templates
```

## Ownership Rules

| Directory | Owner | Notes |
|-----------|-------|-------|
| `raw/` | User-owned, engine-written | Ingest output lands here |
| `wiki/` | User-owned, engine-written | Compiled artifacts |
| `blog/` | User-owned, engine-written | Blog workspace |
| `projects/` | User-owned, engine-written | Project-scoped artifacts |
| `_meta/` | Engine-owned, gitignored | Never manually edit |
| `_prompts/` | User-authored, engine-read-only | Prompt template overrides |

All vault writes go through `vault/writer.py`, which updates the SQLite index in the same transaction. Bypassing `writer.py` (direct file I/O) causes index drift. Use `meatywiki index --reset` to recover.

## Write Path Invariant

```
caller → vault/writer.py → atomic file write + index upsert
```

Portal modules must route through `EngineAdapter`. Direct `open()` / `shutil` / `os.remove` on vault paths from Portal code is blocked by Ruff rule `PORTAL-001`.

## Obsidian Compatibility

- Standard markdown with YAML frontmatter — valid Obsidian vault structure.
- Wikilinks (`[[artifact-title]]`) are supported in graph edge fields.
- `_meta/` should be excluded from Obsidian indexing via `.obsidianignore` or `.gitignore`.
- Vault root is a valid Obsidian vault directory; no special Obsidian config required.

## File Naming

- Kebab-case, `.md` extension.
- Engine generates filenames from the artifact title during compilation (e.g., `my-concept-name.md`).
- User-authored files in `raw/` may use any name; the engine normalizes on ingest.

## Prompt Overrides (`_prompts/`)

- Place a file at `_prompts/{prompt_name}.md` to override a built-in engine prompt.
- Engine resolves vault-local overrides before package defaults in `src/meatywiki/llm/prompts/`.
- Overrides use `string.Template.safe_substitute` — use `$variable` syntax.
- Watcher/index rebuilds ignore `_prompts/`; prompt-template changes do not auto-recompile existing artifacts.

## `_meta/config.yaml` Key Fields

```yaml
vault_root: /path/to/vault         # resolved at startup
llm:
  classify: haiku                  # model for classify stage
  extract: sonnet                  # model for extract stage
  compile: opus                    # model for compile/query stage
  lint: sonnet                     # model for lint stage
agent_mode:                        # opt-in per purpose
  compile: false
  query: false
```

Model selection is frozen after config load. Stage-level agent configuration is available but practical value is in compile/query stages only. Providers must declare `capabilities.agent_mode: native` to use `AgentRuntime`; others fall back to sync chat without the agent system prompt.
