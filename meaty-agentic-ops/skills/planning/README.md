# Planning Skill - Quick Reference

## Overview

The Planning Skill generates and optimizes Product Requirements Documents (PRDs) and Implementation Plans as AI artifacts optimized for AI agent consumption.

> Tier 2/3 Implementation Plans follow the Claude-5-generation authoring doctrine —
> `references/plan-doctrine.md` — milestones not phases, no plan-time model/agent pins, thin plan
> mass. See `SKILL.md` for the full workflow; this file is the quick-reference index.

**Primary Use Cases**:
- Generate PRDs from feature requests
- Create milestone-based Implementation Plans (constraints + AC, not phase task tables)
- Optimize long planning docs by breaking into phase-specific files

---

## Quick Start

### Generate PRD

```
User: "Create a PRD for advanced filtering on prompts"

Skill:
1. Extracts feature details
2. Uses prd-template.md
3. Generates: docs/project_plans/PRDs/advanced-filtering-v1.md
```

### Generate Implementation Plan

```
User: "Create implementation plan for docs/project_plans/PRDs/advanced-filtering-v1.md"

Skill (default, Tier 2/3 — see references/plan-doctrine.md):
1. Reads PRD
2. Uses milestone-plan-template.md
3. Structures 3-4 reviewable-state milestones with AC + routing_constraints
   (no plan-time model/agent pins — delegation-router resolves those at dispatch)
4. Creates: docs/project_plans/implementation_plans/advanced-filtering-v1.md
   (target <=150 lines; phase files only for legacy/expanded-template or oversized plans)
```

### Optimize Existing Plan

```
User: "Optimize docs/project_plans/implementation_plans/harden-polish/sidebar-polish-v1.md"

Skill:
1. Analyzes plan (1200 lines)
2. Breaks into phase files (~400 lines each)
3. Updates parent with links
4. Results in 50-70% token reduction
```

---

## Key Concepts

### Token Efficiency

Files optimized for AI loading:
- **Hard ceiling**: ~800 lines max per file, any planning doc
- **Tier 2/3 Implementation Plan target**: <=150 lines (frontmatter included) —
  `references/plan-doctrine.md`; reached by thinness (milestones + AC + routing constraints), not
  by pre-emptive splitting
- **Strategy**: Progressive disclosure (summary → detail)
- **Result**: 50-70% token reduction for most queries

### Project Architecture Compliance

All plans follow layered architecture.

### Routing (default path — no plan-time pins)

Tier 2/3 milestone plans declare `routing_constraints` (MUST-stay-claude-primary classes,
offload-eligibility, capability bar) instead of pinning a subagent or model per task;
`delegation-router` resolves both at dispatch time. The **legacy/expanded** template
(`implementation-plan-template.md`, in-flight plans only) still assigns a specialist per task:
- Database → data-layer-expert
- Backend → python-backend-engineer, backend-architect
- Frontend → ui-engineer-enhanced, frontend-developer
- Testing → testing specialists
- Docs → documentation-writer

---

## File Structure

```
docs/project_plans/
├── PRDs/[category]/
│   └── feature-name-v1.md
└── implementation_plans/[category]/
    ├── feature-name-v1.md (parent)
    └── feature-name-v1/ (phase files if >800 lines)
        ├── phase-1-3-backend.md
        ├── phase-4-5-frontend.md
        └── phase-6-8-validation.md

.claude/progress/
└── feature-name/
    └── phase-{N}-progress.md (one file per phase)
```

---

## Templates

Located in `./templates/`:

1. **prd-template.md** - Standard PRD structure
2. **milestone-plan-template.md** - **Default for new Tier 2/3 plans**: 3-4 milestones + AC matrix
   + routing constraints, <=150-line target (`references/plan-doctrine.md`)
3. **implementation-plan-template.md** - Legacy/expanded 8-phase plan structure (in-flight plans,
   economy-executor expansion path only — not the default for a new plan)
4. **phase-breakdown-template.md** - Individual phase file format (legacy/expanded path)

---

## References

Located in `./references/`:

1. **plan-doctrine.md** - The Claude-5-generation authoring rules (milestones not phases, no
   plan-time model/agent pins, thin plan mass, context-class sizing) — canonical, cited elsewhere
2. **subagent-assignments.md** - Task type to subagent mapping (legacy/expanded path)
3. **estimation-heuristics.md** - H1-H7 bottom-up sizing rules + mandatory Sanity Check
4. **file-structure.md** - Directory organization and naming
5. **optimization-patterns.md** - Strategies for breaking up large files

---

## Scripts

Located in `./scripts/`:

**Note**: Currently placeholders, need Node.js implementation

1. **generate-prd.sh** - Generate PRD from description
2. **generate-impl-plan.sh** - Generate plan from PRD
3. **optimize-plan.sh** - Break up long plan

---

## Common Workflows

### Workflow 1: New Feature from Scratch

1. Generate PRD: `"Create PRD for [feature]"`
2. Generate Plan: `"Create implementation plan for [prd-path]"`
3. Start Implementation: Development agents use progress tracking

### Workflow 2: Optimize Existing Planning Docs

1. Analyze Plan: Check line count
2. Optimize: `"Optimize [plan-path]"` if >800 lines
3. Validate: Ensure all content preserved
4. Update Links: Cross-link phase files

---

## Best Practices

1. **File Sizes**: <800 lines hard ceiling for any file; Tier 2/3 plans target <=150 lines
2. **Naming**: Use kebab-case, version numbers (-v1), descriptive names
3. **Cross-Linking**: Always link related documents (PRD ↔ Plan ↔ Progress)
4. **Routing constraints, not pins**: New Tier 2/3 plans declare `routing_constraints`, not a
   per-task subagent/model — `delegation-router` resolves at dispatch (legacy/expanded path still
   uses the subagent-assignments reference guide)
5. **Progressive Disclosure**: Summary in parent, details in phase files

---

## Examples

See SKILL.md "Examples" section for:
- Creating PRD for advanced filtering
- Generating implementation plan with phase breakout
- Optimizing long plan

---

## Integration with Project

### Documentation Policy

Follows CLAUDE.md:
- PRDs/Plans: `/docs/` with YAML frontmatter

### Subagent Ecosystem

Integrates with 50+ subagents:
- Architecture: lead-architect, backend-architect, data-layer-expert
- Development: python-backend-engineer, frontend-developer, ui-engineer-enhanced
- Review: code-reviewer, task-completion-validator
- Documentation: documentation-writer, documentation-complex
- Testing: testing specialists

---

## For Full Details

See `SKILL.md` for:
- Complete workflow descriptions
- All templates
- All scripts
- Complete references
- Detailed examples
- Troubleshooting guide

---

## Quick Tips

**Creating PRDs**:
- Be specific about feature requirements
- Include user stories and pain points
- Reference related ADRs and guides

**Creating Plans** (default: milestone-based, `references/plan-doctrine.md`):
- Structure 3-4 reviewable-state milestones with AC — not an 8-phase task table
- Target <=150 lines total; break into phase files only for the legacy/expanded path or an
  oversized plan (>800 lines)
- Declare `routing_constraints`, not a per-task subagent/model pin

**Optimizing Plans**:
- Group related phases (1-3, 4-5, 6-8)
- Keep summary in parent (200-300 lines)
- Use descriptive phase file names

---

**Version**: 2.0
**Last Updated**: 2026-07-30 (see `SKILL.md` frontmatter + `CHANGELOG.md` for the versioned record)
**Skill Location**: `.claude/skills/planning/`
