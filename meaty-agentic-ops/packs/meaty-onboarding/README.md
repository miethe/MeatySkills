# `meaty-onboarding` — the onboarding-core member group

A member set for **distribution**, not a second source of doctrine. It collects what onboarding
skills in this ecosystem share: the template set's dependency-resolution convention, the
workflow-doctrine references backing `aos-onboarding` route W, and the harness-portability /
support-matrix convention.

> **Not yet declared as a dependency by anything — stated because the alternative is a decorative
> claim.** `aos-onboarding`'s `depends_on:` carries exactly one entry, `workflow-set:v4.1`; it links
> this group's harness matrix but does not declare the group. So the sentence this README wants to
> write — "it is what an onboarding skill declares as its shared dependency" — is the **goal**, not
> the state. Making it true means adding a `depends_on` entry for this group with a real `locator:`
> and `verifier:` (per `agentic_meta_dev/.claude/skills/skill-dev/SPEC.md` §3.1), which needs a
> durable carrier for the group itself — this manifest is hand-authored and not yet snapshot-cut.
> Tracked, not done.

## What this is

- A **hand-authored** manifest (`MANIFEST.yaml`) plus two convention documents
  (`harness-support-matrix.md`, `dependency-resolution.md`) that a consuming onboarding skill
  points at via its own `depends_on:` block, rather than each skill re-deriving or re-writing the
  same content.
- Placed in `packs/` because that is this repo's existing distribution-oriented area (as opposed to
  `workflow-sets/`, which holds frozen, hash-verified snapshots of the plan → execute lifecycle
  skill set). This is the first directory under `packs/`; the sibling entry,
  `meaty-agentic-ops-full.skillmeat-pack`, is a pre-built SkillMeat pack archive — a different
  artifact shape from this hand-authored source directory.
- Modeled on the one real precedent in this repo for a `type:name` member list with a currency
  carrier per entry: `workflow-sets/v4.1/MANIFEST.yaml`. This file reuses that idiom (`id`,
  `snapshot`/`snapshot_path` XOR `provenance_sha`) so a reader who knows one knows the other — but
  it is a **hand-authored sibling**, not output of `make-snapshot.py`. It carries no "GENERATED —
  do not hand-edit" header because none applies; it is meant to be edited by hand as the group's
  membership changes.

## What this is NOT

- **Not a second source of doctrine.** The pinned excerpt this group carries for `plan-doctrine.md`,
  `execution-doctrine.md`, and `gate-risk-classes.md` is not a fourth copy living in this
  directory — it **is** the copy that `workflow-sets/v4.1/artifacts/skill/{planning,dev-execution}/
  references/` already holds, referenced by relative path and the snapshot label
  `workflow-set-v4.1`. See `MANIFEST.yaml`'s `doctrine:*` entries. Duplicating those files here
  would create a drift surface with zero benefit and contradict the governing correction from the
  design spec: **"the manifest is the pin, not the bundle."**
- **Not a generated artifact.** Unlike `workflow-sets/<label>/MANIFEST.yaml`, nothing builds or
  verifies this file automatically. "How to verify this manifest" in `MANIFEST.yaml` lists the
  exact commands to run by hand (or from a script that shells out to them); there is no
  `meaty-onboarding verify` command and none is implied.
- **Not a resolver.** Nothing in the SkillMeat/skill-dev toolchain looks up a member here and
  decides whether it is current. That is the entire subject of `dependency-resolution.md`: each
  member's currency is checked by running its own locator/verifier commands, by hand, before
  trusting it.

## Members (see `MANIFEST.yaml` for the full entries)

| `id` | Currency carrier | Why |
|---|---|---|
| `skill:aos-onboarding` | `provenance_sha` | created after the v4.1 snapshot cut; no snapshot exists for it |
| `skill:skill-dev` | `provenance_sha` | **excluded from workflow-set-v4.1 membership** (meta-layer/authoring gate — see `MANIFEST.yaml`'s note); no snapshot exists for it, and none was skipped by mistake |
| `doctrine:plan-doctrine` | `snapshot: workflow-set-v4.1` | excerpt of the already-snapshotted `skill:planning`; referenced through it, never duplicated |
| `doctrine:execution-doctrine` | `snapshot: workflow-set-v4.1` | excerpt of the already-snapshotted `skill:dev-execution`; referenced, never duplicated |
| `doctrine:gate-risk-classes` | `snapshot: workflow-set-v4.1` | excerpt of the already-snapshotted `skill:dev-execution`; referenced, never duplicated |

## Verifying this group

Run from the `MeatySkills` repo root; see `MANIFEST.yaml`'s footer comment for the full commands.
In short: three `diff`s prove the pinned doctrine excerpts are byte-identical to their live
upstream, `make-snapshot.py verify v4.1` proves the snapshot itself hasn't drifted, and two
`git log -1` calls prove the two `provenance_sha`-pinned members haven't moved since this manifest
was authored.

## Related conventions in this group

- `harness-support-matrix.md` — which harnesses can consume an onboarding skill today, and under
  what state (`Supported` / `Reference-only`), with the gate that promotes each row.
- `dependency-resolution.md` — the three-state (installed / missing / stale-vs-pin) resolution
  procedure every member's locator/verifier feeds into, mirrored from the onboarding-skill
  template so both levels (a single skill's `depends_on:`, and this group's `members:`) read the
  same rule.
