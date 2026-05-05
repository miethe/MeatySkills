---
name: meatywiki
description: Drive the MeatyWiki CLI end-to-end — knowledge-compilation loop (ingest → classify → extract → compile → file-back → lint) over a file-first Obsidian-compatible markdown vault. Use when running any MeatyWiki CLI task, compiling inbox sources, querying/searching the wiki, or orchestrating the compile loop. Triggers: "meatywiki", "compile loop", "ingest into wiki", "vault", "knowledge compilation". Do NOT use for: non-MeatyWiki knowledge systems, Portal UI, SAM/CCDash (those are separate skills/projects).
schema_version: 1
skill_version: 0.1.0-draft
cli_version_range: "compilation-engine-v1 (pre-release)"
spec_ref: SPEC.md
---

# MeatyWiki Skill

## 1. Compile Loop Overview

MeatyWiki implements Karpathy's knowledge-compilation loop over a markdown vault. Sources enter via `ingest` (raw/), flow through classify → extract → compile into structured wiki/ artifacts, and are validated by `lint`. Files are canonical; SQLite + FTS5 (`_meta/meatywiki.db`) is a derived, rebuildable index. Seven engine layers (CLI → Vault → Schema → Index → LLM → Workflows → Hooks) execute as linear pipelines — no DAGs, no retry framework.

---

## 2. Decision Tree

```
TASK                                      COMMAND
─────────────────────────────────────────────────────────────────
First-time vault setup                 →  init
Add a source (URL/PDF/note/transcript) →  ingest
Process inbox (raw/ → wiki/)           →  compile --pending
Recompile specific domain              →  compile --scope <domain>
Preview compile without writing        →  compile --dry-run
Force full recompile of all sources    →  compile --full
Look up information in the wiki        →  query
Write query answer back to vault       →  query --file-back
Scope a query to a domain              →  query --scope <domain>
Cross-source synthesis / summary       →  synthesize
Fix frontmatter / schema drift         →  lint --fix
Generate a lint report                 →  lint --report
Run specific lint checks               →  lint --checks <names>
Full-text keyword search               →  search
Filter search by artifact type         →  search --type <type>
Filter search by freshness             →  search --freshness <age>
Traverse artifact relationships        →  graph
Set relationship traversal depth       →  graph --depth <n>
Export graph in specific format        →  graph --format <fmt>
Rebuild the derived SQLite index       →  index --reset
Count artifacts / freshness stats      →  stats
Health check: vault + index + config   →  doctor
Auto-ingest on file drop               →  watch
Auto-compile on file drop              →  watch --auto-compile
Lifecycle promotion (draft→compiled…)  →  promote
Force promotion past rules             →  promote --force
Start FastAPI thin wrapper             →  serve

(Register artifact with SAM           →  [deferred: F1])
```

---

## 3. Command Map

| Command | Purpose | Key flags | Reference |
|---|---|---|---|
| `init` | Initialize a new vault at the target path | — | `references/command-reference.md#init` |
| `ingest` | Ingest a source into raw/ and classify | — | `references/command-reference.md#ingest` |
| `compile` | Process raw/ artifacts through extract → compile → write wiki/ | `--pending`, `--scope`, `--dry-run`, `--full` | `references/command-reference.md#compile` |
| `query` | FTS5-backed natural-language query over the wiki | `--file-back`, `--scope` | `references/command-reference.md#query` |
| `synthesize` | Cross-source synthesis into a new wiki/ artifact | — | `references/command-reference.md#synthesize` |
| `lint` | Deterministic + semantic checks on vault artifacts | `--fix`, `--report`, `--checks` | `references/command-reference.md#lint` |
| `search` | FTS5 full-text keyword search | `--type`, `--freshness` | `references/command-reference.md#search` |
| `graph` | Traverse and render artifact relationships | `--depth`, `--format` | `references/command-reference.md#graph` |
| `index` | Manage the derived SQLite + FTS5 index | `--reset` | `references/command-reference.md#index` |
| `stats` | Vault counts by type, lifecycle, freshness | — | `references/command-reference.md#stats` |
| `doctor` | Health check: structure, index freshness, config, drift | — | `references/command-reference.md#doctor` |
| `watch` | Auto-ingest on file drop in raw/ | `--auto-compile` | `references/command-reference.md#watch` |
| `promote` | Lifecycle promotion with default rules | `--force` | `references/command-reference.md#promote` |
| `serve` | Start the FastAPI thin CLI-parity wrapper | — | `references/command-reference.md#serve` |

---

## 4. Top 5 Workflow Recipes

### Recipe 1 — Ingest a URL and auto-classify into the wiki

```bash
meatywiki ingest https://example.com/article
meatywiki compile --pending
meatywiki stats
```

### Recipe 2 — Ingest a PDF with manual classification override

```bash
meatywiki ingest ~/downloads/paper.pdf
# Review raw/ artifact; edit frontmatter artifact_type if auto-classify is wrong
meatywiki compile --pending
```

### Recipe 3 — Full compile loop end-to-end

```bash
meatywiki ingest <source>
meatywiki compile --pending
meatywiki lint --fix
meatywiki stats
```

### Recipe 4 — Query the wiki and write the answer back to a vault file

```bash
meatywiki query "What are the key patterns in distributed tracing?" --file-back
# Engine writes answer to wiki/summaries/ with schema_version: "1.0.0" frontmatter
```

### Recipe 5 — Rebuild the derived index after manual vault edits

```bash
meatywiki index --reset
meatywiki stats
meatywiki doctor
```

---

## 5. Guardrails

- **(a) All writes go through the engine.** Agents MUST invoke `meatywiki` commands rather than editing `wiki/`, `raw/`, or `_meta/` files directly; all writes pass through `vault/writer.py` which indexes in the same transaction. Direct file edits will cause vault/index drift.
- **(b) `_meta/` is engine-owned.** Never edit `_meta/meatywiki.db`, `_meta/compile_state.json`, or `_meta/config.yaml` programmatically except via CLI commands or `meatywiki config` operations. `_meta/` is gitignored.
- **(c) Query and search use FTS5 only in V1.** No `--semantic` flag exists; semantic/vector search is `[deferred: F3]`. Do not attempt `query --semantic` or any vector path.
- **(d) All V1 frontmatter must include `schema_version: "1.0.0"`.** Artifacts without this field will fail lint and will not round-trip through the index.

---

## 6. Deferred Features (do NOT invoke)

| Feature | Track | What the skill says |
|---|---|---|
| SAM `register` + live hook | F1 | no-op stub only |
| CCDash live hook | F2 | no-op stub only |
| Semantic search (`--semantic`) | F3 | FTS5 only in V1 |
| Dev-artifact connectors (SkillMeat/GitHub/Claude config) | F4 | knowledge-domain connectors only |
| Workflow OS lens scoring | F5 | not surfaced in V1 |
| Portal / web UI | F6 | not in V1 |
| Image OCR | — | images as opaque blobs + captions |
| `agent_visibility` enforcement | — | advisory metadata only |
| Prompt-template auto-recompile | — | manual `compile --full --scope` only |
| DAG workflows / retry | — | linear pipelines only |

---

## 7. References Pointer Table

| File | Load when | Max lines |
|---|---|---|
| `references/command-reference.md` | Need full flag/exit-code/example detail for a command | 800 |
| `references/workflow-patterns.md` | Need expanded recipe with setup/output/troubleshooting | 800 |
| `references/vault-layout.md` | Need to understand directory ownership or Obsidian compat | 800 |
| `references/artifact-taxonomy.md` | Need to construct or validate a specific artifact subtype | 800 |
| `references/hook-policy.md` | Working near SAM/CCDash stubs or F1/F2 boundary | 800 |
| `references/troubleshooting.md` | Compile failure, vault drift, index corruption, LLM timeout | 800 |

---

## 8. Contract Pointer

See `SPEC.md` for the coverage matrix, CLI version compatibility, and update protocol.
