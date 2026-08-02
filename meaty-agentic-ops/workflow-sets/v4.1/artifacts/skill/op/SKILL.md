---
name: op
description: >-
  Route an idea or request through the Agentic Operator — classify route × tier and dispatch to rf, arc, skillmeat, meatywiki, intenttree, or multi-hop workflows.
  Use when the user brings an idea to route, requests escalation to a new tier, approves/rejects a pending gate, or asks for run status/history.
  Triggers: "op new", "route this", "which subsystem", "escalate", "approve", "reject", "what's the status", "spin up".
  Do NOT use for: direct subsystem command invocation (use rf, intenttree, council-review, meatywiki, skillmeat-cli skills instead).
version: 0.3
app_version: "2026-06-30"
updated: 2026-06-30
spec: /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/00-AGENTIC-OPERATOR-DESIGN.md
---

# op Skill

The Agentic Operator entry point and control-plane router. One skill to bring an idea; the operator classifies it and dispatches to the right subsystem at the right effort tier.

For full AOS workflow guidance (context injection, capture targets, AAR/story flow, node targeting,
and current limits), read `docs/agentic-operator/AOS-AGENT-GUIDE.md`.

**AOS correlation:** new runs carry a `correlation` envelope and AOS-controlled final responses
should end with exactly one `AOS-ID: urn:aos:turn:<uuid>` footer. Use `op id mint|resolve|link|footer|backfill-runs`
for model-free ID work. Contract: `docs/agentic-operator/contracts/aos-correlation.md`.

## 1. Overview

The operator is a **two-dial classifier** and **run-record keeper**. It receives an unclassified idea, decides the **route** (which subsystem) and **tier** (how much machinery), shows a plan at a gate, and dispatches to agents-as-tools. It owns the durable run record so you can resume work across sessions, and it enforces three gates (plan, writeback, task-graph mutation) only on the expensive/irreversible hops.

## 2. The Two-Dial Model (route × tier)

| Dial | Name | Values | Meaning |
|------|------|--------|---------|
| **A** | **ROUTE** | research / council / knowledge / artifact / tasks / multi / clarify | Which subsystem to invoke |
| **B** | **TIER** | 0–4 | How much machinery to spin up |

**Route enum (each maps 1:1 to a sibling skill):**
- `research` → `rf` (find evidence, verify claims, state-of-the-art)
- `council` → `arc` / `council-review` (red-team, critique, scorecard)
- `knowledge` → `meatywiki` (recall, file a note, what do we know)
- `artifact` → `skillmeat` (deploy, find, bundle, register)
- `tasks` → `intenttree` (plan, break down, track, dispatch)
- `multi` → operator decomposes (spans 2+ subsystems)
- `clarify` → ask the user one disambiguating question (never guess on expensive work)

## 3. The Tier Ladder (T0–T4, each a superset of the one below)

- **T0 — Capture / Idea.** "Just hold this." → IntentTree off-tree Ideas capture (+ optional MeatyWiki note). ~free, trivially reversible.
- **T1 — Spike / Question.** A bounded question or lookup. → One small `rf` pass or a `meatywiki query`. Low cost, reversible.
- **T2 — Workflow / Council.** "Make this repeatable" or "judge this." → Registered SkillMeat workflow artifact and/or an ARC council scorecard. Medium cost.
- **T3 — Initiative / Feature.** Chartered work inside an existing project. → IntentTree workspace + planning docs (charter→PRD→plan) + optional research/council seed. Med-high cost.
- **T4 — New Project.** A genuinely new thing. → Full scaffold: repo skeleton + project `CLAUDE.md` + SkillMeat bundle + IntentTree workspace + MeatyWiki namespace + seed research/council pass. High cost.

The tier is also the **budget**: each tier carries a default token ceiling and fan-out width (T0=0 agents, T1=1–3, T2=3–5, T3/T4=full wave).

## 4. Decision Tree

```
INTENT                                              COMMAND
─────────────────────────────────────────────────────────────────────
"op research X" / "op council Y" (explicit verb) →  forced route, default tier
"capture this" / short noun phrase, no verb       →  op capture "<idea>"   (T0)
Question, "look into", "is X true"                →  op "<idea>"           (classifier → T1)
"Make a reusable…" / "review this"                →  op "<idea>"           (classifier → T2)
"Build the X feature" (existing project)          →  op new "<idea>" --tier 3
"New app/tool/project", "start…"                  →  op new "<idea>" --tier 4
Pending gate / "approve <run_id>"                 →  op approve <run_id> [--yes]
Cancel paused run                                 →  op reject <run_id> [--reason "..."]
"What's the status" / one-line summary            →  op status <run_id>
Need full run record JSON                         →  op show <run_id>
List all runs                                     →  op list
Subsystem availability check                      →  op doctor
─────────────────────────────────────────────────────────────────────
```

## 5. Command Map (the real `op` CLI surface)

| Command | Purpose | Key flags | Notes |
|---------|---------|-----------|-------|
| `op "<idea>"` | Bare-idea form: classify (route × tier) + run to first gate | `--tier 0..4` `--yes` `--json` `--home` | The default entrypoint. No subcommand needed. |
| `op run "<text>"` | Same as bare form, explicit | (as above) | Identical handler. |
| `op research "<text>"` | Force `research` route | `--tier` `--yes` `--json` `--home` | Routes to `rf`. |
| `op council "<text>"` | Force `council` route | `--tier` `--yes` `--json` `--home` | Routes to `arc`/`council-review`. |
| `op knowledge "<text>"` | Force `knowledge` route | `--tier` `--yes` `--json` `--home` | Routes to `meatywiki`. |
| `op artifact "<text>"` | Force `artifact` route | `--tier` `--yes` `--json` `--home` | Routes to `skillmeat`. |
| `op tasks "<text>"` | Force `tasks` route | `--tier` `--yes` `--json` `--home` | Routes to `intenttree`. |
| `op capture "<idea>"` | Force a T0 Ideas capture | `--yes` `--json` `--home` | Always tier=0, always tasks route. |
| `op new "<idea>" [--tier N]` | Tiered "new thing" scaffolder | `--tier 0..4` `--json` `--home` | Proportional output (T0=note → T4=repo). |
| `op remember "<fact>"` | Capture a durable persona fact | `--facet` `--confidence` `--json` `--home` | No model; writes to persona capture path. |
| `op recall [query]` | Read persona memory | `--limit` `--json` `--home` | Pure read; no model. |
| `op persona reconcile` | Drain persona inbox through SkillMeat extraction and pause at writeback gate | `--run-log` `--yes` `--json` `--home` | The only model-touching persona reconcile path; gated before writeback. |
| `op persona pack` | Generate the persona slice | `--budget` `--output` `--json` `--home` | Part 1 source for delegation context. |
| `op context pack` | Assemble the v2 four-part delegation context bundle | `--budget` `--plan-ref` `--prd-ref` `--project-root` `--project` `--output` | No model; assemble once and pass by path to delegates. |
| `op status <run_id>` | One-line synthesis (NO model call) | `--json` `--home` | Read-only; ICA-friendly. |
| `op show <run_id>` | Full run record (JSON) | `--home` | Read-only. |
| `op list` | List run ids | `--json` `--home` | Read-only. |
| `op approve <run_id>` | Approve the pending gate and continue | `--yes` `--json` `--home` | Resumes paused run. |
| `op reject <run_id>` | Cancel a paused run | `--reason "..."` `--json` `--home` | Records reason in run record. |
| `op doctor` | Probe subsystem availability + env | `--json` `--home` | Lists adapters + routes; never calls a model. |
| `op story scan` | Discover AAR pointers from the app registry | `--first-run` `--registry` `--no-ccdash` | File-only scan; first-run discoveries become backlog plus a digest. |
| `op story review` | Score fresh AAR candidates and pause before drafting | `--include-backlog` `--backlog` `--yes` | Default scores only `new`; `--include-backlog` is for initial import; `--backlog` is digest-only. |
| `op story bootstrap` | Initial fan-out/import across historical AARs | `--registry` `--no-ccdash` `--yes` | Runs first-run scan, then backlog-aware review; still pauses unless `--yes` is supplied. |
| `op story catalog export` | Emit sanitized story catalog records | `--format json\|jsonl` `--output` `--no-archive` | No model call; excludes raw source paths and bodies for MeatyWiki ingest. |
| `op story capture <aar-path>` | Register one AAR pointer | `--json` `--home` | No model call; source AAR stays in place. |
| `op story list` | Read story inbox/archive state | `--archive` `--json` `--home` | Pure read of local queue state. |
| `op story status` | Read latest story run and pending review | `--json` `--home` | Pure read; shows pending candidate and PR link when present. |

### Global flags (every command)
- `--json` — machine-readable output (Principle §2.4: read paths never call a model).
- `--home <dir>` — run-record home (default `$OP_HOME` or `./.operator/runs`).
- `--yes` / `-y` — auto-approve gates (non-interactive).
- `--tier <0..4>` — override the classifier's tier choice.

## 6. The Three Gates (only the hops that matter)

1. **Plan gate** — before any fan-out: show route + tier + hop plan + estimated token/effort budget. Auto-skipped for T0/T1 below threshold.
2. **Writeback gate** — before writing into MeatyWiki or deploying via SkillMeat (irreversible knowledge/artifact mutations).
3. **Task-graph mutation gate** — reuses IntentTree's existing approvable `AgentRun` gate; nothing new to build.

Gates **persist to the run record** and are resumable across sessions — "approve tomorrow" works. Use `op approve <run_id>` to continue, `op reject <run_id> --reason "..."` to cancel.

## 7. When to escalate to `op new` (vs. `op` vs. `op capture`)

| User signal | Use | Why |
|-------------|-----|-----|
| "Just remember this", short noun phrase | `op capture "<idea>"` | T0, zero ceremony, no gates, IntentTree Ideas capture only. |
| Question / "look into" / ambiguous | `op "<idea>"` | Bare form runs the cascade classifier; lets the operator pick route × tier. |
| "Build feature X in <existing project>" | `op new "<idea>" --tier 3` | T3 scaffolder: workspace + planning docs + optional seed. |
| "New app", "start a project", "launch X" | `op new "<idea>" --tier 4` | T4 scaffolder: full repo + bundle + namespace + seed pass. |
| User explicitly names a subsystem | `op <route> "<text>"` | Skip classifier; force the route. Faster, deterministic. |
| "What happened with run X?" | `op status X` / `op show X` | Read-only, no model. |
| "Approve / reject the pending gate" | `op approve X` / `op reject X` | Resumes the paused run from the persisted gate. |

## 8. Deferred / Do Not Say (do NOT invoke)

| Feature | Status | What the skill says |
|---------|--------|---------------------|
| **Atomic dispatch+await on tasks route** | Not shipped | Operator dispatches but does not yet await intenttree completion atomically; the adapter is the harness-exec bridge for now. |
| **Fan-out swarm primitive** | Not shipped | No built-in N-way dispatch; the op composes fan-out from sequential hops + a parent aggregation node. The `multi` route is staged for Phase 3. |
| **Real research model adapters** | Not installed | `rf doctor` reports adapters 0/6 available. Real discovery goes through the `rf-run-execute.js` Claude workflow; the deterministic spine works offline. |
| **Command Center UI / "spin up swarm" button** | Later | The visual front-end is a Phase-5 deliverable over the same operator core. Do not promise a UI. |
| **Tier override that conflicts with classifier** | Reject + clarify | If `--tier` is far from the classifier's confidence band, the operator asks one clarifying question rather than blindly clamping. |

## 9. References Pointer Table

| File | Load when | Max lines |
|------|-----------|-----------|
| `/Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/00-AGENTIC-OPERATOR-DESIGN.md` | Design doc; canonical reference for §4 (route × tier) and §5 (tier ladder) | full |
| `/Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/AOS-AGENT-GUIDE.md` | Need the full current AOS agent workflow and capture map | full |
| `/Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/contracts/story.md` | `op story` behavior, review gates, and local story inbox contract | full |
| `/Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/contracts/delegation-context.md` | Need context bundle format or per-transport injection rules | full |
| `/Users/miethe/dev/homelab/development/agentic_meta_dev/src/operator_core/cli.py` | Verb behavior is unclear; read the real handlers | full |

## 10. Contract Pointer

See `docs/agentic-operator/00-AGENTIC-OPERATOR-DESIGN.md` for the run-record schema,
gate sequencing, adapter contracts, and the cascade classifier's confidence thresholds.

## Key References

- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/00-AGENTIC-OPERATOR-DESIGN.md
- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/AOS-AGENT-GUIDE.md
- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/contracts/story.md
- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/contracts/delegation-context.md
- /Users/miethe/dev/homelab/development/agentic_meta_dev/src/operator_core/cli.py
- /Users/miethe/dev/homelab/development/agentic_meta_dev/docs/agentic-operator/contracts/skill-structure.md
