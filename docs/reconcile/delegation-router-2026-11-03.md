# delegation-router reconcile — 2026-11-03

Target node: `node_01M6H8TAQK9PPV2YCF0MRM55P2`. Comparison base: `2230c85a` (PR #107 merged).
Canonical path: `meaty-agentic-ops/skills/delegation-router`. Neither deployed copy was edited.

## Method and counts

Compared tracked paths and bytes against the pinned base with `git ls-tree` / `git show`, then
reviewed unified diffs. For every conflicting launchpad file, queried
`git -C /Users/miethe/dev/homelab/development/agentic_meta_dev log --follow -1 --
.claude/skills/delegation-router/<file>`; latest-touch results are below. The SkillMeat summary
captured earlier on the node was launchpad `13 deployed-ahead / 6 upstream-ahead / 25 conflicting`
and home `0 / 1 / 17`. A fresh byte comparison in this worktree instead finds:

| Copy | Same-path conflicts | Deployed-only at 2230c85a | Upstream-only at 2230c85a |
|---|---:|---:|---:|
| launchpad | 25 | 1 (`references/dispatch-preflight.md`) | 6 |
| home | 17 | 0 | 1 (`tests/test-observed-availability.js`) |

The earlier SkillMeat class totals and the fresh path comparison do not use the same observable
classification; both measurements are preserved here rather than conflated.

## Ported and conflict decisions

| Path / hunk | Decision | Evidence and rationale |
|---|---|---|
| `references/dispatch-preflight.md` (launchpad-only file) | PORTED, with account correction | Launchpad `c09a6020b8` (#2522, 2026-10-21). Ported ordered preflight, worktree/context checks, write recipes and refusal remedies. Kept the canonical Primary default from upstream; `codex_secondary` remains explicit-only. |
| `SKILL.md`, `README.md` — “Bound-front dispatch” block | PORTED | Launchpad added the same pointer block with `c09a6020b8`; linked to the ported reference. Older surrounding text is superseded by upstream v3. |
| `model-registry.yaml`, `model-registry.generated.json` — Terra pilot and ICA availability facts | PORTED, needs-nick | Launchpad `7440379526` (#3233, 2026-10-27) adds GPT-6.1 Terra as a codex_primary scoped pilot; `ae1bebf949` (#3361, 2026-10-27) records Opus 5.5 unavailable on ICA, Sonnet 5.5 as ICA default, and Haiku 5.5 available/free on ICA. Mapped these into upstream v3 and added Terra to `registry/providers/openai.yaml`; Terra is not added to any automatic chain. Preserved #107 selection and floors. Generator validation already fails on the base tree; generated JSON was updated to match source facts, with no claim of clean regeneration. |
| `resolver.js`, `resolve-cli.js`, `tests/test-codex-identities.js` — missing availability and pin-reason behavior | SUPERSEDED by #107 (`abdb6eb3`, in `2230c85a`) | The deployed versions predate receipt consumption, skip reasons and explicit pin provenance. Kept #107. |
| `tests/test-observed-availability.js` and its fixture | UPSTREAM-ONLY at base | Added by #107 and retained. |
| All remaining differing files listed below | SUPERSEDED by upstream `2230c85a` | Deployed versions are older schema/API snapshots. Reviewed their unique hunks; none beyond the listed ports is compatible with the v3 registry/resolver contract. Where launchpad/home disagree, launchpad is the later deployed snapshot by launchpad history; upstream v3 remains authoritative. |

### File-by-file classification

`PORTED` denotes the specific hunks above; other hunks in a listed file are `SUPERSEDED`.

| Launchpad conflicting path | Latest `--follow` touch | Decision |
|---|---|---|
| `CHANGELOG.md` | `7440379526` (2026-10-27, Terra onboarding) | SUPERSEDED; upstream changelog has later v3/#107 entries |
| `README.md` | `c09a6020b8` (2026-10-21, dispatch preflight) | PORTED pointer hunk |
| `SKILL.md` | `7440379526` (2026-10-27, Terra onboarding) | PORTED pointer hunk; old surrounding CLI text superseded |
| `SPEC.md` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by v3 spec |
| `model-registry.generated.json` | `ae1bebf949` (2026-10-27, ICA availability) | PORTED availability facts; remaining snapshot superseded |
| `model-registry.yaml` | `ae1bebf949` (2026-10-27, ICA availability; also `7440379526` Terra) | PORTED Terra and availability facts; remaining snapshot superseded |
| `recipe.toml` | `3e3ddb79f5` (2026-08-14, routing audit) | SUPERSEDED by upstream routing contract |
| `references/model-registry.md` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by v3 registry guide |
| `registry/private-only.yaml` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by upstream provider data |
| `registry/providers/google.yaml` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED; upstream has newer catalog |
| `resolve-cli.js` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by #107 CLI |
| `resolver.js` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by #107 resolver |
| `routing-feedback-contract.v1.json` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by upstream taxonomy |
| `routing-record.js` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by schema v3 validation |
| `scripts/build-model-registry.py` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by v3 generator |
| `scripts/check-registry-fresh.py` | `f5395a45fe` (2026-08-14, deployed snapshot) | SUPERSEDED by upstream generator checks |
| `task-class-vocabulary.v1.json` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by upstream vocabulary |
| `tests/test-codex-identities.js` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by #107 pin contract |
| `tests/test-context-class.js` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by v3 test contract |
| `tests/test-p3-dry-run.js` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by v3 resolver tests |
| `tests/test-provider-facts.py` | `92c58c8e36` (2026-10-09, integration) | SUPERSEDED by upstream registry model |
| `tests/test-registry-builder.py` | `ae1bebf949` (2026-10-27, ICA availability) | SUPERSEDED by v3 generator contract |
| `tests/test-registry-resolver.js` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by v3 resolver tests |
| `tests/test-resolve-cli.js` | `3e3ddb79f5` (2026-08-14, routing audit) | SUPERSEDED by #107 CLI contract |
| `tests/test-sovereignty-ladder.js` | `8c48fa92b6` (2026-10-04, integration) | SUPERSEDED by upstream v3 floors |

Home conflicts: `CHANGELOG.md`, `SKILL.md`, `SPEC.md`, `model-registry.generated.json`,
`model-registry.yaml`, `references/model-registry.md`, `registry/providers/google.yaml`,
`resolve-cli.js`, `resolver.js`, `routing-table.generated.json`, `tests/test-codex-identities.js`,
`tests/test-context-class.js`, `tests/test-p3-dry-run.js`, `tests/test-provider-facts.py`,
`tests/test-registry-resolver.js`, `tests/test-resolve-cli.js`, and `tests/test-two-step-resolver.js`.
All are `SUPERSEDED` by `2230c85a`; the ports above come from newer launchpad hunks. Home lacks
`tests/test-observed-availability.js`, retained upstream. `registry/providers/openai.yaml` is a
scope addition needed to register the ported Terra model in the canonical provider catalog; it
was not itself a deployed conflict.

## Validation

Ran every `tests/test-*.js` and `tests/test-*.py` in the foreground on this branch and on an
archive of `2230c85a`. Current: 6 failures; base: 7 failures; no new failures. The shared failures
are `test-codex-identities.js`, `test-p3-dry-run.js`, `test-resolve-cli.js`,
`test-two-step-resolver.js`, `test-provider-facts.py`, and `test-registry-builder.py`.
`test-observed-availability.js` passes in both trees. `test-workflow-routing-log-shape.js` fails
only at base and passes on this branch. The v3 registry generator emits pre-existing validation
errors for lane/provider declarations, so generated output cannot be cleanly rebuilt from YAML at
this base; see `hub-out/registry-generation.log`.
