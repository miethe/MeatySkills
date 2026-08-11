# DI-1 feedback driver — decision record

**Status:** accepted, 2026-08-11
**Artifact:** `delegation-router/feedback-cli.js` (+ `tests/test-feedback-cli.js`)
**Upstream spec:** CCDash `docs/project_plans/design-specs/routing-feedback-router-merge-handoff.md`
§2.4 (landing surface, ADR Option C, ratified 2026-08-03) · IntentTree node
`node_01KZ6Z3C37W3CM84BT5F3550Y7`

## The gap

DI-1 shipped two of the three pieces of the CCDash proof→routing loop and left the wire between
them missing:

- **`routing-feedback.js`** — the merge + discrete actuation engine. Aggregates CCDash rows into
  `combined_signal` (§2.2 verbatim) and turns that scalar into a bounded one-position demotion.
- **`resolver.js`** — reads `~/.claude/state/routing-feedback-overrides.json` on the resolve path
  and applies whatever overrides it finds, TTL-filtered.

Nothing fetched the CCDash rollup, and nothing wrote that state file. The loop had a producer of
evidence and a consumer of overrides with no step in between, so it was **inert**: the state file
never came into existence, `loadFeedbackState()` always returned `absent`, and every resolve
behaved exactly as it did pre-DI-1. This driver is that missing step.

## Shape of the driver

One headless Node CLI, modelled on `resolve-cli.js`'s house style (same `parseArgs` /
`printHelp(stream)` / exit-code conventions / `module.exports` seam):

1. `GET {base}/api/v1/routing/rollup?project_id={pid}` with `Authorization: Bearer $CCDASH_TOKEN`.
2. Unwrap the `{status, data, meta}` envelope. `data.enabled === false` or an empty `data.keys`
   is a **normal, successful, non-writing** outcome — exit 0, state untouched.
3. Rebuild the merge envelope from `data`'s identity fields plus `producer`, which the REST
   response carries per key row rather than at the top level. A producer mismatch is caught
   downstream by `validateFeedbackJoin()` per row, fail-closed.
4. `loadFeedbackState()` → `mergeFeedback()` → print the decisions table (`task_class`, `entry`,
   `action`, `combined_signal`, `reason`) plus `applied` / `gate_reason`.
5. Write only on `--apply` **and** `result.applied === true`.

The core is exported as `run(argv, deps)` with `{fetchImpl, env, statePath, now, stdout, stderr}`
injectable, so the test suite drives the whole flow with a canned rollup and a tmp state path —
no network, no `child_process`.

## Decision: an empty override map is not one state

Post-review addition (2026-08-11). The write guard originally short-circuited only on
`data.enabled === false || keys.length === 0`, which missed a rollup that *has* rows where every
one comes back `skip` (join-rejected / not eligible / low confidence / no live terms). That merges
to `applied: true` with `overrides == {}`, and `--apply` would have overwritten a live state
file — **lifting every demotion immediately instead of at its TTL**, the exact failure the
nothing-to-merge guard exists to prevent.

The fix turns on a distinction that is easy to miss because both cases produce the same artifact.
An empty `overrides` map means either:

- **"measured, and healthy"** — rows evaluated to `neutral`, which legitimately lifts a stale
  demotion. That write **must** happen; suppressing it would strand a demotion until its TTL on
  evidence that already says it should go.
- **"nothing was measurable"** — every row was skipped. Writing that empty map lifts every live
  demotion on the strength of no evidence at all.

So the discriminator is the **decisions**, never the resulting override map: write iff at least one
decision's action is in `{neutral, demote, hold, restore}`. This is the same principle
`routing-feedback.js` already applies per row when it refuses to actuate on `no_live_terms`
("absence of evidence is not evidence of health"), lifted to whole-rollup scope. An all-skipped
rollup is therefore treated exactly like an empty one: exit 0, print the table so the operator can
see *why* each row was skipped, write nothing — even under `--apply`.

Related hardening in the same pass: `--timeout <seconds>` (default 30) with an `AbortSignal`, so
the driver cannot hang on an unreachable node; value-taking flags reject a missing or `--`-prefixed
value, so `--state-path` with no value can never silently fall through to the operator's **real**
state file; `deps.mergeOpts` is spread *before* `env`, so the test seam cannot displace the
`AOS_ROUTING_FEEDBACK` kill switch; `--json` emits its envelope on every exit path; and `main()`
sets `process.exitCode` rather than calling `process.exit()`, so a large piped `--json` run drains
fully instead of truncating at the pipe buffer (verified at 150 KB / 200 rows).

## Decision: on-demand in v1, cron deferred (AC4)

**v1 is an on-demand operator command, dry-run by default.** A Hermes cron firing once per TTL
window is the automation path, but enabling it is a deliberate future decision rather than a
default.

The reasoning is the direction of the failure mode. Every override this driver writes carries an
`expires_at` derived from its own rollup window (§2.4.6: an override "expires if the next window
does not re-confirm it"), and `loadFeedbackState()` drops expired entries on read. So if a cron
driver **stops running**, each live demotion lifts at its TTL and routing returns to registry
order on its own. **A dead driver lifts demotions; it does not freeze stale ones** — fail-safe,
not fail-dangerous.

That asymmetry sets the price of each option. Running by hand costs a slightly staler signal.
Running unattended costs an unattended writer on the routing path. Since the unattended version's
absence is self-healing, there is no urgency that justifies buying the second cost now.

Two consequences are deliberate: dry-run is the default (a bare invocation can never change
routing), and `--apply` is necessary but not sufficient — it must also clear `mergeFeedback`'s own
gate, which requires the pinned contract's `live_consumption` to be exactly `enabled` and the
`AOS_ROUTING_FEEDBACK` kill switch not to be falsy. A refused `--apply` exits **3** with the
`gate_reason` on stderr and writes nothing, so **the gate is visible at the producer step** rather
than only later, as a written file the resolver silently ignores.

## Invariant: the fetch never enters `resolver.js`

The HTTP call lives **only** in this CLI. `resolver.js` and the whole resolve path stay pure and
offline, and `routing-feedback.js` keeps its own "NO MODEL CALL, NO NETWORK, NO SHELL" guarantee.
A routing decision must never depend on network reachability: a rollup fetch on the resolve path
would make every delegation inherit CCDash's uptime, its latency, and its auth state, and would
turn an unreachable node into an unroutable task. Keeping the fetch at the edge preserves the
same separation `resolve-cli.js` already established — the resolver is the environment-agnostic
oracle, the CLI is the environment-aware consumer.

Concretely, the loop's only shared surface is the state file on disk. That is what makes the
precedence ladder in §2.4.5.1 enforceable (MUST-stay > `routing.local.toml` > machine feedback
state > registry) and what lets the whole channel be disabled by deleting one file.
