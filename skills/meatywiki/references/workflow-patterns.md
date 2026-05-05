---
name: meatywiki-workflow-patterns
description: Five annotated command-sequence recipes covering the MeatyWiki compile loop, query patterns, and index maintenance.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki Workflow Patterns

Expanded recipes for the five core workflows. Load this file when SKILL.md's inline ≤10-line recipes are insufficient — e.g., when troubleshooting a failure, validating expected output, or understanding a multi-step setup.

Each recipe has six sections: Goal, When to use, Prerequisites, Command sequence, Expected output, Troubleshooting tip.

---

## Recipe 1 — Ingest a URL and auto-classify into the wiki

**Goal.** Fetch a public URL, let the engine classify and extract it automatically, and surface it in the wiki.

**When to use.** Use when you have a public URL and want it ingested and classified without manual intervention — the default path for web sources.

**Prerequisites.**
- `meatywiki init` has been run (vault exists at the configured path).
- `_meta/config.yaml` declares required LLM credentials and the default model assignments (classify=Haiku-tier, extract=Sonnet-tier); see `_meta/` guardrail.
- The URL is publicly reachable; private/auth-gated URLs will fail at the fetch stage.
- No prior ingest of the same URL exists; if it does, `compile --pending` will skip it (use `compile --full --scope <id>` to reprocess).

**Command sequence.**
```bash
# Step 1 — Ingest the URL; engine fetches, stores to raw/, and auto-classifies
meatywiki ingest https://example.com/article

# Step 2 — Process all pending (uncompiled) raw/ artifacts into wiki/
meatywiki compile --pending

# Step 3 — Confirm vault counts reflect the new artifact
meatywiki stats
```

**Expected output.**
- **Step 1**: Stdout reports `Ingested: raw/2026-04-14/<slug>.md` plus a classification line like `Classified as: concept (confidence: 0.91)`. A new file appears in `raw/2026-04-14/` with `schema_version: "1.0.0"` and auto-populated frontmatter (`artifact_type`, `source_url`, `lifecycle: classified`). Index row added to `_meta/meatywiki.db`.
- **Step 2**: Stdout lists each stage — `[classify] <slug> → concept`, `[extract] <slug>`, `[compile] <slug> → wiki/concepts/<slug>.md`, `[index] updated`. Compile completes with `1 artifact(s) compiled, 0 skipped, 0 failed`.
- **Step 3**: `stats` shows incremented counts for the `concepts` workspace and `compiled` lifecycle bucket, plus an updated `last_compiled` timestamp.

**Troubleshooting tip.** If `ingest` fails with a fetch error, verify network access and that the URL is public. If classification confidence is low (printed alongside the classification), the engine will still proceed — inspect `raw/<date>/<slug>.md` frontmatter and correct `artifact_type` manually if needed, then run `compile --scope <id>` to reprocess just that artifact. If `compile --pending` stalls, run `meatywiki doctor` to check LLM credentials and index health. If the source was already ingested on a prior run, `--pending` skips it by design; use `compile --full --scope <id>` to force reprocessing of a specific artifact.

---

## Recipe 2 — Ingest a PDF with manual classification override

**Goal.** Ingest a PDF document and correct a wrong or low-confidence auto-classification before compiling it into the wiki.

**When to use.** Use when ingesting a PDF (research paper, report, exported transcript) where auto-classification is likely wrong or you already know the intended artifact type and want to enforce it before compilation.

**Prerequisites.**
- `meatywiki init` has been run.
- `_meta/config.yaml` declares required LLM credentials.
- The PDF is on local disk; `~/downloads/paper.pdf` in the example below (adjust path).
- You know the intended `artifact_type` value from the artifact taxonomy (see `references/artifact-taxonomy.md` for valid subtypes).

**Command sequence.**
```bash
# Step 1 — Ingest the PDF; engine stores it to raw/ and auto-classifies
meatywiki ingest ~/downloads/paper.pdf

# Step 2 — Inspect the raw artifact's frontmatter to confirm or correct the type
#           Note: --type flag does not exist in V1; manual frontmatter edit is the override path.
#           [not available as a flag in V1; use frontmatter edit as workaround]
#
#           Open raw/<date>/<slug>.md in your editor and set the artifact_type field:
#             artifact_type: synthesis   # or concept, topic, evidence, etc.
#           Save the file. Do NOT edit _meta/ files directly.

# Step 3 — Recompile only this artifact using its ID (slug or path) with --scope
meatywiki compile --scope <slug-or-id>

# Step 4 — Verify the artifact appeared in the correct wiki/ subdirectory
meatywiki stats
```

**Expected output.**
- **Step 1**: `Ingested: raw/2026-04-14/<slug>.md`. Classification line printed; if confidence is low (e.g., `0.52`), note the type for possible correction.
- **Step 2**: No CLI output — this is a direct file edit to `raw/<date>/<slug>.md`. After saving, the file's `artifact_type` frontmatter field reflects your override. The index is not yet updated; the compile step in Step 3 will reindex.
- **Step 3**: Stdout shows compile pipeline running for the scoped artifact: `[classify] skipped (type locked)` or `[extract] <slug>`, `[compile] <slug> → wiki/<workspace>/<slug>.md`. Ends with `1 artifact(s) compiled`.
- **Step 4**: `stats` shows the artifact counted in the correct workspace (e.g., `syntheses: +1`).

**Troubleshooting tip.** If `compile --scope <id>` reports `artifact not found`, confirm the slug exactly matches the filename in `raw/<date>/` (without the `.md` extension) or use the full relative path `raw/2026-04-14/<slug>`. If the artifact recompiles into the wrong workspace despite the frontmatter edit, run `meatywiki lint --checks schema` to detect frontmatter drift, then `lint --fix` to auto-repair. Images embedded in PDFs are ingested as opaque blobs with optional captions — no OCR is performed in V1; text extraction covers only the PDF text layer.

---

## Recipe 3 — Full compile loop end-to-end (ingest → compile → lint)

**Goal.** Run the complete knowledge-compilation loop for a new source: ingest, compile pending artifacts, validate the output, and confirm vault health.

**When to use.** Use when onboarding a new source end-to-end or when you want a verified, lint-clean artifact in the wiki — not just a compiled one. Also use as the canonical integration check after batch ingests.

**Prerequisites.**
- `meatywiki init` has been run.
- `_meta/config.yaml` declares LLM credentials for all pipeline stages (classify, extract, compile, lint).
- The source is accessible (URL reachable or file on disk).
- `meatywiki doctor` returns no blocking errors (recommended pre-flight).

**Command sequence.**
```bash
# Step 0 — Optional pre-flight health check (recommended for first run or after vault edits)
meatywiki doctor

# Step 1 — Ingest the source
meatywiki ingest <source>

# Step 2 — Compile all pending artifacts (classify → extract → compile → file-back)
meatywiki compile --pending

# Step 3 — Run lint with auto-fix to repair any schema or frontmatter drift
meatywiki lint --fix

# Step 4 — Confirm vault state: counts, lifecycle distribution, freshness
meatywiki stats
```

**Expected output.**
- **Step 0**: `doctor` prints a green-status summary: vault structure OK, index fresh, config valid, no drift detected. Any blocking issue prints a remediation hint and exits non-zero.
- **Step 1**: `Ingested: raw/<date>/<slug>.md`. Classification confidence printed.
- **Step 2**: Per-stage progress lines for each artifact in the pending queue. Ends with a summary: `N artifact(s) compiled, M skipped (already compiled), 0 failed`. New wiki/ files appear with `schema_version: "1.0.0"` frontmatter.
- **Step 3**: `lint --fix` prints each check run (e.g., `[schema] OK`, `[links] 2 fixed`, `[frontmatter] OK`). Exits 0 if all checks pass after fixes; exits non-zero if unfixable violations remain (manual intervention required — run `lint --report` for details).
- **Step 4**: `stats` shows updated counts across all lifecycle stages. Freshly compiled artifacts appear under `compiled` lifecycle.

**Troubleshooting tip.** If `compile --pending` exits with failures (`N failed`), check `_meta/compile_state.json` for the failed artifact IDs and run `meatywiki doctor` to isolate whether the issue is LLM credentials, a malformed source, or index corruption. For prompt-related issues, re-run with `compile --full --scope <id>` to force reprocessing; V1 does not auto-recompile on prompt-template changes (manual `--full --scope` only). If `lint --fix` reports unfixable violations, run `lint --report` to get the full report, then inspect the flagged wiki/ file directly. Do not edit `_meta/` files to resolve lint failures — all fixes go through the CLI or direct frontmatter edits to `wiki/` or `raw/` files.

---

## Recipe 4 — Query the wiki and write the answer back to a vault file (`query --file-back`)

**Goal.** Query the compiled wiki using FTS5 full-text search and write the engine's synthesized answer to a specified vault file under agent control.

**When to use.** Use when you need a knowledge lookup whose result should persist in the vault — e.g., generating a concept summary, answering a research question, or seeding a new wiki artifact from existing knowledge.

**Prerequisites.**
- `meatywiki init` has been run and the vault contains compiled artifacts (run `compile --pending` first if the inbox is non-empty).
- `_meta/config.yaml` declares LLM credentials for the query stage (Opus-tier or equivalent strong model recommended for synthesis).
- V1 query uses FTS5 only — no `--semantic` flag. Queries must use keywords present in compiled artifact text. `[deferred: F3]`
- The target output path for `--file-back` must be inside the vault (e.g., `wiki/concepts/my-concept.md`); the engine will create or overwrite the file via `vault/writer.py`.

**Command sequence.**
```bash
# Step 1 — Run a natural-language FTS5 query and write the answer to a vault file
meatywiki query "What are the key patterns in distributed tracing?" \
  --file-back wiki/concepts/distributed-tracing-patterns.md

# Step 2 — Optional: scope the query to a specific domain to reduce noise
meatywiki query "What are the key patterns in distributed tracing?" \
  --scope observability \
  --file-back wiki/concepts/distributed-tracing-patterns.md

# Step 3 — Lint the newly written file to confirm schema compliance
meatywiki lint --checks schema wiki/concepts/distributed-tracing-patterns.md

# Step 4 — Confirm the artifact is indexed and counted
meatywiki stats
```

**Expected output.**
- **Step 1**: FTS5 search runs; engine prints matched source artifact IDs (e.g., `Matched: 4 artifact(s)`). Synthesized answer written to `wiki/concepts/distributed-tracing-patterns.md` with `schema_version: "1.0.0"` frontmatter, `artifact_type: summary` (or as determined by the engine), and `lifecycle: compiled`. Index row added to `_meta/meatywiki.db`. Stdout prints: `Written: wiki/concepts/distributed-tracing-patterns.md`.
- **Step 2** (optional, scoped): Same as Step 1 but FTS5 search is filtered to artifacts whose domain metadata matches `observability`. Match count may be lower; answer may be more precise.
- **Step 3**: `[schema] OK` — confirms `schema_version: "1.0.0"` is present and frontmatter is valid.
- **Step 4**: `stats` shows the new artifact counted in the appropriate workspace.

**Troubleshooting tip.** If `query --file-back` returns zero matches (`Matched: 0 artifact(s)`), the FTS5 index has no artifacts containing the query keywords. Verify the vault has compiled artifacts (`stats`); if the inbox is full, run `compile --pending` first. Adjust query keywords to match terms present in source text — FTS5 is keyword-based, not semantic. If `--scope <domain>` narrows matches to zero, drop the scope flag and re-run globally. If the written file fails lint (`lint --checks schema`), the engine may have omitted required frontmatter fields — run `lint --fix` to auto-repair, or inspect the file and add missing fields manually before re-linting.

---

## Recipe 5 — Rebuild the derived index after vault edits (`index --reset` + `stats`)

**Goal.** Rebuild the SQLite + FTS5 derived index from vault files to restore consistency after manual edits, vault migration, or index corruption — without losing any data.

**When to use.** Use after manually editing frontmatter in `wiki/` or `raw/` files, after moving vault files between directories, after index corruption errors reported by `doctor`, or after restoring the vault from backup. The index is derived from files — resetting it does not lose canonical data.

**Prerequisites.**
- `meatywiki init` has been run and the vault directory is intact.
- Vault files (`wiki/`, `raw/`, `blog/`, `projects/`) are the canonical source of truth; `_meta/meatywiki.db` is derived and safe to rebuild.
- No active `compile`, `ingest`, or `watch` processes are running (stop them first to avoid write conflicts).
- `_meta/config.yaml` is valid (doctor can confirm this).

**Command sequence.**
```bash
# Step 0 — Confirm the vault structure and config are valid before resetting
meatywiki doctor

# Step 1 — Rebuild the SQLite + FTS5 index from all vault files
#           The index is derived; reset does NOT delete canonical vault files.
meatywiki index --reset

# Step 2 — Confirm rebuild succeeded: artifact counts and lifecycle distribution
meatywiki stats

# Step 3 — Run doctor again to verify no drift remains
meatywiki doctor
```

**Expected output.**
- **Step 0**: `doctor` prints current health. If it reports `index: stale` or `index: corrupt`, this confirms `index --reset` is the correct next step.
- **Step 1**: `index --reset` prints progress: `Dropping existing index...`, `Scanning vault files...`, `Indexing: N artifact(s)...`, `FTS5 index rebuilt.`, `Done: N artifact(s) indexed in X.Xs`. `_meta/meatywiki.db` is recreated from vault file contents. No vault files are modified.
- **Step 2**: `stats` shows correct artifact counts matching the number of `.md` files in `wiki/` and `raw/`. If counts differ from what you expect, a vault file may be missing required `schema_version: "1.0.0"` frontmatter — run `lint --checks schema` to identify non-compliant files.
- **Step 3**: Second `doctor` run should print all-green: `vault: OK`, `index: fresh`, `config: valid`, `drift: none`.

**Troubleshooting tip.** If `index --reset` exits with an error (e.g., `database is locked`), a background `compile` or `watch` process may still hold a write lock on `_meta/meatywiki.db` — stop those processes and retry. If `stats` after reset shows fewer artifacts than expected, run `lint --checks schema` to find files missing `schema_version: "1.0.0"` frontmatter; the indexer skips files that fail schema validation. Add the missing frontmatter field and re-run `index --reset` (the reset is idempotent — safe to run multiple times). If `doctor` still reports drift after a successful reset, the drift may be in `_meta/compile_state.json`; run `compile --pending` to reconcile the compile state with the current index.
