---
schema_version: 2
doc_type: report
report_category: feasibility                  # Reuses report doc_type; category scopes it as a feasibility brief
title: "[Idea Name] — Feasibility Brief"      # Idea name + " — Feasibility Brief"
status: draft                                  # draft | in-progress | finalized
created: YYYY-MM-DD
updated: YYYY-MM-DD
feature_slug: kebab-slug-here                 # Must match the exploration_charter feature_slug
verdict: null                                 # Mandatory before finalized; enum: go | no-go | conditional
verdict_confidence: null                      # 0.0–1.0; reflects aggregate confidence across legs
exploration_charter_ref: docs/project_plans/exploration/[slug]/[slug]-charter.md   # Required
proposed_adr_ref: null                        # Path to proposed ADR, or null if none drafted
recommended_next_action: null                 # e.g. "/plan:plan-feature --tier=2" | "archive" | "defer-until: [condition]"
related_documents: []                         # Additional back-links (SPIKE outputs, prior reports)
---

# [Idea Name] — Feasibility Brief

<!-- Copy to docs/project_plans/exploration/[slug]/[slug]-feasibility-brief.md -->
<!-- verdict and verdict_confidence MUST be populated before status: finalized. -->

---

## 1. Synopsis

<!-- One paragraph: what the idea is, who it serves, why it surfaced. -->

[One paragraph idea statement: what, who, why now.]

---

## 2. Investigation Summary

<!-- Table of all investigation legs from the exploration charter.
     Confidence is 0.0–1.0 from the SPIKE output frontmatter.
     Findings link points to the SPIKE output file.
     Conclusion is a one-line summary of what the leg established. -->

| Leg | Agent | Confidence | Findings | Conclusion |
|-----|-------|-----------|----------|------------|
| tech | spike-writer | 0.0 | [link] | [one-line conclusion] |
| value | ux-researcher | 0.0 | [link] | [one-line conclusion] |

---

## 3. Cost Estimate

<!-- Rough story-point range anchored to a comparable past feature (estimation-heuristics.md §H5). -->

**Rough estimate**: [N–M story points] ([tier X] equivalent)

**Comparable past feature**: [Feature name and slug] (~[N] pts, completed [date])

**Major cost drivers**:
- [Driver 1]
- [Driver 2]

---

## 4. Value Statement

<!-- Who benefits, evidence (logs/requests/complaints), counterfactual if not built. -->

**Primary beneficiaries**: [User roles or actors]

**Evidence of demand**:
- [Signal 1: source + brief description]
- [Signal 2: source + brief description]

**Counterfactual**: If this is not built, [describe the continuing pain or missed opportunity].

---

## 5. Risks & Blast Radius

<!-- Categorize risks across technical, operational, and organizational dimensions.
     Rate each H/M/L. Be specific — vague risks are not actionable. -->

| Risk | Category | Severity | Mitigation |
|------|----------|---------|------------|
| [Risk 1] | technical | H/M/L | [Mitigation] |
| [Risk 2] | operational | H/M/L | [Mitigation] |
| [Risk 3] | organizational | H/M/L | [Mitigation] |

---

## 6. Architectural Implications

<!-- Summarize any architectural decisions that surfaced during investigation.
     If a proposed ADR was drafted, link it here and summarize the decision. -->

<!-- If proposed_adr_ref is set, uncomment and complete: -->
<!-- **Proposed ADR**: [proposed_adr_ref] — [one-sentence decision summary] -->

[Describe whether this idea fits cleanly into the existing architecture or requires structural changes. Reference specific layers (e.g., agent_queries, repositories, router). If no architectural implications exist, state that explicitly.]

---

## 7. Verdict

<!-- Expands the verdict frontmatter fields. Frontmatter is machine-readable; this section is the rationale. -->

**Verdict**: [go | no-go | conditional]
**Confidence**: [0.0–1.0]

**Rationale**:
[2–4 sentences. Reference specific leg findings. Explain how the verdict_criteria from the charter were applied. If conditional, name the specific precondition that must be resolved.]

**Recommended next action**: [e.g. `/plan:plan-feature --tier=2 --charter=[charter-path]` | `archive` | `defer-until: [named condition]`]

---

## 8. Citations

<!-- Back-links to all artifacts consumed in producing this brief.
     Every SPIKE output, the charter, and any external sources. -->

- Exploration charter: [exploration_charter_ref]
- Tech leg SPIKE: [path]
- Value leg SPIKE: [path]
- [Additional citation]
