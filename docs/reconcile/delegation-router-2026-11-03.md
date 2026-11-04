# delegation-router reconcile — 2026-11-03

Target node: `internal work record`. Comparison base: `2230c85a` (PR #107 merged).
Canonical path: `meaty-agentic-ops/skills/delegation-router`. Neither deployed copy was edited.

## Method and counts

Compared tracked paths and bytes against the pinned base with `git ls-tree` / `git show`, then
reviewed unified diffs. For every conflicting launchpad file, queried
`git -C the launchpad checkout log --follow -1 --
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
| `model-registry.yaml`, generated registry JSON — pilot and ICA availability facts | PARTIALLY PORTED, needs-nick | Removed the deployed-only model/account pilot. A node declares its task class and optional floor; the resolver selects a registry model and eligible lane, and nodes never pin a model, lane, or Codex account. Retained the separate `ae1bebf949` (#3361, 2026-10-27) ICA availability updates for Opus 5.5, Sonnet 5.5, and Haiku 5.5. Preserved #107 selection and floors. |
| `resolver.js`, `resolve-cli.js`, `tests/test-codex-identities.js` — missing availability and pin-reason behavior | SUPERSEDED by #107 (`abdb6eb3`, in `2230c85a`) | The deployed versions predate receipt consumption, skip reasons and explicit pin provenance. Kept #107. |
| `tests/test-observed-availability.js` and its fixture | UPSTREAM-ONLY at base | Added by #107 and retained. |
| All remaining differing files listed below | SUPERSEDED by upstream `2230c85a` | Deployed versions are older schema/API snapshots. Reviewed their unique hunks; none beyond the listed ports is compatible with the v3 registry/resolver contract. Where launchpad/home disagree, launchpad is the later deployed snapshot by launchpad history; upstream v3 remains authoritative. |

### File-by-file classification

`PORTED` denotes the specific hunks above; other hunks in a listed file are `SUPERSEDED`.

| Launchpad conflicting path | Latest `--follow` touch | Decision |
|---|---|---|
| `CHANGELOG.md` | `7440379526` (2026-10-27, model onboarding) | PARTIALLY PORTED; unregistered model/account pilot removed |
| `README.md` | `c09a6020b8` (2026-10-21, dispatch preflight) | PORTED pointer hunk |
| `SKILL.md` | `7440379526` (2026-10-27, model onboarding) | PORTED pointer hunk; old surrounding CLI text superseded |
| `SPEC.md` | `de06faf28e` (2026-10-17, integration) | SUPERSEDED by v3 spec |
| `model-registry.generated.json` | `ae1bebf949` (2026-10-27, ICA availability) | PORTED availability facts; remaining snapshot superseded |
| `model-registry.yaml` | `ae1bebf949` (2026-10-27, ICA availability; also `7440379526` model onboarding) | PORTED ICA availability facts; removed unregistered model/account pilot |
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
scope addition for the canonical provider catalog; every provider entry must refer to a model
registered in `model-registry.yaml`.

## Validation — phantom removal completion

Full repository snapshots (not router-only copies) were archived at each pinned ref and run
with the same commands from `meaty-agentic-ops/skills/delegation-router`:

| Ref | `node --test tests/*.js` | `python3 tests/test-registry-builder.py` | Builder |
|---|---|---|---|
| `origin/main` (`2230c85a`) | 19/23 | chain assertion fails | schema/lane errors |
| `2ae9c03f` (prior #109 head) | 19/23 | chain assertion fails | schema/lane errors |
| `8b590da9` (after `78a32da3`) | 19/23 | same chain assertion | same schema/lane errors |
| This correction | 23/23 | pass | pass |

Builder command: `python3 scripts/build-model-registry.py --in model-registry.yaml --out model-registry.generated.json`.
No observed failure was introduced by `78a32da3`. The earlier 17/23 report was not reproduced:
these tests had dependencies on the host registry and live account receipt. The four reproduced
JS failures were `test-codex-identities`, `test-p3-dry-run`, `test-resolve-cli`, and
`test-two-step-resolver`. Baseline logs are attached to the target node's validation evidence.

The root cause of the builder failure was a legacy v1 source paired with a v3 builder and tests.
Restored the tracked v3 source from `7341b08`, removed its phantom `gpt-6.1-terra` entry, and
preserved #109's October 24 ICA Opus unavailability. This restores existing lane attributes,
model-only holders, evaluated floors, account lanes and capabilities; it does not invent a new
schema or weaken validation. Python's older enabled-Opus assertion now agrees with the retained
October 24 observation. JS fixtures use the checked-out registry and an empty test receipt;
the observed-availability test still exercises LIMITED/stale receipts and pin-reason refusal.
The P3 dry-run declares canonical task classes, leaving selection to the resolver.

Both JSON outputs were regenerated by the builder. Exact phantom-id occurrences across
`model-registry.generated.json` and `routing-table.generated.json`: **0**. The separate
`gpt-5.6-terra` ICA image fallback remains registered. Frozen workflow snapshots are unchanged.
Removed `.leg/checkpoints.jsonl` from the tracked tree in this new commit.

SkillMeat deployment remains a post-merge steward action; this branch does not deploy either copy.
