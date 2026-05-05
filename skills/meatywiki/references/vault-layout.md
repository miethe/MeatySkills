---
name: meatywiki-vault-layout
description: Annotated MeatyWiki vault directory tree — ownership rules, read/write boundaries, Obsidian compatibility.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki Vault Layout

## Overview

A MeatyWiki vault is the user's knowledge base — typically an Obsidian-compatible markdown vault. Two core invariants:

1. **Files are canonical.** The vault's markdown files are the authoritative source. The SQLite index (`_meta/meatywiki.db`) is derived and rebuildable (run `meatywiki index --reset` to regenerate from vault files).
2. **`_meta/` is engine-owned.** Only the engine writes to `_meta/meatywiki.db`, `_meta/compile_state.json`, and `_meta/config.yaml`. Users interact with config via CLI commands (`meatywiki config`), not by editing files directly. Everything outside `_meta/` is user-owned and visible in Obsidian.

---

## Annotated Directory Tree

```
<vault-root>/
├── raw/                        # [user-owned] source drop zone
│   ├── <ingest-1.md>          # User drops sources here; engine reads and classifies
│   ├── <ingest-2.pdf>
│   └── <transcript.txt>
│
├── wiki/                       # [engine-written, user-readable]
│   ├── concepts/               # Concept artifacts (theory, patterns, frameworks)
│   ├── entities/               # Entity artifacts (people, organizations, places, tools)
│   ├── topics/                 # Topic artifacts (narratives, how-tos, domain overviews)
│   ├── summaries/              # Summary artifacts (key points, executive summaries)
│   ├── syntheses/              # Synthesis artifacts (cross-source patterns, original analysis)
│   ├── evidence/               # Evidence artifacts (quotes, data, citations, references)
│   ├── glossary/               # Glossary entries and terminology
│   └── _index/                 # [engine-written index files]
│       ├── concepts-index.md
│       ├── entities-index.md
│       └── <other-index-files>
│
├── blog/                       # [user-owned output surface]
│   ├── <post-1.md>
│   └── <post-2.md>
│
├── projects/                   # [user-owned] project artifacts, notes, deliverables
│   ├── <project-1>/
│   └── <project-2>/
│
├── _meta/                      # [engine-owned — gitignored; do not edit directly]
│   ├── meatywiki.db            # SQLite + FTS5 derived index (read-only for agents)
│   ├── compile_state.json      # Engine compile state tracker (do not edit)
│   └── config.yaml             # User-editable config (prefer: meatywiki config …)
│
└── _prompts/                   # [user-managed prompt templates]
    ├── classify-prompt.txt
    ├── extract-prompt.txt
    ├── compile-prompt.txt
    └── <custom-prompts>
```

---

## Per-Directory Ownership & Read/Write Rules

| Path | Ownership | Agents may read | Agents may write directly | Read/Write Rule |
|---|---|---|---|---|
| `raw/` | User-owned | Yes | Yes (via `meatywiki ingest`) | Use `meatywiki ingest <source>` to add files. Direct writes allowed but won't trigger classification/compile; use the CLI. |
| `wiki/concepts/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` stage. Manual edits cause drift; run `meatywiki doctor` and `meatywiki index --reset` to recover. |
| `wiki/entities/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` stage. Manual edits cause drift; run `meatywiki doctor` and `meatywiki index --reset` to recover. |
| `wiki/topics/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` stage. Manual edits cause drift; run `meatywiki doctor` and `meatywiki index --reset` to recover. |
| `wiki/summaries/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` and `query --file-back` stages. Manual edits cause drift. |
| `wiki/syntheses/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `synthesize` stage. Manual edits cause drift. |
| `wiki/evidence/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` stage. Manual edits cause drift. |
| `wiki/glossary/` | Engine-written, user-readable | Yes | No | Read-only to agents. Engine writes here during `compile` stage. Manual edits cause drift. |
| `wiki/_index/` | Engine-written index | Yes | No | Read-only to agents. Index files are derived; regenerate via `meatywiki index --reset`. |
| `blog/` | User-owned output | Yes | Yes | Write freely. User surface; engine does not write here in V1. |
| `projects/` | User-owned | Yes | Yes | Write freely. User surface; engine does not write here in V1. |
| `_meta/meatywiki.db` | Engine-owned | Agents may query (read-only) | No — use CLI only | Do **not** edit directly. Represents the derived index state. Drift causes query failures. Run `meatywiki doctor` if suspected corruption. |
| `_meta/compile_state.json` | Engine-owned | Yes (informational) | No — use CLI only | Do **not** edit. Tracks compilation progress. Direct edits will be overwritten on next `compile`. |
| `_meta/config.yaml` | User-editable | Yes | Prefer `meatywiki config …` commands | User-editable but prefer CLI. Direct edits accepted but risk validation errors. Use `meatywiki config <key> <value>` for safe updates. |
| `_prompts/` | User-managed | Yes | Yes | Prompt templates. Editable by users and agents; changes take effect on next relevant compile stage (manual `compile --full --scope` only; no auto-recompile on prompt change in V1). |

---

## `_meta/` Boundary (Critical Rule)

### Why This Matters

`_meta/` holds derived state — the SQLite index and compile state — that the engine manages in a single transaction with vault file writes. Editing `_meta/` files directly breaks the invariant and causes **vault/index drift**: the files on disk and the index become inconsistent, leading to:

- Query results that don't match vault file content
- Stale frontmatter in artifacts
- `doctor` health check failures

### The Off-Limits Files

**Never edit these directly:**
- `_meta/meatywiki.db` — SQLite + FTS5 index. Query-only for agents; all index updates go through `vault/writer.py`.
- `_meta/compile_state.json` — Tracks which artifacts have been processed, which are pending, timestamps of last compile. Engine owns this completely.

**When you must edit config:**
- `_meta/config.yaml` — User-editable, but prefer the CLI: `meatywiki config <key> <value>`. If you edit directly, validate with `meatywiki doctor` afterward.

### Recovery from Drift

If drift is suspected (query fails, frontmatter looks stale, `doctor` reports inconsistencies):

```bash
# Check what's wrong
meatywiki doctor

# Rebuild the index from vault files
meatywiki index --reset

# Verify health
meatywiki stats
meatywiki doctor
```

**Why this works:** The vault IS canonical. Rebuilding the index from the vault files re-derives `_meta/meatywiki.db` and `_meta/compile_state.json`, restoring consistency.

---

## Obsidian Compatibility

MeatyWiki vaults are designed to work seamlessly as Obsidian vaults. Key considerations:

### Obsidian Configuration

**Add `_meta/` to Obsidian's exclusion list** (Settings → Files & Links → Excluded files):
- Add `./.claude/` and `./_meta/` to prevent Obsidian from indexing engine-owned state.
- Add `./.claude/` and `_meta/` to `.gitignore` if the vault is version-controlled.

**`_prompts/` is visible in Obsidian:**
- Obsidian will show the `_prompts/` directory as a normal folder.
- Users can edit prompt templates in Obsidian's editor if desired; changes take effect on next manual `compile --full --scope`.

### Frontmatter Convention

All artifacts in `wiki/` and files written by the engine carry YAML frontmatter at the top:

```markdown
---
schema_version: "1.0.0"
artifact_type: concept
title: "The Artifact Title"
created: 2026-04-14T10:30:00Z
updated: 2026-04-14T10:30:00Z
lifecycle_stage: compiled
source_references: ["raw/source-1.md"]
tags: ["domain", "pattern"]
---

# The Artifact Title

Markdown content here...
```

**Important:** Obsidian reads and preserves frontmatter transparently. Users can view and edit frontmatter in Obsidian's YAML frontmatter editor without breaking the engine. The `schema_version: "1.0.0"` field is required (per guardrail d) — artifacts without it will fail `lint` and won't round-trip through the index.

### Link and Wikilink Support

- Files use standard Markdown links: `[link text](../path/to/artifact.md)`
- Obsidian wikilinks are also supported: `[[artifact-title]]` or `[[../path/to/artifact|display text]]`
- The engine resolves links transparently during `compile` and builds the relationship graph accordingly.

### Directory Structure is Readable

Obsidian renders the full directory tree, so users see:
- `wiki/concepts/`, `wiki/entities/`, etc., as normal folders containing readable markdown files
- `raw/` as the visible inbox
- `blog/` and `projects/` as output surfaces
- `_prompts/` as an editable templates folder

---

## File Naming & Frontmatter Contract

### Naming Convention

- **Filenames are slugified from the artifact title:** "The Quick Brown Fox" → `the-quick-brown-fox.md`
- Engine handles collisions deterministically: if two artifacts slugify to the same name, the second gets a collision suffix (e.g., `the-quick-brown-fox-1.md`)
- Extensions are always `.md` (markdown)

### Frontmatter Envelope (All V1 Artifacts)

Every file written by the engine or stored in `wiki/` includes a YAML frontmatter block with at minimum:

```yaml
---
schema_version: "1.0.0"              # Required: V1 contract field
artifact_type: <one of ~40 subtypes> # Required: concept, entity, topic, summary, synthesis, etc.
title: "<human-readable title>"      # Required
created: <ISO 8601 timestamp>        # Required
updated: <ISO 8601 timestamp>        # Required (bumped on every engine write)
lifecycle_stage: <stage>             # Required: raw, classified, compiled, reviewed, published
<subtype-specific fields>            # E.g., for entity: entity_type; for topic: topic_category
---
```

Users may add custom fields (e.g., `tags`, `aliases`, custom metadata); the engine preserves them. The engine validates `schema_version: "1.0.0"` on read and write — artifacts without it will be flagged by `lint`.

---

## Related References

- **`artifact-taxonomy.md`** — All ~40 artifact subtypes, per-subtype frontmatter fields, 5-workspace organization
- **`command-reference.md`** — Commands that operate on vault paths: `ingest`, `compile`, `index`, `doctor`, `stats`
- **`hook-policy.md`** — `_meta/` hook stub behavior (SAM and CCDash no-op references only)
- **`SPEC.md`** — Full skill contract; CLI version compatibility range
