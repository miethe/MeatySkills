# Workflow Phases — Detailed Procedures

Read when entering Phase 1. Elaborates the nine-phase workflow from SKILL.md with concrete heuristics, grep patterns, and stopping rules.

## Orchestrator Token Budget

**Target: ≤15K orchestrator tokens for a full run.** See also: `.claude/rules/context-budget.md`.

Budget allocation:
- Phase 1 (inventory summary received back): ~1.5K tokens
- Phases 2–5 (targeted Explore delegations, receiving only ranked/classified lists): ~5K tokens
- Phase 6 (demotion review, ledger is a file — orchestrator reads only conflict summary): ~1.5K tokens
- Phase 7 (4 parallel writer Task() calls, no TaskOutput()): ~3K tokens in prompts
- Phase 9 (verify.py output review, one lightweight reviewer subagent): ~2K tokens
- Overhead (tool calls, status updates): ~2K tokens

**Invariants (non-negotiable):**
1. Phase 1 must be fully delegated. Orchestrator receives compact YAML only (<2K tokens).
2. Orchestrator never reads source files directly at any phase.
3. Phase 7 writers run in a single parallel batch (4 Task() calls in one message).
4. Never call `TaskOutput()` on file-writing agents — verify artifacts on disk.
5. Subagent prompts must be <500 words each. Provide file paths, not file contents.
6. The evidence ledger is the sole handoff artifact between phases — passed by path, not by content.

---

## Phase 1 — Inventory (DELEGATED)

**Goal**: Produce a compact YAML/JSON structural map. Orchestrator receives summary only — never raw findings or file contents.

**Delegation pattern:**

```
Task("codebase-explorer",
  "Inventory the project at <project_path>. Return ONLY a compact YAML summary with:
   - top_level_dirs: list
   - language_manifests: list of detected files (pyproject.toml, package.json, etc.)
   - frameworks: list with evidence paths
   - runtime_boundaries: list of {name, type, primary_path}
   - entrypoints: list of {path, type}
   - integration_surfaces: list (external HTTP, env vars, SDKs)
   - infra_files: list (Dockerfiles, CI, compose)
   - doc_paths: list (*.md, CLAUDE.md, .claude/**)
   - file_count: integer
   - service_count: integer (monorepos only)
  Do NOT include file contents. Target output: under 150 lines of YAML.")
```

Orchestrator writes this summary to `.claude/context/distilled/.ledger.yaml` under a `inventory` key as the first ledger entry. No other Phase 1 output is retained in orchestrator context.

**Stopping rule**: Phase 1 output is paths + labels, not prose. Delegate to `Explore` or `codebase-explorer` for any repo >200 files.

---

## Phase 2 — Supplemental Ingestion

**Goal**: Classify every supplemental document before integration. Tagged claims go directly into the ledger.

For each supplemental path (and each doc from Phase 1):
1. Delegate a read-classify task to a subagent (batch up to 10 docs per agent call).
2. Each doc gets classified as: `implemented` / `aspirational` / `historical`.
3. Note: ADR, PRD, design note, meeting notes, NotebookLM export, changelog, README, spec.
4. Flag docs older than relevant code commits as potentially stale.

**Output to ledger** (one entry per doc):
```yaml
claims:
  - id: "doc-001"
    type: evidence
    confidence: H
    source: "docs/architecture.md"
    classification: implemented
    subject: "data-flow patterns"
    note: ""
```

**Heuristics**:
- PRDs/specs → usually `aspirational` until verified.
- ADRs → usually `implemented` or `historical`.
- NotebookLM exports → treat as synthesis; don't re-cite as primary evidence.

---

## Phase 3 — Product Intent Inference

**Goal**: Derive purpose, personas, jobs-to-be-done. Every inferred element tagged and written to ledger immediately.

Delegate to subagent with paths only (no file contents in orchestrator):
- `README.md`, `CLAUDE.md` / `AGENTS.md`
- CLI help text grep pattern: `help=`, `description=`
- API route names
- Test names (`def test_*`, `it(`, `describe(`)

For each element (persona, JTBD, core workflow) the subagent returns a compact ledger entry:
```yaml
- id: "intent-001"
  type: inference
  confidence: M
  evidence_ids: ["doc-001"]
  claim: "Primary persona is solo developer managing Claude Code artifacts"
  source: "skillmeat/cli/__init__.py + README.md"
```

Orchestrator appends these to the ledger — does not hold them in context.

---

## Phase 4 — Feature Cataloging

**Goal**: Enumerate features with catalog metadata. Each feature entry tagged inline.

Delegate in batches by domain/subsystem:
```
Task("codebase-explorer",
  "Catalog features in <domain_path>. For each feature return a YAML list entry:
   {name, what_it_does, persona, location, dependencies, maturity, confidence, evidence_citations}
   Use maturity labels: implemented/partial/experimental/dormant/planned.
   Tag type: evidence or inference. Return YAML only.")
```

**Maturity signals to delegate:**
```
Grep patterns (delegate to subagent):
  NotImplementedError|not implemented|TODO|FIXME|XXX|HACK
  @deprecated|DeprecationWarning|warnings.warn
  feature_flag|featureFlag|FEATURE_|is_enabled
  beta|experimental|preview
```

Each feature batch result is appended to the ledger. Orchestrator does not hold feature lists in context.

---

## Phase 5 — Architectural Synthesis

**Goal**: Capture design fundamentals. ADR decisions ranked before surfacing.

### ADR Discovery and Ranking

When ADRs are present, delegate a ranking subagent:

```
Task("codebase-explorer",
  "Find all ADRs/decision records in <repo_root>. For each:
   1. Get last modified date (git log -- <file> --format=%ai | head -1)
   2. Extract the ADR ID or title
   3. Count grep hits of the ADR ID/key-term across the codebase
   4. Note if code contradicts the ADR decision
   Return a YAML list ranked by: (a) recency, (b) grep footprint, (c) contradiction status.
   Top 5 'load-bearing decisions' labeled as such.")
```

Orchestrator receives only the ranked list. Top 5 load-bearing decisions go into the fundamentals artifact; remainder noted in Open Questions.

### Architectural patterns subagent

Delegate with paths only:
- Architecture-significant directories (interfaces, DI factories, core)
- Language manifests
- Pattern: "identify patterns, key decisions, data/control flow, extensibility model, constraints, fragility signals — return YAML summary only"

All findings tagged at extraction time:
```yaml
- id: "arch-001"
  type: evidence
  confidence: H
  claim: "Hexagonal architecture with DTO boundary at router layer"
  source: "skillmeat/core/interfaces/repositories.py, skillmeat/api/dependencies.py"
```

---

## Phase 6 — Demotion / Conflict Resolution (formerly "Evidence Tagging")

**Goal**: Review the ledger for claims that should drop in confidence or be marked `[open]`. This is NOT bulk retroactive tagging — claims were tagged in Phases 1–5. Phase 6 is conflict resolution only.

Procedure:
1. Read `evidence_ids` for all `inference` claims in the ledger. Any inference with no `evidence_ids` → demote to `open`.
2. Identify sibling claims that contradict each other (same subject, different confidence or content).
3. Resolve conflicts: code evidence > documentation evidence > single-grep evidence.
4. Flag contradictions for Phase 8.
5. Write conflict summary to ledger `meta.conflicts` list (compact — paths + claim IDs only).

Orchestrator reads only the conflict summary (~20 lines), not the full ledger.

Apply `references/evidence-standards.md` rubric. Read it before Phase 6.

---

## Phase 7 — Artifact Generation (PARALLEL, DELEGATED)

**Goal**: Fill the four templates in parallel. Orchestrator never holds draft content.

**Before launching writers**, write the ledger to disk:
- `output_dir/.ledger.yaml` — complete, with all Phase 1–6 claims.

Then launch all four writers **in a single message** (4 Task() calls):

```
# Launch all four in one message — do NOT wait for one before starting others

Task("ui-engineer",
  "Write project-purpose-and-feature-catalog.md to <output_dir>.
   Template: .claude/skills/project-context-distiller/assets/project-purpose-and-feature-catalog.template.md
   Evidence ledger: <output_dir>/.ledger.yaml
   Repo root: <project_path>
   Fill every section. For Health Signals, add Confidence Note if >30% inference.
   Do not omit sections — write 'No evidence found; see Open Questions' if empty.
   Do not return file contents — write to disk only.")

Task("ui-engineer",
  "Write project-fundamentals-and-design-context.md to <output_dir>.
   Template: .claude/skills/project-context-distiller/assets/project-fundamentals-and-design-context.template.md
   Evidence ledger: <output_dir>/.ledger.yaml
   Repo root: <project_path>
   Important Design Decisions: surface only the top 5 load-bearing decisions (ranked by Phase 5).
   Fill every section. Write to disk only.")

Task("ui-engineer",
  "Write research-agent-context-pack.md to <output_dir>.
   Template: .claude/skills/project-context-distiller/assets/research-agent-context-pack.template.md
   Evidence ledger: <output_dir>/.ledger.yaml
   Repo root: <project_path>
   Proof-of-Concept Snippets: extract 3 real code snippets from highest-confidence arch claims
   (with exact path:line_start-line_end citations). Write to disk only.")

Task("ui-engineer",
  "Write project-opportunity-map.md to <output_dir>.
   Template: .claude/skills/project-context-distiller/assets/project-opportunity-map.template.md
   Evidence ledger: <output_dir>/.ledger.yaml
   Repo root: <project_path>
   Base opportunities on evidence in ledger — do not fabricate. Write to disk only.")
```

After all four complete, verify by checking files exist on disk (Glob). Do NOT call TaskOutput().

Artifact fill order within each writer (for internal consistency):
1. `project-purpose-and-feature-catalog.md` (factual ground)
2. `project-fundamentals-and-design-context.md` (builds on catalog)
3. `research-agent-context-pack.md` (synthesizes 1+2)
4. `project-opportunity-map.md` (reasons forward from 1+2+3)

Since writers run in parallel, they each read the shared ledger rather than depending on sibling output.

---

## Phase 8 — Contradiction & Stale-Doc Sweep

Cross-reference Phase 2 classifications against Phase 4 findings:
- Docs marked `implemented` but feature is `planned` → contradiction.
- Docs marked `aspirational` but feature is `implemented` → stale doc.
- ADR decisions contradicted by current code → flag loudly.

Delegate sweep to a subagent reading the ledger + artifact paths. Subagent adds findings to:
- Catalog "Known Gaps / TODO Signals / Incomplete Areas"
- Fundamentals "Technical Debt / Fragility Signals"

Orchestrator receives only the count of contradictions found.

---

## Phase 9 — Self-Review (SCRIPT-FIRST)

**Step 1 — Run verify.py:**

```bash
python .claude/skills/project-context-distiller/scripts/verify.py \
  --ledger <output_dir>/.ledger.yaml \
  --output-dir <output_dir> \
  --repo-root <project_path>
```

If `--counts-check` file exists (`.claude/distiller-counts.yaml`), add that flag.

**Step 2 — If verify.py exits 0:** proceed to reporting.

**Step 3 — If verify.py exits 1:** delegate fixes to a lightweight reviewer subagent:

```
Task("code-reviewer",
  "verify.py reported these failures: <paste verify.py output, ~20 lines max>
   Artifacts are in <output_dir>. Ledger at <output_dir>/.ledger.yaml.
   Fix each failure — update the artifact files, do not modify the ledger.
   Report: which failures were fixed, which required human input.")
```

Re-run verify.py after fixes. Orchestrator does not read artifact content at any point.

**Step 4 — Report to user.** See SKILL.md deliverable checklist for the required summary format.
