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

Targets mirror `html-capsules` `export-writeback`: `skillmeat` · `intenttree` · `meatywiki` · `ccdash`.
The envelope carries `route`, `title`, `subject`, `revision`, `truth_status`, `generated_from`,
the manifest + HTML paths, `item_count`, and `tracker_links[]` (every item handoff that names a
tracker node). Ingestion recipes:

| Target | What to do with the envelope |
|---|---|
| `meatywiki` | Ingest the HTML as a knowledge artifact: `meatywiki ingest <html> --kind report`. The envelope's `generated_from` + `truth_status` become front-matter. |
| `skillmeat` | Attach report HTML + manifest to the project record; the envelope is the manifest for `skillmeat` artifact linkage. |
| `intenttree` | For each `tracker_links[]` entry, annotate the node with the report URL (see §2). |
| `ccdash` | Attach as run evidence; `generated_from.commit` binds it to a tree. |

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
