# delegation-router reconcile — 2026-11-03

Node `node_01M6H8TAQK9PPV2YCF0MRM55P2`. Base: `2230c85a` (PR #107 merged). Upstream: `meaty-agentic-ops/skills/delegation-router`.
Method: whole-file `diff -rq`, blob lookup in upstream history (`git log --find-object`), and a line-set check for
deployed lines absent from upstream; launchpad history from `git -C agentic_meta_dev log --follow`. Neither deployed copy was edited.

Classes: **PORTED** (real deployed-ahead work, now upstream) · **SUPERSEDED** (deployed is an older snapshot; upstream `2230c85a` already holds the behavior) · **UPSTREAM-ONLY** (deployed lacks the file).

## Counts

| Copy | differing files | PORTED | SUPERSEDED | UPSTREAM-ONLY (missing from copy) | deployed-only files |
|---|---|---|---|---|---|
| launchpad `.claude/skills/delegation-router` | 25 | 1 hunk (`SKILL.md`) | 24 | 6 | 1 (`references/dispatch-preflight.md`, PORTED whole) |
| home `~/.claude/skills/delegation-router` | 17 | 0 | 17 | 1 | 0 |

Launchpad history: last touch `ae1bebf949` (2026-10-27) — all registry/ICA/Terra churn there predates upstream v3 (`a21c601`, 2026-10-16 registry v3 + `e43e798`/`3821d43`) or is already in upstream. Home is an older v3.5 snapshot (SPEC updated 2026-09-09); launchpad is newer than home wherever the two disagree, and upstream is newer than both.

## PORTED

| File | Deployed source | Action |
|---|---|---|
| `references/dispatch-preflight.md` | launchpad, `c09a6020b8` (#2522, 2026-10-21; node_01M52WQT5JX6QBKESK80GMS1WR) | copied; one edit (see conflicts) |
| `SKILL.md` § "Bound-front dispatch" | launchpad `c09a6020b8` | inserted before "When To Use" |

## Conflicts resolved

| Hunk | Choice | Why |
|---|---|---|
| preflight "standing account is `codex_secondary`" + `--codex-identity codex_secondary` | **upstream**: `codex_primary` standing, secondary explicit | upstream SKILL/SPEC (Nick 2026-10-16, agentic_meta_dev #2466) says Primary is default until 2026-11-12; the doc's own text contradicted it |
| `resolve-cli.js`, `resolver.js` (both copies) lack `--pin-reason`, `--availability-file`, observed-availability | **#107** | deployed predates `abdb6eb` |
| `tests/test-codex-identities.js` (both copies: unnamed call, no `pin_reason`) | **#107** | #107 requires a recorded `pin_reason` for explicit pins |
| launchpad/home `resolver.js` inline `stampNodeContract` object | superseded | upstream `normalizeNodeContract` (`a21c601`) is the same mapping |
| home vs launchpad disagreement (SPEC, registry, tests) | launchpad newer by history; upstream newer than both | no hunk needed porting |

## Per-file table (SUPERSEDED unless noted; upstream SHA = `2230c85a`)

Both copies unless marked L (launchpad only) / H (home only).

- Docs: `CHANGELOG.md` (3.6 entry; L also lacks it; the L-only 2026-10-26 Terra entry is already in upstream CHANGELOG/registry), `README.md` L, `SPEC.md` (§1a v3 absent), `SKILL.md` (v3 CLI + observed-availability sections absent), `references/model-registry.md` (v3-scores caveat is stale: upstream v3 rewrites it).
- Registry data: `model-registry.yaml`, `model-registry.generated.json` (deployed = pre-v3 chain format; H 1000+ lines older), `registry/providers/google.yaml` (lacks gemini-4-argon), `registry/private-only.yaml` L (lacks glm-5-3), `task-class-vocabulary.v1.json` L (1.3.0 < 1.4.0, lacks journal_reflect), `routing-feedback-contract.v1.json` L (taxonomy 1.3.0), `routing-table.generated.json` H (stale revision), `recipe.toml` L (lacks routing-table op).
- Code: `resolver.js`, `resolve-cli.js`, `routing-record.js` L (lacks schema_version 3 validation), `scripts/build-model-registry.py` L, `scripts/check-registry-fresh.py` L.
- Tests (older fixtures): `test-codex-identities.js`, `test-context-class.js`, `test-p3-dry-run.js`, `test-provider-facts.py`, `test-registry-resolver.js`, `test-resolve-cli.js`, `test-two-step-resolver.js` H; L also `test-registry-builder.py`, `test-sovereignty-ladder.js`.
- UPSTREAM-ONLY: L lacks `registry/providers/nvidia.yaml`, `routing-table.generated.json`, `tests/fixtures/v3/`, `test-observed-availability.js`, `test-routing-table.js`, `test-two-step-resolver.js`; H lacks `test-observed-availability.js`.

## Tests

`tests/*.js|py` run in the foreground. `test-observed-availability.js` passes. Six files fail identically on base `2230c85a` and after this change (docs-only): the three known (`test-codex-identities`, `test-p3-dry-run`, `test-resolve-cli`; node_01M6HBYE8EFKYP6G1F9F4DD187) plus `test-two-step-resolver.js`, `test-provider-facts.py`, `test-registry-builder.py` — pre-existing, filed as a finding. No new failures.
