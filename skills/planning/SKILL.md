---
name: planning
description: >
  Generate and optimize PRDs, Implementation Plans, and Progress Tracking
  documents optimized as AI artifacts for development agents. Use when
  creating new feature plans, breaking down long planning docs (>800 lines),
  or setting up progress tracking. Supports: 1) Create PRD from feature
  request, 2) Create Implementation Plan from PRD with phase breakdown and
  subagent assignments, 3) Optimize existing plans by breaking into
  phase-specific files, 4) Create progress tracking with task assignments.
  Example: "Create a PRD for user authentication feature" or "Break down the
  sidebar-polish implementation plan into phase files" or "Create progress
  tracking for data-layer-fixes PRD".
---

# Planning Skill

## About This Skill

The Planning Skill generates and optimizes Product Requirements Documents (PRDs) and Implementation Plans as AI artifacts - file-based context caches optimized for AI agent consumption rather than human reading.

### Purpose

- Generate comprehensive PRDs from feature requests following MP template
- Create phased Implementation Plans with subagent task assignments
- Optimize existing planning docs by breaking into token-efficient files
- Set up progress tracking structures for multi-phase implementations

### Key Benefits

- **Token Efficiency**: Max ~800 lines per file for optimal AI context loading
- **Progressive Disclosure**: Summary → Detail pattern with linked files
- **Subagent Integration**: Automatic task assignment to appropriate specialists
- **MP Architecture Compliance**: Plans follow layered architecture (routers → services → repositories → DB)
- **Structured Tracking**: One progress file per phase following CLAUDE.md policy

### Token Discipline (Mandatory for Orchestrators)

**Opus must NOT read source documents that subagents will also read.** Provide file paths in delegation prompts instead.

| What to Delegate | Agent | Prompt Size Target |
|-----------------|-------|-------------------|
| OQ assessment | haiku (general) | 10-15 lines |
| PRD creation | prd-writer (sonnet) | 30-50 lines |
| Implementation plan | implementation-planner (sonnet) | 40-60 lines |
| Progress files | python-backend-engineer (sonnet) | 20-30 lines |

**What Opus reads directly**: Tracker entries (~5 lines), meta-plan rows (~5 lines), frontmatter for edits (~15 lines). Nothing else.

**Anti-patterns with measured cost**: See `docs/project_plans/CLAUDE.md` for the full anti-pattern table with token costs. Key rule: reading a SPIKE as Opus to inform a prd-writer prompt costs ~7K tokens; delegating OQ assessment to haiku costs ~1.2K (6x cheaper).

### Agent Consumption Rule

**Agents invoked for implementation, review, or execution MUST NOT load `docs/project_plans/human-briefs/` files unless the task prompt explicitly names the brief.**

- The `audience: [humans]` frontmatter field is the machine-readable skip signal.
- Briefs contain orchestrator-level rationale (estimation narrative, wave strategy, open-question inventory). This content is irrelevant to executing subagents and burns context budget without improving output quality.
- **Exception**: An agent may be explicitly asked to populate an initial brief skeleton or append a note to the Running Log. In both cases, the task prompt must name the brief file explicitly.
- Spec reference: `.claude/specs/artifact-structures/human-brief-spec.md` §5.

### When to Use This Skill

- Creating PRDs for new features or enhancements
- Generating detailed implementation plans from PRDs
- Breaking down long planning documents (>800 lines) into manageable files
- Setting up progress tracking for multi-phase work
- Optimizing existing plans for better AI agent consumption
- **Generating Planning Review Boards** to visualize all planning artifacts for a feature

## Quick Start

### Create PRD from Feature Request

```bash
# User provides feature description
User: "Create a PRD for advanced filtering on the prompts page"

# Skill generates PRD at:
# docs/project_plans/PRDs/[category]/advanced-filtering-v1.md
```

### Create Implementation Plan from PRD

```bash
# Provide PRD path
User: "Create implementation plan for docs/project_plans/PRDs/harden-polish/advanced-filtering-v1.md"

# Skill generates:
# - Main plan: docs/project_plans/implementation_plans/harden-polish/advanced-filtering-v1.md
# - Phase files (if needed): docs/project_plans/implementation_plans/harden-polish/advanced-filtering-v1/phase-[N]-[name].md
```

### Generate Planning Review Board

```bash
# Auto-discover all planning docs for a feature and generate interactive HTML board
python scripts/generate-planning-board.py \
  --feature-slug enterprise-tier-comparison-scopes \
  --wireframe-dir docs/dev/designs/wireframes/enterprise-unified-sync \
  --output planning-review-board.html \
  --open

# Or from a specific implementation plan path
python scripts/generate-planning-board.py \
  --plan docs/project_plans/implementation_plans/features/some-feature-v1.md

# Preview what would be discovered without generating
python scripts/generate-planning-board.py --feature-slug xyz --dry-run
```

**Reference**: `.claude/skills/planning/references/planning-review-board.md`

### Optimize Existing Plan

```bash
# Provide existing plan path
User: "Optimize docs/project_plans/implementation_plans/harden-polish/sidebar-polish-v1.md"

# Skill:
# 1. Analyzes plan length (e.g., 1200 lines)
# 2. Breaks into phase-specific files (~400 lines each)
# 3. Updates parent plan with links to phase files
```

### Create Progress Tracking

```bash
# Provide PRD or Implementation Plan
User: "Create progress tracking for data-layer-fixes PRD"

# Skill generates:
# .claude/progress/[feature-name]/all-phases-progress.md
# With task breakdown, subagent assignments, completion tracking
```

### Track Plan Status Lifecycle

```bash
# Mark PRD approved
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file docs/project_plans/PRDs/features/feature-name-v1.md \
  --status approved

# Mark implementation in progress
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file docs/project_plans/implementation_plans/features/feature-name-v1.md \
  --status in-progress

# Mark implementation completed
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file docs/project_plans/implementation_plans/features/feature-name-v1.md \
  --status completed
```

Status values: `draft` → `approved` → `in-progress` → `completed`

**Reference**: See `.claude/skills/artifact-tracking/plan-status-management.md` for full status management guide.

## CCDash Frontmatter Requirements

Use CCDash-aligned frontmatter for all planning artifacts.

- Reference: `.claude/skills/artifact-tracking/schemas/field-reference.md`
- Baseline fields for all planning docs: `schema_version`, `doc_type`, `title`, `status`, `created`, `updated`, `feature_slug`
- Linkage fields: `prd_ref`, `plan_ref`, `related_documents`
- Lifecycle fields to update after implementation: `commit_refs`, `pr_refs`, `files_affected`

### Canonical Paths Table

All planning documents follow a canonical location pattern by doc type, enabling discovery and cross-referencing.

| doc_type | Purpose | Canonical Location | Feeds / Downstream |
|----------|---------|-------------------|-------------------|
| `design_spec` | Pre-PRD ideation and design, varying maturity | `docs/project_plans/design-specs/[name].md` | `prd` |
| `prd` | Formal product requirements | `docs/project_plans/PRDs/[category]/[name]-v1.md` | `implementation_plan` |
| `implementation_plan` | Phased technical breakdown | `docs/project_plans/implementation_plans/[category]/[name]-v1.md` | `phase_plan`, `progress` |
| `phase_plan` | Single phase (if parent plan >800 lines) | `docs/project_plans/implementation_plans/[category]/[name]-v1/phase-[N]-[title].md` | `progress` |
| `progress` | Phase task tracking and orchestration | `.claude/progress/[feature-slug]/phase-[N]-progress.md` | — |
| `spike` | Formal research investigation with charter | `docs/project_plans/SPIKEs/[name]-charter.md` or `docs/project_plans/SPIKEs/[name].md` | `design_spec`, `prd`, ADR |
| `report` | Investigation, audit, finding, post-mortem | `docs/project_plans/reports/[category]/[name].md` or `.claude/findings/[name].md` | `design_spec`, `prd` |
| `meta_plan` | Workflow, process, or tooling change (not product) | `.claude/plans/[name].md` | — |
| `human_brief` | Human-orchestrator lens: estimation rationale, wave strategy, OQ ledger, success behaviors | `docs/project_plans/human-briefs/[feature-slug].md` | — (audience: humans; agents skip) |

**Categories** (PRD and implementation_plan subdirs): `features`, `enhancements`, `refactors`, `harden-polish`, `infrastructure`

**Report categories** (subdirs under `docs/project_plans/reports/`): `findings`, `investigations`, `audits`, `post-mortems`, `refactor-reports`

### Cross-Reference Policy

**Prefer envelope fields over ad-hoc fields** for linking planning documents. This enables consistent discovery and prevents scattered linkage patterns.

**Canonical linkage fields** (prefer these):
- `prd_ref`: Path to the PRD this design_spec or report is linked to
- `plan_ref`: Path to the implementation plan this phase_plan or progress is linked to
- `spike_ref`: Path to the spike this design_spec or PRD references
- `related_documents`: Array of paths to related docs (cross-references, background, context)

**Legacy fields to migrate** (phase out over time):
- `related_prds`: OLD; use `prd_ref` or `related_documents` instead
- Scattered ad-hoc fields in existing docs that don't follow envelope schema

**Migration strategy**: When updating a design_spec or report with `related_prds`, refactor to use `prd_ref` (if single primary PRD) or move items into `related_documents` (if multiple cross-references).

**Example**:
```yaml
# OLD (avoid):
related_prds:
  - docs/project_plans/PRDs/features/xyz-v1.md

# NEW (correct):
prd_ref: docs/project_plans/PRDs/features/xyz-v1.md

# Multiple related docs:
related_documents:
  - docs/project_plans/PRDs/features/xyz-v1.md
  - docs/dev/architecture/adr-123.md
  - .claude/context/some-pattern.md
```

### Field Checklist by Doc Type

- `prd`
  - Required now: `schema_version`, `doc_type: prd`, `title`, `status`, `created`
  - Populate early: `feature_slug`, `priority`, `risk_level`, `owner`, `contributors`
  - Keep `prd_ref: null`; set `plan_ref` after implementation plan exists
  - Optional: `changelog_required: true` — set when the feature introduces user-facing changes that must appear in CHANGELOG `[Unreleased]` before release. Omit (default: unset, treated as false) for purely internal or infrastructure-only changes. When set, Phase 7 Documentation Finalization **must** include a CHANGELOG entry. See `.claude/specs/changelog-spec.md` for categorization rules.

- `implementation_plan`
  - Required now: `schema_version`, `doc_type: implementation_plan`, `title`, `status`, `created`, `prd_ref`
  - Populate early: `scope`, `effort_estimate`, `feature_slug`, `priority`, `risk_level`
  - Set `plan_ref: null` for root implementation plan
  - If plan includes deferred items or research-needed items: populate `deferred_items_spec_refs` as design specs are authored in the final phase; populate `findings_doc_ref` if a findings doc is created lazily during execution
  - Optional: `changelog_required: true` — inherit from the parent PRD or set independently when the implementation scope confirms user-facing changes. When set, Phase 7 Documentation Finalization **must** include a CHANGELOG `[Unreleased]` entry. Default: unset (false). See `.claude/specs/changelog-spec.md`.

- `phase_plan`
  - Required now: `schema_version`, `doc_type: phase_plan`, `title`, `status`, `created`, `phase`, `phase_title`
  - Populate early: `prd_ref`, `plan_ref`, `entry_criteria`, `exit_criteria`
  - Keep `feature_slug` aligned with parent PRD/plan

- `spike`
  - Required now: `schema_version`, `doc_type: spike`, `title`, `status`, `created`
  - Populate early: `feature_slug`, `research_questions`, `complexity`, `estimated_research_time`
  - Set `prd_ref`/`plan_ref` when spike is linked to planned work

- `human_brief`
  - Required always: `schema_name: ccdash_document`, `schema_version: 2`, `doc_type: human_brief`, `title`, `status`, `created`, `audience: [humans]`, `feature_slug`, `category: human-briefs`
  - Required when linked docs exist: `prd_ref`, `plan_ref`
  - Populate early: `owner`, `priority`, `confidence`, `feature_family`, `feature_version`
  - Reserve but leave null: `intent_ref`, `epic_ref` (forward-compat for INTENT.md system)
  - Do NOT set `blocked` or `superseded` status — use only `draft`, `in-progress`, `completed`
  - Full schema: `.claude/specs/artifact-structures/human-brief-spec.md` §2

## Frontmatter Lifecycle

Planning artifacts follow a structured lifecycle as they move through the SDLC. Frontmatter fields populate progressively at each phase.

### Field Population Timeline

| Field | Draft | Approved | In-Progress | Completed |
|-------|-------|----------|-------------|-----------|
| `title` | ✓ | ✓ | ✓ | ✓ |
| `description` | ✓ | ✓ | ✓ | ✓ |
| `status` | draft | approved | in-progress | completed |
| `created` | ✓ | ✓ | ✓ | ✓ |
| `updated` | ✓ | ✓ | ✓ | ✓ |
| `prd_ref` | null | ✓ | ✓ | ✓ |
| `plan_ref` | null | ✓ | ✓ | ✓ |
| `contributors` | [author] | [author] | [author + team] | [author + team] |
| `milestone` | null | ✓ | ✓ | ✓ |
| `commit_refs` | [] | [] | [refs...] | [refs...] |
| `pr_refs` | [] | [] | [refs...] | [refs...] |
| `files_affected` | [] | [] | [files...] | [files...] |

**Lifecycle Phases**:

- **Draft**: Initial creation with title, description, author. Status defaults to `draft`.
- **Approved**: PRD/plan review complete. Set status to `approved` and populate cross-references (`prd_ref` / `plan_ref`).
- **In-Progress**: Execution begins. Add implementation team to `contributors`, set `milestone` target, track `commit_refs` as work commits.
- **Completed**: All tasks done. Finalize `commit_refs`, `pr_refs`, and `files_affected` list for audit trail.

**Status Management**:

Use `manage-plan-status.py` to advance status lifecycle:

```bash
python .claude/skills/artifact-tracking/scripts/manage-plan-status.py \
  --file docs/project_plans/PRDs/features/feature-name-v1.md \
  --status approved
```

Use `update-field.py` to append to list fields (`contributors`, `commit_refs`, `pr_refs`, `files_affected`):

```bash
python .claude/skills/artifact-tracking/scripts/update-field.py \
  --file docs/project_plans/implementation_plans/features/feature-name-v1.md \
  --field pr_refs \
  --append "https://github.com/owner/repo/pull/123"
```

**Full field lifecycle details**: `.claude/skills/artifact-tracking/schemas/field-reference.md`

## Lifecycle Guidance

Planning artifacts follow a natural progression from ideation through implementation. Use this guide to determine when to create each document type.

**Human Briefs** are opt-in living documents that accompany PRDs and plans for qualifying features (≥8 pts, ≥2 phases, or notable orchestration complexity — see Workflow 5 heuristic). They live at `docs/project_plans/human-briefs/[feature-slug].md` alongside their linked PRD and plan, evolve throughout the feature lifecycle, and are archived in place when the feature ships. Unlike plans, briefs are not versioned — no `-v1` suffix. See `.claude/specs/artifact-structures/human-brief-spec.md` §4 for the full heuristic.

### Rough Idea → `design_spec`

**When**: You have a raw idea, loose thoughts, or unstructured exploration on a potential feature or change.

**What to do**:
1. Create a new file in `docs/project_plans/design-specs/[name].md`
2. Set `maturity: idea` in frontmatter
3. Add sections: problem statement (optional), open questions, explored alternatives
4. This is your working document for shaping the idea

**Example**:
```yaml
---
schema_version: 2
doc_type: design_spec
maturity: idea
title: "Real-time Sync Architecture"
status: draft
created: 2026-04-08
feature_slug: realtime-sync
---
```

### Gaining Shape → `maturity: shaping` → `maturity: ready`

**When**: The `design_spec` has structure, you've explored trade-offs, and it's crystallizing into a concrete proposal.

**What to do**:
1. Update the design_spec file
2. Change `maturity: shaping` (has structure, exploring)
3. Populate sections: problem_statement, open_questions, explored_alternatives
4. Continue iterating until all open questions are resolved
5. When ready to formalize, bump to `maturity: ready`

**Example**:
```yaml
maturity: shaping         # Has structure, exploring trade-offs
# ... after resolving questions and alternatives:
maturity: ready           # Ready to promote to PRD
```

### Promote → Create `prd`

**When**: The design_spec is at `maturity: ready` and you're ready to formalize as a product requirement.

**What to do**:
1. Create a new PRD at `docs/project_plans/PRDs/[category]/[name]-v1.md`
2. Update the design_spec:
   - Set `maturity: promoted`
   - Add `prd_ref: docs/project_plans/PRDs/[category]/[name]-v1.md`
3. Reference the design_spec in the PRD as context/background
4. Move forward with PRD lifecycle and implementation planning

**Example**:
```yaml
# In design_spec:
maturity: promoted
prd_ref: docs/project_plans/PRDs/features/realtime-sync-v1.md
```

### Workflow/Process/Tooling Change → `meta_plan`

**When**: You need to document a change to how the team works (process), tools used (tooling), or infrastructure changes (NOT a product feature).

**What to do**:
1. Create a new file in `.claude/plans/[name].md`
2. Set `doc_type: meta_plan` and `scope: [process|tooling|workflow|infrastructure|documentation|other]`
3. Document: what's changing, why, affects_skills, affects_commands, expected outcome
4. This is distinct from product PRDs and tracks workflow improvements

**Example**:
```yaml
---
schema_version: 2
doc_type: meta_plan
title: "Planning Document Cleanup"
scope: process
status: in-progress
affects_skills: [planning, artifact-tracking, plan-status]
---
```

### Investigation/Audit/Finding → `report`

**When**: You discover something worth documenting (bug investigation, performance audit, learning, post-mortem) that informs product or process decisions.

**What to do**:
1. For **raw findings during execution**, create in `.claude/findings/[name].md` with minimal frontmatter (status: draft, source: agent)
2. When finding proves **load-bearing**, promote to `docs/project_plans/reports/[category]/[slug].md` with full frontmatter
3. Link the report to the PRD or design_spec it informs via `prd_ref` or `related_documents`
4. Report categories: `findings`, `investigations`, `audits`, `post-mortems`, `refactor-reports`

**Example** (raw finding):
```yaml
---
schema_version: 2
doc_type: report
report_category: finding
title: "SQLAlchemy Comparator Cache Poisoning"
status: draft
source: agent
created: 2026-04-08
feature_slug: enterprise-db-layer
---
```

**Example** (promoted finding):
```yaml
---
schema_version: 2
doc_type: report
report_category: finding
title: "SQLAlchemy Comparator Cache Poisoning"
status: accepted
source: agent
created: 2026-04-08
prd_ref: docs/project_plans/PRDs/features/enterprise-database-v1.md
promoted_to: [docs/project_plans/implementation_plans/features/enterprise-database-v1.md]
outcome: "Implemented manual cache refresh in enterprise repository tests"
---
```

### `design_spec` Maturity States

Use the maturity field to track ideation progress:

| State | Definition | Next Step |
|-------|-----------|-----------|
| `idea` | Raw ideation, loose thoughts | Explore and structure |
| `shaping` | Has structure, actively exploring | Resolve open questions |
| `ready` | Resolved questions, ready to promote | Create PRD |
| `promoted` | Has prd_ref, formalized to PRD | Use PRD for implementation |
| `shelved` | Not pursuing this idea | Archive if needed |

## Core Workflows

### Workflow 1: Create PRD from Feature Request

**Input**: Feature description or request from user

**Process**:

1. **Analyze Request**
   - Extract feature name, scope, goals
   - Identify related systems and components
   - Determine priority and complexity

2. **Structure PRD**
   - Use template: `./templates/prd-template.md`
   - Follow MP architecture patterns (see `./references/mp-architecture.md`)
   - Include frontmatter with proper metadata
   - Organize into standard PRD sections

3. **Add Implementation Context**
   - Break into phased approach
   - Identify architectural layers involved
   - Note dependencies and risks
   - Define success criteria and acceptance tests

4. **Determine Location**
   - Category: `docs/project_plans/PRDs/[category]/`
   - Categories: `harden-polish`, `features`, `enhancements`, `refactors`
   - Naming: `[feature-name]-v1.md` (kebab-case)

5. **Generate File**
   - Write PRD to determined location
   - Include YAML frontmatter with metadata
   - Link to related docs (ADRs, guides, etc.)
   - Add to project tracking if needed

**Output**:
- PRD file at: `docs/project_plans/PRDs/[category]/[feature-name]-v1.md`
- Follows template structure
- Ready for implementation planning

**Example**:

```markdown
Input: "Add real-time collaboration features to prompt editing"

Output Location: docs/project_plans/PRDs/features/realtime-collaboration-v1.md

Sections:
1. Executive Summary - Real-time collaborative editing
2. Context & Background - Current single-user editing limitations
3. Problem Statement - Users can't collaborate on prompts
4. Goals & Success Metrics - Multiple concurrent editors, conflict resolution
5. Requirements - WebSocket connections, operational transforms, presence indicators
6. Implementation Phases - Phase 1: Backend infrastructure, Phase 2: Frontend integration
... (full PRD structure)
```

### Workflow 2: Create Implementation Plan from PRD

**Input**: Path to existing PRD or newly created PRD

**Process**:

1. **Analyze PRD**
   - Read full PRD content
   - Extract key requirements
   - Identify architectural layers needed
   - Determine phase breakdown strategy

2. **Plan Phase Structure**
   - Follow MP layered architecture: routers → services → repositories → DB
   - Group related tasks into phases
   - Common phases: Database → Repository → Service → API → UI → Testing → Docs → Deployment
   - Consider parallel work opportunities
   - Identify critical path
   - **Populate the Phase Summary table** in Implementation Strategy (after Critical Path) with every phase, point estimate, target subagents, and model designation. This table is mandatory — it is the canonical orchestration index executors use to plan delegation. Keep it synced with detailed phase breakdowns. Use Claude models by default (`sonnet` / `haiku`); note external models (e.g., `gemini-3.1-pro`, `nano-banana-pro`, `gpt-5.3-codex`) per `references/multi-model-guidance.md`.

3. **Generate Task Breakdown**
   - Use template: `./templates/implementation-plan-template.md`
   - Create tasks for each phase
   - Format: Task tables with ID, Name, Description, Acceptance Criteria, Estimate
   - Include quality gates for each phase

3.5 **Run Estimation Sanity Check (mandatory) — write output to Human Brief, not the plan**
   - Use reference: `./references/estimation-heuristics.md`
   - Determine if a Human Brief applies (see §4 creation heuristic in `.claude/specs/artifact-structures/human-brief-spec.md`).
   - If brief applies: scaffold `docs/project_plans/human-briefs/[feature-slug].md` using `./templates/human-brief-template.md`, then populate **§2 Estimation Sanity Check** in the brief with the H1–H6 output.
   - If brief does not apply (feature too small): populate the H1–H6 check in a comment or scratchpad for your own reference; do not add the full block to the plan.
   - Apply heuristics H1–H6 **bottom-up**:
     - H1: noun-counting (≥2 pts per new CRUD-with-RBAC table)
     - H2: dual-implementation multiplier (~1.8× repo subtotal when local+enterprise)
     - H3: algorithmic service flag (≥3 pts for any service whose description includes dependency / resolution / graph / conflict / cycle / solver / inference / ranking / scheduling / merge / diff / transform; SPIKE first if test scenarios cannot be enumerated)
     - H4: bundle-vs-sum (per-area estimates summed = floor for plan total when ≥3 capability areas)
     - H5: anchor reference (cite a comparable completed feature, justify any delta >30%)
     - H6: hidden plumbing budget (~15–20% line item for DTOs / DI / OpenAPI / RLS / inventory updates / CHANGELOG)
   - If bottom-up total disagrees with top-down intuition, **trust bottom-up** or write justification.
   - Set `**Human Brief**` pointer line near the top of the plan (the template provides the field).

4. **Assign Subagents**
   - Use reference: `./references/subagent-assignments.md`
   - Assign based on task type:
     - Database: `data-layer-expert`
     - Backend API: `python-backend-engineer`, `backend-architect`
     - Frontend: `ui-engineer-enhanced`, `frontend-developer`
     - UI Components: `ui-designer`, `ui-engineer`
     - Testing: appropriate testing agents
     - Docs: `documentation-writer`, `documentation-complex`
   - Add to each task: "Assigned Subagent(s): agent-1, agent-2"

5. **Model Assignment**
   - Evaluate each task for the appropriate model:
     - Default: `sonnet` for implementation, `haiku` for docs/exploration
     - Route image generation → `nano-banana-pro`
     - Route UI wireframing/design → `gemini-3.1-pro`
     - Route web research → `gemini-3.1-pro`
     - Route debug escalation → `gpt-5.3-codex`
   - Assign effort levels per model (reference `[models.effort_levels]` in `.claude/config/multi-model.toml`)
   - Group external model tasks as pre-work (batch_0) when possible
   - Add to each task: "Model: [model]; Effort: [level]"
   - Reference: See `./references/multi-model-guidance.md` for detailed routing logic

6. **UI Extraction Evaluation** (UI-Heavy Phases Only)
   - For phases with React/UI component work, evaluate against extraction criteria
   - Flag reusable components with `[pkg]` marker in task descriptions
   - Evaluate: multiple projects reuse (2+), generic API design, stability window (2+ weeks), no app-specific dependencies
   - Document extraction candidates for potential `@meaty/ui` packaging
   - Reference: `./references/ui-extraction-guidance.md` for criteria details
   - Full spec: `.claude/specs/ui-package-extraction-spec.md`

7.5 **Deferred Items & Findings Planning**
   - Scan the PRD for deferred/backlog/research-needed items, open questions with `OQ-*` markers, or spike-needed investigations
   - List them in a "Deferred Items" triage table in the plan's `## Deferred Items & In-Flight Findings Policy` section
   - Add a corresponding design-spec authoring task row (DOC-006) for each item — or document "N/A — no deferred items" if none exist
   - Initialize `deferred_items_spec_refs: []` and `findings_doc_ref: null` in plan frontmatter
   - Reference: `./references/deferred-items-and-findings.md`

7. **Documentation Evaluation**
   - Assess which docs require updates based on feature scope:
     - **CHANGELOG**: Include if user-facing changes (new features, breaking changes, deprecations). When `changelog_required: true` is set in frontmatter, a CHANGELOG `[Unreleased]` entry is **mandatory** in the Documentation Finalization phase before release. Categorization rules: `.claude/specs/changelog-spec.md`.
     - **README**: Include if features, CLI commands, screenshots, or version change
     - **User/dev docs**: Include if behavior changes requiring user/developer knowledge
     - **Context files**: Include if changes affect agent behavior or architectural patterns
     - **Project-level custom skills**: Include if changes affect domain of a custom skill (new CLI commands, capability changes, workflow shifts); check `.claude/specs/skills-index.md` for domain ownership
   - Create doc tasks for the Documentation Finalization phase:
     - CHANGELOG → `changelog-generator` agent with `changelog-generator` skill
     - README/docs → `documentation-writer` agent with `managing-readmes` skill
     - Context files → `documentation-writer` agent (progressive disclosure: CLAUDE.md pointers only, detail in key-context)
     - Project-level skills → `ai-artifacts-engineer` (SPEC.md + SKILL.md) and `documentation-writer` (workflows)
   - Keep docs minimal/usage-focused, not verbose
   - Reference: `./references/doc-finalization-guidance.md` for detailed heuristics
   - Add "Model: haiku; Effort: low" to doc tasks (or "Model: sonnet; Effort: medium" for skill SPEC updates)

8. **Optimize for Token Efficiency**
   - If total plan >800 lines: break into phase-specific files
   - Pattern: `[feature-name]-v1/phase-[N]-[name].md`
   - Parent plan links to phase files
   - Each phase file <800 lines
   - See `./references/optimization-patterns.md`

9. **Generate Files**
   - Main plan: `docs/project_plans/implementation_plans/[category]/[feature-name]-v1.md`
   - Phase files (if needed): `docs/project_plans/implementation_plans/[category]/[feature-name]-v1/phase-[N]-[name].md`
   - Link phase files from parent plan

**Output**:
- Implementation Plan at determined location
- Phase breakdown with subagent assignments
- Linked phase files if plan >800 lines
- Quality gates and success criteria per phase

**Example**:

```markdown
Input PRD: docs/project_plans/PRDs/features/realtime-collaboration-v1.md

Output:
Main Plan: docs/project_plans/implementation_plans/features/realtime-collaboration-v1.md

Phase Breakdown:
- Phase 1: Database Layer (websocket_sessions, edit_locks tables) - data-layer-expert
- Phase 2: Repository Layer (session management, lock management) - python-backend-engineer
- Phase 3: Service Layer (operational transforms, conflict resolution) - backend-architect
- Phase 4: API Layer (WebSocket endpoints, presence API) - python-backend-engineer
- Phase 5: UI Layer (collaborative editor, presence indicators) - ui-engineer-enhanced, frontend-developer
- Phase 6: Testing (unit, integration, E2E conflict scenarios) - testing agents
- Phase 7: Documentation (API docs, user guides) - documentation-writer
- Phase 8: Deployment (feature flags, monitoring) - DevOps

Phase Files (if plan >800 lines):
- realtime-collaboration-v1/phase-1-database.md
- realtime-collaboration-v1/phase-2-repository.md
- realtime-collaboration-v1/phase-3-5-backend.md (grouped related phases)
- realtime-collaboration-v1/phase-6-8-validation.md (grouped related phases)
```

### Workflow 3: Optimize Existing Plans

**Input**: Path to existing PRD or Implementation Plan that's >800 lines

**Process**:

1. **Analyze Plan**
   - Read full plan
   - Count total lines
   - Identify natural break points (phases, sections)
   - Determine optimal split strategy

2. **Determine Breakout Strategy**
   - Primary: Break by phase (most common)
   - Secondary: Break by domain (backend vs frontend)
   - Tertiary: Break by task type (implementation vs testing)
   - Goal: Each file <800 lines, logically cohesive

3. **Create Breakout Files**
   - Pattern: `[plan-name]/phase-[N]-[name].md`
   - Alternative: `[plan-name]/[domain]-tasks.md`
   - Each file includes:
     - Phase/section overview
     - Relevant tasks with subagent assignments
     - Quality gates for that section
     - Links back to parent plan

4. **Update Parent Plan**
   - Add table of contents linking to breakout files
   - Keep executive summary and overview in parent
   - Replace detailed sections with links:
     ```markdown
     ## Phase 2: Repository Layer
     See [Phase 2 Implementation Details](./[plan-name]/phase-2-repository.md)
     ```
   - Maintain quality gates summary in parent

5. **Validate Optimization**
   - Each file <800 lines ✓
   - All content preserved ✓
   - Links work correctly ✓
   - Logical grouping maintained ✓
   - Progressive disclosure achieved ✓

**Output**:
- Optimized parent plan (summary + links)
- Breakout files for detailed content
- Improved token efficiency (95%+ reduction in single-load context)

**Example**:

```markdown
Input: docs/project_plans/implementation_plans/harden-polish/sidebar-polish-v1.md (1200 lines)

Analysis:
- 8 phases, ~150 lines each
- Can group related phases: 1-3 (backend), 4-5 (frontend), 6-8 (validation)

Output:
Parent: sidebar-polish-v1.md (200 lines - summary + links)
Phase Files:
- sidebar-polish-v1/phase-1-3-backend.md (450 lines)
- sidebar-polish-v1/phase-4-5-frontend.md (400 lines)
- sidebar-polish-v1/phase-6-8-validation.md (350 lines)

Token Efficiency:
- Before: Load 1200 lines for any query
- After: Load 200-line summary, then specific phase (450 max) = 67% reduction
```

### Workflow 4: Create Progress Tracking

**Input**: PRD or Implementation Plan

**Process**:

Utilize artifact-tracking skill to create progress tracking and context artifacts per the skill instructions.

You should NOT create these files from this skill, as there are specific optimizations and structures required by the artifact-tracking skill.

### Workflow 5: Create Human Brief for Feature

**Input**: PRD path + Implementation Plan path (both required when they exist)

**Spec reference**: `.claude/specs/artifact-structures/human-brief-spec.md`

**Process**:

1. **Check creation heuristic (§4 of spec)** — create a brief when any of these are true:
   - Feature is ≥8 story points estimated
   - Implementation plan has ≥2 phases
   - Estimation Sanity Check has non-trivial anchor comparison
   - ≥2 deferred items with non-trivial rationale
   - Feature spans ≥2 capability areas
   - Notable orchestration complexity (wave coordination, cross-team dependencies)
   Skip when: quick feature (<5 pts, single phase), trivial refactor, single-file fix.

2. **Scaffold the brief** at `docs/project_plans/human-briefs/[feature-slug].md`
   - Use template: `./templates/human-brief-template.md`
   - No `-v1` suffix — briefs are living documents, not versioned deliverables
   - Set `prd_ref`, `plan_ref`, `feature_slug`, `owner`, `status: draft`

3. **Populate on creation**:
   - **§1 Context Pointers**: one-line links to PRD, plan, design specs, SPIKEs
   - **§2 Estimation Sanity Check**: migrate H1–H6 output from planning step 3.5
   - **§4 Open Questions Ledger**: harvest `OQ-*` markers from PRD and plan
   - **§8 Expected Success Behaviors**: extract human-verifiable outcomes from PRD acceptance criteria

4. **Populate as information becomes available**:
   - §3 Wave & Orchestration Notes — after phase structure is finalized
   - §5 Deferred Items Rationale — after triage table in plan is populated
   - §6 Risk Narrative — after risk section in plan is written
   - §7 What to Watch For — before or during execution
   - §9 Running Log — append-only during execution

5. **Set brief as in-progress** when execution begins; **completed** when feature ships.

**Output**: `docs/project_plans/human-briefs/[feature-slug].md`

**Agents must not load this file during execution** (see Agent Consumption Rule below and spec §5).

## Templates Reference

### prd-template.md

**Location**: `./templates/prd-template.md`

**Based On**: `/docs/docs-v2/templates/PRD-TEMPLATE.md`

**Purpose**: Standard PRD structure for MeatyPrompts features

**Key Sections**:
- Feature Brief & Metadata (name, date, author, related docs)
- Executive Summary (1-2 paragraphs)
- Context & Background (problem space, current state)
- Problem Statement (clear gap or pain point)
- Goals & Success Metrics (measurable outcomes)
- Requirements (functional and non-functional)
- Scope (in-scope vs out-of-scope)
- Dependencies & Assumptions
- Risks & Mitigations
- Target State (post-implementation)
- Acceptance Criteria (definition of done)
- Implementation (phased breakdown with tasks)

**When to Use**: Creating any new PRD

### implementation-plan-template.md

**Location**: `./templates/implementation-plan-template.md`

**Based On**: `/claude-export/templates/pm/implementation-plan-template.md`

**Purpose**: Detailed phased implementation with task breakdown

**Key Sections**:
- Executive Summary (approach, milestones, success criteria)
- Implementation Strategy (architecture sequence, parallel work, critical path)
- Phase Breakdown (8 standard phases with task tables)
- Risk Mitigation (technical and schedule risks)
- Resource Requirements (team composition, skills, infrastructure)
- Success Metrics (delivery, business, technical)
- Communication Plan (status reporting, escalation)
- Post-Implementation Plan (monitoring, maintenance)

**When to Use**: Creating implementation plan from PRD

### phase-breakdown-template.md

**Location**: `./templates/phase-breakdown-template.md`

**Purpose**: Template for individual phase files when breaking up long plans

**Key Sections**:
- Phase overview (duration, dependencies, team)
- Task breakdown table (ID, name, description, acceptance criteria, estimate, assignee)
- Subagent assignments
- Quality gates
- Key files and integration points
- Link back to parent plan

**When to Use**: Breaking long implementation plans into phase-specific files

## Scripts Reference

All scripts are in `./scripts/` directory and use Node.js (NOT Python).

### generate-prd.sh

**Purpose**: Generate PRD from feature request

**Usage**:
```bash
./scripts/generate-prd.sh "Feature description" "category"
```

**Process**:
1. Parse feature description
2. Determine category and filename
3. Load PRD template
4. Generate PRD content
5. Write to `docs/project_plans/PRDs/[category]/[feature-name]-v1.md`

**Output**: PRD file path

### generate-impl-plan.sh

**Purpose**: Generate implementation plan from PRD

**Usage**:
```bash
./scripts/generate-impl-plan.sh "path/to/prd.md"
```

**Process**:
1. Read PRD content
2. Extract requirements and phases
3. Generate task breakdown
4. Add subagent assignments
5. Determine if plan needs breakout (>800 lines)
6. Write main plan and phase files

**Output**: Implementation plan file path(s)

### optimize-plan.sh

**Purpose**: Break long plan into phase-specific files

**Usage**:
```bash
./scripts/optimize-plan.sh "path/to/plan.md"
```

**Process**:
1. Read plan and count lines
2. Determine optimal breakout strategy
3. Create phase-specific files
4. Update parent plan with links
5. Validate all content preserved

**Output**: List of created phase files

## References

### estimation-heuristics.md

**Location**: `./references/estimation-heuristics.md`
**Purpose**: Bottom-up sizing rules to prevent under-estimation. Codifies six heuristics — noun-counting (H1), dual-implementation multiplier (H2), algorithmic service flag (H3), bundle-vs-sum check (H4), anchor reference comparison (H5), hidden plumbing budget (H6) — and the mandatory "Estimation Sanity Check" template every implementation plan must populate.
**Used By**: Implementation plan authoring (mandatory sanity check), `plan-review` skill (post-mortem heuristic tuning).
**When to load**: Always, when creating or reviewing an implementation plan estimate.

### subagent-assignments.md

**Location**: `./references/subagent-assignments.md`
**Purpose**: Mapping of task types to appropriate subagents
**Used By**: Implementation planning, progress tracking creation

### file-structure.md

**Location**: `./references/file-structure.md`
**Purpose**: Directory structure conventions for plans and progress
**Naming Conventions**:
- PRDs: `[feature-name]-v1.md` (kebab-case)
- Implementation Plans: `[feature-name]-v1.md`
- Phase Files: `phase-[N]-[name].md` or `phase-[N]-[M]-[name].md` (grouped)
**Used By**: File creation, optimization

### optimization-patterns.md

**Location**: `./references/optimization-patterns.md`

**Purpose**: Patterns for breaking up long files into token-efficient chunks

**Content**:

**Pattern 1: Break by Phase** (Most Common)
- Split implementation plan by phase (1-3, 4-5, 6-8)
- Each phase file <800 lines
- Parent links to phase files
- Progressive disclosure: Load summary, then specific phase

**Pattern 2: Break by Domain**
- Backend phases (Database, Repository, Service, API)
- Frontend phases (UI, Components, State)
- Validation phases (Testing, Docs, Deployment)

**Pattern 3: Break by Task Type**
- Implementation tasks
- Testing tasks
- Documentation tasks
- Deployment tasks

**Pattern 4: Keep Together**
- Always keep in parent plan:
  - Executive summary
  - Phase overview table
  - Risk mitigation summary
  - Success metrics overview
- Move to phase files:
  - Detailed task breakdowns
  - Specific acceptance criteria
  - Technical implementation notes

**Token Efficiency Gains**:
- Before: Load entire 1200-line plan
- After: Load 200-line summary + 400-line phase = 50% reduction
- For targeted queries: Load only relevant phase = 67%+ reduction

**Used By**: Plan optimization workflow

## Plan Generator Rules (Mandatory)

Apply these rules whenever generating or reviewing an implementation plan or any phase that contains ACs. These rules are non-negotiable; they catch the class of integration/verification gaps documented in the motivating incident (`ccdash-planning-reskin-v2-interaction-performance-addendum`).

- **R-P1** — *No AC may contain the words "across", "everywhere", "throughout", "all X", or "visible" without an explicit `target_surfaces:` list.* If the AC uses any of these terms without enumerating concrete component paths, the plan generator must expand the AC inline.
- **R-P2** — *Every new backend field X introduced in a phase introduces an implicit AC "FE handles missing X".* If this AC is not already present, the generator writes it automatically. Resilience is a contract state, not a reviewer's courtesy.
- **R-P3** — *Every phase with ≥2 owner specialties (e.g., FE + BE) and overlapping `files_affected` (intersection ≥1 file) must declare an `integration_owner` field and at least one seam task.* A seam task is a task whose sole purpose is to verify the cross-owner propagation contract.
- **R-P4** — *UI-touching phases (any `*.tsx` file in `files_affected`) must include a "runtime smoke" task in the verification phase.* The smoke task must reference every `target_surfaces` entry from that phase.

**AC schema for structured ACs** (use this format whenever an AC covers multi-surface propagation or has resilience requirements):

```markdown
#### AC [ID]: [Short description]
- target_surfaces:
    # Use path strings (see §8 Q1 note in references/ac-schema.md).
    - components/Planning/PlanningSummaryPanel.tsx
    - components/Planning/PlanningGraphPanel.tsx
- propagation_contract: [how the value flows from producer to each surface]
- resilience: [how each surface behaves when the field is absent/null]
- visual_evidence_required: [screenshot spec, e.g. "desktop ≥1440px before/after" or false]
- verified_by: [list of task IDs in the verification phase that sign off this AC]
```

For the full AC schema reference and examples, see `./references/ac-schema.md`.

## Best Practices

### File Size Management

**Guideline**: No file should exceed ~800 lines

**Rationale**:
- Optimal token efficiency for AI context loading
- Enables progressive disclosure pattern
- Reduces cognitive load for agents
- Faster file parsing and analysis

**Strategies**:
1. Break plans by phase when >800 lines
2. Group short related phases (1-3, 4-5)
3. Keep summaries in parent, details in phase files
4. Use links for cross-references

### Naming Conventions

**PRDs**: `[feature-name]-v1.md`
- Use kebab-case (lowercase with hyphens)
- Include version number (-v1, -v2)
- Descriptive name (e.g., `advanced-filtering-v1.md`)

**Implementation Plans**: `[feature-name]-v1.md`
- Match PRD naming
- Same category as PRD
- Version synchronized with PRD

**Phase Files**: `phase-[N]-[name].md`
- Sequential numbering (phase-1, phase-2)
- Can group: `phase-1-3-backend.md`
- Descriptive name (database, repository, frontend)

### Directory Organization

**PRDs**:
- `docs/project_plans/PRDs/[category]/`
- Categories: `harden-polish`, `features`, `enhancements`, `refactors`

**Implementation Plans**:
- `docs/project_plans/implementation_plans/[category]/`
- Match PRD category
- Phase breakouts in subdirectory: `[plan-name]/`

### Token Efficiency Tips

**Progressive Disclosure**:
1. Summary in parent plan (200 lines)
2. Link to detailed phase files (400 lines each)
3. Agent loads summary first, then specific phase as needed
4. 50-67% token reduction

**Structured References**:
- Link to ADRs instead of duplicating architecture info
- Reference existing docs rather than repeating
- Use relative paths for phase file links

**Chunk by Logical Units**:
- Keep related tasks together
- Don't split mid-phase
- Group short phases if logical
- Maintain quality gates with phases

### YAML Frontmatter

**PRDs**:
```yaml
---
title: "Feature Name - PRD"
description: "Brief summary (1-2 sentences)"
audience: [ai-agents, developers]
tags: [relevant, tags, for, search]
created: 2025-11-11
updated: 2025-11-11
category: "product-planning"
status: draft|published
related:
  - /docs/architecture/ADRs/relevant-adr.md
  - /docs/guides/relevant-guide.md
# changelog_required: true   # Optional — uncomment for user-facing features requiring a CHANGELOG [Unreleased] entry
---
```

**Implementation Plans**:
```yaml
---
title: "Feature Name - Implementation Plan"
description: "Brief summary of implementation approach"
audience: [ai-agents, developers]
tags: [implementation, planning, phases]
created: 2025-11-11
updated: 2025-11-11
category: "product-planning"
status: draft|in-progress|published
related:
  - /docs/project_plans/PRDs/category/feature-name-v1.md
# changelog_required: true   # Optional — inherit from PRD or set here; enforces CHANGELOG entry in Phase 7
---
```

**Design Specifications** (schema v2, pre-PRD ideation):
```yaml
---
schema_version: 2
doc_type: design_spec
title: "Feature Idea Name"
description: "Brief description of what's being designed"
status: draft
maturity: idea
created: 2026-04-08
updated: 2026-04-08
feature_slug: kebab-case-slug
problem_statement: "Clearly articulate the problem being solved (optional for early ideation)"
open_questions:
  - "Question 1 blocking clarity?"
  - "Question 2 to explore?"
explored_alternatives:
  - "Option A considered: pros/cons"
  - "Option B considered: pros/cons"
related_documents: []
prd_ref: null
---
```

**Maturity progression**: Update `maturity` field as design_spec evolves: `idea` → `shaping` → `ready`. When promoting to PRD, set `maturity: promoted` and add `prd_ref: docs/project_plans/PRDs/[category]/[name]-v1.md`.

**Meta Plans** (schema v2, process/tooling/workflow changes):
```yaml
---
schema_version: 2
doc_type: meta_plan
title: "Meta Plan Title (e.g., 'Planning Document Cleanup')"
description: "What process/workflow/tooling is changing and why"
status: draft
scope: process|tooling|workflow|infrastructure|documentation|other
created: 2026-04-08
updated: 2026-04-08
owner: nick
affects_skills: [skill-name-1, skill-name-2]
affects_commands: [/command:name-1, /command:name-2]
outcome: "Expected result or success criteria (optional)"
related_documents: []
plan_ref: null
---
```

**Scope values**: Use `process` for team procedures, `tooling` for tool changes, `workflow` for execution patterns, `infrastructure` for system/deployment changes, `documentation` for doc updates, `other` for miscellaneous meta-work.

## Examples

### Example 1: Create PRD for Advanced Filtering

**Input**:
```
User: "Create a PRD for adding advanced filtering to the prompts page. Users need to filter by multiple criteria: model, provider, date range, tags, and favorites."
```

**Process**:
1. Extract feature name: "Advanced Filtering"
2. Determine category: "features"
3. Generate PRD using template
4. Structure sections:
   - Problem: Users can only filter by single criteria
   - Goals: Multi-criteria filtering, saved filter sets
   - Requirements: UI for filter builder, backend filter query support
   - Phases: Phase 1 (Backend), Phase 2 (Frontend), Phase 3 (Saved Filters)

**Output**:
```
File: docs/project_plans/PRDs/features/advanced-filtering-v1.md

# Advanced Filtering - PRD

**Feature Name**: Advanced Filtering
**Date**: 2025-11-11
**Author**: Claude (Sonnet 4.5)
**Related**: Filtering guides, search ADRs

## 1. Executive Summary
Enable users to filter prompts by multiple criteria simultaneously (model, provider, date range, tags, favorites) with the ability to save and reuse filter sets.

## 2. Context & Background
Current filtering supports single criteria only. Users frequently need to filter by combinations (e.g., "OpenAI models from last week tagged 'production'").

... (full PRD structure)
```

### Example 2: Create Implementation Plan with Phase Breakout

**Input**:
```
User: "Create implementation plan for docs/project_plans/PRDs/features/advanced-filtering-v1.md"
```

**Process**:
1. Read PRD, extract requirements
2. Plan 7 phases following MP architecture
3. Generate task breakdown with estimates
4. Assign subagents to each task
5. Calculate total: 1100 lines → needs breakout
6. Create phase files:
   - phase-1-3-backend.md (500 lines)
   - phase-4-5-frontend.md (400 lines)
   - phase-6-7-validation.md (300 lines)
7. Update parent plan with links (200 lines)

**Output**:
```
Main Plan: docs/project_plans/implementation_plans/features/advanced-filtering-v1.md (200 lines)

# Implementation Plan: Advanced Filtering

## Phase Overview
| Phase | Title | Effort | Files |
|-------|-------|--------|-------|
| 1-3 | Backend Implementation | 18 pts | [Details](./advanced-filtering-v1/phase-1-3-backend.md) |
| 4-5 | Frontend Implementation | 12 pts | [Details](./advanced-filtering-v1/phase-4-5-frontend.md) |
| 6-7 | Validation & Deployment | 8 pts | [Details](./advanced-filtering-v1/phase-6-7-validation.md) |

... (executive summary, strategy)

---

Phase Files Created:
- advanced-filtering-v1/phase-1-3-backend.md (500 lines)
  - Phase 1: Database (filter_sets table, indexes)
  - Phase 2: Repository (query builder, filter sets repo)
  - Phase 3: Service (filter validation, DTO mapping)

- advanced-filtering-v1/phase-4-5-frontend.md (400 lines)
  - Phase 4: API (filter endpoints, saved sets API)
  - Phase 5: UI (filter builder component, saved sets UI)

- advanced-filtering-v1/phase-6-7-validation.md (300 lines)
  - Phase 6: Testing (unit, integration, E2E)
  - Phase 7: Deployment (feature flags, monitoring)
```

### Example 3: Optimize Existing Long Plan

**Input**:
```
User: "Optimize docs/project_plans/implementation_plans/harden-polish/sidebar-polish-v1.md - it's 1200 lines"
```

**Process**:
1. Read plan: 8 phases, ~150 lines each
2. Determine breakout: Group 1-3 (backend), 4-5 (frontend), 6-8 (validation)
3. Create phase files:
   - phase-1-3-backend.md (450 lines)
   - phase-4-5-frontend.md (400 lines)
   - phase-6-8-validation.md (350 lines)
4. Update parent plan: Keep summary, add links to phase files (200 lines)

**Output**:
```
Updated: docs/project_plans/implementation_plans/harden-polish/sidebar-polish-v1.md (200 lines)

Created Phase Files:
- sidebar-polish-v1/phase-1-3-backend.md (450 lines)
  Phase 1: Database - Sidebar state, user preferences
  Phase 2: Repository - State management, RLS
  Phase 3: Service - Preference sync, DTOs

- sidebar-polish-v1/phase-4-5-frontend.md (400 lines)
  Phase 4: API - Endpoints for sidebar state
  Phase 5: UI - Sidebar component, animations

- sidebar-polish-v1/phase-6-8-validation.md (350 lines)
  Phase 6: Testing - Unit, integration, visual
  Phase 7: Documentation - Component docs, API docs
  Phase 8: Deployment - Feature flags, rollout

Token Efficiency: 67% reduction for targeted queries
```

## Integration with Project Standards

### Architecture Compliance

All plans follow project layered architecture.

### Subagent Ecosystem

Plans integrate with 50+ project subagents:

**Architecture**: lead-architect, backend-architect, data-layer-expert
**Development**: python-backend-engineer, frontend-developer, ui-engineer-enhanced
**UI/UX**: ui-designer, ux-researcher
**Review**: code-reviewer, task-completion-validator
**Documentation**: documentation-writer, documentation-complex
**Testing**: testing specialists
**Performance**: react-performance-optimizer, web-accessibility-checker

### Documentation Policy

Follows CLAUDE.md documentation policy:
- PRDs are product-planning docs (allowed)
- Implementation Plans are product-planning docs (allowed)
- NO reports, summaries, etc unless explicitly requested

### File Organization

**PRDs**: `/docs/project_plans/PRDs/[category]/[feature-name]-v1.md`
**Plans**: `/docs/project_plans/implementation_plans/[category]/[feature-name]-v1.md`
**Phase Files**: `[plan-name]/phase-[N]-[name].md`

## Advanced Usage

### Customizing Templates

Edit templates in `./templates/` to match project needs:

1. **PRD Template Customization**:
   - Add project-specific sections
   - Adjust success metrics format
   - Include standard acceptance criteria

2. **Implementation Plan Template Customization**:
   - Add/remove phases
   - Adjust quality gates
   - Customize risk categories

3. **Progress Tracking Template Customization**:
   - Add project-specific status values
   - Adjust completion tracking format
   - Include team-specific metadata

### Multi-PRD Planning

For complex initiatives spanning multiple PRDs:

1. Create parent epic document
2. Generate individual PRDs for each component
3. Link PRDs to parent epic
4. Create unified progress tracking across PRDs

### Spike Integration

For research-heavy features:

1. Create SPIKE document first (using spike-writer agent)
2. Use SPIKE to inform PRD generation
3. Reference SPIKE in PRD "Context & Background"
4. Link SPIKE from Implementation Plan

### Continuous Optimization

Regularly optimize plans as work progresses:

1. Update progress tracking with actual completion
2. Adjust estimates based on learnings
3. Break out new sections if plan grows >800 lines
4. Archive completed phases

## Related Skills

- **artifact-tracking**: Create progress tracking and context artifacts
- **skill-builder**: Create new custom skills
- **symbols**: Token-efficient codebase indexing
- **codebase-explorer**: Fast pattern discovery
- **explore**: Deep codebase analysis

## Related Agents

- **lead-pm**: SDLC orchestration
- **prd-writer**: PRD creation
- **implementation-planner**: Detailed implementation planning
- **task-decomposition-expert**: Task breakdown
- **lead-architect**: Architecture planning assistance, task delegation
- **documentation-writer**: Documentation for plans

## Version History

- **2025-11-11**: Initial skill creation
  - 4 core workflows (PRD, Plan, Optimize, Progress)
  - 4 templates (PRD, Plan, Progress, Phase)
  - 5 scripts (generate-prd, generate-impl-plan, optimize-plan, assign-subagents, create-progress-tracking)
  - 4 references (architecture, subagents, file-structure, optimization-patterns)
- **2025-12-01**: Remove Tracking Creation from this skill; delegate to artifact-tracking skill
