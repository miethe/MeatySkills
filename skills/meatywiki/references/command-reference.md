---
name: meatywiki-command-reference
description: Complete V1 CLI reference for all 14 MeatyWiki commands — flags, examples, exit codes.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki V1 CLI Command Reference

All 14 V1 commands in decision-tree order. Load this file when SKILL.md's command map isn't enough. No commands or flags beyond the V1 allow-list appear here. `register` is in the Deferred Commands footer only.

---

## init

**Purpose.** Initialize a new vault directory structure at the target path.

**Usage.**
```bash
meatywiki init <vault-path>
```

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Create a new vault in ~/my-wiki
meatywiki init ~/my-wiki

# Create a vault in the current directory
meatywiki init .
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Vault initialized successfully |
| 1 | Target path already contains a vault or permission error |

**Output.** Human-readable confirmation listing created directories (`raw/`, `wiki/`, `blog/`, `projects/`, `_meta/`, `_prompts/`) and path of generated `_meta/config.yaml`.

**Related.** See `vault-layout.md` for full directory ownership rules and `_meta/` boundary.

---

## ingest

**Purpose.** Ingest a source into `raw/` and trigger auto-classification.

**Usage.**
```bash
meatywiki ingest <source>
```

Where `<source>` is one of the 9 V1 knowledge-domain connector types: local notes (`.md`), URLs, PDFs, transcripts (`.txt`/`.vtt`), AI-tool exports (chat exports, tool outputs), and related variants. Developer-artifact connectors (SkillMeat, GitHub, Claude configs) are `[deferred: F4]`.

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Ingest a URL; engine fetches, extracts text, writes to raw/
meatywiki ingest https://example.com/article

# Ingest a local PDF
meatywiki ingest ~/downloads/paper.pdf

# Ingest a local markdown note
meatywiki ingest ~/notes/meeting-2026-04-14.md

# Ingest a transcript file
meatywiki ingest ~/recordings/interview.vtt
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Source ingested and written to raw/ |
| 1 | Unreachable URL, unreadable file, or unsupported source type |

**Output.** Human-readable: path of created `raw/` artifact, inferred `artifact_type`, and `lifecycle_stage: raw`. Images ingested as opaque blobs with optional captions; no OCR in V1.

**Related.** Run `compile --pending` after ingest to process raw/ through the compile pipeline. See `artifact-taxonomy.md` for artifact type reference.

---

## compile

**Purpose.** Process `raw/` artifacts through classify → extract → compile → write `wiki/`.

**Usage.**
```bash
meatywiki compile [--pending] [--scope <domain>] [--dry-run] [--full]
```

**Required flags.** None. (Running `meatywiki compile` with no flags compiles all pending sources; use a flag to narrow scope.)

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--pending` | off | Compile only artifacts in `raw/` with `lifecycle_stage: raw` (not yet classified) |
| `--scope <domain>` | all domains | Limit compile to a named domain (e.g., `ml`, `distributed-systems`); repeatable |
| `--dry-run` | off | Run all pipeline stages but write no files; print what would change |
| `--full` | off | Force recompile of all sources regardless of `lifecycle_stage`; ignores compile_state.json |

**Examples.**
```bash
# Compile only newly ingested (pending) sources
meatywiki compile --pending

# Preview compile without writing (safe pre-flight)
meatywiki compile --pending --dry-run

# Recompile only the ml domain
meatywiki compile --scope ml

# Force full recompile of everything
meatywiki compile --full

# Force full recompile scoped to one domain
meatywiki compile --full --scope distributed-systems
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Compile completed; all staged artifacts written |
| 1 | Pipeline stage failure (LLM error, schema validation failure, write error) |
| 2 | No pending sources found (when `--pending` passed and raw/ is empty) |

**Output.** Human-readable progress per artifact: `[compile] <artifact-id> → wiki/<subdir>/<slug>.md`. `--dry-run` prefixes all lines with `[dry-run]` and writes nothing. Final summary: N compiled, N skipped, N failed.

**Related.** See `workflow-patterns.md` recipe 3 for the full compile loop. Prompt-template auto-recompile is `[deferred: Q4]`; use `--full --scope` manually.

---

## query

**Purpose.** Execute an FTS5-backed natural-language query over compiled wiki artifacts.

**Usage.**
```bash
meatywiki query "<question>" [--file-back] [--scope <domain>]
```

**Required flags.** None. (The query string is a positional argument.)

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--file-back` | off | Write query answer as a new artifact to `wiki/summaries/` with `schema_version: "1.0.0"` frontmatter |
| `--scope <domain>` | all domains | Restrict FTS5 search to artifacts in a named domain |

**Examples.**
```bash
# Query the wiki for an answer
meatywiki query "What are the key patterns in distributed tracing?"

# Query and write the answer back to the vault
meatywiki query "Summarize the consensus algorithms covered in the wiki" --file-back

# Scope a query to a specific domain
meatywiki query "How does attention work?" --scope ml
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Query completed; results printed (or filed) |
| 1 | FTS5 index error or LLM failure |
| 2 | No results found |

**Output.** Human-readable answer synthesized from matched wiki artifacts, followed by a list of source artifact IDs. With `--file-back`: additionally prints path of created `wiki/summaries/` artifact. `--semantic` is `[deferred: F3]`; do not use.

**Related.** For keyword search over raw text, use `search`. See `workflow-patterns.md` recipe 4 for the query + file-back pattern.

---

## synthesize

**Purpose.** Perform cross-source synthesis and write a new wiki artifact from multiple sources.

**Usage.**
```bash
meatywiki synthesize "<topic>" [<source-id> ...]
```

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Synthesize a topic from the full wiki
meatywiki synthesize "Consensus algorithms in distributed systems"

# Synthesize from specific source artifact IDs
meatywiki synthesize "RAFT vs Paxos tradeoffs" art-01HXYZ art-01HABC

# Synthesize a topic scoped by title keyword
meatywiki synthesize "transformer attention mechanisms"
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Synthesis artifact written to wiki/ |
| 1 | LLM failure or no relevant sources found |

**Output.** Human-readable: path of created `wiki/syntheses/` artifact, source artifact IDs used, token cost summary.

**Related.** `synthesize` writes to `wiki/syntheses/`; for a simple query-and-file, use `query --file-back`. See `artifact-taxonomy.md` for the 5 synthesis output subtypes.

---

## lint

**Purpose.** Run deterministic and semantic checks on vault artifacts; optionally auto-fix.

**Usage.**
```bash
meatywiki lint [--fix] [--report] [--checks <names>]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--fix` | off | Auto-apply safe fixes (missing `schema_version`, malformed frontmatter, broken wikilinks) |
| `--report` | off | Write a structured lint report to `_meta/lint-report.json` instead of (or in addition to) stdout |
| `--checks <names>` | all checks | Comma-separated subset of check names (e.g., `frontmatter,links,lifecycle`) |

**Examples.**
```bash
# Run all lint checks; print findings to stdout
meatywiki lint

# Auto-fix all safe issues
meatywiki lint --fix

# Generate a lint report file
meatywiki lint --report

# Run only frontmatter and lifecycle checks
meatywiki lint --checks frontmatter,lifecycle

# Fix issues and write a report
meatywiki lint --fix --report
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | No issues found (or all issues fixed with `--fix`) |
| 1 | Issues found that could not be auto-fixed (or `--fix` not passed) |
| 2 | Internal lint engine error |

**Output.** Per-artifact findings table: artifact path, check name, severity, description. With `--fix`: lines marked `[fixed]` or `[manual-required]`. With `--report`: confirmation of report path.

**Related.** Run after every `compile` in the standard loop. See `workflow-patterns.md` recipe 3. For vault health beyond lint, use `doctor`.

---

## search

**Purpose.** Execute an FTS5 full-text keyword search across vault artifacts.

**Usage.**
```bash
meatywiki search "<query>" [--type <artifact-type>] [--freshness <age>]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--type <artifact-type>` | all types | Filter results to a specific artifact subtype (e.g., `concept`, `entity`, `summary`) |
| `--freshness <age>` | all ages | Filter to artifacts updated within a time window (e.g., `7d`, `30d`, `1y`) |

**Examples.**
```bash
# Full-text search for a keyword
meatywiki search "transformer attention"

# Search and filter by artifact type
meatywiki search "attention" --type concept

# Search for recently updated artifacts
meatywiki search "LLM evaluation" --freshness 30d

# Combine type and freshness filters
meatywiki search "distributed tracing" --type summary --freshness 7d
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Search completed; results printed |
| 1 | FTS5 index error |
| 2 | No results found |

**Output.** Ranked results table: artifact path, type, last-updated, match snippet. `--semantic` is `[deferred: F3]`; do not use.

**Related.** For natural-language questions with synthesized answers, use `query`. For type enumeration, see `artifact-taxonomy.md`.

---

## graph

**Purpose.** Traverse and render artifact relationship edges from the compiled graph index.

**Usage.**
```bash
meatywiki graph [<artifact-id>] [--depth <n>] [--format <fmt>]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--depth <n>` | 2 | Number of relationship hops to traverse from the root artifact |
| `--format <fmt>` | `text` | Output format: `text`, `json`, `dot` (Graphviz) |

**Examples.**
```bash
# Show the relationship graph for a specific artifact (depth 2)
meatywiki graph art-01HXYZ

# Traverse up to 3 hops deep
meatywiki graph art-01HXYZ --depth 3

# Export the full graph in Graphviz DOT format
meatywiki graph --format dot

# Export artifact subgraph as JSON
meatywiki graph art-01HABC --format json --depth 1
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Graph traversal complete; output printed or written |
| 1 | Artifact ID not found or index error |

**Output.** `text`: indented tree of artifact IDs with edge labels (e.g., `supports`, `contradicts`, `derived-from`). `json`: structured edge list. `dot`: Graphviz DOT source.

**Related.** See `artifact-taxonomy.md` for edge type definitions. If graph appears stale after manual vault edits, run `index --reset` first.

---

## index

**Purpose.** Manage the derived SQLite + FTS5 index; `--reset` rebuilds it from vault files.

**Usage.**
```bash
meatywiki index [--reset]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--reset` | off | Drop and rebuild `_meta/meatywiki.db` from the vault files; safe to run at any time |

**Examples.**
```bash
# Rebuild the index after manual vault edits or corruption
meatywiki index --reset

# Check index status without rebuilding (no flags = status report)
meatywiki index
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Index rebuilt (or status reported) successfully |
| 1 | Index rebuild failed (disk error, schema mismatch) |

**Output.** With `--reset`: progress lines `[index] reindexing <artifact-path>` followed by summary (N artifacts indexed, N edges built, elapsed time). Without flags: index freshness status (last rebuild timestamp, artifact count, index size).

**Related.** Run after any direct vault file edits or after a failed compile. See `workflow-patterns.md` recipe 5 for the index rebuild sequence (`index --reset` → `stats` → `doctor`).

---

## stats

**Purpose.** Print vault counts broken down by artifact type, lifecycle stage, and freshness.

**Usage.**
```bash
meatywiki stats
```

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Print summary stats for the entire vault
meatywiki stats

# Typical post-compile check: stats after compiling
meatywiki compile --pending && meatywiki stats
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Stats printed |
| 1 | Index unavailable or vault not initialized |

**Output.** Human-readable table: artifact count by type, count by lifecycle stage (`raw`, `classified`, `compiled`, `reviewed`, `published`), count of artifacts updated in last 7d/30d/90d. No arguments or flags change the output format in V1.

**Related.** Run after every compile or index rebuild as a sanity check. For health beyond counts, use `doctor`.

---

## doctor

**Purpose.** Run a health check covering vault structure, index freshness, config validity, and drift detection.

**Usage.**
```bash
meatywiki doctor
```

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Run the full health check
meatywiki doctor

# Typical remediation sequence after detecting drift
meatywiki doctor
meatywiki index --reset
meatywiki doctor
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | All checks pass; vault healthy |
| 1 | One or more checks failed (drift detected, index stale, config invalid) |
| 2 | Vault not initialized or unreadable |

**Output.** Per-check result table: check name, status (`OK` / `WARN` / `FAIL`), description, remediation hint. Checks include: vault directory structure, `_meta/config.yaml` validity, index freshness (age since last rebuild), artifact count consistency (vault files vs. index rows), broken wikilinks count.

**Related.** Run after `index --reset` to confirm remediation. See `troubleshooting.md` for remediation steps keyed to specific `FAIL` check names.

---

## watch

**Purpose.** Watch `raw/` for new files and auto-ingest on file drop.

**Usage.**
```bash
meatywiki watch [--auto-compile]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--auto-compile` | off | After each auto-ingest, immediately run `compile --pending` for the new artifact |

**Examples.**
```bash
# Watch raw/ for new files and ingest them as they appear
meatywiki watch

# Watch and auto-compile each new file immediately after ingest
meatywiki watch --auto-compile

# Typical background usage (shell backgrounding is outside the CLI)
meatywiki watch --auto-compile
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Watcher stopped cleanly (SIGINT/SIGTERM) |
| 1 | Watcher startup failure (vault not initialized, watchdog error) |

**Output.** Streaming: `[watch] detected <filename>`, `[ingest] <artifact-id>`, and (with `--auto-compile`) `[compile] <artifact-id> → wiki/...`. Process runs until interrupted.

**Related.** `watch` is a "Should" priority in V1 (requires `watchdog` dependency). See `ingest` for the single-file equivalent. Use `compile --pending` for a batch compile after a watch session.

---

## promote

**Purpose.** Apply lifecycle promotion rules to advance artifact stages (`raw → classified → compiled → reviewed → published`).

**Usage.**
```bash
meatywiki promote [<artifact-id> ...] [--force]
```

**Required flags.** None.

**Optional flags.**
| Flag | Default | Notes |
|---|---|---|
| `--force` | off | Bypass default promotion rules; promote regardless of `verification_status` or `lifecycle_stage` constraints |

**Examples.**
```bash
# Promote all artifacts that meet default promotion rules
meatywiki promote

# Promote a specific artifact
meatywiki promote art-01HXYZ

# Force-promote an artifact past a rule block
meatywiki promote art-01HXYZ --force

# Promote multiple specific artifacts
meatywiki promote art-01HXYZ art-01HABC
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Promotion applied; artifacts advanced |
| 1 | No artifacts eligible for promotion (without `--force`) or write error |
| 2 | Artifact ID not found |

**Output.** Per-artifact result: `[promote] <artifact-id>: <old-stage> → <new-stage>` or `[skip] <artifact-id>: <reason>`. With `--force`: skipped rules listed inline.

**Related.** Default promotion rules: artifacts in `lifecycle_stage: compiled` require `verification_status: human_review_complete` before advancing to `reviewed`. See `artifact-taxonomy.md` for full lifecycle rules. See `troubleshooting.md` for stuck-promotion remediation.

---

## serve

**Purpose.** Start the FastAPI thin CLI-parity wrapper service.

**Usage.**
```bash
meatywiki serve
```

**Required flags.** None.

**Optional flags.** None documented in V1.

**Examples.**
```bash
# Start the API service on the default host/port
meatywiki serve

# Typical usage: start service, then interact via HTTP
meatywiki serve
# In another shell: curl http://localhost:8000/stats
```

**Exit codes.**
| Code | Meaning |
|---|---|
| 0 | Service stopped cleanly |
| 1 | Startup failure (port conflict, vault not initialized, FastAPI/uvicorn error) |

**Output.** Uvicorn startup logs followed by per-request access log lines. The service exposes CLI-parity endpoints (one endpoint per CLI command); no additional API surface beyond the 14 commands in V1.

**Related.** `serve` is a "Should" priority in V1; requires `fastapi` and `uvicorn` dependencies. For direct CLI use, no service is needed.

---

## Deferred commands

| Command | Track | Status |
|---|---|---|
| `register` | F1 | Not available in V1. SAM registry integration deferred. |
