# artifact-structures/ — Schema Spec Index

Specs in this directory define the **structure of document artifacts** used in SkillMeat planning,
tracking, and skill authoring. Each spec here answers the question "what does a `[type]` document
look like?" — as distinct from process/policy specs (changelog, version-bump, doc-policy, etc.)
which live at the `.claude/specs/` root.

---

## Base Schema

All doc types in this directory specialize the shared CCDash envelope:

| File | Purpose |
|------|---------|
| `ccdash-doc-structure.md` | CCDash shared envelope (schema_version 2); defines the base frontmatter fields (`schema_name`, `schema_version`, `doc_type`, `status`, `owner`, etc.) that every downstream spec must include. **Start here** when adding a new doc type. |

---

## Document Type Specs

Each file defines the frontmatter schema, required sections, lifecycle, and storage location for a
specific `doc_type`.

| Spec | `doc_type` | Storage path | Purpose |
|------|-----------|-------------|---------|
| `human-brief-spec.md` | `human_brief` | `docs/project_plans/human-briefs/` | Human-orchestrator planning lens for a feature: estimation rationale, critical-path narrative, open questions, observable success behaviors. Keeps implementation plans lean and agent-friendly. |

---

## Skill Artifact Specs

These specs define the structure of `SPEC.md` files that accompany every custom skill in
`.claude/skills/`. They are schema/structure specs (not process specs), so they belong here.

| Spec | Purpose |
|------|---------|
| `skill-spec-convention.md` | Formal SPEC.md convention: frontmatter schema, all 7 required sections (Purpose & Scope, Capability Coverage, Invariants, Enhancement Backlog, Changelog, Integration Points, Success Signals), maturity states (draft → stable → deprecated), and version-management rules. |
| `skill-spec-template.md` | Copy-paste fillable template for authoring new SPEC.md files. Fill all `{{PLACEHOLDER}}` values; remove HTML comments before promoting to `stable`. |

---

## What Stays at `.claude/specs/` Root

The following specs define **processes and policies**, not document structures. They remain at the
root level. See `.claude/specs/README.md` for the full root index.

- `changelog-spec.md` — CHANGELOG.md categorization rules and entry conventions
- `version-bump-spec.md` — Version bump procedure and validation checklist
- `doc-policy-spec.md` — Allowed/prohibited documentation locations and naming
- `multi-model-usage-spec.md` — Multi-model routing policy
- `project-tracking-spec.md` — Progress and context file tracking conventions
- `claude-fundamentals-spec.md` — Generic CLAUDE.md generation patterns
- `skills-index.md` — Searchable inventory of all custom skills (not a schema spec; lives at root for discoverability)
