# Reference — Gate Risk Classes (risk-class → reviewer-lens ruleset)

The data behind the `plan-optimization` mode. Load this when running the plan-optimizer pass or
when hand-tuning a plan's per-phase gates. The mode file (`../modes/plan-optimization.md`) owns the
*procedure*; this file owns the *ruleset*, the *defect checklist*, and the *cost calibration*.

> **Evidence basis: n=1.** Every rule here is calibrated against a single labelled execution retro —
> RF Operator MCP P1 (the worked example below). It is a defensible first-pass heuristic, **not** a
> validated general model. Do not tighten these rules beyond their retro-derived starting point until
> more retros are captured via `op story capture` (see "Feeding it real data" in the spec). The
> classifier has **not** yet been validated against a plan whose actual review outcome *diverged* from
> its prediction.

---

## 1. The reviewer-lens vocabulary

Drawn verbatim from `../SKILL.md`'s **Mandatory Reviewer Gates** table — this pass never invents a
lens, it only chooses among these:

| `gate_lens` value | Reviewer | What it is good at | What it is NOT reliable for |
|---|---|---|---|
| `validator` | `task-completion-validator` | AC-mapping; catching a fabricated/absent validation transcript; "did every acceptance criterion get met" | Adversarial defect-finding. In the retro it **approved a critical authorization bypass twice.** |
| `security` | adversarial security-review lens | Finding the actual defect on the path nobody tested; fail-open defaults; relocated fixes | AC-completeness bookkeeping (that's the validator's job) |
| `karen` | `karen` | Reality-check on whole-tree completion vs claimed | Per-phase adversarial depth; duplicates the final-tree pass if run every phase |
| `karen-final-tree-only` | `karen`, scoped to the final assembled tree | The one end-of-feature completion reality-check | Anything mid-plan (that's the point — it de-duplicates per-phase karen) |

---

## 2. Risk-class → lens ruleset

For each phase, match its `files_affected` + title/description against the rows below **top to
bottom**; the first matching security row makes the phase security-relevant. A phase can match
multiple rows (e.g. a security surface that also has heavy AC bookkeeping → `[security, validator]`).

| # | Risk class | Trigger signals (in `files_affected` / title / description) | Assigns |
|---|---|---|---|
| R1 | **Auth / authorization** | authorize, RBAC, capability, policy evaluation, permission, guard, preflight | `security` (non-removable) |
| R2 | **Identity** | identity, principal, actor, session, ownership, tenant boundary | `security` (non-removable) |
| R3 | **Tokens / nonces / confirmation** | token, nonce, confirmation, replay, idempotency-key, one-time-use | `security` (non-removable) |
| R4 | **Isolation / sandboxing** | isolation, sandbox, worktree boundary, subprocess, cwd/PGID, tool-permission surface | `security` (non-removable) |
| R5 | **Preview-safety / writeback** | preview, dry-run negative-proof, writeback, "must-not-execute" surface | `security` (non-removable) |
| R6 | **Secrets** | secret, credential, key, redaction, `secret_patterns` | `security` (non-removable) |
| R7 | **Durability / atomicity / concurrency** | CAS/compare-and-swap, transaction, exclusive lock, `BEGIN IMMEDIATE`, `O_EXCL`, single-writer, atomic-rename | `security` (non-removable) — *see note* |
| M1 | **Mechanical / adapter** | adapter wrapping, transport shim, mechanical extraction, pure-function refactor, rename/move | `validator` only |
| M2 | **Schema-additive / config** | additive schema key, config plumbing, advisory-field add | `validator` only |
| M3 | **Docs / spec shaping** | docs, README, comment, deferred spec shaping | `validator` only |
| D1 | **Ambiguous / mixed** | matches an M-row but *also* touches a value that reaches an R-surface; or unclear | **more expensive lens wins** → `[security, validator]`; log the tie |

**Note on R7 (durability is a security property).** Atomicity/concurrency looks mechanical but is not:
a validator will approve a read-then-write CAS, and a non-atomic consume-confirmation *passes every
functional test and is still exploitable by replay*. The retro's P2 rationale is explicit — "durability/
atomicity is a security property; a validator will approve a read-then-write CAS." Route it to
`security`.

**Cross-reference for the R1–R6 surface vocabulary.** The security-relevant surface list above is the
same surface taxonomy that `asdlc-secure-tool-permissions` (its rung-3–5 gated/human-approval tools)
and `asdlc-mcp-threat-modeling` (its write/exec tool classification) already flag as high-permission.
Those skills classify *tool permissions*, a different axis than *reviewer lenses*; this ruleset borrows
their surface vocabulary but not their ladders.

### The hard invariant — never remove a distinct lens

> **The optimizer may only ever recommend dropping a *duplicate* lens, never the *only* lens a
> phase's risk class requires.** Once R1–R7 assigns `security` to a phase, no report, merge, or cost
> pressure may remove it. The duplicate-lens report (output 2) may recommend dropping a `validator`
> that a `security` lens's coverage subsumes; it may **never** recommend dropping the `security` lens
> itself. This is structural, not advisory: "we can't afford the security lens here" is a scope cut
> disguised as gate optimization, and it is prohibited.

### Karen placement

Per-phase `karen` duplicates the final-tree pass. Assign `karen` where the retro's matrix keeps it
(end of a major foundational phase, and end-of-feature); on the **last** phase use
`karen-final-tree-only` so the per-phase karen collapses into the single final reality-check.

### Shared-gate merges (`gate_shared_with`)

Two phases serialized **for file-ownership reasons** (they appear in the same
`wave_plan.serialization_barriers` entry, or their `files_affected` overlap) but whose review content
is the same body of work can **share one review pass**. Populate `gate_shared_with: <earlier-phase-id>`
on the *later* phase; its gate rides the earlier phase's. Do this only when the shared review genuinely
covers both — not to save a distinct lens.

---

## 3. Front-loaded defect checklist (retro §4.2, verbatim)

This is the literal text the `plan-optimization` pass injects into **every** implementer `Task()`
prompt. Reproduced here verbatim so it does not decay independently of its source retro. Both review
rounds in the grounding retro found the same classes; front-loading them attacks the two-cycle problem
at its source and costs nothing.

```
Before you claim done, self-check against these four defect classes (they caused two full
re-review cycles on the surface this checklist came from):

1. No fail-open defaults. No permissive default on a security-relevant field; no None-means-skip;
   no unknown-label fallback that grants rather than denies. Check the PRODUCER of a value, not just
   the field — a defect survived once because the field default was removed while the function
   producing it still returned the permissive value.

2. Fix the layer below. After hardening a symbol, enumerate its delegates, callers, and siblings in
   __all__ and ask whether reaching any of them yields the unsafe behavior. The single highest-yield
   question is: "which delegate, caller, or sibling of the thing I just hardened is still soft?"

3. Never pin unsafe behavior with a test. If a test asserts the current behavior and the current
   behavior is wrong, the test is wrong. Say so and invert it — do not write a test that asserts the
   unsafe behavior is correct.

4. Never fabricate a transcript. Paste real command output, or report the failure. A green suite is
   not evidence — a passing test can sit over a critical bypass on a path nobody tested.
```

---

## 4. Cost calibration (retro §3 actuals)

The per-pass token costs from the grounding run, used as the calibration baseline for the cost
projection (output 6). These are Tier-3 authorization-surface figures; treat them as an upper band and
scale down for mechanical phases.

| Pass | Tokens |
|---|---:|
| Progress scaffolder | 116k |
| Implementer (one Tier-3 phase) | 355k |
| Validator (one pass) | ~164–168k |
| Security review (one pass) | ~157–171k |
| Fix cycle (one) | ~376–388k |
| Consolidated final gate | 254k |

**Projection heuristic (first-pass, until more retros calibrate it):**

- Implementation estimate per phase ≈ `effort`-scaled fraction of the 355k Tier-3 implementer band
  (xs≈0.15×, s≈0.3×, m≈0.5×, l≈0.75×, xl≈1×), further scaled by the phase `model` tier.
- Review estimate per phase ≈ `Σ lenses × ~165k` **× expected fix cycles** (assume ≥2 rounds for any
  phase carrying `security`, ≥1 otherwise — the retro needed two).
- Each duplicate lens dropped saves ~165k per round it would have run.

**Inversion warning.** Flag any phase where `projected_review > projected_implementation`. That is the
signal the gate structure is wrong for that phase — name which lens to cut or merge to correct it. A
uniform "two lenses every round" structure inverts on mechanical phases (P3/P4 in the worked example);
the recommended structure does not.

---

## 5. Worked example — RF Operator MCP P1 (the calibration case, n=1)

This is the labelled example the ruleset is calibrated against, and the P1 acceptance target. Running
the ruleset in §2 over the RF Operator MCP plan's `wave_plan.phases[]` reproduces the gate assignments
now live in that plan (`research-foundry-operator-mcp-v1.md`):

| Phase | Surface | Matched rule | Original (plan's first cut) | Recommended `gate_lens` | `gate_shared_with` |
|---|---|---|---|---|---|
| P1 | Authorization contract (policy, tokens, RBAC) | R1 + R3 + heavy AC surface → D1 keeps both | security + validator | `[security, validator, karen]` | `null` |
| P2 | Consumption CAS / atomicity | R7 (durability = security) | validator + karen | `[security, karen]` | `null` |
| P3 | Mechanical adapter extraction | M1 | validator | `[validator]` | `null` |
| P4 | Adapter wrapping same files as P3 | M1 + file-ownership overlap | validator + karen | `[validator]` | `P3` |
| P5 | Writeback-preview negative proof | R5 | security + validator | `[security, validator]` | `null` |
| P6 | Docs + deferred shaping | M3, last phase | validator then karen (per-phase) | `[validator, karen-final-tree-only]` | `null` |

**Duplicate-lens report for this plan** (output 2 format):

| Phase | Two lenses originally? | Kept | Cut | Rationale |
|---|---|---|---|---|
| P2 | validator + karen | security + karen | validator | Atomicity is a security property (R7); validator would approve a read-then-write CAS. Karen kept for the end-of-foundational-phase reality-check. |
| P4 | validator + karen | (rides P3's validator) | its own karen + own validator pass | Same files as P3, serialized for ownership not review reasons → `gate_shared_with: P3`. |
| P6 | validator + per-phase karen | validator + `karen-final-tree-only` | per-phase karen | Per-phase karen duplicates the single final-tree pass. |

**The one divergence, named honestly.** The retro's §4.1 "collapse duplicates" rule, read literally,
would trim P1 to `[security, karen]` (drop the validator as a duplicate of the security lens). The live
plan keeps `[security, validator, karen]` — a deliberate D1 call: P1 is the foundational authorization
*contract* every later phase trusts, with the heaviest AC surface in the plan, so the validator's
distinct AC-mapping value (it caught the fabricated transcript here) is worth its cost on this one
phase. This is exactly the kind of classifier-vs-actual divergence the "Do Not Say" note warns about
at n=1: the rule and the judgment disagree on P1, and the judgment won. Capture more retros before
deciding which is right in general.

**Inversion check for this plan.** Under a uniform "security + validator, two rounds every phase"
structure, P3 (mechanical, ~50k impl) would carry ~660k review — a 13× inversion. Under the recommended
structure P3 carries one validator pass (~165k) against its implementation, and P4 carries zero
incremental review (shared with P3). No phase inverts under the recommended structure. Net: ~4 fewer
Opus review passes across the plan, 40–50% off the naive extrapolation, with **zero reduction in
security coverage** (every R-classed phase keeps its security lens).
