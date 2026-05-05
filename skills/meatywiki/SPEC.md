---
name: meatywiki-spec
description: Skill contract for MeatyWiki — coverage matrix, CLI version compatibility, update/deprecation protocol.
type: spec
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 – v1.1 (pre-release; spec-driven)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-28
oq_resolutions:
  OQ-1: "defer-scripts (V1 ships 0 shell scripts; wrapping single-command invocations yields <10% token savings vs. direct CLI call)"
  OQ-3: "option-b-per-file (per-file cli_version_range in references/)"
status: draft
engine_prd_ref: "MeatyBrain/App Ideas/Work/Agentic Control Plane/llm_wiki/compilation-engine/PRDs/compilation-engine-v1.md (additional working dir)"
skill_prd_ref: docs/project_plans/PRDs/features/meatywiki-skill-v1.md
context_ref: .claude/progress/meatywiki-compilation-engine/context.md
---

# MeatyWiki Skill Contract (SPEC.md)

## 1. Purpose

This file is the durable contract for the `.claude/skills/meatywiki/` skill. It defines which CLI surface the skill covers, maps each engine PRD acceptance criterion (A1–A15) to the skill file(s) that satisfy it, and provides the protocol for updating or deprecating skill content when the CLI evolves. It is an AI artifact — agent-facing, not human-documentation.

The skill teaches agents to drive the MeatyWiki compilation-engine V1 CLI (`ingest → classify → extract → compile → file-back → lint`) over an Obsidian-compatible markdown vault. It is spec-driven: the CLI does not exist at authorship time; all guidance derives from the engine PRD, canonical spec, and resolved open questions Q1–Q9.

---

## 2. Scope Boundary

### In Scope

- All 14 V1 CLI commands (see §5 File Inventory; detailed in `references/command-reference.md`).
- File-first vault architecture: `raw/`, `wiki/`, `blog/`, `projects/`, `_meta/`, `_prompts/`.
- FTS5-only full-text search and graph traversal.
- 4 mandatory guardrails (FR-S12): writes through `vault/writer.py`; `_meta/` engine-owned; FTS5-only query; `schema_version: "1.0.0"` in all V1 frontmatter.
- ~40 artifact subtypes across 5 workspaces (`wiki/` subdirs).
- SAM and CCDash no-op stub documentation (F1/F2 deferral markers only).

### Out of Scope (Deferred Features)

| Deferred | Track | Reason |
|---|---|---|
| SAM `register` command + live integration | F1 | `register` deferred to F1 (Q7 resolved); no-op stub only in V1 |
| CCDash live hook wiring | F2 | CCDash telemetry deferred to F2; no-op stub only in V1 |
| Semantic search (`--semantic` flag, vector embeddings) | F3 | FTS5 is the only search backend in V1 (Q5 resolved); `embeddings` table schema reserved only |
| Developer-artifact connectors (SkillMeat, GitHub, Claude configs) | F4 | Knowledge-domain connectors only in V1 (Q1 resolved); 9 connector types |
| Workflow OS lens scoring (fidelity, reusability, sensitivity) | F5 | Deferred per PRD §7 |
| Portal / web UI integrations | F6 | Portal is a separate system (out of scope for engine V1) |
| Image OCR | Q3 | Images ingested as opaque blobs with optional captions; no OCR library in V1 (Q3 resolved) |
| `agent_visibility` enforcement | Q2 | Advisory metadata only; no enforcement code path in V1 (Q2 resolved) |
| Prompt-template auto-recompile | Q4 | Manual `compile --full --scope` only; no prompt-hash tracking (Q4 resolved) |
| DAG workflows / retry framework | — | Linear pipelines only in V1; no DAGs, no branching, no retry |

---

## 3. CLI Version Compatibility

The skill is authored against `compilation-engine-v1` (pre-release, spec-driven). It is valid for the CLI surface defined in engine PRD FR-1 through FR-22.

**Compatibility definition:**
- The skill is valid for a stated `cli_version_range` declared in this file's frontmatter and in each `references/` file's frontmatter.
- A **minor CLI bump** (new flags, new optional commands): update the affected `references/` file, bump its `cli_version_range`, and update the File Inventory row if line budgets shift.
- A **major CLI bump** (renamed commands, removed flags, breaking behavior change): mandatory full skill review triggered; all `references/` file `cli_version_range` fields must be audited; SPEC.md coverage matrix must be reconciled.
- When the real `compilation-engine-v1` ships, validate every command and flag in `references/command-reference.md` against the actual implementation. Discrepancies are breaking changes for skill purposes even if the CLI semver is still v1.

---

## 4. File Inventory

| File | Purpose | Max Lines | Owner Tag |
|---|---|---|---|
| `SKILL.md` | Entry point. Compile-loop overview, decision tree, top 5 recipes (inline), guardrails section, references/ pointer table. | 500 | ai-artifacts-engineer |
| `SPEC.md` (this file) | Skill contract. Coverage matrix A1–A15, CLI compat, file inventory, update/deprecation protocol, validation approach. | 1000 | ai-artifacts-engineer |
| `references/command-reference.md` | Full command map: 14 V1 commands + `migrate-edges` (v1.1), per-command flag tables, example invocations (≥2 per command), exit codes, output format. A `#migrate-edges` section is required (see §5 v1.1-ME). | 900 | ai-artifacts-engineer |
| `references/workflow-patterns.md` | Top 5 workflow recipes with annotated command sequences (setup, command sequence, expected output, troubleshooting tip). | 800 | ai-artifacts-engineer |
| `references/vault-layout.md` | Annotated vault directory tree, per-directory ownership, `_meta/` boundary, Obsidian compatibility notes. | 800 | documentation-writer |
| `references/artifact-taxonomy.md` | ~40 artifact subtypes across 5 workspaces, frontmatter envelope fields, `schema_version: "1.0.0"` requirement. | 800 | ai-artifacts-engineer |
| `references/hook-policy.md` | SAM and CCDash no-op stub behavior, F1/F2 deferral markers, no-op stub interface contract. | 800 | ai-artifacts-engineer |
| `references/troubleshooting.md` | Common failure modes (vault drift, index corruption, LLM timeout, connector errors), remediation steps. | 800 | documentation-writer |
| `scripts/validate-vault.sh` | **Deferred (OQ-1 resolution)**. Would wrap `meatywiki doctor`; direct invocation is one CLI call. No V1 shell script shipped. | — | — |
| `scripts/dry-run-compile.sh` | **Deferred (OQ-1 resolution)**. Would wrap `meatywiki compile --dry-run`; direct invocation is one CLI call. No V1 shell script shipped. | — | — |

**Scripts Policy (OQ-1 resolution, 2026-04-14)**: V1 ships **0 shell scripts**. The two scripts proposed in the plan each wrap a single CLI command with no additional orchestration, yielding <10% token savings per invocation vs. `meatywiki doctor` or `meatywiki compile --dry-run` called directly. Shipping them would add a maintenance surface (shell quoting, PATH assumptions, `meatywiki` executable discovery) without meaningful agent benefit. Agents invoke the CLI commands directly. If a future workflow emerges that genuinely composes 3+ commands with branching logic and is invoked by agents frequently, revisit this decision and author under the skill's standard update protocol (§6).

---

## 5. Coverage Matrix (A1–A15)

Reconciled against engine PRD §18 "Overall Acceptance Criteria" on **2026-04-14** (audit log in §10). Every row cites a skill file that teaches agents how to satisfy the criterion or operate within its boundaries.

| A-ID | Engine-PRD Criterion (verbatim intent) | Skill file(s) that cover it | Status |
|---|---|---|---|
| A1 | **Vault initialization.** `meatywiki init <path>` creates the full vault layout (spec §4.2) with an initial `_meta/config.yaml`; `doctor` returns OK on a fresh vault. | `SKILL.md` §2, `references/command-reference.md#init` / `#doctor`, `references/vault-layout.md` | confirmed |
| A2 | **Frontmatter validation.** Files missing required frontmatter fields are refused by `vault/writer.py` with a Pydantic error; valid writes are atomic (temp + rename) and indexed in the same transaction. | `SKILL.md` §5 guardrail (a), `references/artifact-taxonomy.md` (required fields), `references/troubleshooting.md` (frontmatter validation failure mode) | confirmed |
| A3 | **Index round-trip.** `meatywiki index --reset` rebuilds index from N files so `count(artifacts) == N` with matching `file_hash`; subsequent `doctor` reports zero drift. | `references/command-reference.md#index`, `references/workflow-patterns.md` (index rebuild recipe), `references/troubleshooting.md` (vault drift / index corruption) | confirmed |
| A4 | **URL connector.** `meatywiki ingest <url> --compile` fetches, extracts, classifies as `raw_url/article`, writes `raw_url` artifact in `raw/urls/`, and produces at minimum a `source_summary`. Re-run is a no-op. | `references/command-reference.md#ingest` / `#compile`, `references/workflow-patterns.md` (Recipe 1), `references/artifact-taxonomy.md` (`raw_url` subtype) | confirmed |
| A5 | **PDF connector.** `meatywiki ingest paper.pdf --compile --domain ai` extracts via `pypdf`, classifies as `raw_upload/pdf`, produces `source_summary` + ≥1 `concept`. | `references/command-reference.md#ingest`, `references/workflow-patterns.md` (Recipe 2), `references/artifact-taxonomy.md` (`raw_upload`) | confirmed |
| A6 | **ChatGPT export connector.** `meatywiki ingest chatgpt-export.json --type chatgpt_export --compile` parses multi-turn structure, classifies as `raw_import/chatgpt_export`, produces conversation-aware `source_summary`. | `references/command-reference.md#ingest`, `references/artifact-taxonomy.md` (`raw_import` subtypes) | confirmed |
| A7 | **Entity resolution / dedup.** Three independent sources mentioning the same entity produce **one** `entity` artifact with all three source IDs in `source_refs`; `edges` records three `derived_from` + three `supports` edges. | `references/artifact-taxonomy.md` (entity compounding + edge types), `references/workflow-patterns.md` (compile loop recipe) | confirmed |
| A8 | **Compounding concept page.** Three sources touching the same concept yield a single `concept` artifact with body updated and `source_refs` accumulated; BM25 duplicate check does not flag. | `references/artifact-taxonomy.md` (concept compounding), `references/command-reference.md#lint` | confirmed |
| A9 | **Query with citations.** `meatywiki query "..."` returns answer with `[source: art_XXX]` citation per claim; `--file-back` writes answer as `synthesis` artifact in `wiki/syntheses/` with full `source_refs`. | `SKILL.md` §2/§4 (Recipe 4), `references/command-reference.md#query`, `references/workflow-patterns.md` | confirmed |
| A10 | **Synthesis.** `meatywiki synthesize --scope <scope> --type research_synthesis` produces `synthesis` artifact, detects cross-scope contradictions, emits `contradicts` edges where applicable. | `references/command-reference.md#synthesize`, `references/artifact-taxonomy.md` (synthesis type + `contradicts` edge) | confirmed |
| A11 | **Lint.** `lint --report` outputs JSON with per-check results for 5 deterministic + 2 semantic checks; `lint --checks broken-links --fix` repairs outdated wikilinks whose target file exists. | `references/command-reference.md#lint`, `references/workflow-patterns.md` (Recipe 3), `references/troubleshooting.md` | confirmed |
| A12 | **Multi-model routing.** With `_meta/config.yaml` routing `classify.provider: anthropic` and `compile.provider: openai`, a single run logs LLM calls to both providers attributed to correct stages. | `references/command-reference.md` (init/config section), `references/troubleshooting.md` (LLM timeout, provider switch remediation) | confirmed |
| A13 | **Idempotency.** Re-ingesting an unchanged source is a no-op (0 LLM calls, cache-hit log); re-compile without `--full` is a no-op. | `SKILL.md` §2 (`--full` vs `--pending`), `references/command-reference.md#compile`, `references/troubleshooting.md` (idempotency failure mode) | confirmed |
| A14 | **Hooks interface.** `hooks/sam.py` and `hooks/ccdash.py` exist as no-op stubs that log intent on each lifecycle event; disabling hooks has zero effect on pipeline output. | `SKILL.md` §6 (deferred table), `references/hook-policy.md` (full policy + F1/F2 deferral), `references/artifact-taxonomy.md` (namespace reservation) | confirmed |
| A15 | **Service mode (Should).** `meatywiki serve` starts FastAPI exposing `POST /ingest`, `POST /compile`, `POST /query`, `GET /search` with CLI-parity JSON responses. | `references/command-reference.md#serve`, `SKILL.md` §2/§3 (serve command) | confirmed |
| v1.1-ME | **Edge backfill (`migrate-edges`).** `meatywiki migrate-edges --strategy {wikilink\|cooccurrence\|llm\|all} --vault PATH [--dry-run] [--report PATH] [--max-errors N] [--no-confirm]` backfills v1.1 edge types (REFERENCES, RELATES_TO, SUPERSEDES, CONTAINS) onto a vault that predates the linkage stages. `--strategy llm` and `--strategy all` invoke the LLM router (extract-tier model; cost estimate printed before any writes). `--dry-run` previews scope and cost without writing. `--report PATH` writes a JSON (default) or CSV report (extension-selected). `--max-errors N` (default 100; 0 = unlimited) aborts the current strategy phase after N per-artifact errors. `--no-confirm` skips the interactive cost-confirmation prompt. Exit 0 on success; `SystemExit(1)` on `MigrationAbortedError` (threshold exceeded). Existing edges are never overwritten (UNIQUE constraint violations silently skipped — safe to re-run). | `references/command-reference.md#migrate-edges` (to be authored), `references/workflow-patterns.md` (backfill recipe) | confirmed |

**Cross-cutting V1 invariants** (not numbered criteria but enforced by guardrails; the skill must teach these):

| Invariant | Source | Skill file(s) |
|---|---|---|
| FTS5-only search in V1 (`--semantic` deferred F3) | PRD FR-22 (Q5 resolved) | `SKILL.md` §5 guardrail (c), `references/command-reference.md#query` / `#search` |
| `schema_version: "1.0.0"` mandatory in all V1 frontmatter | PRD §6, context.md migration plan | `SKILL.md` §5 guardrail (d), `references/artifact-taxonomy.md` §Frontmatter Envelope |
| `agent_visibility` advisory (no enforcement) | Context Q2 | `references/artifact-taxonomy.md` (envelope), `references/hook-policy.md` |
| Image OCR not in V1 (opaque blobs + optional caption) | Context Q3 | `references/artifact-taxonomy.md` (`raw_upload/image`) |
| `_meta/` engine-owned | Spec §4.1 | `SKILL.md` §5 guardrail (b), `references/vault-layout.md` |
| 9 V1 knowledge-domain connectors only (dev-artifact connectors `[deferred: F4]`) | PRD Q1, §8 | `references/hook-policy.md`, `references/artifact-taxonomy.md` |

---

## 6. Update / Enhancement Protocol

When the CLI changes (new flag, renamed command, removed behavior, or the real CLI ships and diverges from the spec), follow these steps:

1. **Identify the changed surface.** Diff the CLI release notes or `compilation-engine-v1.md` changes against the current `references/command-reference.md`. Note the command name, flag name, and change type (added / changed / removed).

2. **Locate affected skill files.** Cross-reference the change against:
   - The File Inventory table (§4) to identify which `references/` file owns the command or domain.
   - The Coverage Matrix (§5) to identify which A-ID rows cite that file — those rows may need wording updates.

3. **Update the reference file.** Edit the affected `references/` file. For added flags: add a row to the flag table and ≥1 example invocation. For changed behavior: update the example and expected output. For removed commands/flags: apply the Deprecation Policy (§7) — do not delete immediately.

4. **Bump `cli_version_range` frontmatter.** Update the `cli_version_range` field in the modified `references/` file's YAML frontmatter to reflect the new valid range (e.g., `"compilation-engine-v1.0.0 – v1.2.0"`).

5. **Update SPEC.md.** If a file's line count changed materially (>10%), update the File Inventory row's Max Lines field. If a Coverage Matrix row's skill-file mapping changed, update the row. Bump `updated` date in this file's frontmatter.

6. **Run skill-builder validation.** Confirm SKILL.md is still <500 lines, all `references/` files are <800 lines, frontmatter schema is valid, and structural checks pass.

7. **If it is a major CLI version bump:** trigger a full skill review — audit every row of the Coverage Matrix, re-verify all 14 command entries in `command-reference.md`, and update `cli_version_range` in SPEC.md frontmatter and all `references/` file frontmatters.

---

## 7. Deprecation Policy

**Removed command or flag:**
1. Mark the affected content `[deprecated: engine v{X.Y}]` inline (e.g., in the flag table row or command section header).
2. Keep the deprecated content through one minor CLI version bump so agents on older CLI versions can still find it.
3. At the next minor CLI version bump, delete the deprecated content and remove the `[deprecated]` marker.

**Deferred features (F1–F6):**
- Content for deferred features must carry `[deferred: F{N}]` label in all skill files.
- Deferred content contains no instructional guidance — only a statement that the feature is deferred and which F-track it belongs to.
- When a deferred feature is promoted (e.g., F1 ships SAM integration): remove the `[deferred: F1]` label, add full documentation in the appropriate `references/` file, update the Coverage Matrix row, and follow the Update Protocol above.
- Deferred labels are never removed without a corresponding promotion of the feature into scope.

**Entire skill deprecation:**
- If the MeatyWiki CLI is replaced or substantially rewritten (major version), the skill directory is archived at `.claude/skills/meatywiki-v1-archived/` and a new skill is created for the new version. The archived skill carries `status: deprecated` in its frontmatter.

---

## 8. Validation Approach

Validation is performed at Phase 4 of the implementation plan and again on any CLI version bump.

**(a) Skill-builder structural checks**
- `SKILL.md` present at `.claude/skills/meatywiki/SKILL.md`.
- `SKILL.md` < 500 lines (`wc -l`).
- `SKILL.md` frontmatter schema valid: `name`, `description` fields present and non-empty.
- `references/` directory exists; all six reference files present.
- Each `references/` file < 800 lines.
- Script files (if present) follow naming convention and are executable.

**(b) Coverage matrix audit**
- All 15 rows (A1–A15) cite ≥1 skill file.
- No row cites a file not in the File Inventory (§4).
- All rows have `status: draft` (until engine PRD surfaces and wording is confirmed) or `status: confirmed` (post-reconciliation).

**(c) Command-flag audit**
- Cross-reference every command entry in `references/command-reference.md` against PRD FR-1 (command list) and FR-2 through FR-22 (per-command behavior).
- Currently: cross-reference against skill PRD §13 (V1 CLI command surface reference table) since engine PRD is not present in this repo.
- Confirm all 14 V1 commands are present; confirm no commands not in FR-1 are present; confirm documented flags match skill PRD §13 flag listings (`compile --pending/--scope/--dry-run/--full`, `query --file-back/--scope`, `lint --fix/--report/--checks`, `search --type/--freshness`, `graph --depth/--format`, `index --reset`, `watch --auto-compile`).
- **v1.1 addition — `migrate-edges`**: Confirm `#migrate-edges` section exists in `command-reference.md` with all six flags documented: `--strategy {wikilink|cooccurrence|llm|all}` (required), `--vault PATH` (optional, overrides env/cwd), `--dry-run` (flag), `--report PATH` (optional, extension-selects JSON/CSV), `--max-errors N` (int, default 100; 0 = unlimited), `--no-confirm` (flag). Confirm two exit codes documented: 0 (success) and `SystemExit(1)` (`MigrationAbortedError` / threshold exceeded). Confirm LLM cost implications noted for `llm` and `all` strategies.

**(d) Deferred-feature audit**
- Search all skill files for references to: `register`, `--semantic`, SkillMeat connector, GitHub connector, Claude config connector, Workflow OS, lens scoring, Portal, OCR.
- Confirm each occurrence carries `[deferred: F{N}]` label and contains no instructional guidance.
- Search for `F1`, `F2`, `F3`, `F4`, `F5`, `F6` labels; confirm each is paired with `[deferred: F{N}]` syntax.

**(e) Guardrail completeness check**
- Confirm SKILL.md guardrails section explicitly states all 4 required guards:
  - (a) All writes go through `vault/writer.py`
  - (b) `_meta/` is engine-owned; do not manually edit `meatywiki.db`, `compile_state.json`, `config.yaml`
  - (c) Query and search use FTS5 only; `--semantic` is `[deferred: F3]`
  - (d) `schema_version: "1.0.0"` must appear in all V1 artifact frontmatter

---

## 9. Version Management

**Chosen strategy: option (b) — per-file `cli_version_range` in each `references/` file.**

Each `references/` file carries its own `cli_version_range` field in its YAML frontmatter, scoped to the commands and behaviors it documents. The `cli_version_range` in this file's frontmatter is a roll-up representing the minimum compatible engine version across all `references/` files — it tightens only when every references file has migrated. This enables targeted updates: when a single command ships a breaking change, only the affected file's range and frontmatter need updating, without forcing a whole-skill version bump.

**Per-file frontmatter contract:**

- Each `references/*.md` file MUST declare `cli_version_range: "<spec>"` in its frontmatter, where `<spec>` uses the form `">=<MAJOR.MINOR.PATCH>,<<MAJOR.MINOR.PATCH>"` (PEP 440 / semver range syntax).
- During V1 pre-release authorship, all files declare `cli_version_range: "compilation-engine-v1 (pre-release)"` as a literal string; semver ranges are adopted once the engine ships a tagged release.
- `SPEC.md` frontmatter `cli_version_range` is the intersection (tightest compatible) of all references/ files; bump it only when every references file has migrated.

**Breaking vs. additive vs. patch changes:**

| Change type | Examples | Version impact |
|---|---|---|
| Breaking | Command renamed/removed; flag renamed/removed; default behavior changed; guardrail rule inverted | Bump engine MAJOR → re-run skill audit; update affected references file + its `cli_version_range`; possibly bump `SKILL.md` `skill_version` major |
| Additive | New flag with backward-compatible default; new command added; new artifact subtype; new recipe pattern | Bump engine MINOR → extend affected references file's upper bound in `cli_version_range`; `skill_version` MINOR bump |
| Patch | Clarified docs, error-message wording, non-semantic output format tweak | Bump engine PATCH → usually no skill change required; document in skill commit only |

**When to bump (procedure):**

1. Engine releases new version → grep `.claude/skills/meatywiki/` for affected command/flag mentions.
2. For each hit, update the references file's `cli_version_range` to include the new version (extending upper bound for additive; raising lower bound for breaking).
3. Recompute `SPEC.md` frontmatter `cli_version_range` as the intersection; update if it tightened.
4. If any breaking changes, bump `SKILL.md` frontmatter `skill_version` (MAJOR for breaking, MINOR for additive); re-run skill-builder validation.

**Note on option (c) CHANGELOG rejection:** This strategy deliberately omits a `CHANGELOG.md` (option c). The per-file `cli_version_range` fields combined with git history provide the necessary audit trail without adding a separate sync surface. If a future skill version identifies a concrete need, a CHANGELOG can be added without invalidating this strategy.

---

## 10. Phase 4 Audit Log

**Audit date:** 2026-04-14
**Auditor:** /dev:execute-phase orchestrator (Opus 4.6)
**Engine PRD:** `/Users/miethe/Documents/Other/PKM/MeatyBrain/App Ideas/Work/Agentic Control Plane/llm_wiki/compilation-engine/PRDs/compilation-engine-v1.md` (795 lines; per-capability A1–A15 in §18)

### (a) Coverage matrix reconciliation

Reconciled §5 of this SPEC.md against engine PRD §18 on 2026-04-14. The pre-audit matrix contained *inferred* criteria (the PRD was not previously accessible to the skill). All 15 rows were rewritten against the verbatim per-capability acceptance criteria:

- **15/15 A-IDs** present with specific skill-file citations.
- **0/15** remain in `draft` status; all rows marked `confirmed`.
- Cross-cutting invariants (FTS5-only, `schema_version: "1.0.0"`, agent_visibility advisory, `_meta/` engine-owned, image-as-opaque-blob, 9 V1 connectors) added as a separate table; each cites the guardrail it enforces and the skill file(s) that teach it.

### (b) Command-flag audit (PRD FR-1 vs. `command-reference.md`)

PRD FR-1 command list: `init`, `ingest`, `compile`, `query`, `synthesize`, `lint`, `search`, `graph`, `index`, `stats`, `doctor`, `watch`, `promote` (Must) + `serve` (Should via FR-21). `register` is `[deferred: F1]` per Q7 and is not present.

- **14/14 V1 commands documented** in `references/command-reference.md` and surfaced in `SKILL.md` §3 Command Map.
- **0 invented commands** (scanned for any command word not in FR-1/FR-21).
- **0 invented flags** (cross-checked `--pending`, `--scope`, `--dry-run`, `--full`, `--file-back`, `--fix`, `--report`, `--checks`, `--type`, `--freshness`, `--depth`, `--format`, `--reset`, `--auto-compile`, `--force`, `--compile`, `--domain`, `--semantic` (absent as expected — F3)).
- `register` explicitly marked `[deferred: F1]` in `SKILL.md` §2 decision tree and §6 deferred table.

### (c) Deferred-feature audit

All of the following are confirmed to carry `[deferred: F{N}]` labels and contain no instructional guidance:

| Mention | Location | Label |
|---|---|---|
| `register` command | `SKILL.md` §2 | `[deferred: F1]` |
| SAM hook live integration | `references/hook-policy.md` §4 | `[deferred: F1]` |
| CCDash hook live integration | `references/hook-policy.md` §5 | `[deferred: F2]` |
| `--semantic` flag / vector query | `SKILL.md` §5(c), `references/command-reference.md` (query/search) | `[deferred: F3]` |
| SkillMeat / GitHub / Claude-config connectors | `references/hook-policy.md` §2/§7 | `[deferred: F4]` |
| Workflow OS lens scoring | `SKILL.md` §6 | `[deferred: F5]` |
| Portal / web UI | `SKILL.md` §6, `SPEC.md` §2 | `[deferred: F6]` |
| Image OCR | `SKILL.md` §6, `references/artifact-taxonomy.md` (`raw_upload/image`) | non-F (Q3 resolved) |
| `agent_visibility` enforcement | `references/artifact-taxonomy.md`, `references/hook-policy.md` | non-F (Q2 resolved) |

### (d) Structural checks (skill-builder parity)

- `SKILL.md`: 162 lines (<500 ✓); frontmatter: `name`, `description`, `schema_version`, `skill_version`, `cli_version_range`, `spec_ref` present.
- All 6 references/ files < 800 lines (max: `command-reference.md` = 592).
- All 6 references/ files declare the required per-file frontmatter (`name`, `description`, `type`, `skill_name`, `cli_version_range`, `schema_version`).
- `scripts/` contains only `.gitkeep` (0 scripts shipped; OQ-1 resolution confirmed).
- 4/4 guardrails (a)–(d) present in `SKILL.md` §5.

### (e) OQ resolutions

| OQ | Status | Resolution |
|---|---|---|
| OQ-1 (scripts) | resolved 2026-04-14 | Defer — ship 0 scripts in V1 (see §4 Scripts Policy) |
| OQ-2 (test fixtures) | deferred | F2 skill version (no agent test-vault use case in V1) |
| OQ-3 (versioning) | resolved 2026-04-14 | Option (b): per-file `cli_version_range` (see §9) |

### (f) Residual risks / notes for future audit

- **Draft SPEC status.** The `status: draft` frontmatter remains until the engine CLI ships and commands/flags are validated against the real implementation. Promote to `status: stable` at that time.
- **Line count drift.** `command-reference.md` at 592 lines is the closest to the 800-line ceiling (now bumped to 900 to accommodate `migrate-edges`); monitor on any CLI v1.x flag expansion.
- **Minor inconsistency fixed.** Three references (command-reference, vault-layout, workflow-patterns) used `parent_skill` where the Phase-3 references used `skill_name`. Normalized to `skill_name` on 2026-04-14 for consistency with SPEC.md §9 contract.

---

## 11. v1.1 Audit Log (migrate-edges CLI contract)

**Audit date:** 2026-04-28
**Auditor:** ai-artifacts-engineer (P6-06)
**Engine version:** compilation-engine-v1.1 (entity-linkage; branch `feat/compilation-engine-v1.1`)

### Decision: full contract section (not N/A)

`migrate-edges` is a new top-level CLI command added in v1.1, not a wrapper around an existing command. It exposes a distinct flag surface, output format, and exit-code contract. The SPEC documents commands by name in the Coverage Matrix (§5) and points to `references/command-reference.md` for per-command flag tables. A new Coverage Matrix row (`v1.1-ME`) has been added and the File Inventory row for `command-reference.md` updated to require a `#migrate-edges` section (§4). This is an **additive CLI bump** per the version management table (§9): new command, backward-compatible defaults.

### Verified flag surface (from `src/meatywiki/cli.py` lines 1053–1309)

| Flag | Type | Default | Required | Notes |
|---|---|---|---|---|
| `--strategy` | Choice: `wikilink\|cooccurrence\|llm\|all` | — | yes | Selects edge-backfill stage(s) |
| `--vault` / `vault_flag` | Path (dir, need-not-exist) | None (resolves via env/cwd) | no | Overrides env `MEATYWIKI_VAULT_ROOT` and cwd resolution |
| `--dry-run` | Flag (bool) | False | no | Prints report + cost estimate; no DB writes |
| `--report` / `report_path` | Path (file) | None | no | Extension selects format: `.json` (default) or `.csv` |
| `--max-errors` / `max_errors` | int | 100 (shown in help) | no | Abort after N per-artifact errors; 0 = unlimited |
| `--no-confirm` / `no_confirm` | Flag (bool) | False | no | Skips interactive LLM cost-confirmation prompt |

**Exit codes (verified):**
- `0` — successful migration (or dry-run preview)
- `SystemExit(1)` — `MigrationAbortedError` raised (threshold exceeded); partial report still emitted
- Click `ClickException` (non-zero, Click-managed) — `ValueError` or unhandled `Exception`

**LLM cost behavior (verified):**
- Triggered when `strategy in {"llm", "all"}`
- `estimate_llm_cost()` called before any writes; cost range printed to stderr
- Interactive `click.confirm()` prompt unless `--dry-run` or `--no-confirm`
- Model tier used: `ModelPurpose.EXTRACT` (Sonnet-tier per router config)

**Output (verified):**
- Always emits JSON report to stdout via `format_report(report, fmt="json")`
- If `--report PATH` provided: also writes JSON or CSV to file (format inferred from extension via `_infer_fmt()`)
- Dry-run: emits `[DRY RUN] migrate-edges --strategy ...` prefix line, then report

**Edge types backfilled (verified, from docstring):**
`REFERENCES`, `RELATES_TO`, `SUPERSEDES`, `CONTAINS` — existing edges never overwritten (UNIQUE constraint violations silently skipped; safe to re-run).

### Spec drift observed

**None.** The task prompt listed `--vault PATH` as a required positional-style argument; the actual implementation makes it optional (`default=None`), falling back to env/cwd vault resolution (consistent with all other commands). The contract row in §5 and the flag table above reflect the actual implementation.

### Files requiring follow-up

- `references/command-reference.md` — **needs a `#migrate-edges` section** authored (per §4 File Inventory update). This is out of scope for P6-06 (SPEC-only task) but is a known gap; the §8(c) audit check will catch it at the next validation pass.
- `references/workflow-patterns.md` — may benefit from a backfill recipe (Recipe 6: edge backfill); not required for P6-06.

### cli_version_range update

`SPEC.md` frontmatter `cli_version_range` extended from `"compilation-engine-v1 (pre-release; spec-driven)"` to `"compilation-engine-v1 – v1.1 (pre-release; spec-driven)"` — additive bump per §9 procedure.
