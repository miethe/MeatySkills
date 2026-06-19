---
description: Pre-commitment exploration — orchestrate SPIKE legs + feasibility synthesis + verdict (go/no-go/conditional) before tier classification
allowed-tools: Task, Skill, Read, Write, Edit, Bash, Glob, Grep
argument-hint: "[idea-description-or-file] [--timebox=N] [--legs=technical,value,risk,priorart] [--charter=path] [--sequential]"
---

**You are Opus. Tokens are expensive. You orchestrate; subagents execute.**

Pre-commitment exploration loop for: `$ARGUMENTS`. Terminates in one of `{go, no-go, conditional}` with a citable verdict and a traceable artifact chain.

**Token budget target**: ~30–60K end-to-end. If Phase 2 alone exceeds 40K, flag the user and consider tightening leg scope.

---

## Required Skills (Invoke First)

Per CLAUDE.md Command–Skill Bindings, before any other action:

1. `Skill("planning")` — loads the "Workflow: Pre-Commitment Exploration" section and templates
2. `Skill("artifact-tracking")` — loads `manage-exploration-status.py` and progress conventions

Do not scaffold the charter, spawn legs, or mutate any artifact until both skills are loaded.

---

## Argument Parsing

Parse from `$ARGUMENTS`:
- **Positional**: idea description, OR path to a request/brief file, OR an existing `--charter=path` to resume
- `--timebox=N`: override charter `timebox_days` (default 3, max 7)
- `--legs=...`: comma-separated subset of `{technical, value, risk, priorart}` (default: catalog-driven per Phase 0 recommendation)
- `--charter=path`: skip Phase 0/1 and resume from an existing exploration_charter
- `--sequential`: opt out of parallel leg execution (default is parallel)

---

## Phase 0 — Triage (Opus, ~3K tokens)

**Goal**: decide if this idea even warrants exploration, or if it should route directly to `/plan:plan-feature`.

**Inputs**: idea description only. Do not read codebase files.

**Triage signals** (check each):

1. Does a comparable past feature exist? (Ask: have we shipped this exact pattern before?)
2. Is a deal-killer obvious from the request alone? (e.g., requires deleting all user data, depends on a vendor we don't use)
3. Is `risk_level` clearly low? (no auth, payments, migrations, or data deletion in scope)

**Decision**:

- **All three signals point to "no exploration needed"**: output a recommendation to route to `/plan:plan-feature` directly. Cite which signals triggered. Stop here.
- **Otherwise**: draft a charter scaffold and proceed to Phase 1.

**Anti-pattern guard**: Do not run a triage that reads more than ~2K tokens of context. If triage requires deep exploration, that exploration *is* Phase 2 — proceed.

---

## Phase 1 — Charter

**Goal**: scaffold a complete `exploration_charter` at `docs/project_plans/exploration/[feature-slug]/[feature-slug]-charter.md`.

**Inputs**: triage scaffold from Phase 0, idea description, optional `--charter=path` (then skip to Phase 2).

**Steps**:

1. Derive `feature_slug` from the idea (kebab-case; matches directory name).
2. Read `.claude/skills/planning/templates/exploration-charter-template.md` as the source structure.
3. Populate frontmatter:
   - `hypothesis` — falsifiable single sentence
   - `deal_killer` — mandatory single-line abandonment condition
   - `timebox_days` — from `--timebox` or default 3; cap at 7
   - `investigation_legs` — 1–4 legs selected per `.claude/skills/planning/references/exploration-legs-catalog.md` §"Composing Legs"
   - `verdict_criteria` — concrete go/no_go/conditional gates
   - `status: draft`, `verdict: null`, `verdict_rationale: null`, `output_artifacts: []`
4. Write the charter to `docs/project_plans/exploration/[feature-slug]/[feature-slug]-charter.md`.
5. Advance status: `manage-exploration-status.py --file [charter] --status in-progress`.

**Anti-pattern guards**:

- Refuse to scaffold without a `deal_killer` (validator enforces; do not bypass).
- Refuse to scaffold with zero legs — minimum one (typically `technical`).
- Charter body should stay under ~60 lines. Defaults from the template are the floor, not the ceiling.

---

## Phase 2 — Parallel Legs

**Goal**: execute each charter leg as a SPIKE sub-invocation and collect findings + confidence scores.

**Steps**:

1. For each entry in charter `investigation_legs`, prepare one `Task()` invocation that calls `/plan:spike --leg-of=[charter-path]` with the leg's `question` and `id`.
2. **Spawn all legs in parallel** in a single message (one `Task()` per leg) unless `--sequential` is set.
3. Each leg writes to `docs/project_plans/exploration/[feature-slug]/spikes/[leg-id]/` and appends its confidence score back to the charter's `output_artifacts` field.
4. Agent assignments come from `exploration-legs-catalog.md` — do not invent new agents. Default mapping:
   - `technical` → `spike-writer` or `research-technical-spike`
   - `value` → `ux-researcher` or `search-specialist`
   - `risk` → `backend-architect` or `data-layer-expert`
   - `prior-art` → `search-specialist` or `docs-seeker`

**Hard timebox**: Phase 2 cannot exceed `timebox_days` from charter. At cutoff:

- Any incomplete leg is marked `partial` with a one-line reason in its findings file
- Synthesis proceeds with partial results; the gap is surfaced in the feasibility brief

**Anti-pattern guards**:

- Do not spawn legs sequentially "to save tokens" — parallel is the default for a reason (verification, not echo)
- Do not extend the timebox at the boundary. If the picture is unclear at cutoff, that is a `conditional` verdict signal, not a reason to run longer
- Verify each leg's output on disk after its Task completes — do NOT pull `TaskOutput()` on file-writing background agents

**Token check**: If Phase 2 cumulative tokens cross 40K, surface to user before continuing.

---

## Phase 3 — Synthesis

**Goal**: produce the `feasibility_brief` and (optionally) a proposed ADR.

**Steps**:

1. Delegate to `documentation-writer` (or `spike-writer` if architectural depth is needed). Provide:
   - Path to charter
   - Paths to all leg findings under `spikes/`
   - Path to `.claude/skills/planning/templates/feasibility-brief-template.md`
   - Output path: `docs/project_plans/exploration/[feature-slug]/[feature-slug]-feasibility-brief.md`
2. The brief must populate frontmatter fields: `verdict`, `verdict_confidence`, `exploration_charter_ref`, `proposed_adr_ref`, `recommended_next_action`.
3. **Proposed ADR (conditional)**: draft a proposed ADR via `create-adr` with `status: proposed` ONLY when the synthesis identifies an architectural decision that will exist regardless of verdict direction (only the choice changes). Otherwise no ADR — the brief carries the reasoning.
4. ADR path (when drafted): `docs/project_plans/exploration/[feature-slug]/[feature-slug]-proposed-adr.md`. Reference it from the brief's `proposed_adr_ref`.

**Anti-pattern guards**:

- Verdict-as-prose is forbidden — `verdict` and `verdict_confidence` are structured frontmatter fields
- Synthesis cannot proceed with zero leg outputs. A charter-only verdict is not a feasibility brief
- Do not draft an ADR just to have one. Noise in the ADR space is a real cost

---

## Phase 4 — Verdict & Handoff

**Goal**: present recommendation, obtain sign-off, record verdict, route handoff.

**Steps**:

1. Opus reviews the feasibility brief and forms a recommendation: `go | no-go | conditional`.
2. Present the recommendation to the user with cited evidence from the brief.
3. **Sign-off** (per meta plan OQ-5):
   - `go` → human sign-off REQUIRED
   - `no-go` → human sign-off REQUIRED
   - `conditional` → may auto-close ONLY when the precondition is concrete and time-bound; otherwise human sign-off required
4. Record verdict via CLI:
   ```bash
   python .claude/skills/artifact-tracking/scripts/manage-exploration-status.py \
     --file docs/project_plans/exploration/[feature-slug]/[feature-slug]-charter.md \
     --status concluded --verdict [go|no-go|conditional] \
     --verdict-rationale "..."
   ```
5. Finalize the brief:
   ```bash
   python .claude/skills/artifact-tracking/scripts/manage-exploration-status.py \
     --file docs/project_plans/exploration/[feature-slug]/[feature-slug]-feasibility-brief.md \
     --status finalized
   ```

### Handoff rules

| Verdict | Action |
|---------|--------|
| `go` | Recommend `/plan:plan-feature --tier=[N]`. Inject feasibility-brief path into the new PRD's `related_documents` frontmatter (the consumer command auto-imports it via its Phase 0 charter-check). |
| `no-go` | Set `recommended_next_action: archive` in the brief. Leave charter + brief as the archive entry; do not delete. Future similar ideas should cite this archive. |
| `conditional` | Set `recommended_next_action: "defer-until: [concrete condition]"`. Create a backlog entry via `meatycapture` (per meta plan OQ-6) so the idea resurfaces when the precondition holds. |

**Anti-pattern guards**:

- Verdict without rationale is invalid — `manage-exploration-status.py` validator refuses
- `conditional` without a named, concrete precondition collapses to `no-go` — do not paper over uncertainty
- ADR drafted as `proposed` in Phase 3 is upgraded to `accepted` (on `go`) or `rejected` (on `no-go`) HERE, not during implementation

---

## Token Discipline

- Opus reads: charter frontmatter, brief frontmatter, leg confidence scores. Not full leg findings.
- Subagents read: their own assigned files. Do not pre-read for them.
- Verify file-writing agent output on disk (read the file), not via `TaskOutput()`.
- Phase 2 budget signal: warn at 40K cumulative; do not silently exceed 60K end-to-end.

---

## Critical Reminders

- **Never write code directly** — delegate to specialized subagents
- **Never explore codebases yourself** — use `codebase-explorer` or the legs
- **Verdict requires sign-off** — Opus recommends, user decides (except auto-close `conditional`)
- **Settled ground is settled** — `no-go` charters are archives. `/plan:plan-feature` will refuse to re-explore them. Cite, do not rerun.
