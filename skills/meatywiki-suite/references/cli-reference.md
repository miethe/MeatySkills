---
name: meatywiki-suite-cli-reference
description: Complete CLI reference for all MeatyWiki commands — engine core + portal subcommands
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2, portal-v2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# MeatyWiki CLI Reference

Entrypoint: `meatywiki` (maps to `meatywiki.cli:main`).
Vault resolution order: `--vault` flag > `MEATYWIKI_VAULT_ROOT` env > cwd.
Vault is valid only when `_meta/config.yaml` exists at the resolved root.

---

## Global Options

Applied before any subcommand.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--vault PATH` | path | — | Vault root; overrides `MEATYWIKI_VAULT_ROOT` and cwd |
| `--verbose` / `-v` | flag | off | Enable debug logging |
| `--json-logs` / `--no-json-logs` | bool | `--json-logs` | Structured JSON log output (default on) |

```bash
meatywiki --vault /my/vault --verbose compile --pending
```

---

## Core Commands

### init

Initialize a new vault. Creates directory structure, `_meta/config.yaml`, default prompt README, and SQLite DB with migrations applied.

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `PATH` | yes | Directory to initialize (need not exist) |
| `--force` | no | Allow init in non-empty directory; overwrites config if present |

Exit codes: 0 success, 1 non-empty directory (without `--force`).

```bash
meatywiki init /home/user/mywiki
meatywiki init /home/user/mywiki --force
```

---

### ingest

Run the `accept → normalize → classify → create_raw_artifact` pipeline. Writes to `raw/<source_type>/<artifact_id>.md`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `SOURCE` | yes* | — | File path, URL, or directory |
| `--text TEXT` | no | — | Inline text; alternative to SOURCE |
| `--type TYPE` | no | auto | Force source type: `note`, `url`, `upload_pdf`, `upload_image`, `transcript`, `import_chatgpt`, `import_perplexity`, `import_gemini`, `upload_file` |
| `--domain TAG` | no | — | Domain tag (repeatable) |
| `--project SLUG` | no | — | Project slug (repeatable) |
| `--workspace WS` | no | derived from type | Override workspace: `library`, `research`, `blog`, `projects`, `inbox` |
| `--dry-run` | no | off | Validate without writing files |
| `--force` | no | off | Skip idempotency check; re-ingest even if content hash matches |
| `--compile` | no | off | Auto-compile after ingest (triggers full compile pipeline) |
| `--facet TAG` | no | — | Facet tag (repeatable; not yet persisted — logs a warning) |

Connector dispatch order (first match wins):
`NoteConnector` → `UrlConnector` → `UploadPdfConnector` → `UploadImageConnector` → `TranscriptConnector` → `ImportChatGPTConnector` → `ImportPerplexityConnector` → `ImportGeminiConnector` → `UploadFileConnector` (catch-all).

Output on success: artifact ID, type, title, workspace, file path. On cache hit (same content hash without `--force`): skips silently.

```bash
meatywiki ingest https://example.com/article
meatywiki ingest chatgpt_export.json --type import_chatgpt
meatywiki ingest notes.md --domain ai --domain systems --workspace research
meatywiki ingest https://example.com/article --compile
meatywiki ingest --text "Quick note about X" --dry-run
```

---

### compile

Compile raw artifacts through `CompileCheck → Extract → CompileSummary → UpdateGraph → ParseWikilinks → LinkExtractedItems → DetectSupersedes → ExtractContains → EnqueueReview → Notify → CompileFingerprint`.

TARGET may be: artifact ID (`art_...`), file path, directory, or the literal `all`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `TARGET` | see note | — | Artifact ID, file path, directory, or `all` |
| `--pending` | no | off | Compile all raw (uncompiled) artifacts; mutually exclusive with explicit TARGET (except `all`) |
| `--full` | no | off | Force recompile even if fingerprint unchanged |
| `--scope DOMAIN` | no | — | Restrict batch to domain (used with `--pending`; filters `domain_json`) |
| `--dry-run` | no | off | Preview which artifacts would be compiled; no writes |
| `--quiet` | no | off | Suppress stderr warnings (e.g. half-configured relationship pipeline) |

Note: one of `TARGET`, `--pending`, or `--scope` is required.

LLM cost gating: `extract.relationship_extraction` and `compile.relationship_synthesis` are off by default. Enabling only one side emits a half-pipeline warning to stderr (suppressed with `--quiet`).

```bash
meatywiki compile --pending
meatywiki compile art_01JXXXXXXXXXXXXXXXXXXXXXXXXX --full
meatywiki compile raw/url/ --dry-run
meatywiki compile all --scope ai --pending
```

---

### query

Natural-language query against the compiled knowledge graph. Uses FTS5 to assemble context, then calls LLM (Opus tier by default). With `--file-back`, persists answer as `synthesis/research_synthesis` under `wiki/syntheses/`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `QUESTION` | yes | — | Natural-language question |
| `--scope DOMAIN` | no | — | Limit FTS5 context search to domain |
| `--limit-context N` | no | 10 | Max artifacts assembled as LLM context |
| `--file-back` | no | off | Write answer as synthesis artifact; prints filed artifact ID |
| `--format` | no | `text` | Output: `text`, `json` |

JSON output fields: `answer`, `source_refs`, `confidence`, `unanswered_aspects`, `llm_summary`, `synthesis_artifact_id` (if `--file-back`).

```bash
meatywiki query "explain the relationship between X and Y"
meatywiki query "summarize current AI trends" --file-back --scope ai
meatywiki query "what do I know about Kubernetes?" --format json
```

---

### search

FTS5 full-text search over the vault index.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `QUERY` | yes | — | Search terms (FTS5 syntax supported) |
| `--workspace` / `-w` WS | no | — | Filter by workspace |
| `--type TYPE` | no | — | Filter by artifact type |
| `--domain` / `-d` TAG | no | — | Filter by domain tag |
| `--freshness` | no | — | Filter by freshness class: `current`, `aging`, `stale` |
| `--limit` / `-n` N | no | 20 | Maximum results |
| `--format` | no | `table` | Output: `table`, `json`, `paths` |

```bash
meatywiki search "kubernetes" --workspace wiki --limit 10
meatywiki search "machine learning" --type concept --format json
meatywiki search "stale docs" --freshness stale --format paths
```

---

### synthesize

LLM synthesis across artifacts in a scoped domain. Persists result as `synthesis` artifact under `wiki/syntheses/` by default.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--scope` / `-s` DOMAIN | yes | — | Domain scope for artifact collection |
| `--type TYPE` | no | `research_synthesis` | Synthesis subtype: `research_synthesis`, `comparison`, `thesis_note`, `briefing`, `evidence_summary` |
| `--topic` / `-t` TOPIC | no | scope value | Topic/question for synthesis |
| `--file-back` / `--no-file-back` | no | `--file-back` | Write synthesis to vault |
| `--format` | no | `text` | Output: `text`, `json` |

```bash
meatywiki synthesize --scope "ai/llm"
meatywiki synthesize --scope kubernetes --type comparison --topic "k8s vs nomad"
meatywiki synthesize --scope systems --no-file-back --format json
```

---

### lint

Quality checks across the vault. Deterministic checks: `broken-links`, `orphans`, `missing-refs`, `stale`, `weak-summaries`. Semantic checks (LLM): `duplicates`, `contradictions` — skipped gracefully if no LLM key configured.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--scope` / `-s` DOMAIN | no | all | Limit lint to domain |
| `--checks` / `-c` LIST | no | all | Comma-separated check names to run |
| `--fix` | no | off | Apply deterministic fixes (e.g. broken link renames) |
| `--report` | no | off | Output JSON lint report (same as `--format json`) |
| `--format` | no | `table` | Output: `table`, `json` |

Exit codes: 0 all checks passed, 1 one or more checks failed.

```bash
meatywiki lint
meatywiki lint --checks broken-links,orphans --fix
meatywiki lint --scope wiki/concepts --report
meatywiki lint --format json > lint-results.json
```

---

### graph

Traverse the artifact graph from a given artifact ID.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `ARTIFACT_ID` | yes | — | Starting artifact ULID (`art_...`) |
| `--depth` / `-d` N | no | 3 | Max traversal depth |
| `--edge-type` / `-e` TYPES | no | all | Comma-separated edge types: `derived_from`, `supports`, `references`, `relates_to`, `supersedes`, `contains` |
| `--direction` | no | `both` | Edge direction: `outgoing`, `incoming`, `both` |
| `--mode` | no | `bfs` | Traversal algorithm: `bfs`, `dfs` |
| `--format` | no | `tree` | Output: `tree`, `json`, `dot` |

```bash
meatywiki graph art_01JXXXXXXXXXXXXXXXXXXXXXXXXX
meatywiki graph art_01JXXXXXXXXXXXXXXXXXXXXXXXXX --depth 2 --format json
meatywiki graph art_01JXXXXXXXXXXXXXXXXXXXXXXXXX --edge-type derived_from,supports --direction outgoing
meatywiki graph art_01JXXXXXXXXXXXXXXXXXXXXXXXXX --format dot | dot -Tsvg > graph.svg
```

---

### index

Rebuild the SQLite+FTS5 index from vault files. Without `--reset`, performs incremental upsert of all files.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--reset` | no | off | Drop and rebuild index from scratch; guarantees no stale rows |
| `--scope WS` | no | all | Limit rebuild to workspace: `inbox`, `research`, `blog`, `projects` |

Output: `Done in Xs — N indexed, N skipped, N error(s).`

```bash
meatywiki index --reset
meatywiki index --scope wiki
```

---

### stats

Vault statistics by workspace, artifact type, freshness class, lifecycle stage.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--format` | no | `table` | Output: `table`, `json` |
| `--runs` | no | off | Include workflow run cost/token statistics |
| `--costs` | no | off | Alias for `--runs` |

JSON output fields (with `--runs`): `total`, `by_workspace`, `by_artifact_type`, `by_freshness_class`, `by_lifecycle_stage`, `runs.{total_runs, total_cost_estimate, total_tokens_in, total_tokens_out, recent_runs}`.

```bash
meatywiki stats
meatywiki stats --format json
meatywiki stats --runs
```

---

### doctor

Health check: vault layout, config validity, index drift, orphan rows, frontmatter validity, schema version, edge integrity.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--format` | no | `table` | Output: `table`, `json` |

Exit codes: 0 all checks OK, 1 one or more checks failed.

JSON output fields: `vault_layout_ok`, `config_valid`, `drift_count`, `orphan_count`, `missing_frontmatter`, `schema_version_ok`, `edge_integrity_ok`, `total_checks`, `passed_checks`, `all_ok`.

```bash
meatywiki doctor
meatywiki doctor --format json
```

---

### watch

Watch vault for `.md` file changes and auto-reindex. Does NOT auto-compile (controlled by `watch.auto_compile` in config, off by default). Deletions are logged as warnings only; run `index --reset` to purge stale rows.

Requires: `uv sync --extra watch`

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--debounce` SECS | no | 2.0 | Debounce interval before triggering re-index |

Terminates on SIGINT/SIGTERM (Ctrl+C).

```bash
meatywiki watch
meatywiki watch --debounce 5.0
```

---

### serve

Start the FastAPI HTTP service via uvicorn. Requires `features.service.enabled: true` in `_meta/config.yaml`.

Requires: `uv sync --extra service`

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--host` | no | `127.0.0.1` | Bind address |
| `--port` | no | `8000` | Bind port |
| `--workers` N | no | 1 | uvicorn worker processes |

```bash
meatywiki serve --port 8910
meatywiki serve --host 0.0.0.0 --port 8000 --workers 2
```

---

### promote

Advance an artifact one step in lifecycle (`raw → classified → compiled → reviewed → published`), or jump directly with `--to`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `ARTIFACT_ID` | yes | — | Artifact ULID to promote |
| `--to STAGE` | no | next | Target stage: `classified`, `compiled`, `reviewed`, `published` |
| `--force` | no | off | Skip promotion rules and force transition |
| `--format` | no | `table` | Output: `table`, `json` |

Exit codes: 0 promoted, 1 promotion blocked (without `--force`).

```bash
meatywiki promote art_01JXXXXXXXXXXXXXXXXXXXXXXXXX
meatywiki promote art_01JXXXXXXXXXXXXXXXXXXXXXXXXX --to published --force
```

---

### consolidate

Find duplicate `entity` and `glossary_term` artifacts and optionally auto-merge safe pairs.

Default mode is dry-run (non-mutating). `--auto` requires `--no-dry-run` and `--scope`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--dry-run` / `--no-dry-run` | no | `--dry-run` | Show candidates without merging |
| `--auto` | no | off | Execute auto-band merges; requires `--no-dry-run --scope` |
| `--scope TYPE[,TYPE]` | required with `--auto` | — | Restrict to: `entity`, `glossary_term` |
| `--since DATETIME` | no | — | ISO-8601 cutoff; only seed candidates from artifacts after this timestamp |
| `--min-confidence N` | no | 0.65 | Minimum scored confidence to include in report (0.0–1.0) |
| `--output PATH` | no | — | Write report to file; `.json` emits JSON, `.md`/`.markdown` emits Markdown |

Output: JSON report to stdout (dry-run) or auto-merge summary.

```bash
meatywiki consolidate
meatywiki consolidate --scope entity --min-confidence 0.8 --output report.json
meatywiki consolidate --no-dry-run --auto --scope entity,glossary_term
meatywiki consolidate --since 2026-05-01 --scope entity
```

---

## Relationship Pipeline Commands (v1.1+)

### migrate-edges

Backfill v1.1 edge types onto an existing vault. Safe to re-run — UNIQUE constraint violations are silently skipped; existing edges are never overwritten.

Edge types populated: `REFERENCES`, `RELATES_TO`, `SUPERSEDES`, `CONTAINS`.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--strategy` | yes | — | `wikilink` (REFERENCES), `cooccurrence` (RELATES_TO), `llm` (extract+synthesize, expensive), `all` (chains all three in order) |
| `--vault PATH` | no | — | Per-command vault override (highest priority) |
| `--dry-run` | no | off | Print report and cost estimate without writing edges |
| `--report PATH` | no | — | Write report to file; `.json` (default) or `.csv` |
| `--max-errors N` | no | 100 | Abort strategy after N per-artifact errors; 0 = run to completion |
| `--no-confirm` | no | off | Skip interactive LLM cost confirmation prompt (use in CI) |
| `--quiet` / `-q` | no | off | Suppress informational warnings (e.g. half-pipeline) |

Strategy cost notes:
- `wikilink`, `cooccurrence`: no LLM cost
- `llm`, `all`: prints cost estimate (`$X.XXXX – $Y.YYYY`) to stderr and requires confirmation unless `--no-confirm`

v1.2 model blocks for LLM strategy: `models.extract_relationships` (falls back to `models.extract`), `models.synthesize_relationships` (falls back to `models.compile`).

Exit codes: 0 success, 1 aborted (max-errors exceeded).

```bash
meatywiki migrate-edges --strategy wikilink --dry-run
meatywiki migrate-edges --strategy cooccurrence --report report.json
meatywiki migrate-edges --strategy llm --no-confirm
meatywiki migrate-edges --strategy all --max-errors 50 --report errors.csv
meatywiki migrate-edges --strategy all --dry-run --vault ./vault
```

---

### backfill-edges

Backfill `derived_from` edges using deterministic signals: `source_refs` frontmatter, `## Sources` markdown section, and `[[ULID]]` wikilinks.

Default mode is dry-run. Idempotent: only writes when proposed list differs from current frontmatter.

| Argument/Flag | Required | Default | Description |
|---------------|----------|---------|-------------|
| `--dry-run` / `--no-dry-run` | no | `--dry-run` | Preview without writing |
| `--vault PATH` | no | — | Per-command vault override |
| `--quiet` / `-q` | no | off | Suppress per-artifact log lines; emit only final summary |
| `--orphan-audit` | no | off | Query index for NULL-endpoint edges; print markdown audit table; skips normal backfill |
| `--recover-orphans` | no | off | Recover NULL-endpoint orphan edges by writing recovered target ULID to `derived_from`; respects `--dry-run` |

Output format: `BACKFILL mode=X scanned=N proposed=N deduped=N new_artifacts=N unchanged=N`

Orphan confidence ladder (used by `--orphan-audit` and `--recover-orphans`):
| Level | Confidence | Signal |
|-------|-----------|--------|
| high | 0.9 | ULID found in parent Sources section |
| medium | 0.7 | slug found in Sources section |
| low | 0.5 | Sources section has text but no machine-resolvable ID |
| none | 0.0 | No Sources section |

```bash
meatywiki backfill-edges
meatywiki backfill-edges --no-dry-run --vault ./my-vault
meatywiki backfill-edges --quiet
meatywiki backfill-edges --orphan-audit --vault ./my-vault
meatywiki backfill-edges --recover-orphans --no-dry-run --vault ./my-vault
```

---

## Portal Subcommands

All portal commands require: `uv sync --extra portal`

Portal environment variables:
| Variable | Description |
|----------|-------------|
| `PORTAL_DATABASE_URL` | Postgres DSN (required for all portal commands) |
| `MEATYWIKI_VAULT_ROOT` | Vault root (fallback when `--vault` not set) |
| `PORTAL_ALLOW_NETWORK` | Set to `1` to allow non-loopback bind |
| `MEATYWIKI_PORTAL_TOKEN` | Bearer token for API auth |
| `PORTAL_DISABLE_AUTH` | Dev toggle to skip auth checks |

---

### portal reconcile

Synchronise the Postgres overlay with vault state. Two modes: apply (default) and audit (`--check`).

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--check` | no | off | Audit mode: report drift without writing; exit 1 on drift |
| `--output FORMAT` | no | `text` | Report format: `text`, `json`, `yaml` |
| `--database-url DSN` | no | `$PORTAL_DATABASE_URL` | Postgres DSN |
| `--vault PATH` | no | env/cwd | Vault root |
| `--index-path PATH` | no | `<vault>/_meta/meatywiki.db` | Engine SQLite path |
| `--quiet` / `-q` | no | off | Suppress info logs; emit only final report |
| `--force` | no | off | Bypass bulk-delete safety rail; never use in automated paths |

Exit codes:
| Code | Meaning |
|------|---------|
| 0 | Clean (check mode) or successful apply |
| 1 | Drift detected (check mode) or reconcile error |
| 2 | Configuration error (missing DSN, bad vault path) |

```bash
meatywiki portal reconcile --check
meatywiki portal reconcile --output json
meatywiki portal reconcile --vault /my/vault --database-url postgres://localhost/meatywiki
```

---

### portal embed

Batch-embed vault artifacts into the Postgres `embeddings` table. Skips already-current embeddings; safe to run repeatedly.

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--database-url DSN` | no | `$PORTAL_DATABASE_URL` | Postgres DSN |
| `--vault PATH` | no | env/cwd | Vault root |
| `--model NAME` | no | `$PORTAL_EMBED_MODEL` / `text-embedding-3-small` | Embedding model |
| `--batch-size N` | no | 50 | Artifacts per API call (1–500) |
| `--quiet` / `-q` | no | off | Suppress info logs; emit only final summary |

Exit codes:
| Code | Meaning |
|------|---------|
| 0 | Success (partial failures logged but don't change exit code) |
| 1 | Fatal error (DB connection failed, vault not found) |
| 2 | Configuration error |

```bash
meatywiki portal embed
meatywiki portal embed --force
meatywiki portal embed --batch-size 100 --model text-embedding-3-large
```

---

### portal backfill-workflow-artifact-ids

Backfill missing `workflow_runs.artifact_id` links by scanning persisted JSON run output for artifact IDs. Default is dry-run (read-only).

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--apply` | no | off | Apply updates; without this flag the command is a dry run |
| `--output FORMAT` | no | `text` | Report format: `text`, `json`, `yaml` |
| `--database-url DSN` | no | `$PORTAL_DATABASE_URL` | Postgres DSN |
| `--limit N` | no | — | Max missing-link workflow runs to inspect |
| `--quiet` / `-q` | no | off | Suppress info logs; emit only final report |

```bash
meatywiki portal backfill-workflow-artifact-ids
meatywiki portal backfill-workflow-artifact-ids --apply
meatywiki portal backfill-workflow-artifact-ids --apply --limit 100 --output json
```

---

## Quick Reference

| Command | Primary Purpose | LLM Cost |
|---------|----------------|----------|
| `init` | Create new vault | none |
| `ingest` | Add raw artifact | classify (Haiku) |
| `ingest --compile` | Add + compile | Haiku + Sonnet + Opus |
| `compile --pending` | Compile all raw | Sonnet + Opus |
| `compile --full` | Force recompile | Sonnet + Opus |
| `query` | NL question answering | Opus |
| `search` | FTS5 keyword search | none |
| `synthesize` | Domain synthesis | Opus |
| `lint` | Quality checks | Sonnet (semantic only) |
| `graph` | Edge traversal | none |
| `index --reset` | Rebuild SQLite index | none |
| `stats` | Vault counts | none |
| `doctor` | Health check | none |
| `watch` | Auto-reindex on change | none |
| `serve` | Start FastAPI service | none |
| `promote` | Advance lifecycle | none |
| `consolidate` | Dedup entities | none |
| `migrate-edges --strategy wikilink` | Backfill REFERENCES edges | none |
| `migrate-edges --strategy cooccurrence` | Backfill RELATES_TO edges | none |
| `migrate-edges --strategy llm` | Backfill via LLM extraction | Sonnet + Opus |
| `backfill-edges` | Backfill derived_from edges | none |
| `portal reconcile` | Sync Postgres overlay | none |
| `portal embed` | Batch embed artifacts | OpenAI embeddings API |
| `portal backfill-workflow-artifact-ids` | Fix workflow run links | none |

## Common Patterns

```bash
# Full ingest-to-query cycle
meatywiki init /vault
meatywiki ingest /vault article.pdf --compile
meatywiki query "what did the article say about X?"

# Batch compile with cost awareness
meatywiki compile --pending --dry-run          # preview scope
meatywiki compile --pending --scope ai         # scoped first
meatywiki compile --pending                    # full run

# Upgrade existing vault to v1.1 edges
meatywiki migrate-edges --strategy wikilink    # free, fast
meatywiki migrate-edges --strategy cooccurrence
meatywiki migrate-edges --strategy llm --dry-run   # preview cost
meatywiki migrate-edges --strategy llm --no-confirm

# Portal startup sequence
meatywiki portal reconcile --check             # audit drift
meatywiki portal reconcile                     # apply
meatywiki portal embed                         # build vectors

# Maintenance
meatywiki doctor
meatywiki index --reset
meatywiki lint --fix
meatywiki consolidate --no-dry-run --auto --scope entity
```
