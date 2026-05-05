---
name: meatywiki-suite-workflow-patterns
description: Multi-step workflow recipes for common agentic use cases — CLI, API, and combined patterns
type: reference
skill_name: meatywiki-suite
cli_version_range: "compilation-engine-v1 – v1.2, portal-v2"
schema_version: 1
created: 2026-05-04
updated: 2026-05-04
---

# Workflow Patterns Reference

Multi-step recipes for common agentic use cases. Each recipe covers CLI commands, API calls, or combinations. Keep tool calls minimal — use `--batch` and bulk endpoints where available.

---

## Recipe 1: Research a Topic End-to-End

**When to use**: Exploring an unfamiliar topic, building on existing knowledge before generating new synthesis.

```bash
# 1. Check what already exists
meatywiki search "topic" --workspace wiki

# 2. Generate or refresh synthesis
meatywiki query "summarize what we know about topic" --file-back

# 3. Verify the synthesis artifact landed
meatywiki search "topic" --workspace wiki --type synthesis
```

Expected outcome: A synthesis artifact under `wiki/syntheses/` consolidating existing knowledge on the topic.

---

## Recipe 2: Bulk Ingest a Directory of Documents

**When to use**: Onboarding a folder of PDFs, markdown files, or exported content into the vault.

```bash
# 1. Ingest all files and compile in one pass
meatywiki ingest /path/to/docs/ --batch --compile

# 2. Check artifact counts and pipeline state
meatywiki stats

# 3. Repair any dedup or index issues found
meatywiki doctor --fix
```

Expected outcome: All files in `raw/`, compiled artifacts in `wiki/`, index updated.

---

## Recipe 3: API-Driven Content Management

**When to use**: Programmatic note creation from an external tool or integration (no CLI available).

```bash
# 1. Create a note via intake API
curl -X POST http://localhost:8000/api/intake/note \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "My Note", "body": "Content here", "workspace": "wiki"}'

# 2. Poll until compilation completes (job_id from step 1 response)
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/intake/jobs/{job_id}

# 3. Verify the compiled artifact
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/artifacts/{id}

# 4. Update metadata (tags, workspace, lens scores)
curl -X PATCH http://localhost:8000/api/artifacts/{id} \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["tag1"], "workspace": "wiki"}'
```

Expected outcome: Artifact created, compiled, and metadata updated via API.

---

## Recipe 4: Workflow-Driven Compilation via SSE

**When to use**: Triggering a synthesis or compile workflow and streaming progress events.

```bash
# 1. Start a synthesize workflow
curl -X POST http://localhost:8000/api/workflows/synthesize \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope": {"workspace": "wiki", "tags": ["ai"]}}'

# 2. Stream progress events (run_id from step 1)
curl -N -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/sse/workflows/{run_id}

# 3. Fetch final run summary
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/workflows/runs/{run_id}
```

Expected outcome: Synthesis artifacts created for the scoped content; SSE stream shows stage-by-stage progress.

---

## Recipe 5: Quality Audit and Lens Score Review

**When to use**: Periodic vault health check, identifying low-quality or incomplete artifacts.

```bash
# 1. Run the linter and dump a report
meatywiki lint --report lint-results.json

# 2. Auto-fix everything the linter can resolve
meatywiki lint --fix

# 3. Find artifacts with lowest lens fidelity scores
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  "http://localhost:8000/api/artifacts?sort=lens_fidelity&order=asc&limit=20"

# 4. Update lens score on a specific artifact after manual review
curl -X PATCH http://localhost:8000/api/artifacts/{id}/lens \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fidelity": 0.85, "notes": "reviewed and updated"}'
```

Expected outcome: Lint issues resolved, low-scoring artifacts identified for follow-up.

---

## Recipe 6: Knowledge Graph Exploration

**When to use**: Traversing relationships between artifacts, finding backlinks, exploring concept neighborhoods.

```bash
# 1. Get edges from a specific artifact (CLI)
meatywiki graph --artifact "artifact-id" --depth 2

# 2. Or via API
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/artifacts/{id}/graph

# 3. Find all backlinks to an artifact
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  "http://localhost:8000/api/research/backlinks?artifact_id={id}"
```

Expected outcome: Graph edges and related artifacts returned; useful for building synthesis prompts or surfacing orphaned content.

---

## Recipe 7: Import AI Export Files (ChatGPT / Perplexity / Gemini)

**When to use**: Importing a JSON export from ChatGPT, Perplexity, or Gemini into the vault.

```bash
# 1. Ingest with explicit type hint (avoids ambiguous JSON detection)
meatywiki ingest export.json --type chatgpt   # or: perplexity, gemini

# 2. Compile pending raw artifacts
meatywiki compile --pending

# 3. Verify content landed
meatywiki search "topic from export"
```

Notes: Use `--type` whenever the export format is ambiguous. Connectors run in order (`import_chatgpt` → `import_perplexity` → `import_gemini` → `UploadFileConnector` catch-all); explicit `--type` skips dispatch ordering.

Expected outcome: Export conversations compiled into wiki artifacts with source provenance preserved in frontmatter.

---

## Recipe 8: Intake Approval Workflow

**When to use**: `PORTAL_INBOX_REQUIRE_APPROVAL=1` is set; items need human review before compilation.

```bash
# 1. Enable approval gate (env var, then restart portal)
export PORTAL_INBOX_REQUIRE_APPROVAL=1

# 2. Trigger inbox scan
curl -X POST http://localhost:8000/api/admin/inbox/scan \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN"

# 3. Review pending items
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  "http://localhost:8000/api/intake/jobs?status=pending_approval"

# 4a. Approve a job
curl -X POST http://localhost:8000/api/intake/jobs/{id}/approve \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN"

# 4b. Reject a job
curl -X POST http://localhost:8000/api/intake/jobs/{id}/reject \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -d '{"reason": "duplicate content"}'
```

Expected outcome: Only approved items proceed to compilation; rejected items logged with reason.

---

## Recipe 9: Context Pack for Project Work

**When to use**: Assembling a curated set of artifacts as a named context pack for a project session.

```bash
# 1. Create a context pack (artifact IDs from search/graph results)
curl -X POST http://localhost:8000/api/projects/context-packs \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Research Pack", "artifact_ids": ["id1", "id2", "id3"]}'

# 2. List all context packs
curl -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  http://localhost:8000/api/projects/context-packs

# 3. Update pack membership
curl -X PUT http://localhost:8000/api/projects/context-packs/{id} \
  -H "Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"artifact_ids": ["id1", "id2", "id4"]}'
```

Expected outcome: Named context pack created and available for project workspace sessions.

---

## Recipe 10: Full Vault Maintenance

**When to use**: Periodic health reset, after manual vault edits, or when stats show drift.

```bash
# 1. Dry-run reconciliation to check for Postgres/vault drift
meatywiki portal reconcile --check

# 2. Apply reconciliation if drift found
meatywiki portal reconcile

# 3. Rebuild SQLite + FTS5 index from scratch
meatywiki index --reset

# 4. Refresh all embeddings (force re-embed all artifacts)
meatywiki portal embed --force

# 5. Repair dedup, orphan edges, and naming issues
meatywiki doctor --fix

# 6. Verify final state
meatywiki stats --json
```

Expected outcome: Index, Postgres overlay, and vault all in sync; embeddings current; no orphaned or duplicate artifacts.
