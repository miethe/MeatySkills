# Provisioning Workflow

Manifest-driven artifact provisioning for a project's declared artifact set — the SkillMeat side
of the dev-execution pre-execution gate (`hooks/provision-artifacts.sh` +
`hooks/provision_artifacts.py`). This workflow composes **only existing SkillMeat CLI primitives**
(`show` / `deploy` / `undeploy`); there is no new SkillMeat command in P1.

> **Not a new subsystem.** The gate is dev-execution's, not SkillMeat's. This doc exists so an
> agent asked "why did this project just deploy 3 skills before executing?" — or asked to
> provision/teardown artifacts by hand — knows the manifest shape, the primitives it maps to, and
> where the real engine lives.

---

## Overview

Every project that opts in carries a durable manifest, `.claude/aos-artifacts.yaml` — a
project-local join/state table over SkillMeat's catalog. It is **not** a competing source of
truth: SkillMeat's collection/enterprise catalog stays canonical for artifact content and
versions; the manifest only records *which* artifacts this project links to, *how* (permanent vs
ephemeral), and *whether* each should currently be on disk (active vs inactive).

**Canonical schema exemplar**: `templates/aos-artifacts.yaml.tmpl`. **Design**: PRD
`docs/project_plans/PRDs/dynamic-artifact-provisioning.md` §6.1.

```yaml
schema_version: 1
project: "my-project"
policy:
  mode: auto            # auto | sign-off | off
artifacts:
  - name: dev-execution
    type: skill          # skill | agent | command | mcp | workflow | context_module
    lifecycle: permanent # permanent | ephemeral
    status: active        # active | inactive
    source: bundle:skillmeat-instance-starter
    tuned: false
    scope: null           # ephemeral only: epic:<id> | plan:<feature_slug>
    version: null
    note: "default scaffold"
```

A second, complementary set can be **declared at planning time** rather than read from the
manifest: a plan's `required_artifacts` frontmatter (schema: `plan-frontmatter-schema.md` §5.7,
authoring guide: `.claude/skills/planning/references/required-artifacts-guidance.md`). The gate
resolves against the **union** of the durable manifest's active entries and the current plan's
`required_artifacts` with `status: available`.

---

## The provision loop (what the hook does, in primitive terms)

The engine (`provision_artifacts.py`) is a thin composition — nothing here is a new SkillMeat
capability:

1. **Read the manifest** (`.claude/aos-artifacts.yaml`) and, if bound to a plan run, that plan's
   `required_artifacts`. Compute the desired-active set: manifest `permanent` + `active` entries,
   union manifest `ephemeral` + `active` entries scoped to the current run (`--scope plan:<slug>`),
   union plan `required_artifacts` with `status: available`.
2. **Diff against disk** — is each artifact already present under `.claude/{skills,agents,commands,
   workflows}`? (`mcp`/`context_module` entries are unverifiable from a file and are reported, not
   gated.)
3. **Classify each gap** with the existing lookup primitive:
   ```bash
   skillmeat show <artifact-name> --type <type>
   ```
   Exit 0 → in-catalog gap (deployable now). Non-zero → unsatisfiable (needed, exists nowhere).
4. **Deploy in-catalog gaps** (mode `auto` only) with the existing deploy primitive, exactly as in
   `./deployment-workflow.md` / `./management-workflow.md`, but SHA-safe (no `--overwrite`, so a
   `tuned: true` artifact already on disk is never clobbered):
   ```bash
   skillmeat deploy <artifact-name> --type <type> --project <project-root> --non-interactive
   ```
5. **Skip `status: inactive` manifest entries.** Inactive means "linked to this project and kept
   in the manifest, but deliberately not deployed until flipped active" — see § "The active/
   inactive convention" below.
6. **Hard-fail on unsatisfiable + needed.** An artifact that is neither on disk nor in the catalog
   is reported and the gate exits non-zero (a real correctness gate — see the exit contract in
   `provision-artifacts.sh`'s header comment). This is the one place the loop is *not*
   non-fatal: a plan that needs an artifact that exists nowhere cannot silently proceed.
7. **Report, never build**, `needs_creation` / `needs_enhancement` plan entries — those are
   authoring work for a `batch_0` task, not something `deploy` can produce.

Everything above is driven from `docs/project_plans/PRDs/dynamic-artifact-provisioning.md`
and the hook/engine source; this doc is the SkillMeat-skill-facing narrative of that same loop, not
a second implementation.

---

## Fleet-level automation (`op fleet`)

The per-project provisioning gate (FLEET-005..FLEET-014, embedded in `dev-execution`) is the per-run, single-project surface. For **multi-project automation**, `op fleet` (subcommand group `list`/`deploy`/`update`) enumerates registry projects via their `.claude/aos-artifacts.yaml` manifests and runs a curated fan-out loop over an explicit project list (never a blind broadcast — SD-5). `op fleet deploy` and `op fleet update` compose `skillmeat deploy` subcommands per project, with result parsing from `--format json` rows (never exit codes, per CP-2). Update propagation to already-registered projects is gated on SM-P2 (merge) + SM-P3 (`deploy pull --update`) landing; design specs for the future swaps are in `docs/project_plans/design-specs/op-fleet-*-swap.md`. The fleet layer is shipped and tested today on the fallback path; it is not a simulation pending engine work.

---

## The active/inactive convention (P1 simulation vs P2 first-class state)

**Today (P1, this manifest field):** `status: active` / `status: inactive` on a manifest entry is
a **manifest-only convention** honored by the dev-execution gate. There is no corresponding
SkillMeat engine state yet — `inactive` simply means "the gate will skip this entry when
computing the desired-active set," so the artifact stays linked (recorded, tracked, kept in the
manifest for future activation) without being materialized to `.claude/`.

```yaml
- name: patent-analyst
  type: agent
  lifecycle: permanent
  status: inactive        # linked + kept in sync, NOT deployed until flipped active
  source: catalog
  tuned: false
  scope: null
  version: null
  note: "kept ready for patent work; activate when needed"
```

To activate: flip `status: active` in the manifest (by hand, or via a future `op`/scaffolder
helper) and re-run the gate — it becomes a gap, gets classified, and deploys on the next pass. To
deactivate an artifact currently on disk: flip the manifest field to `inactive` **and**
explicitly `skillmeat undeploy <artifact-name> --project <root>` — flipping the manifest alone
does not remove files already materialized; it only stops the gate from re-deploying it if
removed later.

**Forward reference (P2, not built here):** the design spec
`docs/project_plans/design-specs/skillmeat-linked-inactive-and-project-reconcile.md` (Workstream B)
makes "linked-but-not-deployed" a **first-class SkillMeat enterprise engine state** — an
`active BOOLEAN` column on `EnterpriseDeployment`, `POST /api/v1/deployments/{id}/activate|
deactivate`, and a `skillmeat deploy activate|deactivate <name> --project` CLI pair — replacing
this manifest-only simulation with an engine-tracked one. Do not build any of that here; when it
ships, this section drops its "P1 simulates this" caveat and the gate's inactive-handling switches
from a manifest read to an engine `active` flag read.

---

## Ephemeral teardown

Ephemeral entries (`lifecycle: ephemeral`, `scope: epic:<id>` or `plan:<feature_slug>`) are pulled
for the life of one epic/plan and removed when it completes:

```bash
# Provision (already covered by the standard loop above, scoped to this run):
PROVISION_SCOPE="plan:<slug>" .claude/skills/dev-execution/hooks/provision-artifacts.sh

# Teardown at end-of-feature — undeploys scoped ephemerals and rewrites the manifest without them:
PROVISION_TEARDOWN=1 PROVISION_SCOPE="plan:<slug>" \
  .claude/skills/dev-execution/hooks/provision-artifacts.sh
```

Teardown never removes a `permanent` entry, even if it happens to share a scope tag, and never
touches `inactive` entries (they were never deployed by this loop in the first place). The
underlying primitive is the same `skillmeat undeploy <name> --project <root>` used in
`./management-workflow.md`.

---

## Relationship to `skillmeat project reconcile` (P2 — not built)

This workflow's loop is deliberately primitive-only so it is a **drop-in replacement target**, not
a dead end. `docs/project_plans/design-specs/skillmeat-linked-inactive-and-project-reconcile.md`
Workstream A specs a first-class `skillmeat project reconcile <path> [--plan|--manifest] [--check]
[--mode auto|sign-off|off]` command (adopting the unshipped `artifact-reconciliation-preflight-gate`
PRD) that would do the scan/classify/deploy/report steps above as one engine call instead of a
composed `show`/`deploy` loop. `provision_artifacts.py` already emits that PRD's frozen `--json`
shape, so the swap is intended to be transparent to dev-execution when it lands — do not hand-roll
a competing reconcile implementation here or in the launchpad.

---

## Quick reference — commands used by this loop

| Step | Command |
|---|---|
| Classify a gap | `skillmeat show <name> --type <type>` |
| Deploy an in-catalog gap | `skillmeat deploy <name> --type <type> --project <root> --non-interactive` |
| Remove a deployed ephemeral / deactivated artifact | `skillmeat undeploy <name> --project <root>` |
| Dry-run the whole loop | `PROVISION_CHECK=1 .claude/skills/dev-execution/hooks/provision-artifacts.sh` |
| Run against a specific plan's `required_artifacts` | `PROVISION_PLAN_FILE=<plan.md> .claude/skills/dev-execution/hooks/provision-artifacts.sh` |

## Related

- **Rule (look-first/save-after index)**: `.claude/rules/artifact-provisioning.md`
- **Hook (bash wrapper)**: `.claude/skills/dev-execution/hooks/provision-artifacts.sh`
- **Engine**: `.claude/skills/dev-execution/hooks/provision_artifacts.py`
- **Manifest schema exemplar**: `templates/aos-artifacts.yaml.tmpl`
- **Plan-side `required_artifacts` schema**: `.claude/skills/planning/references/plan-frontmatter-schema.md` §5.7
- **Plan-side authoring guide**: `.claude/skills/planning/references/required-artifacts-guidance.md`
- **PRD**: `docs/project_plans/PRDs/dynamic-artifact-provisioning.md`
- **P2 design spec (not built)**: `docs/project_plans/design-specs/skillmeat-linked-inactive-and-project-reconcile.md`
- **Deployment primitives**: `./deployment-workflow.md`
- **Management primitives (show/undeploy/sync)**: `./management-workflow.md`
