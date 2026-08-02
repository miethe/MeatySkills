# Changelog — planning

## v2.1 — 2026-07-31 — Gate tiering (workflow-set v4.1)

The authoring half of gate tiering. Execution half: `dev-execution` v1.3. Ruleset:
`dev-execution/references/gate-risk-classes.md` §2.

- **Author for one lens.** Both reviewer tables (the Tier Matrix `Reviewer` column and the Reviewer
  Gates pointer) now describe a **base gate of one lens for every tier**, with a second added only on
  a named trigger. **Tier no longer adds lenses** — a Tier 3 CRUD milestone gets one; a Tier 2
  authorization milestone gets two. Tier 3's blanket per-milestone `karen` is narrowed to
  `context_class` C3/C4; otherwise `karen` is one final-tree pass. Tier 0 gains an explicit
  one-validator row.
- **The three triggers are the whole second-lens test**: the milestone's surface **parses untrusted
  input**, **is an authorization/identity boundary**, or its effect is **irreversible or leaves the
  system**. Recorded per milestone as `gate_lens` + a mandatory `gate_lens_reason`. A two-lens
  milestone with no named trigger is a classification error, not a cautious default.
- **ARC is now the second lens, not a third pass.** The Council Routing section previously made ARC
  *additive* — "both `task-completion-validator` and `karen` still run; ARC is an extra pass" — which
  on `risk_level: high` produced three lenses per gate. ARC now occupies the second-lens slot, and
  `risk_level: high` alone no longer triggers it: risk level sizes the *plan*, the surface triggers
  classify the *surface*, and only the surface sets the lens count.
- **`references/plan-frontmatter-schema.md` §5.4 registers the gate fields** — `gate_lens`,
  `gate_lens_reason`, `gate_shared_with`. These were emitted by the plan-optimizer since 2026-07-29
  and are now read at dispatch, but were absent from the schema, so the linter could not see them and
  authors did not know they existed (the same gap `routing_constraints` fell into). Adds a
  `conditional_required:` block making `gate_lens_reason` required when `gate_lens` has ≥2 entries,
  enforced advisorily by `artifact-tracking/scripts/validate-plan-frontmatter.py`. The mandatory
  same-PR diff to `docs/agentic-operator/contracts/frontmatter-schema.md` (OQ-4 gate) landed with it.
- **`references/plan-doctrine.md`** gains the design rule behind the recurrence trigger: ask *what
  can the caller even say?* before *is every input guarded?* — surface reduction over guard
  proliferation.
- **`templates/milestone-plan-template.md`** carries `gate_lens` slots with an authoring comment and
  one worked triggered example, stating that keeping `[validator]` is correct rather than
  under-specified.
- **`/plan:plan-feature`** instructs per-milestone gate classification with a concrete YAML example.

## v2.0 — 2026-07-30

- **Wire in the Claude-5-generation plan doctrine** (`references/plan-doctrine.md` +
  `templates/milestone-plan-template.md`): Tier 2/3 Implementation Plans default to **milestone-based
  thin plans** — 3-4 reviewable-state milestones with AC, replacing the 8-standard-phase task-table
  breakdown. `implementation-plan-template.md` is retained as the legacy/expanded template for
  in-flight plans and the economy-class-executor decisions-block expansion path (Workflow 2 step 2.5)
  only — not the default for a new plan.
- **No plan-time model or agent pins.** Workflow 2 steps 4 ("Assign Subagents") and 5 ("Model
  Assignment") are replaced by a single `routing_constraints` authoring step: plans declare MUST-stay-
  claude-primary classes, offload-eligibility, and the capability bar per milestone; `delegation-router`
  resolves provider + model at dispatch time. `assigned_to` and `phases[].model`/`effort` are
  **deprecated, not deleted** — in-flight plans authored under the old rules keep them.
  `wave_plan.orchestrator_model` is **deleted outright** (advisory field, never read by the execution
  loop) — including from the `Execute: /dev:execute-plan <plan>` handoff string, which no longer names
  an orchestrator model.
- **Add `context_class` (C1-C4) sizing**, step 3.6 of Workflow 2 — points size behavior, context class
  sizes agent context and is the actual burn predictor (`plan-doctrine.md` § "Context class").
  Generalizes the per-task **H7 heuristic** (huge-file touch multiplier), added to
  `references/estimation-heuristics.md` and the mandatory Estimation Sanity Check (now H1-H7).
- **Delete the mandatory Phase Summary table.** It duplicated the milestones + AC-matrix that now
  own the same information; the instruction that made it mandatory is removed outright, not
  deprecated — new plans do not emit it. In-flight plans that already carry one finish under the
  rules they were authored on.
- **Plan mass is now a budget.** New Tier 2/3 plans target **<=150 lines total**, frontmatter
  included ("Prompt and Artifact Sizing", Tier Matrix, Key Benefits, Best Practices — all reconciled
  against the pre-existing **~800-line hard ceiling**, which still applies to every planning doc but
  is no longer the plan-specific target).
- **First validator-conformant version.** Added `version`/`app_version`/`updated` frontmatter, this
  CHANGELOG, and the required `When NOT To Use` section. Clears the `skill-dev` `validate_skill.py`
  frontmatter/heading FAILs (the `.agents/` mirror `.Codex/`-ref FAIL and `MirrorParity` WARN are
  pre-existing, out of scope for this change — `.agents/` is the deprecated stale mirror).
- Rewrote the `description` frontmatter and worked example to describe milestone-based thin plans
  instead of "8 standard phases + subagent assignments"; Tier Matrix Tier 2/3 rows now show
  constraint-style routing language instead of a model-pin cell.
