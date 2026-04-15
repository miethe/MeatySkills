---
name: project-context-distiller
description: Use this skill to distill a software project (codebase plus optional supplemental docs, ADRs, PRDs, NotebookLM exports, design/business notes) into high-signal, research-ready context artifacts. Produces four synthesized markdown documents — feature catalog, design fundamentals, research context pack, and opportunity map — grounded in repo evidence with explicit confidence levels, intended for downstream AI agents reasoning about expansion, novel ideas, or architectural evolution. Trigger when the user asks to "distill project context", "generate project understanding artifacts", "externalize project context for future agents", "build a research context pack", or points the skill at a repo with supplemental materials.
---

# Project Context Distiller

## Purpose

Transform a project repository (plus optional supplemental materials) into four structured, evidence-first artifacts that downstream agents can use to reason about the project without re-deriving it from scratch. Optimize for synthesis, not summarization.

## When to use

Invoke when the user wants to:
- Externalize deep project context for future AI agents.
- Generate feature catalogs, architectural fundamentals, or opportunity maps for an existing codebase.
- Refresh previously generated context artifacts after significant changes.
- Build a research briefing pack for ideation, strategy, or architecture evolution work.

Do not invoke for shallow repo overviews, README rewrites, or single-file explanations.

## Inputs

Accept any combination:
- `project_path` (required): absolute path to the target repo or monorepo root.
- `supplemental_paths` (optional): list of paths to docs, ADRs, PRDs, changelogs, design/business notes, NotebookLM exports.
- `output_dir` (optional, default `<project_path>/.claude/context/distilled/`): where to write artifacts.
- `mode` (optional): `full` (default) or `refresh` (update existing artifacts in place).
- `scope` (optional): `monorepo` or `service:<name>` to narrow analysis.

If essentials are missing, infer from the working directory and ask once for clarification.

## Output artifacts

Always write these four files to `output_dir`. Templates live in `assets/`:

1. `project-purpose-and-feature-catalog.md` — from `assets/project-purpose-and-feature-catalog.template.md`
2. `project-fundamentals-and-design-context.md` — from `assets/project-fundamentals-and-design-context.template.md`
3. `research-agent-context-pack.md` — from `assets/research-agent-context-pack.template.md`
4. `project-opportunity-map.md` — from `assets/project-opportunity-map.template.md`

A fifth file is always produced as the backbone of the run:

5. `output_dir/.ledger.yaml` — the evidence ledger: all claims, citations, confidence tags, and maturity labels accumulated during Phases 1–6. This is the handoff artifact between all phases. It is NOT one of the four user-facing artifacts.

Copy templates verbatim into `output_dir`, then fill every section. Do not omit sections — if a section has no evidence, write "No evidence found in repo; see Open Questions" and list the gap explicitly.

## Orchestrator Token Budget

**Target: ≤15K orchestrator tokens for a full run.**

Reference: `.claude/rules/context-budget.md`

| Phase | Orchestrator tokens | Notes |
|-------|--------------------|----|
| Phase 1 inventory | ~1.5K | Receives compact YAML summary only |
| Phases 2–5 synthesis | ~5K | Receives ranked/classified lists only |
| Phase 6 conflict resolution | ~1.5K | Reads conflict summary (~20 lines), not full ledger |
| Phase 7 writer prompts | ~3K | 4 Task() calls × ~750 words each |
| Phase 9 verify.py review | ~2K | Reads verify.py stdout only |
| Overhead | ~2K | Tool calls, status, reporting |
| **Total** | **~15K** | |

If the budget is exceeded, the most likely cause is Phase 1 returning prose instead of YAML, or TaskOutput() being called on writer agents. See `references/troubleshooting-distiller.md`.

## Delegation Invariants

These rules are non-negotiable and enforce the token budget:

1. **Phase 1 is fully delegated.** Orchestrator receives a compact YAML summary (<2K tokens). Never receives file contents from Phase 1.
2. **Orchestrator never reads source files.** All file reading is done by subagents. Orchestrator receives only structured summaries passed via file path or compact inline YAML.
3. **The evidence ledger is the handoff medium.** All claims, tags, and citations are written to `.ledger.yaml` during Phases 1–6. Writers in Phase 7 read this file; orchestrator does not hold its contents.
4. **Phase 7 writers run in parallel.** All 4 artifact writers are launched in a single message (4 Task() calls). Do not launch them sequentially.
5. **Never call TaskOutput() for file-writing agents.** Verify artifacts on disk using Glob after writers complete.
6. **Subagent prompts are <500 words each.** Reference patterns by path, not by embedding file contents.
7. **Phase 9 is script-first.** Run `scripts/verify.py` before any human or agent review. Only delegate to a reviewer subagent if verify.py reports failures.

## Workflow (high level)

Execute phases in order. Detailed procedures, heuristics, and grep patterns live in `references/workflow-phases.md` — read it when entering Phase 1.

1. **Phase 1 — Inventory** (DELEGATED): map structure, languages, entrypoints, layers, integrations. Orchestrator receives compact YAML only.
2. **Phase 2 — Supplemental ingestion**: classify each supplemental doc as `implemented`, `aspirational`, or `historical`. Claims tagged inline to ledger.
3. **Phase 3 — Product intent inference**: derive purpose, personas, jobs-to-be-done, core workflows. Tagged claims appended to ledger.
4. **Phase 4 — Feature cataloging**: enumerate features with code location, maturity, dependencies. Delegate per domain; receive YAML lists only.
5. **Phase 5 — Architectural synthesis**: patterns, decisions, constraints, extensibility surfaces, fragility signals. ADR ranking delegated; top 5 returned.
6. **Phase 6 — Demotion / conflict resolution**: review ledger for claims lacking evidence parents; resolve sibling conflicts. Code evidence beats doc evidence. Orchestrator reads conflict summary only.
7. **Phase 7 — Artifact generation** (4 PARALLEL WRITERS): fill four templates from ledger. Writers launched in single message. Orchestrator never holds drafts.
8. **Phase 8 — Contradiction & stale-doc sweep**: flag doc/code mismatches; writers update affected artifacts.
9. **Phase 9 — Self-review** (SCRIPT-FIRST): run `scripts/verify.py`; delegate fixes to lightweight reviewer only if failures found.

For large repos (>500 files or >5 services), read `references/large-repo-strategy.md` before Phase 1.

For `mode=refresh`, read `references/incremental-refresh.md` instead of regenerating from scratch.

For troubleshooting, read `references/troubleshooting-distiller.md`.

## Quality bar (non-negotiable)

Every claim in every artifact must satisfy:

- **Citable**: reference a concrete path (file, module, directory) whenever possible. Inline form: `` `path/to/file.py:symbol` ``.
- **Typed**: explicitly labeled `evidence` (directly grounded), `inference` (reasoned from signals), or `open question` (unresolved).
- **Calibrated**: attach confidence (`high` / `medium` / `low`). Never overclaim.
- **Nuanced on maturity**: distinguish `implemented`, `partial`, `experimental`, `dormant`, `planned`.
- **Skeptical of docs**: when docs and code diverge, code wins unless the doc is a forward-looking plan — flag the divergence in the contradiction sweep.
- **Synthesized, not summarized**: do not restate READMEs. Cross-reference code, docs, config, naming, and supplemental materials.
- **Inline evidence tagging**: claims are tagged during Phases 1–5 as they are discovered, not retroactively in bulk during Phase 6.

Full rubric: `references/evidence-standards.md` — read before Phase 6.

## Evidence Ledger

The evidence ledger (`.ledger.yaml`) is produced during Phases 1–6 and consumed by Phase 7 writers. Structure:

```yaml
meta:
  project: "<project-name>"
  last_refreshed: "YYYY-MM-DD"
  distiller_version: "1.1"
  mode: full
  conflicts: []          # Phase 6: list of {claim_ids, resolution}

claims:
  - id: "inv-001"
    type: evidence        # evidence | inference | open
    confidence: H         # H | M | L
    claim: "<text>"
    source: "path/to/file.py:symbol"
    phase: 1
    evidence_ids: []      # for inference: list of parent evidence claim IDs

  - id: "arch-003"
    type: inference
    confidence: M
    claim: "<text>"
    source: "multiple"
    evidence_ids: ["inv-001", "doc-002"]
    phase: 5
```

Write the ledger incrementally — append claims as each phase completes. Do not hold claim text in orchestrator context.

## Execution guidance

- **Delegate all exploration.** Use `codebase-explorer` or `Explore` subagents. Orchestrator never reads source files.
- **Pass paths, not contents.** Subagent prompts reference file paths; subagents read what they need.
- **Write incrementally to the ledger.** Accumulate claims during Phases 1–5; Phase 6 resolves conflicts; Phase 7 consumes the ledger.
- **Process supplemental materials in a single delegated pass**, classifying each before integrating.
- **On monorepos**, apply Phases 1–5 per service/package via separate subagents, then synthesize in the ledger.
- **Flag contradictions loudly** — doc/code mismatches are high-value signal for downstream agents.

## Deliverable checklist

Before reporting completion, verify via `scripts/verify.py` (exit code 0 = pass):

- [ ] All four artifacts exist in `output_dir`.
- [ ] Every required section present (none omitted).
- [ ] Every major claim has a path citation or an explicit "no evidence" note.
- [ ] Every conclusion is tagged (evidence/inference/open-question) with confidence.
- [ ] Contradictions and stale docs are listed in the relevant artifacts.
- [ ] Feature maturity labels applied consistently.
- [ ] `research-agent-context-pack.md` Executive Context is dense and scannable (~400 words or less).
- [ ] `project-opportunity-map.md` separates near-adjacent, bolder, and architectural-change ideas with risk notes.
- [ ] `project-purpose-and-feature-catalog.md` Health Signals section is populated.
- [ ] `research-agent-context-pack.md` Proof-of-Concept Snippets has 2–3 real code extracts with line citations.
- [ ] Fundamentals Important Design Decisions surfaces top 5 load-bearing decisions (ranked by recency + footprint).
- [ ] Evidence ledger exists at `output_dir/.ledger.yaml`.

Report to the user: artifact paths, counts (features cataloged, contradictions found, open questions), top 3 highest-confidence findings, top 3 open questions.
