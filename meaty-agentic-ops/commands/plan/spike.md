---
description: Execute a SPIKE research investigation from a charter document or ad-hoc description
allowed-tools: Read(./**), Write(./**), Edit, MultiEdit, Glob, Grep, Bash, Agent, Task, WebSearch, WebFetch
argument-hint: "[spike-charter-path-or-description] [--leg-of=exploration-charter-path]"
---

Execute SPIKE investigation for: `$ARGUMENTS`

Delegate orchestration to `spike-writer` (opus). This command is the entry point; all implementation and research is delegated.

## Routing

**Detect input type**:
- Path ending in `.md` → charter-based flow (phases 0–4)
- Raw description or no argument → ad-hoc flow (scope first, then charter-based flow)
- `--leg-of=<exploration-charter-path>` flag present → exploration-leg mode (additive layer over charter-based flow; see "Exploration-Leg Mode" below). The flag is additive — it does not replace the routing rules above, it modifies their outputs.

---

## Exploration-Leg Mode (`--leg-of=PATH`)

Used when `/plan:explore` invokes this command for a single leg of a pre-commitment exploration. Additive to the standard charter-based flow — the existing standalone invocation continues to work unchanged.

**Behavior when `--leg-of` is set**:

1. **Inherit from parent charter**: read the exploration_charter at `PATH` (frontmatter only) and inherit:
   - `timebox_days` — hard cap for this leg
   - `hypothesis` — frames the leg's investigation (do not re-derive)
   - `deal_killer` — the leg must explicitly assess or steer clear of this
2. **Scope strictly to the leg's `question`**: parse `--leg-id=<id>` (or accept it via `$ARGUMENTS`) and locate the matching entry in the parent charter's `investigation_legs`. The leg's investigation MUST address only that question. Do not broaden to "while I'm here" tangents.
3. **Output location**: write all leg outputs under `docs/project_plans/exploration/[idea-slug]/spikes/[leg-id]/` (NOT the default `docs/dev/architecture/spikes/...`). Standard files become:
   - `[leg-id]-findings.md` — primary leg findings (replaces `*-design.md`)
   - `[leg-id]-open-questions.md` — unresolved questions (optional; only if open questions remain)
4. **Confidence score (mandatory)**: each leg must append a confidence score in the range `0.0–1.0` for its findings, using the per-leg-type guidance in `.claude/skills/planning/references/exploration-legs-catalog.md`. Append the score to the parent charter's `output_artifacts` field as:
   ```yaml
   output_artifacts:
     - path: docs/project_plans/exploration/[idea-slug]/spikes/[leg-id]/[leg-id]-findings.md
       leg_id: [leg-id]
       confidence: 0.0–1.0
       status: complete | partial
   ```
5. **Timebox enforcement**: if the parent charter's timebox is reached before the leg completes, mark `status: partial` in the appended entry plus a one-line reason in the findings file and stop. Do not extend the parent timebox from here.

**What does NOT change in this mode**:
- The charter-based phase flow (Discovery → Parallel Investigation → Synthesis → Write Outputs → Charter Update) still runs
- Subagent selection still follows the legs catalog (`technical → spike-writer`, etc.)
- Architecture compliance rules below still apply

---

## Ad-Hoc Flow (raw description)

### Phase 0A: Scope the SPIKE

Delegate to `spike-writer`:
1. Define 3–7 research questions from the description
2. Identify expected output artifacts (design doc, ADR, implementation plan)
3. Create charter document at `docs/dev/architecture/spikes/{spike-name}/{spike-name}-charter.md`
4. Set charter status: `in-progress`

Then continue with charter-based flow using the new charter path.

---

## Charter-Based Flow

### Phase 0: Discovery

Read the charter document. Extract:
- Research questions (required)
- Expected output artifacts and locations
- Key files or domains to investigate
- Links to related progress tracking files

MeatyCapture search — find related bugs/enhancements to inform scope:
```bash
# Search request-logs for related items
mc-quick.sh search "spike-keyword" skillmeat
```

If a progress file is referenced in the charter, read it for blocked tasks or prior context.

### Phase 1: Parallel Investigation

For each research question, spawn parallel investigation threads. Assign to:
- `codebase-explorer` (haiku) — code pattern discovery, symbol queries, file mapping
- `research-technical-spike` (sonnet) — deep technical analysis, feasibility, constraints
- `backend-architect` (sonnet) — API layer, services, repositories, DB schema impact
- `data-layer-expert` (sonnet) — migration strategy, Alembic, query performance
- `ui-engineer` (sonnet) — frontend component design, hook patterns, accessibility
- Domain experts as needed per charter scope

Provide each agent: research question, relevant file paths from charter, architecture reference (`CLAUDE.md` layered architecture section).

**SkillMeat architecture context for agents**:
- API layer: routers → services → repositories → DB cache (SQLAlchemy)
- CLI layer: cli.py → core services → storage managers → filesystem
- Auth: `LocalAuthProvider` (default), enterprise PAT for service clients — no Clerk
- Frontend: Next.js 15 App Router, Radix UI + shadcn, server components by default

### Phase 2: Synthesis

`spike-writer` synthesizes findings across all research threads:
- Resolve conflicts between investigation outputs
- Identify open questions not answered by research
- Define recommended approach with rationale
- Flag decisions requiring ADRs

### Phase 3: Write Outputs

Delegate to `documentation-writer`. Output locations (in priority order):
1. Locations specified in charter `expected_outputs`
2. Default: `docs/dev/architecture/spikes/{spike-name}/`

Standard outputs:
- `{spike-name}-design.md` — technical design, architecture layer impact, integration points
- `{spike-name}-implementation-plan.md` — phased breakdown (schema → repo → service → API → UI → tests), complexity estimates
- `{spike-name}-open-questions.md` — unresolved questions, assumptions, risks

If charter requests ADRs: write to `docs/dev/architecture/ADRs/` following existing ADR format.

### Phase 4: Charter Update

Update the charter document:
- Set status to `completed`
- Add links to all output artifacts
- Record timestamp

If a progress file was referenced in Phase 0, update it:
```bash
python .claude/skills/artifact-tracking/scripts/update-status.py \
  -f <progress-file> -t <task-id> -s completed
```

---

## Architecture Compliance

All designs must follow (reference `CLAUDE.md` for details):
- **Layered architecture**: routers → services → repositories → DB (API); cli → core → storage (CLI)
- **Auth**: LocalAuthProvider as default fallback; enterprise PAT for service clients only
- **Error handling**: HTTPException in routers; domain exceptions in core
- **Observability**: OpenTelemetry spans, structured logging
- **Testing**: pytest (backend), Jest + RTL (frontend), accessible queries preferred
