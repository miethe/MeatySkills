---
name: meatywiki-troubleshooting
description: Common failure modes (vault drift, index corruption, LLM timeout, connector errors, config validation, namespace pollution) with remediation.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki Troubleshooting Reference

## 1. Purpose & Scope

**First-response reference** when the MeatyWiki CLI misbehaves or vault state looks wrong. This file documents 9 failure modes rooted in actual V1 spec (canonical spec §4.1–4.5, PRD FR-19, A3, A13, A14) with exact detection commands and remediation steps.

**Key principle:** When MeatyWiki breaks, the **first-line triage is always `meatywiki doctor`** (FR-19). Any remediation beyond what's documented here requires human review — never invent fixes.

---

## 2. Triage Decision Tree

```
Does `meatywiki doctor` pass?
├─ YES (0 exit, no warnings)
│  └─→ Issue may be content-level; see §8 (deferred features)
│
└─ NO (non-zero exit or warnings)
   ├─ "drift detected: {N} files not in index" or "index/file counts mismatch"
   │  └─→ See failure mode (a): Vault Drift
   │
   ├─ "SQLite error" or "meatywiki.db corrupted"
   │  └─→ See failure mode (b): Index Corruption
   │
   ├─ "invalid config: missing key {key}"
   │  └─→ See failure mode (f): Config Validation Failure
   │
   ├─ "Pydantic validation error" on write
   │  └─→ See failure mode (c): Frontmatter Validation Error
   │
   ├─ "LLM provider error" or "timeout"
   │  └─→ See failure mode (d): LLM Timeout / Provider Error
   │
   ├─ "Connector error" or "URL unreachable"
   │  └─→ See failure mode (e): Connector Error
   │
   ├─ "Reserved namespace field {field} present"
   │  └─→ See failure mode (g): Namespace Pollution
   │
   └─ "writes not via vault/writer.py detected"
      └─→ See failure mode (h): Guardrail Violation (Direct File Write)
```

---

## 3. Failure Modes

### (a) Vault Drift — On-Disk File Not in Index, or Index Row With No File

**Symptom:**
- `meatywiki doctor` reports "drift detected" with file counts.
- `meatywiki stats` shows mismatched artifact counts (e.g., 42 files in `wiki/`, but index has 39 rows).
- Query results missing expected artifacts.

**Root cause:**
Per spec §4.1 (atomic writes via `vault/writer.py`) and A3 (round-trip guarantee): files are canonical; index is derived. Drift occurs when:
- A file was written outside `vault/writer.py` (shell tools, direct edit, backup restore).
- Index rebuild was interrupted mid-operation.
- A transaction rolled back partway through a multi-artifact compile.

**Detection:**
```bash
meatywiki doctor          # Primary: reports exact drift count + file paths
meatywiki stats           # Secondary: shows counts by type/workspace
meatywiki index           # (no rebuild yet — just inspect)
```

**Remediation:**
```bash
# Step 1: Rebuild index from files (files are canonical per A3)
meatywiki index --reset

# Step 2: Verify drift is gone
meatywiki doctor

# Step 3: Confirm counts match
meatywiki stats
```

If `doctor` still reports drift after `index --reset`, escalate to human review — indicates a deeper writer-path bug.

**Prevention:**
- Never write files to `wiki/`, `raw/`, or `_meta/` outside the engine. Reference SKILL.md guardrail (a): all writes go through `vault/writer.py`.
- If importing files from backup, use `meatywiki ingest` or restore files then run `index --reset`.
- Avoid forcibly killing the engine mid-compile; the atomic write guarantee relies on clean process termination.

---

### (b) Index Corruption — SQLite File in `_meta/meatywiki.db` Unreadable

**Symptom:**
- `meatywiki doctor` or any CLI command fails with "SQLite error: database disk image is malformed" or similar.
- `meatywiki stats` fails immediately.
- Cannot query or search.

**Root cause:**
Per A3 and spec §4.5: files are canonical; index is derived and rebuildable. Index corruption is survivable because the source of truth lives in vault files, not the database.

**Detection:**
```bash
meatywiki doctor          # Fails with SQLite error
meatywiki stats           # Fails immediately
sqlite3 _meta/meatywiki.db "PRAGMA integrity_check;"  # Returns errors
```

**Remediation:**
```bash
# Step 1: Rebuild index from canonical vault files
meatywiki index --reset

# Step 2: Verify recovery
meatywiki doctor
meatywiki stats
```

If `index --reset` fails (e.g., writes to `_meta/` fail), escalate — do not delete `_meta/config.yaml` without human review.

**Prevention:**
- Do not edit `_meta/` manually. Reference SKILL.md guardrail (b): `_meta/` is engine-owned.
- `_meta/meatywiki.db` is gitignored; never restore it from git history. The derived index is in `.gitignore` for this reason — restore only vault files.

---

### (c) Frontmatter Validation Error on Write

**Symptom:**
- `meatywiki ingest` or `compile` exits non-zero with "Pydantic validation error: field '{field}' is required".
- Write is refused; no artifact created in vault.

**Root cause:**
Per FR-4 and A2: every write through `vault/writer.py` validates frontmatter against the Pydantic schema. Missing a required field (e.g., no `artifact_type`, missing `workspace`, or no `schema_version: "1.0.0"`) causes rejection.

**Detection:**
```bash
# The error message itself names the field; inspect the write attempt
meatywiki compile --dry-run   # Safe preview; shows which artifact fails validation
meatywiki lint --report       # Reports frontmatter validation errors
```

**Remediation:**
```bash
# Step 1: Identify which file failed (from error message or --dry-run output)
# Step 2: Inspect the raw artifact frontmatter
# (e.g., cat raw/notes/new-note-ULID.md)

# Step 3: Compare against artifact-taxonomy.md required-fields table
# Step 4: Add the missing field (e.g., add schema_version: "1.0.0")
# Step 5: Re-run the command that failed
meatywiki compile --pending
```

**Prevention:**
- Always include `schema_version: "1.0.0"` in manually created frontmatter (per Q9 resolution and FR-4).
- Cross-reference `artifact-taxonomy.md` required-fields table before editing artifact frontmatter.
- Use `compile --dry-run` before committing writes to detect validation errors early.

---

### (d) LLM Timeout / Provider Error During a Compile Stage

**Symptom:**
- `meatywiki compile` exits non-zero mid-pipeline with "OpenAI timeout" or "provider unavailable".
- `meatywiki stats` shows a `workflow_runs` row with `status: failed` and `error: <provider message>`.
- Artifact partially written or rolled back.

**Root cause:**
Per FR-12 and spec §4.4: each compile stage has a per-purpose model routing entry in `_meta/config.yaml` (e.g., `classify: haiku`, `extract: sonnet`, `compile: opus`). An upstream provider (OpenAI, Anthropic via proxy, local model, etc.) returned error or timeout. Per spec §NF (reliability): no retry framework in V1 — linear pipelines only, no DAGs.

**Detection:**
```bash
# Check exit code and structured logs
meatywiki compile --pending               # Non-zero exit
grep "workflow_run_id" ~/.meatywiki/logs/*.json | tail -5  # Find the failed run ID

# Inspect the run record
sqlite3 _meta/meatywiki.db "SELECT * FROM workflow_runs WHERE id = '<run_id>'" 
# Shows: status='failed', error=<provider message>
```

**Remediation:**
```bash
# Option 1: Wait and retry with the same model
meatywiki compile --pending

# Option 2: Switch to a secondary provider (if configured)
# Edit _meta/config.yaml, change the failing stage's provider:
# Before:  extract: { provider: openai, model: gpt-4 }
# After:   extract: { provider: anthropic, model: claude-sonnet }
# Then save and re-run
meatywiki compile --pending

# Option 3: Retry a specific artifact (idempotent per A13)
meatywiki compile --dry-run               # Preview
meatywiki compile <artifact_id>           # Compile the artifact by ID
```

**Prevention:**
- No retry framework in V1. Ensure LLM providers are stable before running compiles on critical sources.
- Configure multiple providers in `_meta/config.yaml` as fallbacks (per spec §4.4 multi-model routing).
- Idempotency per A13 (SHA-256 fingerprints) makes retries safe — re-running the same compile does not create duplicates.

---

### (e) Connector Error — URL Unreachable, PDF Unparseable, Transcript Malformed

**Symptom:**
- `meatywiki ingest <source>` exits non-zero without writing a raw artifact.
- Error message: "URL not found", "PDF parse failed", "unsupported file type", "encoding error in transcript".

**Root cause:**
Per spec §4.3 (normalize stage) and FR-3 (source connector framework): V1 supports 9 knowledge-domain connector types only. Network errors, malformed files, or unsupported formats cause ingest to fail. Developer-artifact connectors (SkillMeat, GitHub, Claude configs) are `[deferred: F4]`.

**Detection:**
```bash
meatywiki ingest <source>    # Non-zero exit with error message
curl -I <url>                # For URLs: confirm reachability
file <filepath>              # For files: confirm format
```

**Remediation:**
```bash
# Verify the input before retrying

# For URLs:
curl -I https://example.com/article  # Confirm reachable and not 404

# For PDFs:
file paper.pdf                       # Confirm it's a valid PDF

# For transcripts:
head transcripts.vtt                 # Inspect encoding and format

# For AI-tool exports (ChatGPT, Perplexity, Gemini):
# Confirm you passed --type with the correct export_type (e.g., --type chatgpt_export)

# If the source is truly unsupported in V1:
# Capture as a raw_note manually (see workflow-patterns.md §fallback recipe)
meatywiki ingest raw_note "Topic: <title>\n\nContent: <summary>"
```

**Prevention:**
- Test URL reachability before ingest (use `curl -I`).
- Verify file format before ingest (`file` command).
- For AI exports, match the `--type` flag to the actual export source (e.g., `--type gemini_export` for a Gemini export).
- For developer-artifact sources: these are `[deferred: F4]`; do not attempt to ingest SkillMeat artifacts, GitHub repos, or Claude configs in V1.

---

### (f) Config Validation Failure

**Symptom:**
- Any CLI invocation (even `meatywiki stats`) fails with "invalid config: missing key '{key}'" or "YAML parse error in config.yaml".
- `meatywiki doctor` reports config check failed.

**Root cause:**
Per FR-12 (multi-model routing) and spec §4.4: `_meta/config.yaml` must declare all required routing entries (e.g., which provider to use for each stage: classify, extract, compile, query). Missing keys or malformed YAML breaks the entire CLI.

**Detection:**
```bash
meatywiki doctor               # Reports exact missing key
cat _meta/config.yaml          # Inspect for syntax errors
```

**Remediation:**
```bash
# Step 1: Compare against the template
# (documented in command-reference.md § init section; see example below)

# Step 2: Add missing required keys or fix YAML syntax
# Example template:
cat > _meta/config.yaml <<'EOF'
vault_root: "."
lmm_routing:
  classify: {provider: "anthropic", model: "claude-haiku"}
  extract: {provider: "anthropic", model: "claude-sonnet"}
  compile: {provider: "openai", model: "gpt-4"}
  query: {provider: "openai", model: "gpt-4"}
api_keys:
  anthropic: "sk-ant-..."
  openai: "sk-..."
EOF

# Step 3: Re-run the command
meatywiki stats
```

If a human hand-edited the config and broke it beyond repair, escalate.

**Prevention:**
- Never hand-edit `_meta/config.yaml` in production. Use `meatywiki init` to bootstrap a fresh config, then run commands to migrate settings.
- Keep a backup of `_meta/config.yaml` before making changes.

---

### (g) Namespace Pollution — SAM/CCDash Fields Present in V1 Frontmatter

**Symptom:**
- `meatywiki lint --report` or `doctor` flags "reserved namespace field present: {field}".
- An artifact contains fields like `skillmeat-type`, `skillmeat-version`, `skillmeat-id`, or `meatywiki-ccdash-feature-slug`.
- The artifact is otherwise valid but has future-phase fields in V1.

**Root cause:**
Per hook-policy.md (namespace reservation) and FR-18: SAM and CCDash namespace fields are reserved for F1/F2. Writing these fields in V1 violates namespace isolation — the spec reserves them but forbids their use until the hooks ship.

**Detection:**
```bash
meatywiki lint --report | grep "reserved namespace"
grep -l "skillmeat-" wiki/**/*.md   # Find artifacts with SAM fields
grep -l "meatywiki-ccdash" wiki/**/*.md  # Find artifacts with CCDash fields
```

**Remediation:**
```bash
# Step 1: Identify the artifact(s)
# Step 2: Remove the offending fields from the frontmatter
# Example: in wiki/concepts/example.md, delete these lines:
# (remove) skillmeat-type: ...
# (remove) skillmeat-version: ...
# (remove) meatywiki-ccdash-feature-slug: ...

# Step 3: Re-validate via lint
meatywiki lint --report
```

**Prevention:**
- Never write SAM or CCDash fields to V1 artifacts. Reference hook-policy.md § Namespace Reservation.
- If migrating from an older version or imported schema, strip these fields before V1 use.

---

### (h) Guardrail Violation — Direct Write to `_meta/` or Skipping `vault/writer.py`

**Symptom:**
- `meatywiki doctor` reports vault drift after a scripted operation.
- Agent wrote a file using shell tools (`echo >`, `cat >`, direct file edits) instead of engine commands.
- Artifacts in `_meta/` have been manually modified (e.g., `compile_state.json` edited).

**Root cause:**
Per A5 and spec §4.1: the atomic-write guarantee and index consistency depend on all writes flowing through `vault/writer.py`. Bypassing the writer layer (via shell, direct filesystem access, or backup tools) causes drift because index updates are not applied in the same transaction.

**Detection:**
```bash
meatywiki doctor                  # Reports drift or suspicious file timestamps
git status                        # If using git: shows unexpected file changes
ls -la _meta/                     # Check modification times and ownership
```

**Remediation:**
```bash
# Step 1: Roll back via git if possible
git checkout HEAD -- wiki/ raw/   # Restore canonical files

# Step 2: Rebuild index
meatywiki index --reset

# Step 3: Verify no drift remains
meatywiki doctor
meatywiki lint

# Step 4: Manually inspect artifacts with `doctor` complaints
```

**Prevention:**
- Always use `meatywiki ingest`, `compile`, `promote`, `lint --fix` for writes — never use `echo >`, `cat >`, or direct filesystem operations.
- Never edit `_meta/meatywiki.db`, `_meta/compile_state.json`, or `_meta/config.yaml` directly (except `config.yaml` via a text editor for routing changes, which is safe as long as you don't edit during a running compile).
- Treat the vault directory as read-only outside the engine. If you need to import files from backup, run `meatywiki ingest` or use `git restore`, then `index --reset`.

---

## 4. Escalation to Human Review

Stop and escalate to human review when:

1. **Repeated vault drift after `index --reset`** — indicates a deeper writer-path bug or corrupted vault. Do not attempt further automated fixes.
2. **`_meta/meatywiki.db` corruption that `index --reset` cannot recover** — the index is derived and should always rebuild; if it fails, file permissions or filesystem damage may be present.
3. **Hand-edited `_meta/config.yaml` beyond repair** — syntax or logic errors that don't match the documented template. Do not guess at fixes.
4. **Any modification required to deferred-feature files** (SAM, CCDash, semantic search, developer-artifact connectors) — these are F1–F6; they are not in V1 scope and require architectural decisions beyond this reference.
5. **Guardrail violation with unknown root cause** — if you cannot identify why a file was written outside `vault/writer.py`, human forensics are needed.

---

## 5. Diagnostic Command Quick Reference

| Need | Command | Notes |
|---|---|---|
| Overall health check | `meatywiki doctor` | First-line triage (FR-19); reports structure, index freshness, config, drift |
| Vault artifact counts | `meatywiki stats` | Counts by type, workspace, freshness, lifecycle stage |
| Validate frontmatter | `meatywiki lint --report` | Reports schema validation errors, broken links, orphans, contradictions |
| Rebuild index | `meatywiki index --reset` | Files are canonical (A3); rebuilds SQLite + FTS5 from vault |
| Preview compile | `meatywiki compile --dry-run` | Shows what would be created/updated without writing |
| Retry compile | `meatywiki compile --pending` | Idempotent (A13); re-running safe via SHA-256 fingerprints |
| Find workflow run | `structlog` logs, `workflow_runs` table | Query by `workflow_run_id` from error output |
| Query wiki | `meatywiki search "<term>"` | FTS5-only (Q5); no `--semantic` flag in V1 |

---

## 6. Deferred Features (Cannot Troubleshoot These in V1)

| Feature | Track | V1 Status | Don't Attempt |
|---|---|---|---|
| Semantic search (`--semantic` flag) | F3 | FTS5-only, no embeddings query path | Do not use `--semantic` flag; it does not exist |
| SAM `register` command + live hook | F1 | No-op stub only | Do not invoke `register` or write SAM fields to frontmatter |
| CCDash telemetry + live hook | F2 | No-op stub only | Do not write CCDash fields or expect JSONL session logs |
| Developer-artifact connectors (SkillMeat, GitHub, Claude configs) | F4 | Knowledge-domain connectors only (Q1) | Do not attempt to ingest SkillMeat artifacts, GitHub repos, or Claude configs |
| Workflow OS lens scoring (fidelity, reusability, sensitivity) | F5 | Not present in V1 | Do not reference lens scoring APIs |

If your failure involves any of these, escalate — they are out of V1 scope.

---

## 7. Cross-References

For detailed information, see:
- **command-reference.md** — Full syntax, flags, and examples for all 14 CLI commands.
- **vault-layout.md** — Directory ownership rules; which dirs are engine-owned vs. user-editable.
- **artifact-taxonomy.md** — Required/recommended/optional frontmatter fields; all ~40 artifact subtypes.
- **hook-policy.md** — SAM/CCDash no-op stub contracts; namespace reservation rules.
- **workflow-patterns.md** — Complete ingest/compile/query/lint recipes with expected output.
- **SPEC.md** — Coverage matrix (A1–A15), CLI version compatibility, deprecation protocol.
- **SKILL.md** — Guardrails summary; decision tree.

**Canonical sources:**
- Compilation-engine-spec §4.1–4.5 (atomic writes, FTS5, fingerprinting, hooks).
- Compilation-engine PRD FR-19 (doctor), A3 (round-trip), A13 (idempotency), A14 (hooks no-op).
- Context resolutions (Q1–Q9 all resolved 2026-04-07).
