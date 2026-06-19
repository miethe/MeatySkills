---
purpose: Codify the deferred-item + in-flight-finding lifecycle for implementation plans
audience: AI agents (planning skill, implementation agents)
---

# Deferred Items & In-Flight Findings

Reference for the two lifecycle loops that prevent work from being lost when plans defer scope or agents discover new information during execution.

**Exemplars**:
- Plan: `docs/project_plans/implementation_plans/enhancements/enterprise-stub-promotion-gaps-v1.md`
- Findings: `.claude/findings/enterprise-stub-promotion-findings.md`

---

## 1. Deferred Items

### What Counts as a Deferred Item

| Signal | Example |
|--------|---------|
| Explicit PRD deferral | "out of scope for v1", "future phase", "backlog" |
| Open question marker | `OQ-*` items without resolution in the PRD |
| SPIKE-needed | Research required before implementation can begin |
| Tech-debt prerequisite | Schema migration or service refactor blocking the feature |
| Design decision not yet made | Needs ADR or design spec before implementation |

### Triage Table Columns

| Item ID | Category | Reason Deferred | Trigger for Promotion | Target Spec Path |
|---------|----------|-----------------|-----------------------|-----------------|
| DF-001 | research | Needs SPIKE on storage strategy | SPIKE complete + decision recorded | docs/project_plans/design-specs/[item-slug].md |
| DF-002 | prereq | Requires enterprise schema migration first | Migration landed in main | docs/project_plans/design-specs/[item-slug].md |
| DF-003 | design | No consensus on API shape | ADR approved | docs/project_plans/design-specs/[item-slug].md |

**Categories**: `research` | `prereq` | `design` | `tech-debt` | `policy`

### Design-Spec Authoring Checklist (DOC-006)

For each row in the triage table, author a design_spec file at the `Target Spec Path`.

**Required frontmatter fields**:

```yaml
schema_version: 2
doc_type: design_spec
title: "[Feature]: [Item description]"
status: draft
maturity: shaping       # shaping if direction is known; idea if purely exploratory
created: YYYY-MM-DD
updated: YYYY-MM-DD
feature_slug: "[parent-feature-slug]"
prd_ref: /docs/project_plans/PRDs/[category]/[feature]-v1.md
problem_statement: "One sentence: what problem this deferred item addresses"
open_questions: []      # Unresolved questions blocking implementation
explored_alternatives: []  # Options considered so far (can be empty at shaping)
```

**Maturity guidance**:
- `idea` — direction unknown, needs SPIKE or research
- `shaping` — direction known, needs detailed design before implementation

After authoring, append the spec path to `deferred_items_spec_refs` in the parent plan's frontmatter.

---

## 2. In-Flight Findings

Discoveries, plan/reality mismatches, bugs/gotchas, or schema gaps found during execution that were not anticipated at planning time.

### Lifecycle

**Step 1 — First finding triggers doc creation**

Agent creates `.claude/findings/[feature-slug]-findings.md`:

```yaml
---
schema_version: 2
doc_type: report
report_category: finding
title: "Findings: [Feature Name]"
status: draft
source: agent
created: YYYY-MM-DD
updated: YYYY-MM-DD
feature_slug: "[feature-slug]"
promoted_to: null       # Set to parent plan path during finalization
related_plan: /docs/project_plans/implementation_plans/[category]/[feature]-v1.md
---
```

Then agent updates the parent plan:
1. Set `findings_doc_ref: .claude/findings/[feature-slug]-findings.md`
2. Append path to `related_documents`

**Step 2 — Per-phase captures**

Append findings under per-phase subsections in the findings doc:

```markdown
## Phase N Findings

### Discoveries
- [What was found, where, why it matters]

### Plan / Reality Mismatches
- [What the plan assumed vs. what was actually true]

### Bugs / Gotchas
- [file:line or commit ref, brief description]

### Schema / Data Gaps
- [Missing columns, wrong types, migration issues]
```

Also append a brief summary to the "Findings Captured This Phase" section in the phase's progress/breakdown file.

**Step 3 — Load-bearing findings require design-spec**

If a finding warrants design work (not just a bug fix), the executing agent MUST:
1. Add a new row to DOC-006 in the parent plan (or expand the existing row)
2. Author the design-spec at `docs/project_plans/design-specs/[finding-slug].md`
3. Append the spec path to `deferred_items_spec_refs` in the parent plan frontmatter

**Step 4 — Final phase sealing**

In Phase 7 (DOC-007), the documentation agent:
1. Ensures all phase findings are captured in the findings doc
2. Sets `status: accepted`
3. Sets `promoted_to: /docs/project_plans/implementation_plans/[category]/[feature]-v1.md`
4. Confirms all load-bearing findings have design-specs

---

## 3. Quality Gate (Final Phase Pre-Seal)

Phase 7 (Documentation Finalization) cannot be sealed until:

- [ ] All rows in the "Deferred Items" triage table have `Target Spec Path` populated **OR** row marked "N/A — [rationale]"
- [ ] `deferred_items_spec_refs` frontmatter lists all authored spec paths
- [ ] Findings doc exists and `status: accepted` if `findings_doc_ref` is non-null **OR** `findings_doc_ref` remains null (no findings occurred)
- [ ] All load-bearing findings have corresponding design-specs

---

## 4. Anti-Patterns

- Pre-creating findings docs before the first real finding — do not do this
- Leaving `deferred_items_spec_refs: []` when deferred items exist — populate it
- Capturing findings only in phase notes and not in the findings doc — both locations required
- Authoring design-specs without setting `prd_ref` back to the parent plan — always link
