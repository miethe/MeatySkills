---
name: meatywiki-artifact-taxonomy
description: Reference for ~40 artifact subtypes across 5 workspaces, frontmatter envelope fields, and schema_version requirement.
type: reference
skill_name: meatywiki
cli_version_range: "compilation-engine-v1 (pre-release)"
schema_version: 1
created: 2026-04-14
updated: 2026-04-14
---

# MeatyWiki Artifact Taxonomy

## Purpose & Scope

MeatyWiki organizes all knowledge artifacts under a single frontmatter schema with ~40 subtypes distributed across 5 workspaces. This file is the authoritative agent reference for that taxonomy. Sources: spec §4.6 (frontmatter contract), spec §4.7 (artifact taxonomy), PRD FR-4, FR-5, FR-17, and resolved questions Q2 (agent_visibility), Q3 (image OCR), Q5 (semantic search), Q9 (schema_version).

**What this file covers:**
- The 5 workspace values and their artifact-type groupings
- Complete frontmatter envelope — required, strongly recommended, optional, and deferred namespace fields
- Lifecycle and verification state semantics (normative distinction)
- All 5 artifact groups with per-type purpose, subtypes, and example frontmatter
- The `artifact_type` + `subtype` discriminator pattern
- All 7 edge types with direction and typical pairings
- Guardrails recap applicable to artifact construction
- Cross-reference table to sibling skill files

---

## Workspaces

The `workspace` field takes exactly these 5 enum values. Raw artifacts may move from `inbox` to `library` after promote; knowledge artifacts live in `research`.

| `workspace` value | Artifact-type groups | Physical vault dirs | Details |
|---|---|---|---|
| `inbox` | Raw artifacts (newly ingested, unprocessed) | `raw/` | See `vault-layout.md` |
| `library` | Raw artifacts (processed, retained) | `raw/` | Promoted raw artifacts stay in `raw/`; workspace field flips |
| `research` | Knowledge artifacts | `wiki/concepts/`, `wiki/entities/`, `wiki/topics/`, `wiki/summaries/`, `wiki/syntheses/`, `wiki/evidence/`, `wiki/glossary/` | See `vault-layout.md` |
| `blog` | Writing artifacts | `blog/` | See `vault-layout.md` |
| `projects` | Project artifacts | `projects/` | See `vault-layout.md` |

Runtime artifacts (`workflow_run`, `memory_item`) have no vault file; they are internal engine records only.

For directory-level ownership and read/write rules, see `vault-layout.md`. Do not duplicate the tree here.

---

## Frontmatter Envelope

### `schema_version` Requirement

> **All V1 artifacts MUST include `schema_version: "1.0.0"` in their frontmatter.** This field is required by the engine PRD guardrail (FR-4) and resolved per Q9. Artifacts missing this field fail `lint` and will not round-trip through the index.

### Required Fields (all artifact types)

Source: spec §4.6.

| Field | Type / Enum | Purpose |
|---|---|---|
| `id` | ULID string (e.g., `art_01JXYZ123456`) | Assigned by engine; immutable after creation |
| `title` | string | Human-readable artifact title |
| `artifact_type` | enum (see §Taxonomy) | Primary artifact class from spec §4.7 |
| `status` | `active` \| `archived` \| `superseded` | Operational status of the artifact |
| `lifecycle_stage` | `raw` \| `classified` \| `compiled` \| `reviewed` \| `published` | Promotion state (see §Lifecycle) |
| `workspace` | `inbox` \| `library` \| `research` \| `blog` \| `projects` | Workspace the artifact belongs to |
| `created` | ISO 8601 datetime | Engine-set on first write |
| `updated` | ISO 8601 datetime | Engine-set on every write |
| `verification_status` | `unverified` \| `human_review_pending` \| `human_reviewed` \| `machine_verified` | Review/verification state (see §Lifecycle) |

### Strongly Recommended Fields

Source: spec §4.6.

| Field | Purpose |
|---|---|
| `description` | One-paragraph summary of artifact content |
| `source_refs` | IDs of source artifacts this was derived from |
| `derived_from` | Parent artifact(s) in lineage chain |
| `relates_to` | Lateral relationships |
| `supports` | Artifacts this provides evidence for |
| `domain` | Domain tag list (e.g., `[ai, agentic_sdlc]`) |
| `project` | Project tag list (e.g., `[skillmeat]`) |
| `tags` | Free-form tag list |
| `freshness_class` | `current` \| `aging` \| `stale` |
| `contradiction_state` | `none` \| `flagged` \| `resolved` |
| `evidence_strength` | `low` \| `medium` \| `high` |
| `agent_visibility` | `private` \| `shared` \| `published` — **advisory only; no enforcement in V1** (Q2) |

### Optional Fields

Source: spec §4.6.

| Field | Purpose |
|---|---|
| `series` | Blog series identifier |
| `publish_state` | `internal` \| `draft` \| `review` \| `published` |
| `subtype` | Finer-grain discriminator within `artifact_type` (see §Subtype) |
| `owners` | List of owner identifiers |
| `compile_model` | Model used for compilation (e.g., `chatgpt-latest`) |
| `compile_run_id` | Workflow run that produced this artifact |

### Integration Namespace Fields

SAM and CCDash integration fields (`skillmeat-*`, `meatywiki-ccdash-*`) are reserved in the namespace but never written in V1:

- `skillmeat-type`, `skillmeat-version`, `skillmeat-id` — `[deferred: F1]`
- `meatywiki-ccdash-feature-slug`, `meatywiki-ccdash-session-ref` — `[deferred: F2]`

Do not populate these fields in V1.

---

## Lifecycle & Verification Semantics

Source: spec §4.6 (normative).

These are two independent state dimensions. Do not conflate them.

**`lifecycle_stage`** — promotion state, advanced by `meatywiki promote`:

```
raw → classified → compiled → reviewed → published
```

**`verification_status`** — review/verification state, set by review workflow:

```
unverified → human_review_pending → human_reviewed
                                  → machine_verified
```

Normative rules:
- `lifecycle_stage` moves forward only via `promote` (with default rules; `--force` bypasses them).
- If an artifact needs human review after compile, it stays at `lifecycle_stage: compiled` and is marked `verification_status: human_review_pending`.
- `reviewed_pending` is NOT a valid `lifecycle_stage` value.
- `promote` does not touch `verification_status`; the review workflow touches `verification_status` only.

---

## Taxonomy — 5 Artifact Groups

### Group 1: Raw Artifacts (`workspace: inbox` → `library`)

Artifacts created by `ingest`. They land in `raw/` and remain there after promotion (only `workspace` flips from `inbox` to `library`).

**Example frontmatter — `raw_url`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000001
title: "LLM Agents Survey 2026"
artifact_type: raw_url
subtype: article
status: active
lifecycle_stage: classified
workspace: inbox
created: 2026-04-14T09:00:00-04:00
updated: 2026-04-14T09:00:00-04:00
verification_status: unverified
source_refs: []
domain: [ai]
---
```

| Type | Purpose | Typical subtypes | Source connector |
|---|---|---|---|
| `raw_note` | Quick capture or voice note | `quick_capture`, `voice_note` | Manual entry, MeatyCapture |
| `raw_url` | Ingested web page | `article`, `documentation`, `reference` | URL paste, share extension |
| `raw_upload` | Uploaded file — PDF, image, or other | `pdf`, `image`, `file` | File upload; **images are opaque blobs with optional captions — no OCR in V1 (Q3)** |
| `raw_transcript` | Transcribed audio/video | `meeting`, `video`, `podcast` | Transcription service |
| `raw_import` | Exported conversation or AI-tool output | `chatgpt_export`, `perplexity_export`, `gemini_export` | AI tool export connector |

---

### Group 2: Knowledge Artifacts (`workspace: research`)

Engine-compiled artifacts in `wiki/`. These accumulate `source_refs` across ingests (see A7/A8). Entity and concept pages are compounded: re-ingesting a new source that mentions the same entity or concept updates the existing artifact's body and appends to `source_refs` rather than creating a duplicate.

**Example frontmatter — `concept`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000010
title: "Agentic Architecture"
artifact_type: concept
status: active
lifecycle_stage: compiled
workspace: research
created: 2026-04-10T12:00:00-04:00
updated: 2026-04-14T10:00:00-04:00
verification_status: unverified
source_refs: [art_01JAAA, art_01JBBB, art_01JCCC]
derived_from: [art_01JAAA]
domain: [ai, agentic_sdlc]
evidence_strength: medium
freshness_class: current
---
```

| Type | Purpose | Typical edges | Notes |
|---|---|---|---|
| `source_summary` | Summary of one raw source | `derived_from` (raw artifact) | 1:1 with source; first knowledge artifact produced by compile |
| `entity` | Page for a person, org, tool, or product | `derived_from`, `supports` (from sources) | Deduplicated by entity resolution; `source_refs` grows with each new source (A7) |
| `concept` | Page for an idea, pattern, or principle | `derived_from`, `supports` | Body updated across ingests; `source_refs` accumulates (A8) |
| `topic_note` | Overview of a topic or domain area | `relates_to`, `contains` | Aggregate; links to entity and concept pages |
| `synthesis` | Cross-source synthesis | `derived_from` (multiple sources), `supports` | Produced by `synthesize` command or `query --file-back` |
| `evidence_matrix` | Structured comparison across sources | `derived_from`, `contradicts` | Tabular; surfaced by `synthesize` |
| `contradiction_matrix` | Conflicting claims from multiple sources | `contradicts` edges | Created when contradictions detected during compile or synthesize |
| `glossary_term` | Definition with domain context | `relates_to` | Lives in `wiki/glossary/` |

**Example frontmatter — `entity`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000020
title: "Claude Code"
artifact_type: entity
status: active
lifecycle_stage: compiled
workspace: research
created: 2026-04-05T08:00:00-04:00
updated: 2026-04-14T11:00:00-04:00
verification_status: unverified
source_refs: [art_01JSRC1, art_01JSRC2, art_01JSRC3]
domain: [ai, tooling]
evidence_strength: high
---
```

**Example frontmatter — `synthesis`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000030
title: "Approaches to Agentic SDLC — Synthesis"
artifact_type: synthesis
subtype: research_synthesis
status: active
lifecycle_stage: compiled
workspace: research
created: 2026-04-14T14:00:00-04:00
updated: 2026-04-14T14:00:00-04:00
verification_status: human_review_pending
source_refs: [art_01JAAA, art_01JBBB]
derived_from: [art_01JAAA, art_01JBBB]
domain: [ai, agentic_sdlc]
compile_model: gpt-4o
compile_run_id: run_01JXYZ
---
```

---

### Group 3: Writing Artifacts (`workspace: blog`)

Artifacts in `blog/`. User-owned output surface; engine does not write here in V1.

| Type | Purpose | Typical subtypes |
|---|---|---|
| `blog_idea` | Captured idea for a post | `draft_idea`, `rough_concept` |
| `blog_outline` | Structured outline for a post | — |
| `blog_draft` | Draft content for a post | — |
| `series` | Series definition and tracking metadata | — |
| `review_comment_set` | Review feedback on a draft | — |

**Example frontmatter — `blog_draft`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000040
title: "Why Knowledge Compilation Changes Everything"
artifact_type: blog_draft
status: active
lifecycle_stage: compiled
workspace: blog
created: 2026-04-12T10:00:00-04:00
updated: 2026-04-14T09:00:00-04:00
verification_status: unverified
series: governed-agentic-sdlc
publish_state: draft
---
```

---

### Group 4: Project Artifacts (`workspace: projects`)

Artifacts in `projects/`. User-owned. Engine does not write here in V1.

| Type | Purpose | Typical subtypes |
|---|---|---|
| `context_pack` | Assembled context for agent or project work | — |
| `brief` | Project brief | — |
| `prd` | Product requirements document | — |
| `adr` | Architecture decision record | — |
| `implementation_plan` | Step-by-step build plan | — |
| `session_log` | Dev or research session record | — |
| `decision` | Decision record | — |
| `risk` | Risk register entry | — |

**Example frontmatter — `adr`:**

```yaml
---
schema_version: "1.0.0"
id: art_01JXYZ000050
title: "ADR-001: File-First Architecture"
artifact_type: adr
status: active
lifecycle_stage: reviewed
workspace: projects
created: 2026-04-01T10:00:00-04:00
updated: 2026-04-14T08:00:00-04:00
verification_status: human_reviewed
project: [meatywiki]
---
```

---

### Group 5: Runtime Artifacts (internal — no vault file)

These are engine-internal records stored in the SQLite index only. They have no corresponding markdown file and no `workspace` assignment.

| Type | Purpose |
|---|---|
| `workflow_run` | Record of a workflow execution (stage timings, model calls, cost) |
| `memory_item` | Learned knowledge item for agent context reuse |

---

## Subtype Discriminator

Source: spec §4.7 intro ("~40 subtypes").

The primary `artifact_type` field identifies the artifact group. The optional `subtype` field provides finer-grain discrimination within that group. Together they represent the ~40 subtypes referenced in PRD FR-5.

The spec lists 28 named primary types across 5 groups (5 raw + 8 knowledge + 5 writing + 8 project + 2 runtime). The "~40 subtypes" count includes concrete subtype values enumerated in spec §4.7 tables (e.g., `raw_url/article`, `raw_url/documentation`, `raw_import/chatgpt_export`) which expand the 28 base types to approximately 40 addressable leaf types in `schema/taxonomy.py`.

**Pattern:**
```yaml
artifact_type: <primary-type>
subtype: <finer-grain-value>     # optional
```

**Examples:**

| `artifact_type` | `subtype` | Meaning |
|---|---|---|
| `synthesis` | `research_synthesis` | Cross-source synthesis produced by `synthesize` |
| `raw_import` | `chatgpt_export` | Imported ChatGPT conversation export |
| `raw_url` | `article` | Ingested article URL |
| `raw_upload` | `pdf` | Uploaded PDF file |
| `entity` | (none) | Entity page; no standard subtypes |

---

## Edge Types (7)

Source: PRD FR-17; spec §4.4 (SQLite schema `edges` table).

All 7 edge types are stored in the `edges` table as directed relationships. Edges are written by the compile and synthesize stages. Traverse with `meatywiki graph --depth <n> --format <fmt>` (see `command-reference.md` for full flag detail).

| Edge type | Direction | Typical source → target | When written |
|---|---|---|---|
| `derived_from` | child → parent | `source_summary` → `raw_url`; `concept` → `raw_note` | Compile: links a compiled artifact to its source raw artifact(s) |
| `supports` | evidence → claim | `evidence_matrix` → `synthesis`; `source_summary` → `concept` | Compile: marks one artifact as providing evidence for another |
| `relates_to` | lateral | `concept` ↔ `topic_note`; `entity` ↔ `concept` | Compile: lateral associations discovered during extract |
| `supersedes` | new → old | `concept` (v2) → `concept` (v1) | Promote or re-compile: when an artifact replaces a prior version |
| `contradicts` | artifact ↔ artifact | `source_summary` ↔ `source_summary`; `evidence_matrix` → `concept` | Synthesize: when contradicting claims are detected across sources |
| `contains` | parent → child | `topic_note` → `concept`; `context_pack` → `synthesis` | Compile: compositional containment (e.g., a topic note that aggregates concept pages) |
| `generated_by` | artifact → run | any artifact → `workflow_run` | Compile/synthesize: links an artifact to the `workflow_run` record that produced it |

**Graph traversal:** `meatywiki graph --depth <n> --format <fmt>` — see `command-reference.md#graph` for flags and output formats.

---

## Guardrails Recap

Artifact-relevant subset of SKILL.md guardrails (§5):

- `schema_version: "1.0.0"` must appear in all V1 artifact frontmatter (guardrail d; Q9 resolution; PRD FR-4).
- `agent_visibility` is advisory metadata only — no enforcement code path in V1 (Q2 resolution; SPEC.md A15).
- All writes go through `vault/writer.py`; file and index are updated in the same transaction. Direct file edits cause vault/index drift.
- Integration namespace fields (`skillmeat-*`, `meatywiki-ccdash-*`) are reserved but never written in V1 (`[deferred: F1]`, `[deferred: F2]`). Do not populate them.

---

## Cross-References

| File | What it covers | When to load it |
|---|---|---|
| `vault-layout.md` | Annotated directory tree, per-directory ownership, `_meta/` boundary, Obsidian compat | Need to know where a specific artifact type lives on disk |
| `command-reference.md` | All 14 V1 CLI commands, per-command flag tables, exit codes | Need full flag/exit-code detail; graph traversal options |
| `hook-policy.md` | SAM and CCDash no-op stub behavior, F1/F2 deferral interface contract | Working near integration namespace fields or hook boundary |
| `workflow-patterns.md` | Ingest → compile recipes with annotated command sequences | Need end-to-end workflow with setup/output/troubleshooting |
| `SPEC.md` §5 rows A7/A8/A14/A15 | Coverage matrix: entity dedup, compounding concept pages, graph edges, agent_visibility + image OCR advisory | Verifying skill coverage of acceptance criteria |
