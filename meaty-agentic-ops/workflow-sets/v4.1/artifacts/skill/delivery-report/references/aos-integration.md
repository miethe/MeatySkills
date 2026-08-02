# AOS Integration — writeback, tracker linking, registration

`delivery-report` is AOS-native in three ways. None of them put a model call or a network
call on the render path (constraint 4): `render` and `validate` stay deterministic and offline.

## 1. Writeback envelope (`export`)

`export` emits a deterministic JSON envelope describing a rendered report, for ingestion by an
AOS subsystem. It never performs the ingestion itself — that is a separate, approved action run
through the subsystem's own CLI (the save-after gate stays where it already lives).

```bash
delivery_report.py export \
  --manifest .claude/reports/<slug>/report.json \
  --html     .claude/reports/<slug>/index.html \
  --target   intenttree \
  --out       .claude/reports/<slug>/writeback.intenttree.json
```

Targets: `skillmeat` · `intenttree` · `meatywiki` · `ccdash` · `atlas` (added PF-3 M1). The envelope
carries `route`, `title`, `subject`, `revision`, `truth_status`, `generated_from`, the manifest +
HTML paths, `item_count`, `tracker_links[]` (every item handoff that names a tracker node), and — for
`atlas`/`intenttree` — the two PF-3 D1/D2 fields: `instance_key` (the per-instance discriminator;
`null` for `feature`/`dossier`, required for `phase`/`program`/`readiness`) and `link_identity` (the
precomputed identity string, computed once so the atlas asset and the IntentTree external link cannot
drift apart — see §1.1). Ingestion recipes:

| Target | What to do with the envelope |
|---|---|
| `meatywiki` | Ingest the HTML as a knowledge artifact: `meatywiki ingest <html> --kind report`. The envelope's `generated_from` + `truth_status` become front-matter. |
| `skillmeat` | Attach report HTML + manifest to the project record; the envelope is the manifest for `skillmeat` artifact linkage. |
| `intenttree` | For each `tracker_links[]` entry, annotate the node with the report URL (see §2). |
| `ccdash` | Attach as run evidence; `generated_from.commit` binds it to a tree. |
| `atlas` | **Actuated (PF-3 M2/M3).** `scripts/publish_report.py` subprocesses `python3 -m app.cli.atlas report ingest <html> --envelope <envelope.json>` in the sibling `artifact_atlas` repo, parses its `Preview URL:` line, resolves scope (route → target IntentTree node, per the D4 table), re-verifies the resolved node (the R1 misattribution guardrail — reject loudly, no write, on any mismatch), then calls `itt link report <node> --ref <link_identity> ...` passing D2's identity through verbatim. `hooks/publish-report.sh` (in `dev-execution`) composes export→publish at a phase/plan-close binding point, non-fatally. See §1.1 and `dev-execution/SKILL.md` for what actually fires today vs what is armed-but-dormant. |

### 1.1 Link identity — settled convention (OQ-5 RESOLVED 2026-08-02)

**Hazard (DI-283).** IntentTree's `delivery_report` link identity upserts on
`(target_type, target_id, source_system, external_id)` and **refreshes in place** — so two
genuinely different reports that share the same `external_id` **collapse onto one row and the
earlier pointer is lost.** This hazard is the reason the convention below exists; it stays true even
though PF-3 has now closed it.

**The settled identity, computed in exactly one place (`delivery_report.py`'s
`compute_link_identity()`, D2) and passed verbatim as `itt link report --ref`:**

```
feature | dossier              -> report:{route}:{subject}
phase | program | readiness    -> report:{route}:{subject}:{instance_key}
```

`feature`/`dossier` collapse on `(route, subject)` **by design** — one report per feature, or a
living record regenerated in place; that is correct, not a bug. `phase`/`program`/`readiness`
**recur** — a new report at every phase boundary, milestone, or go/no-go decision — so their identity
carries an explicit `instance_key`, sourced by the caller from whatever actually distinguishes the
instance (the phase/milestone id for `phase`, the milestone id for `program`, the decision date for
`readiness`).

**Why `revision` is NOT the discriminator.** It is tempting to key identity off `report.revision`
instead of adding a new field, but nothing in this codebase increments it: `revision` is set to `1`
by `init_manifest` and stays there — the "bump on phase close" instruction in
`modes/phase-execution.md` §5.2b is prose only, never executed by any script. Keying durable pointer
identity off a field nothing writes would reproduce the exact silent-collapse failure DI-283 warns
about, one level deeper. `revision` remains a **display-only** field (`OQ-3`: re-publishing the same
instance overwrites its hosted asset and refreshes its link row in place — no supersedes-chain).

**Enforcement, not just documentation:** `build_export()` raises (`ReportError`, nothing written)
when a recurring route is exported to `atlas`/`intenttree` with no `instance_key` present — it never
falls back to `subject` (recreates the DI-283 collapse) or to `generated_at`/a timestamp (breaks
idempotency by minting a new row on every re-publish of the same instance). `context_label` stays
deliberately outside the identity, so retitling a report refreshes its row rather than forking one.

Full decision + rationale: `docs/project_plans/implementation_plans/delivery-report-hosting-and-linking-v1.md`
(`decisions[]`, OQ-5). Upstream DI-283 (`intenttree/docs/project_plans/deferred-items-backlog.md`)
stays open as **optional** upstream hardening (should the contract *enforce* route-aware identity at
the IntentTree layer too) — PF-3's resolution needed no upstream change to close the hazard here.

## 2. IntentTree tracker linking (look-first, reconcile-against-git)

Every forward-route item handoff may carry `tracker: "node_… — title"`. The renderer prints it as
a labelled reference and the validator sanity-checks the `node_…` id shape. This closes the loop
from *report item* → *task-graph node*.

**Hazard (SR-BL-3 / DR-BL-3):** IntentTree node status in at least one live tree is known to be
stale. A status report must therefore **reconcile item state against git and the filesystem, not
trust the tracker**. The `partial` kind exists precisely because a tree can be 30 commits ahead
while `main`'s trackers still read 0/5 — always run `git log <default>..<branch>` for every active
branch before reporting an item as `not_started` (Appendix C pitfall 2 in the design spec).

v1 posture: **link and optionally read; never write.** Writing node state back is a gated
IntentTree mutation and belongs behind `op` / the IntentTree write lane, not this renderer.
Under the standing `aos-target set node` default, `itt` resolves to the node instance.

**PF-3 actuates this (C2/C3) — read §1.1.** The write verb exists (`itt link report`, PF-2 PR #9)
and PF-3's `scripts/publish_report.py` now calls it for the `atlas`/`intenttree` export targets,
under the resolved §1.1 identity convention and the R1 scope-misattribution guardrail (reject
loudly, no write, on a wrong-node/wrong-type resolution). `tracker_links[]` itself stays a read-only
projection of item-level handoff trackers, unrelated to the report-level link this actuator writes.

## 3. Registration & deploy

`delivery-report` is a Launchpad-owned artifact.

- **Global:** `~/.claude/skills/delivery-report` + `~/.agents/skills/delivery-report`.
- **Node:** listed in `AOS_LAUNCHPAD_SKILLS` in `infra/agentic-node/bootstrap-agentic-node.sh`;
  reaches the node via `/redeploy`.
- **SkillMeat enterprise:** registered as `skill:delivery-report` (federate the laptop CLI first —
  `skillmeat auth login --enterprise http://10.42.10.76:8080`, `SKILLMEAT_EDITION=enterprise`).
- **Registry:** the row in `docs/ARTIFACT-UPSTREAM-REGISTRY.md` (Launchpad-owned table) is the map
  from this upstream to its deploy targets. Also authored into the portable MeatySkills library.

## 4. dev-execution completion hook

`delivery-report` (route `feature`) is the tier-gated end-of-feature report. The
`dev-execution` completion contract invokes `hooks/verify-delivery-report.sh`, which runs
`delivery_report.py validate --require-report --expect-route feature` against the attached
`DELIVERY_REPORT_MANIFEST` / `DELIVERY_REPORT_HTML`. See `references/route-policy.md` for the
eligibility policy and `.claude/skills/dev-execution/validation/completion-criteria.md` for the gate.

## 5. Publish + link hook (`hooks/publish-report.sh`, PF-3 M3)

A separate, non-blocking `dev-execution` hook composes `export --target atlas` (§1) with the
actuator (§1.1/§2) at a phase/plan-close binding point — default-on, binding-gated
(`ITT_NODE_ID`/`INTENTTREE_TREE` + a rendered manifest), always exits 0. It is distinct from the
verify-delivery-report DoD gate above: that gate blocks on a *missing/invalid required report*;
this hook never blocks anything — publish/link failure is a logged skip. **The live, firing path
today is the `dossier` route** (wired at `plan-execution.md` §8, after the dossier render); `phase`
is wired but dormant until something supplies a per-phase report manifest; `feature`/`program`/
`readiness` have no close-hook wiring yet. Full contract: `dev-execution/SKILL.md` and the hook's
own header comment (`hooks/publish-report.sh`).
