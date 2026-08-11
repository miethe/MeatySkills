---
name: artifact-tracking
description: "Token-efficient tracking for AI orchestration. CLI-first for status updates (~50 tokens), agent fallback for complex ops (~1KB). Use when: updating task status, querying blockers, creating progress files, validating plan/phase frontmatter, enforcing the canonical NodeStatus enum."
version: 0.2.0
app_version: "2026-08-06"
updated: 2026-08-06
---

# Artifact Tracking Skill

Token-efficient tracking artifacts for AI agent orchestration.

## Quick Operations (CLI First)

| Operation | Command | Tokens |
|-----------|---------|--------|
| Mark complete | `python scripts/update-status.py -f FILE -t TASK-X -s completed --started TS --completed TS` | ~50 |
| Batch update | `python scripts/update-batch.py -f FILE --updates "T1:completed,T2:completed"` | ~100 |
| Query pending | `python scripts/query_artifacts.py --status pending` | ~50 |
| Validate | `python scripts/validate_artifact.py -f FILE` | ~50 |
| Update fields | `python scripts/update-field.py -f FILE --set "priority=high"` | ~50 |
| Scan migration | `python scripts/migrate-frontmatter.py --scan` | ~100 |
| Phase gate | `python scripts/validate-phase-completion.py -f FILE` | ~50 |
| AC coverage | `python scripts/ac-coverage-report.py --plan PLAN --progress P` | ~100 |
| AC dry-check | `python scripts/ac-coverage-report.py --plan PLAN --dry` | ~50 |
| Lint plan status | `python scripts/validate-plan-frontmatter.py docs/project_plans` | ~50 |
| Autofix status aliases | `python scripts/validate-plan-frontmatter.py docs/project_plans --apply` | ~100 |
| Authoring-time gate (status + binding, advisory) | `python scripts/check-plan-authoring.py <new-plan-file>` | ~50 |
| Stamp node feature_slug (dry-run) | `python scripts/stamp-node-slug.py --tree $INTENTTREE_TREE` | ~100 |
| Verify slug↔node↔plan round-trip | `python scripts/verify-slug-roundtrip.py --tree $INTENTTREE_TREE` | ~50 |
| Stamp file-side itt_node_id/tree (dry-run) | `python scripts/stamp-plan-binding.py --tree $INTENTTREE_TREE` | ~100 |
| **What shipped in project X** (the ledger query) | `python scripts/what-shipped.py --tree $INTENTTREE_TREE` | ~100 |
| Backfill node evidence from plan refs (dry-run) | `python scripts/backfill-node-evidence.py --tree $INTENTTREE_TREE --default-repo <repo>` | ~100 |

**Scripts location**: `.claude/skills/artifact-tracking/scripts/`

### IntentTree SDLC sync (optional)

| Operation | Command |
|-----------|---------|
| Sync one file → IntentTree | `python scripts/intenttree_capture.py sync FILE --tree $INTENTTREE_TREE --apply` |
| Backfill repo's in-flight features | `python scripts/intenttree_capture.py backfill --repo-root . --tree $INTENTTREE_TREE --apply` |

Mirror plans + `.claude/progress/**` into the shared IntentTree instance as a typed
`Feature → Phase → Task` tree (markdown stays canonical; nodes are a derived projection). When
`INTENTTREE_SDLC_SYNC=1` and `INTENTTREE_TREE` are set, status writes auto-sync (best-effort,
non-fatal) via `intenttree_sync.push_to_intenttree`. Full guide + repo→tree map:
**`intenttree-sync.md`**.

## Script Inventory

| Script | Purpose |
|---|---|
| `update-status.py` | Update one task status; enforces completion gate (timestamps/evidence required) |
| `update-batch.py` | Batch-update multiple task statuses |
| `manage-plan-status.py` | Read/update/query planning doc status and arbitrary fields |
| `validate_artifact.py` | Validate frontmatter against schema (`doc_type` auto-detect, strict mode) |
| `validate-phase-completion.py` | Block phase `completed` if any task missing `started`/`completed`/`verified_by`/`evidence` |
| `ac-coverage-report.py` | Two-way AC↔task coverage matrix; `--dry` checks vague ACs for `target_surfaces` |
| `query_artifacts.py` | Query metadata across planning/progress/worknotes docs |
| `migrate-frontmatter.py` | Scan/dry-run/migrate missing `schema_version`/`doc_type` |
| `update-field.py` | Generic `--set` and `--append` updates with schema validation |
| `validate-plan-frontmatter.py` | Lint plan `status` against the ratified 15-value NodeStatus enum; `--apply` additively normalizes legacy/synonym spellings (+ `planning_maturity`); `--json` for machine output. Reuses `_status_aliases.py` |
| `check-plan-authoring.py` | **M4 L1 (FR-12), advisory.** Authoring-time gate for a single newly-authored plan file (or a directory, for corpus measurement): status validity (reuses `validate-plan-frontmatter.py`'s own file processing — a hand-review status is a VIOLATION, a resolvable alias a WARNING) + join-key binding presence (missing `feature_slug` is a VIOLATION; `feature_slug` present but no `itt_node_id`/`intenttree_tree` yet is a WARNING, since a plan is legitimately authored before its tree exists). Read-only, never writes; `--json` for machine output. Exit 2 never blocks a commit or CI (D-M4-1) |
| `_status_aliases.py` | Shared status vocabulary (NodeStatus enum + alias map); imported by `validate-plan-frontmatter.py`, `manage-plan-status.py`, and `check-plan-authoring.py` (not a CLI) |
| `stamp-node-slug.py` | M2 (FR-6/FR-7 + gap-1/gap-2): stamps `meta.feature_slug` (+`meta.plan_ref` when known) onto IntentTree nodes, resolved via four precedence-ordered paths — `direct` / `source_artifact` / `retroactive_binding` / `tag_match` (exact, unambiguous-only match against a node's own `tags`) — from plan-file frontmatter, the sync-bindings table, and/or the plan corpus's `feature_slug` values. Merge-safe (never replaces existing `meta`), never overwrites a conflicting `feature_slug` or `plan_ref` (exit 2), idempotent, tree-scoped. `--apply` to write; `--json` for machine output |
| `verify-slug-roundtrip.py` | M2 acceptance-criteria checker: for a tree (optionally one `--slug`), verifies the stamped `feature_slug` → `plan_ref` → plan file → `feature_slug` round trip is self-consistent. Read-only (no `--apply`); reports PASS/FAIL per feature with a reason |
| `stamp-plan-binding.py` | M2 gap-3: the FILE-side mirror of `stamp-node-slug.py` — for every `feature_slug` already live on a node, writes `itt_node_id` + `intenttree_tree` into that feature's primary plan file (highest node in the tree wins; `doc_type: implementation_plan` > `prd` > lexicographic file preference). Additive/format-preserving (only missing keys inserted), never overwrites a conflicting existing value (exit 2), idempotent. Companion to (not a duplicate of) upstream `itt sync import --stamp-frontmatter`, which cannot reach hand-created nodes |
| `what-shipped.py` | **M3 (the ledger query — the M3 acceptance criterion).** For a tree, lists every `completed` node joined to its plan file by `meta.feature_slug`, with its PR/commit `ExternalLink` rows and validation evidence. Read-only (no `--apply`). Reports coverage **honestly**: unjoinable completed nodes are listed by id/title, never dropped; a `plan_ref` pointing at a missing file is flagged `dangling`. A completed member inherits its feature ANCHOR's evidence (labelled `evidence_source: feature_anchor`), because evidence is written once per feature, not per subtask |
| `backfill-node-evidence.py` | **M3 (FR-10/FR-11).** Populates typed `ExternalLink` rows on nodes from their plan files' OWN hand-authored `commit_refs`/`pr_refs` — never a git-log mining pass. Fail-closed via `_evidence_refs` (skips are first-class output, each with a reason). Pre-reads existing links so a second `--apply` writes nothing (verified live). Defaults to `--scope anchor` (evidence lands on each feature's subtree root, not all 41 of its subtasks); `--scope all-members` restores the wide behaviour. Harvests refs from **every** plan doc carrying the slug, since phase plans often hold the real evidence |
| `_evidence_refs.py` | **M3.** The fail-closed normalizer turning heterogeneous hand-authored `commit_refs`/`pr_refs` into typed `EvidenceRef`s, returning an explicit `SkippedRef` (with reason) for anything not confidently parseable — e.g. the `direct-squash-to-main` sentinel, which naive normalization would mint into a bogus GitHub PR URL. Not a CLI |
| `_itt_client.py` | Shared, injectable `itt` CLI wrapper (the seam all three M2 scripts test against — no live server needed); not a CLI. **M3 added** the typed evidence surface: `get_node_full` / `tree_nodes` / `attach_external_link` / `attach_evidence` / `record_validation` (which tries `POST /nodes/{id}/validations`, falling back to `CompletionEvidence(kind=validation)` on 404 only, exposing `_write_path`) |
| `_slug_resolution.py` | Shared plan-file-scan + slug↔node resolution engine (`direct` / `source_artifact` / `retroactive_binding` / `tag_match` paths, corpus slug index, primary-file selection) used by all three M2 scripts; not a CLI |

## Completion Gate (§4.4 of delivery-quality spec)

`update-status.py -s completed` **rejects** unless at least one of:
1. Both `--started <ISO-8601>` and `--completed <ISO-8601>` are supplied, OR
2. At least one `--evidence` item is provided.

Use `--force` to override; a WARNING is printed to stderr. This gate prevents
batch-flip completions with null timing signals (failure class: Batch-flip completion).

```bash
# Correct — with timing
python scripts/update-status.py -f FILE -t T7-003 -s completed \
    --started 2026-04-22T10:00Z --completed 2026-04-22T17:00Z \
    --evidence "commit:abc123" --verified-by P16-003

# Force override (log WARNING, use sparingly)
python scripts/update-status.py -f FILE -t T7-003 -s completed --force
```

New flags:

| Flag | Type | Purpose |
|---|---|---|
| `--started` | ISO-8601 string | Writes `started:` on the task |
| `--completed` | ISO-8601 string | Writes `completed:` on the task |
| `--evidence KEY:VALUE` | Repeatable | Appends to `evidence:` list (`commit:sha`, `screenshot:path`, `test:path`) |
| `--verified-by TASK_ID` | Repeatable | Appends to `verified_by:` list; deduplicates |
| `--force` | Flag | Bypass completion gate (logs WARNING) |

## Phase Exit Gate

Run before marking any phase `completed`. Fails nonzero if any completed task
is missing `started`, `completed`, `verified_by`, or `evidence`.

```bash
# Human report
python scripts/validate-phase-completion.py -f .claude/progress/prd/phase-7-progress.md

# JSON (for scripting)
python scripts/validate-phase-completion.py -f FILE --json
```

## AC Coverage Matrix

Verify every AC in the implementation plan is referenced by at least one
verification task, and every verification task cites at least one AC.

```bash
# Full matrix (phase exit)
python scripts/ac-coverage-report.py \
    --plan docs/project_plans/implementation_plans/my-plan.md \
    --progress .claude/progress/prd/phase-13-progress.md \
    --progress .claude/progress/prd/phase-16-progress.md

# Plan approval gate: reject vague ACs without target_surfaces
python scripts/ac-coverage-report.py --plan PLAN --dry

# JSON output
python scripts/ac-coverage-report.py --plan PLAN --progress P --json
```

AC format in implementation plans (structured block after heading):

```markdown
#### AC R3.4: Status Distribution filter narrows planning surfaces
- target_surfaces:
  - components/Planning/PlanningSummaryPanel.tsx
  - components/Planning/PlanningGraphPanel.tsx
- verified_by: [P16-003, P16-012-smoke]
```

## Plan Status Management

| Operation | Command | Tokens |
|-----------|---------|--------|
| Read status | `python scripts/manage-plan-status.py --read FILE` | ~50 |
| Update status | `python scripts/manage-plan-status.py --file FILE --status STATUS` | ~50 |
| Update any field | `python scripts/manage-plan-status.py --file FILE --field priority --value high` | ~50 |
| Query plans | `python scripts/manage-plan-status.py --query --status STATUS --type TYPE` | ~100 |

**Use for**: PRDs, implementation plans, phase plans, SPIKEs, quick-feature plans, design-specs, meta-plans, and reports. `design-spec`, `meta-plan`, and `report` are supported types in `--type` alongside the original five.

`manage-plan-status.py` accepts the canonical 15 NodeStatus values **and** the legacy alias
spellings (`draft`, `complete`, `pending`, `in-progress`, `review`, `accepted`, …), but it
**normalizes an alias to its NodeStatus on write** via the shared `_status_aliases.py` map. The
CCDash-era `approved` / `superseded` spellings are no longer accepted — use `ready` / `archived`.

## Canonical Status Enforcement

`validate-plan-frontmatter.py` is the linter that enforces the ratified cross-app `status` value
space — the **15-value IntentTree NodeStatus enum** (`docs/agentic-operator/contracts/frontmatter-schema.md`
§4). It derives its MUST/SHOULD/MAY field sets by parsing the machine-readable block in
`.claude/skills/planning/references/plan-frontmatter-schema.md` (falling back to a hardcoded mirror).

| Value class | Meaning | Autofix |
|---|---|---|
| **valid** | already a NodeStatus | left untouched |
| **alias** | a known synonym (`draft`, `complete`, `accepted`, …) | rewritten to its NodeStatus; a `planning_maturity` line is inserted only when the alias implies one **and** the file lacks it |
| **hand-review** | neither NodeStatus nor alias (incl. the `active \| paused \| blocked` placeholder, `reconciled-for-planning`, `handoff-for-planning`) | **never** auto-mapped; reported as a violation naming the file + value |

```bash
# Check the corpus (report only; never writes). Exit 0 = clean, 2 = violation(s).
python scripts/validate-plan-frontmatter.py docs/project_plans

# Machine-readable summary (per-value would-change counts, violations, changes)
python scripts/validate-plan-frontmatter.py docs/project_plans --json

# Additive, format-preserving autofix (rewrites ONLY the status value token + inserts
# planning_maturity where implied). Review a dry-run diff before applying corpus-wide.
python scripts/validate-plan-frontmatter.py docs/project_plans --apply
```

- **Exit codes**: `0` clean (all statuses are a NodeStatus or a losslessly-resolvable alias),
  `2` one or more violations (hand-review / invalid / unresolvable), `1` usage error.
- **Advisory (v1)**: it reports; the caller decides. The exit code distinguishes clean vs
  violations so a gate can consume it, but the linter does not itself block a commit.
- The alias map is the ratified + claude-decided rule (Shipped Work Ledger M1). Edit it in one
  place: `scripts/_status_aliases.py`.

## Frontmatter Write Contract

Every **plan** frontmatter write goes through `scripts/_frontmatter_edit.py`, which edits
LINES, not a parsed dict. Untouched keys are byte-identical after a write because their lines
are never re-emitted.

| Script | Write path | In place? |
|---|---|---|
| `validate-plan-frontmatter.py --apply` | own line editor (`status:` token + `planning_maturity` insert) | yes |
| `update-field.py` (`--set`/`--append`) | `_frontmatter_edit.FrontmatterEditor` | yes |
| `manage-plan-status.py` (`--status`/`--field`) | `_frontmatter_edit.FrontmatterEditor` | yes |
| `manage-exploration-status.py` | `ruamel.yaml` round-trip | mostly (quotes/comments) |
| `update-status.py`, `update-batch.py` | `yaml.dump` of the whole block | **no** — progress files |

Preserved on a write: the file's list indentation and per-item quoting, bare-date scalars,
block scalars (`>`/`|`), non-ASCII (an em-dash stays an em-dash, never `—`), and the
touched line's own quote style plus any trailing `# comment`. `--append` keeps a flow list
(`tags: [a, b]`) in flow style rather than expanding it.

Why it matters: a re-serializing write turned a 1-line status change into a 29-insertion /
16-deletion diff. All of it was valid YAML, so no validator objected — but the reviewer could
no longer tell a bookkeeping commit from a content change. Measured over the real corpus,
200 of 212 plans were collaterally rewritten by a semantically-null write; now 0 are.

## Authoring-Time Gate (M4 L1, FR-12)

`check-plan-authoring.py` is the gate FR-12 asks for: a check that runs the moment a plan is
authored, not only later against the whole corpus. It checks one file (or a directory, for the
corpus-wide measurement) for exactly two things:

| Check | Violation | Warning |
|---|---|---|
| **status validity** (reuses `validate-plan-frontmatter.py`'s file processing, so the enum/alias map is never duplicated) | hand-review / unknown value | a resolvable alias (`draft`, `complete`, …) |
| **binding presence** | missing `feature_slug` | `feature_slug` present but no `itt_node_id`/`intenttree_tree` yet |

```bash
# Check one newly-authored file (report only; never writes). Exit 0 = clean, 2 = violation(s).
python scripts/check-plan-authoring.py docs/project_plans/PRDs/my-new-feature-v1.md

# Corpus-wide measurement (aggregate summary, same script, a directory instead of a file)
python scripts/check-plan-authoring.py docs/project_plans --json
```

- **Exit codes**: `0` clean (warnings may still print), `2` one or more violations (each naming
  the file + field + bad/missing value), `1` usage error.
- **Advisory (D-M4-1)**: "fails the gate" means this non-zero exit + named violation — it is
  **not** a blocking git hook or CI check, and none is added. The caller (the planning workflow
  below, or a human) decides what to do with the result.
- Missing `feature_slug` is a violation because it is the join key the Shipped Work Ledger
  program exists to establish. Missing `itt_node_id`/`intenttree_tree` is only a warning — a plan
  is legitimately authored before its tree exists; `stamp-plan-binding.py` back-fills those later.
  Do not flip this: making the node/tree binding a violation would fail every plan at the moment
  it is authored, which is exactly when it cannot yet be satisfied.

## Node-Side feature_slug Stamping (M2, FR-6/FR-7)

`stamp-node-slug.py` writes `meta.feature_slug` (+`meta.plan_ref` when known) onto the IntentTree
nodes a plan file's frontmatter — or the sync-bindings table alone — resolves to. It is the
NODE-side half of the Shipped Work Ledger M2 join; the FILE-side writeback
(`itt sync import --stamp-frontmatter`) already shipped upstream in `../intenttree` and is a
dependency, not reimplemented here.

```bash
# Dry-run (default; never writes). Exit 0 = clean, 2 = one or more conflicts.
python scripts/stamp-node-slug.py --tree $INTENTTREE_TREE

# Machine-readable summary (resolution-path breakdown, would-stamp list, conflicts)
python scripts/stamp-node-slug.py --tree $INTENTTREE_TREE --json

# Commit the stamps
python scripts/stamp-node-slug.py --tree $INTENTTREE_TREE --apply
```

Resolution order, most-authoritative first: (a) `direct` — a plan file's own `itt_node_id` +
`feature_slug`; (b) `source_artifact` — a plan file's `source_artifact_id` resolved through the
sync-bindings table to a node set; (c) `retroactive_binding` — the bindings table's own
`source_task_id: "feature:<slug>"` entry, no plan file required. A node already carrying a
*different* `feature_slug` is never overwritten — it is reported as a conflict and the run exits
non-zero (FR-7). Every write is a read-merge-write against the node's live `meta` (`itt node
update --meta` **replaces** the whole dict server-side — a naive write would destroy
`plan_ref`/`fingerprint`/etc.), so pre-existing meta keys always survive.

`verify-slug-roundtrip.py` is the M2 acceptance-criteria checker: for a tree (optionally one
`--slug`), it verifies every stamped node's `feature_slug` → `plan_ref` → plan file →
`feature_slug` round trip is self-consistent, reporting PASS/FAIL per feature with a reason on
failure. It is read-only (no `--apply` — there is nothing for it to write).

```bash
python scripts/verify-slug-roundtrip.py --tree $INTENTTREE_TREE
python scripts/verify-slug-roundtrip.py --tree $INTENTTREE_TREE --slug shipped-work-ledger --json
```

Both scripts talk to IntentTree only through the injectable `_itt_client.IttClient` seam, so
their tests fake every `itt` response and run offline (no live server, no network).

## File Locations

| Type | Location | Limit |
|------|----------|-------|
| Progress | `.claude/progress/[prd]/phase-N-progress.md` | ONE per phase |
| Context | `.claude/worknotes/[prd]/context.md` | ONE per PRD |
| Bug fixes | `.claude/worknotes/fixes/bug-fixes-YYYY-MM.md` | ONE per month |
| Observations | `.claude/worknotes/observations/observation-log-MM-YY.md` | ONE per month |

**Policy**: `.claude/specs/doc-policy-spec.md`

## YAML Quick Reference (v2)

```yaml
---
type: progress
schema_version: 2
doc_type: progress
prd: "prd-name"
feature_slug: "prd-name"
phase: 2
status: in_progress
created: 2026-02-19
updated: 2026-02-19
prd_ref: null
plan_ref: null
commit_refs: []
pr_refs: []

owners: ["agent-name"]
contributors: []

tasks:
  - id: "TASK-2.1"
    status: "pending"
    assigned_to: ["agent-name"]
    dependencies: []

parallelization:
  batch_1: ["TASK-2.1"]
---
```

## Schema Inventory

| Schema | Purpose |
|---|---|
| `envelope.schema.yaml` | Shared CCDash frontmatter envelope |
| `prd.schema.yaml` | PRD frontmatter |
| `implementation-plan.schema.yaml` | Implementation plan frontmatter |
| `phase-plan.schema.yaml` | Phase breakdown frontmatter |
| `spike.schema.yaml` | SPIKE frontmatter |
| `quick-feature.schema.yaml` | Quick feature frontmatter |
| `design-spec.schema.yaml` | Design specification / ideation frontmatter (maturity gradient: idea → promoted) |
| `meta-plan.schema.yaml` | Workflow/process/tooling plans in `.claude/plans/` |
| `report.schema.yaml` | Report frontmatter (extended: `report_category`, `promoted_to`, `source`) |
| `feature-contract.schema.yaml` | Tier 1 Feature Contract (3–8 pt features; replaces PRD + Implementation Plan) |
| `progress.schema.yaml` | Progress tracking (backward-compatible) |
| `context.schema.yaml` | Context worknotes (backward-compatible) |
| `bug-fix.schema.yaml` | Bug-fix logs (backward-compatible) |
| `observation.schema.yaml` | Observation logs (backward-compatible) |

Field-level guidance: `.claude/skills/artifact-tracking/schemas/field-reference.md`

## Post-Implementation Updates

After committing or opening a PR, update traceability fields:

```bash
python scripts/update-field.py -f FILE --append "commit_refs=<SHA>"
python scripts/update-field.py -f FILE --append "pr_refs=#123"
```

Use `commit_refs` and `pr_refs` on PRDs, plans, phase docs, and progress files so CCDash can correlate planning docs with delivery artifacts.

## When NOT To Use

- **Product/source code changes** — this skill tracks planning + progress *artifacts*, not code.
- **IntentTree node mutations** — the markdown is canonical; nodes are a derived projection. Use
  the `intenttree` / `intenttree-cli` skills (or the sync scripts here) to project, never to
  author node state directly.
- **Non-plan documents** — READMEs, human guides, and vault pages are out of scope; the linter
  only enforces `status` on plan-class frontmatter and skips files with no top-level `status`.
- **Choosing/defining the status vocabulary** — the enum is ratified upstream
  (`docs/agentic-operator/contracts/frontmatter-schema.md` §4). This skill *implements* it; it
  does not relitigate it. To change the alias map, edit `scripts/_status_aliases.py` and land the
  same-PR contract diff the governance gate requires.
- **CCDash / MeatyWiki schemas** — those apps own their own envelopes; do not enforce them here.

## Do Not Say

- Do **not** claim `validate-plan-frontmatter.py` or `check-plan-authoring.py` block commits or
  CI — both are **advisory in v1** (they report; the caller decides). A blocking gate is a v2
  decision. Do not add a pre-commit hook or CI step that consumes their exit code.
- Do **not** treat a missing `itt_node_id`/`intenttree_tree` as a `check-plan-authoring.py`
  violation — it is a warning only. A plan is legitimately authored before its tree exists.
- Do **not** auto-map a hand-review status value (`reconciled-for-planning`, `handoff-for-planning`,
  the `active | paused | blocked` placeholder, or any unknown value). Report it; a human resolves it.
- Do **not** describe the autofix as a full re-serialize — it edits **only** the `status:` value
  token in place and inserts `planning_maturity` additively; unrelated frontmatter is untouched.
  The same now holds for `update-field.py` and `manage-plan-status.py` (see § Frontmatter Write
  Contract). It does **not** hold for `update-status.py` / `update-batch.py`, which still
  re-serialize a whole progress file — do not claim in-place semantics for those two.
- Do **not** tell a user to run the corpus-wide `--apply` without a reviewed dry-run diff first.
- Do **not** present `approved` / `superseded` as valid statuses — they are dropped; use
  `ready` / `archived`.
- Do **not** claim `stamp-node-slug.py` reimplements the file-side frontmatter writeback — that
  is `itt sync import --stamp-frontmatter` in `../intenttree`; this tool only writes the node side.
- Do **not** claim `stamp-node-slug.py` overwrites a conflicting `feature_slug` — FR-7 forbids it;
  a conflict is reported and the run exits non-zero, a human resolves it.
- Do **not** describe `itt node update --meta` as a merge — it REPLACES the whole `meta` dict
  server-side; `stamp-node-slug.py` only stays additive because it reads-merges-writes in Python
  before calling it.
- Do **not** claim `what-shipped.py` shows everything that shipped. It shows what is **joinable**:
  a completed node must carry `meta.feature_slug`, and evidence must exist in a plan file's own
  frontmatter. Measured 2026-07-31 in `agentic_meta_dev`: 34 completed · 8 joinable · 26 unjoinable,
  6 with evidence. The unjoinable nodes are hand-created with no join key — reported, never hidden.
- Do **not** claim the node-scoped `POST /api/v1/nodes/{id}/validations` route exists. It **404s**
  on the running server (verified 2026-07-31); `record_validation` falls back to
  `CompletionEvidence(kind=validation)`. The typed `ValidationRun` row is forward-compatibility only.
- Do **not** claim `validation_commands` drives anything today — it appears in **0 of 219** plan
  files. Test evidence attached by these tools is CCDash-summary-shaped, not per-command rows.
- Do **not** match an external link on the request's `system` field when reading — the server
  returns `source_system`. Matching on `system` alone silently never matches, which makes the FR-11
  pre-read re-write every link on every run (this was a real, live-only defect; the offline fake
  echoed `system` and the test passed).

## Detailed References

- **Creating files**: `./creating-artifacts.md`
- **Updating tasks**: `./updating-artifacts.md`
- **Querying data**: `./querying-artifacts.md`
- **Validating**: `./validating-artifacts.md`
- **Orchestration**: `./orchestration-reference.md`
- **Best practices**: `./best-practices.md`
- **Common patterns**: `./common-patterns.md`
- **Format spec**: `./format-specification.md`
- **Templates**: `./templates/`
- **Schemas**: `./schemas/`
