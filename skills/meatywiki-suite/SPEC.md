---
schema_version: 2
doc_type: skill_spec
skill_name: meatywiki-suite
skill_version: 1.0.0
status: draft
created: 2026-05-04
updated: 2026-05-04
owner: miethe
source_docs:
  - docs/project_plans/llm_wiki/meatywiki-project-spec.md
  - docs/project_plans/llm_wiki/portal/PRDs/portal-v2.md
  - .claude/skills/meatywiki/SPEC.md
aligned_app_version: "2.0.0"
related_skills:
  - meatywiki
affects_commands:
  - /dev:execute-phase
  - /dev:implement-story
---

# MeatyWiki Suite Skill Contract (SPEC.md)

## 1. Purpose & Scope

This file is the durable contract for the `.claude/skills/meatywiki-suite/` skill. The skill's mission is to enable agents to use MeatyWiki's full surface — CLI, Portal API, and MCP server — for knowledge management, content ingestion, compilation, querying, and workflow orchestration. Where the sibling `meatywiki` skill covers the compilation-engine CLI only (A1–A15 + v1.1-ME), this skill covers the combined system at Portal v2 depth: 20+ CLI commands, 75+ Portal API endpoints, 2 MCP tools, and the EngineAdapter programmatic interface.

The skill teaches routing decisions: when to use the CLI directly, when to call a Portal API endpoint, and when to use an MCP tool. It does not duplicate `SKILL.md` routing instructions; instead it provides the durable capability map, invariants, and integration metadata that orchestrators need across versions.

### In-Scope

- 20+ CLI commands (engine + portal subcommands: `init`, `ingest`, `compile`, `query`, `synthesize`, `lint`, `search`, `graph`, `index`, `stats`, `doctor`, `watch`, `promote`, `serve`, `migrate-edges`, `portal reconcile`, `portal embed`, and related flags)
- 75+ Portal API endpoints across artifacts, intake, search, workflows, blog, lens, projects, context packs, and research surfaces
- 2 MCP tools: `vault.search` and `vault.read`
- Vault architecture: directory layout, ownership rules, Obsidian compatibility
- Artifact taxonomy: ~40 subtypes across 5 workspaces
- EngineAdapter programmatic interface: 50+ methods used by Portal modules
- Deployment for agentic usage: auth, config, environment, service startup
- Full auth and configuration setup including `MEATYWIKI_PORTAL_TOKEN` and service bind rules

### Out-of-Scope

| Item | Reason |
|------|--------|
| Portal frontend (Next.js) | Lives in sibling repo `meatywiki-portal`; backend endpoints are in scope, frontend wiring is not |
| SAM / CCDash live integrations | F1/F2 deferred; only no-op stub behavior documented |
| Developer-artifact connectors (SkillMeat, GitHub, Claude configs) | F4 deferred; knowledge-domain connectors only |
| Multi-user / multi-tenant auth | Single-user system; YAGNI |
| Image OCR | Images ingested as opaque blobs; no OCR library in V1 |
| Direct vault file editing | Invariant I1 — always through engine |
| Portal frontend implementation | Out of scope; reads portal-api-reference.md only as a consumer |

---

## 2. Capability Coverage Matrix

Every row maps an agent intent to the skill file or section that handles it, and the canonical source doc to consult for authoritative detail.

| ID | Intent | Workflow / Section | Canonical Doc |
|----|--------|--------------------|---------------|
| A1 | Initialize vault | SKILL.md §2, references/cli-reference.md#init | meatywiki-project-spec.md |
| A2 | Ingest content (URL / PDF / file) | SKILL.md §2 + §4, references/cli-reference.md#ingest | meatywiki-project-spec.md |
| A3 | Compile raw artifacts to wiki | SKILL.md §2 + §4, references/cli-reference.md#compile | meatywiki-project-spec.md |
| A4 | Query knowledge base (FTS5) | SKILL.md §2, references/cli-reference.md#query | meatywiki-project-spec.md |
| A5 | Search artifacts (FTS5 full-text) | SKILL.md §2, references/cli-reference.md#search, references/portal-api-reference.md#search | meatywiki-project-spec.md |
| A6 | Autocomplete / suggest | references/portal-api-reference.md#suggest | portal-v2.md |
| A7 | Create note via API | SKILL.md §4, references/portal-api-reference.md#intake | portal-v1.md |
| A8 | Ingest URL via Portal API | references/portal-api-reference.md#intake | portal-v1.md |
| A9 | List and filter artifacts | references/portal-api-reference.md#artifacts | portal-v1.md |
| A10 | Get artifact detail | references/portal-api-reference.md#artifacts-detail | portal-v1.md |
| A11 | Update artifact metadata (PATCH) | references/portal-api-reference.md#artifacts-patch | portal-v1.md |
| A12 | Bulk metadata update | references/portal-api-reference.md#bulk-metadata | portal-v1.6.md |
| A13 | Lint artifacts | references/cli-reference.md#lint | meatywiki-project-spec.md |
| A14 | Synthesize relationships across artifacts | references/cli-reference.md#synthesize | meatywiki-project-spec.md |
| A15 | Manage workflow templates | references/portal-api-reference.md#workflow-templates | portal-v1.md |
| A16 | Start and monitor a workflow | references/portal-api-reference.md#workflows | portal-v1.md |
| A17 | Stream workflow events (SSE) | references/portal-api-reference.md#workflows | portal-v1.md |
| A18 | Agent SDK vault search (MCP) | references/mcp-reference.md#vault-search | — |
| A19 | Agent SDK artifact read (MCP) | references/mcp-reference.md#vault-read | — |
| A20 | Blog post CRUD | references/portal-api-reference.md#blog | portal-v1.5.md |
| A21 | Manage lens scores | references/portal-api-reference.md#lens | portal-v1.6.md |
| A22 | Context pack CRUD | references/portal-api-reference.md#context-packs | portal-v2.md |
| A23 | Reconcile vault state with Postgres overlay | references/cli-reference.md#portal-reconcile | portal-v1.md |
| A24 | Generate and update embeddings | references/cli-reference.md#portal-embed | portal-v2.md |
| A25 | Research workspace queries | references/portal-api-reference.md#research | portal-v1.7.md |
| A26 | Vault statistics and health check | references/cli-reference.md#stats, references/cli-reference.md#doctor | meatywiki-project-spec.md |
| A27 | Watch vault for changes | references/cli-reference.md#watch | meatywiki-project-spec.md |
| A28 | Deploy service for agentic use | references/deployment-guide.md | — |
| A29 | Intake approval workflow | references/portal-api-reference.md#intake-approval | portal-v1.5.md |
| A30 | Graph and edge queries | references/portal-api-reference.md#graph, references/cli-reference.md#graph | meatywiki-project-spec.md |

**Note on deprecation**: When an intent row is deprecated, mark the Intent column with `[deprecated]` and add a forward reference to the replacement row. Do not delete rows until a MAJOR version bump.

---

## 3. Invariants & Constraints

These are non-negotiable behavioral rules. Agents using this skill must respect all of them. Invariants are numbered I1–I10; breaking any invariant is a defect, not a preference violation.

- **I1**: All vault writes must go through the engine CLI or EngineAdapter. Direct `open()` / `shutil` / `os.remove` on vault paths from any Portal module is prohibited and caught by the `PORTAL-001` ruff rule. Source: `src/meatywiki/CLAUDE.md`, `src/meatywiki/portal/CLAUDE.md`.

- **I2**: The `_meta/` directory is engine-owned. `meatywiki.db`, `compile_state.json`, and `config.yaml` are derived artifacts. Agents must not manually edit them; use `meatywiki index --reset` or `meatywiki doctor` to repair. Source: engine `CLAUDE.md` §Vault layout.

- **I3**: Portal modules must never import `meatywiki.vault` or `meatywiki.workflows` directly. All access routes through `EngineAdapter` (`src/meatywiki/portal/adapters/engine.py`). Source: `src/meatywiki/portal/CLAUDE.md`.

- **I4**: Write-through-engine: Portal mutations flow Portal module → EngineAdapter → `vault/writer.py` → index. The vault write and index update are a single atomic transaction; no path bypasses this chain. Source: portal `CLAUDE.md`.

- **I5**: Two-truth reconciliation: the Postgres overlay is derived from the vault, not authoritative. The reconciler upserts from vault on service startup and FS-watch events. `meatywiki portal reconcile --check` exits non-zero on drift. Source: portal `CLAUDE.md`.

- **I6**: All Portal API routes except `/health` and `/docs` require `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN`. Agents must include this header on every API call. Source: portal config, `src/meatywiki/portal/CLAUDE.md`.

- **I7**: The Portal service refuses non-loopback bind addresses unless `PORTAL_ALLOW_NETWORK=1` is set. Default deployments are local-only. Source: portal `CLAUDE.md`.

- **I8**: API responses use the envelope `{"data": ..., "meta": {...}}`. List endpoints use cursor pagination; agents must follow `meta.next_cursor` to page through results. Source: `.claude/context/key-context/portal-service-mode-v2.md`.

- **I9**: The engine V1 query and search path is FTS5-only. Semantic (vector) search is available only through Portal v2 embeddings when `portal embed` has been run and the pgvector extension is configured. Agents must not attempt `--semantic` on the CLI; that flag is deferred (F3). Source: engine `context.md` Q3.

- **I10**: Portal pins `meatywiki` to an exact engine version (not a range). `EngineAdapter` asserts this pin on `__init__`. Agents must not mix engine and portal versions; use `uv sync --extra portal` to install the pinned combination. Source: portal `CLAUDE.md`.

---

## 4. Enhancement Backlog

- **[BL-1] Semantic search recipes**: Add dedicated workflow patterns for Portal v2 semantic search once embeddings stabilize (P2-2 / P2-3 surface). Agents should use FTS5 today and follow `portal-api-reference.md#search` when the endpoint is live.
  _Status_: planned
  _Rationale_: Portal v2 P2-2 is in progress; API contract not yet finalized as of 2026-05-04.

- **[BL-2] SAM hook recipes**: Full SAM integration recipes (F1 track). Current skill documents no-op stub behavior only.
  _Status_: deferred
  _Rationale_: SAM endpoint contracts not yet ready; stubs are configurable no-ops per P2-1 resolution.

- **[BL-3] CCDash telemetry recipes**: Full CCDash telemetry recipes (F2 track). Current skill documents no-op stub behavior only.
  _Status_: deferred
  _Rationale_: CCDash integration deferred to F2; no endpoint contract exists yet.

- **[BL-4] Developer-artifact connector recipes**: SkillMeat, GitHub, and Claude config connector recipes (F4 track).
  _Status_: deferred
  _Rationale_: Knowledge-domain connectors only in V1; F4 has no delivery date.

- **[BL-5] Image OCR ingest recipe**: Guidance for when OCR support ships. Currently images are opaque blobs with optional captions.
  _Status_: candidate
  _Rationale_: No OCR library in V1 (Q3 resolved); revisit if pypdf is extended or a dedicated OCR stage is added.

- **[BL-6] Multi-user auth setup guide**: Guidance for RBAC, SSO, or multi-tenant deployment.
  _Status_: will-not-fix
  _Rationale_: MeatyWiki is a single-user personal knowledge system. Multi-user auth is explicitly out of scope (CLAUDE.md "Project Context: Personal Use First"). Re-propose only if the system's user model changes.

- **[BL-7] MCP write tools**: `vault.create` and `vault.update` MCP tools for agent-initiated vault mutations.
  _Status_: candidate
  _Rationale_: MCP server currently exposes read-only tools (`vault.search`, `vault.read`). Write tools would close the loop for fully agentic ingestion without requiring CLI subprocess calls.

- **[BL-8] Workflow OS Screen C query API recipes**: Full recipes for the query API surface introduced in Portal v2 P2-4.
  _Status_: planned
  _Rationale_: P2-4 is pending as of 2026-05-04; the Screen C endpoint contracts will be added to `portal-api-reference.md` when the phase completes.

---

## 5. Changelog

### v1.0.0 — 2026-05-04

- Initial release of `meatywiki-suite` SPEC.md.
- Capability coverage matrix: 30 intent rows (A1–A30) spanning engine CLI v1–v1.2, Portal v1–v2 API surface, and MCP server.
- 10 invariants (I1–I10) covering write-through-engine, vault ownership, EngineAdapter boundary, auth, bind policy, envelope format, FTS5-only query, and engine version pin.
- 8 backlog entries (BL-1 through BL-8).
- 11 reference files defined in file inventory (SKILL.md, SPEC.md, README.md, and 8 `references/` files).
- Aligned to application version 2.0.0 (Portal v2 engine-pin line).

---

## 6. Integration Points

| Agent / Command | Invocation Pattern | Notes |
|-----------------|-------------------|-------|
| ai-artifacts-engineer | Creates and updates skill files | Owner of SKILL.md and SPEC.md; updates capability matrix when Portal or engine surface changes |
| backend-typescript-architect | Reads `references/portal-api-reference.md` | Consumes Portal API surface for frontend wiring in sibling repo |
| python-backend-engineer | Reads `references/cli-reference.md` | Uses CLI reference for engine and Portal backend implementation |
| codebase-explorer | Reads `references/vault-layout.md` | Pattern discovery for vault directory conventions |
| /dev:execute-phase | Loads SKILL.md on meatywiki-suite trigger | Phase execution tasks that involve engine or portal operations |
| /dev:implement-story | Loads SKILL.md on meatywiki-suite trigger | Story implementation requiring CLI or API interaction |
| /meatywiki-suite | Direct skill invocation | Full skill load; agents use SKILL.md decision tree to select reference file |
| meatywiki (sibling skill) | Parallel load for engine-only tasks | `meatywiki` skill covers CLI A1–A15 + migrate-edges with deeper per-command flag tables; `meatywiki-suite` routes to it for engine-only tasks |

---

## 7. Success Signals

1. Agent correctly routes to CLI vs. Portal API vs. MCP based on task type without being prompted: CLI for batch/vault operations, API for UI-driven or single-artifact operations, MCP for read-only agent queries.
2. Agent never directly edits vault files; all mutations go through a CLI command or a Portal API call.
3. Agent includes `Authorization: Bearer $MEATYWIKI_PORTAL_TOKEN` on every Portal API call (except `/health` and `/docs`).
4. Agent uses `compile --pending` for incremental compiles and reserves `compile --full` for explicit reset requests; does not run `--full` by default.
5. Token cost per meatywiki-suite task stays under 5K tokens beyond skill load, achieved by loading only the relevant `references/` file rather than all reference files upfront.
6. Agent correctly identifies deferred features (F1 SAM, F2 CCDash, F3 `--semantic`, F4 dev-artifact connectors) and declines to attempt them, directing the user to the backlog entry instead.
7. Agent follows cursor pagination (`meta.next_cursor`) on list endpoints and does not assume single-page results.

---

## 8. File Inventory

| File | Purpose | Max Lines | Owner |
|------|---------|-----------|-------|
| SKILL.md | Entry point: routing decision tree, top recipes, guardrails, reference pointer table | 500 | ai-artifacts-engineer |
| SPEC.md (this file) | Durable contract: capability matrix, invariants, backlog, changelog, integration points | 1000 | ai-artifacts-engineer |
| README.md | Human deployment guide: service startup, token config, MCP wiring | 300 | ai-artifacts-engineer |
| references/cli-reference.md | Full CLI command reference: 20+ commands, flag tables, example invocations, exit codes | 800 | ai-artifacts-engineer |
| references/portal-api-reference.md | Full Portal API reference: endpoints, request/response shapes, auth, pagination, SSE | 800 | ai-artifacts-engineer |
| references/mcp-reference.md | MCP server tools: `vault.search` and `vault.read` schemas and usage | 300 | ai-artifacts-engineer |
| references/vault-layout.md | Vault directory structure, per-directory ownership, `_meta/` boundary, Obsidian compatibility | 500 | ai-artifacts-engineer |
| references/artifact-taxonomy.md | Artifact types (~40 subtypes), workspace mapping, frontmatter envelope, edge types | 600 | ai-artifacts-engineer |
| references/workflow-patterns.md | Complex multi-step recipes: ingest-compile-query, reconcile, embed-search, intake-approval | 800 | ai-artifacts-engineer |
| references/deployment-guide.md | Agentic deployment: uv sync, env vars, service bind, token setup, MCP registration | 500 | ai-artifacts-engineer |
| references/troubleshooting.md | Error diagnosis: vault drift, index corruption, LLM timeout, auth failures, reconcile drift | 500 | ai-artifacts-engineer |
