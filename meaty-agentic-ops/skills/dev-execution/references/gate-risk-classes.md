# Reference — Gate Risk Classes (risk-class → reviewer-lens ruleset)

The data behind the `plan-optimization` mode. Load this when running the plan-optimizer pass or
when hand-tuning a plan's per-phase gates. The mode file (`../modes/plan-optimization.md`) owns the
*procedure*; this file owns the *ruleset*, the *defect checklist*, and the *cost calibration*.

> **Evidence basis: three sources, unevenly.** The **cost calibration** (§4) and the **defect
> checklist** (§3) are still n=1 — both come from one labelled execution retro, RF Operator MCP P1
> (the worked example in §5). The **default-one-lens tier** (§2) has broader support: the
> 2026-07-24 cross-AAR synthesis (`docs/project_plans/reports/weekly-aar-review-2026-07-24.html`)
> independently concluded "risk-based independent review with explicit authority — **not generic
> review everywhere**", and the same-class stop rule in §2b was that review's P0 recommendation. The
> **F1 / R8 / R9 rows are doctrine, not retro-calibrated** — they close surfaces the original
> ruleset had no row for, and they have not been measured. Do not tighten §3/§4 beyond their
> retro-derived starting point until more retros are captured via `op story capture`. The classifier
> has **not** yet been validated against a plan whose actual review outcome *diverged* from its
> prediction.

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

Classification is **two steps, in this order**. Step 1 always produces exactly one lens. Step 2 is
the only thing that can add a second.

### Step 1 — the default: one lens

**Every phase starts at one lens.** Match `files_affected` + title/description against the rows
below; each assigns exactly one lens.

| # | Class | Trigger signals (in `files_affected` / title / description) | Assigns |
|---|---|---|---|
| F1 | **Ordinary product surface** | CRUD, list/detail/read path, UI component or page, reporting/export/rollup, internal API shaping, formatting/presentation, test-only changes | `validator` only |
| M1 | **Mechanical / adapter** | adapter wrapping, transport shim, mechanical extraction, pure-function refactor, rename/move | `validator` only |
| M2 | **Schema-additive / config** | additive schema key, config plumbing, advisory-field add | `validator` only |
| M3 | **Docs / spec shaping** | docs, README, comment, deferred spec shaping | `validator` only |

A phase matching **no row at all** also gets `validator`. There is no "no review" outcome, and there
is no path from step 1 to two lenses.

> **F1 is the common case, and it is meant to be.** Most features are ordinary: implement → tests →
> **one** review → ship. No pre-gate, no second lens, no per-phase karen. If a plan's phases are
> mostly landing outside F1, re-read step 2 — the triggers are narrow on purpose.

### Step 2 — the second-lens test: three triggers, nothing else

A **second** lens is added only when the phase matches one of exactly three triggers. These are the
whole test; there is no "feels risky" path and no tier-based promotion.

| Trigger | Meaning | Rows | Adds |
|---|---|---|---|
| `untrusted-input` | the surface **parses input the caller controls** | R8 | `security` (non-removable) |
| `authz-boundary` | the surface **is an authorization or identity boundary** | R1, R2, R3, R4, R6 | `security` (non-removable) |
| `irreversible-outward` | the effect is **irreversible, or leaves the system** | R5, R7, R9 | `security` (non-removable) |

The rows those triggers resolve to:

| # | Risk class | Trigger signals (in `files_affected` / title / description) | Trigger |
|---|---|---|---|
| R1 | **Auth / authorization** | authorize, RBAC, capability, policy evaluation, permission, guard, preflight | `authz-boundary` |
| R2 | **Identity** | identity, principal, actor, session, ownership, tenant boundary | `authz-boundary` |
| R3 | **Tokens / nonces / confirmation** | token, nonce, confirmation, replay, idempotency-key, one-time-use | `authz-boundary` |
| R4 | **Isolation / sandboxing** | isolation, sandbox, worktree boundary, subprocess, cwd/PGID, tool-permission surface | `authz-boundary` |
| R6 | **Secrets** | secret, credential, key, redaction, `secret_patterns` | `authz-boundary` |
| R8 | **Untrusted-input parsing** | deserialization (`pickle`/`yaml.load`/`eval`), request-body or query parsing, path/filename handling (traversal), template rendering with caller data, regex over caller input, file-upload handling, URL/host/redirect parsing, archive extraction | `untrusted-input` |
| R5 | **Preview-safety / writeback** | preview, dry-run negative-proof, writeback, "must-not-execute" surface | `irreversible-outward` |
| R7 | **Durability / atomicity / concurrency** | CAS/compare-and-swap, transaction, exclusive lock, `BEGIN IMMEDIATE`, `O_EXCL`, single-writer, atomic-rename | `irreversible-outward` — *see note* |
| R9 | **Outward-facing / irreversible effect** | publish/deploy, send to an external service (email, webhook, notification, API POST), PR or issue creation, force-push, schema migration, secret rotation, data deletion, cache/index destructive rebuild | `irreversible-outward` |

**Every two-lens phase must name its trigger.** Record it as `gate_lens_reason` on the phase
(`untrusted-input | authz-boundary | irreversible-outward | ambiguity-tie`). A phase carrying two
lenses with no named trigger is a classification error, not a cautious default — the whole point of
the tier is that the second lens is *justified*, not *assumed*.

### Step 2b — ambiguity resolves to a question, not to a second reviewer

An ambiguous phase — one that matches an F1/M-row but *might* reach an R-surface, or that cannot be
confidently classified — gets **one** lens plus a **named unknown to resolve at classification
time**: state precisely which value, caller, or surface you could not rule out, and resolve it by
reading the code. Record `gate_lens_reason: ambiguity-tie` only if the unknown resolves *toward* a
trigger, in which case it is no longer ambiguous.

> **This replaces the retired "more expensive lens wins" rule (formerly D1).** That rule was the
> largest single source of default-two-lens inflation: because no row covered ordinary product work,
> ordinary phases fell through to "unclear" and were escalated to `[security, validator]` by
> tie-break — buying, per the grounding retro's own lesson 3, "one lens's worth of defect-finding at
> two lenses' cost." Ambiguity is cheap to resolve by reading the code and expensive to resolve by
> hiring a second reviewer. Resolve it.
>
> This is **not** a relaxation of the hard invariant below. Once a trigger matches, its `security`
> lens is non-removable. What changed is that *failure to classify* no longer counts as a match.

**Note on R7 (durability is a security property).** Atomicity/concurrency looks mechanical but is not:
a validator will approve a read-then-write CAS, and a non-atomic consume-confirmation *passes every
functional test and is still exploitable by replay*. The retro's P2 rationale is explicit — "durability/
atomicity is a security property; a validator will approve a read-then-write CAS." Route it to
`security`.

**Cross-reference for the R1–R9 surface vocabulary.** The security-relevant surface list above is the
same surface taxonomy that `asdlc-secure-tool-permissions` (its rung-3–5 gated/human-approval tools)
and `asdlc-mcp-threat-modeling` (its write/exec tool classification) already flag as high-permission.
Those skills classify *tool permissions*, a different axis than *reviewer lenses*; this ruleset borrows
their surface vocabulary but not their ladders.

### The hard invariant — never remove a distinct lens

> **The optimizer may only ever recommend dropping a *duplicate* lens, never the *only* lens a
> phase's risk class requires.** Once a step-2 trigger (R1–R9) assigns `security` to a phase, no
> report, merge, cost
> pressure may remove it. The duplicate-lens report (output 2) may recommend dropping a `validator`
> that a `security` lens's coverage subsumes; it may **never** recommend dropping the `security` lens
> itself. This is structural, not advisory: "we can't afford the security lens here" is a scope cut
> disguised as gate optimization, and it is prohibited.
>
> **The Claude-5 doctrine's gate budget reinforces this, it does not weaken it.**
> `execution-doctrine.md` rule 1 (max 2 re-passes per scope × lens, then auto-escalate to re-scope)
> governs how many times a lens is allowed to *re-run* after a rejection — it says nothing about
> whether the lens runs at all. Do not read "gate budget" as license to cut a phase's only lens to
> stay under it: the doctrine text is explicit that reviewer gates stay, frequency and context shrink
> ("Frequency, composition, not existence"). A budget-constrained plan re-scopes the *work*, never
> the *lens*.
>
> **Step 1's one-lens default is not an exception to this.** On an F1/M phase the single lens *is*
> the whole requirement — there is nothing to remove. On a triggered phase the single non-removable
> lens is the `security` one, not the `validator`. "Default to one lens" never means "drop the
> security lens and keep the validator"; where they conflict, the `security` lens survives.

### Karen placement

`karen` is a **whole-tree reality-check, and there is exactly one of it per feature** — at
end-of-feature, as `karen-final-tree-only`. Per-phase karen duplicates that pass and is not assigned
by default.

The one exception: a plan whose `context_class` is **C3 or C4** may also take a karen pass at a
**plan-milestone boundary** (a reviewable state of the system, per `planning/references/plan-doctrine.md`
rule 2) — those are the classes whose posture already calls for operator checkpoints at milestone
boundaries. C1/C2 plans get the single final pass and nothing else.

> **Karen is one lens, not a fan-out.** Karen's own definition previously mandated a sequence of
> three-to-four additional reviewer dispatches on every run. That is removed: karen performs its own
> whole-tree check and returns a verdict. If a karen pass wants a second opinion on a specific
> surface, that surface matched a step-2 trigger and should carry a `security` lens at its own phase
> gate — not a nested fan-out at the final gate, where it is unbudgeted and unscoped.

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

## 3b. Surface reduction before guard proliferation

> **Not part of the verbatim §3 block.** §3 is quoted from its source retro and must stay byte-stable.
> This section is the counterweight to §3's item 2, and is added deliberately alongside it rather than
> inside it.

§3 item 2 ("fix the layer below") tells you to enumerate delegates, callers, and siblings and harden
each one. That is the right move *once the surface is fixed* — but followed alone it produces guard
proliferation: N call sites, N guards, and a permanent obligation to remember the guard on call site
N+1. It is also exactly the shape that generates the same defect class round after round, because
each round finds one more unguarded sibling.

**Ask "what can the caller even say?" before "is every input guarded?"** Order the two questions:

1. **Can the unsafe state be made unrepresentable?** A narrower type, a closed enum instead of a
   free string, a required parameter instead of an optional one with a permissive default, a single
   constructor instead of five, a private setter. If the caller cannot express the unsafe thing,
   there is nothing to guard.
2. **Can every caller be routed through one choke point?** One primitive that all writes go through,
   with the raw path made inaccessible (or statically detectable). Then review the choke point,
   once, instead of rediscovering the subsystem every round.
3. **Only then, guard what remains.** Guards are the residue after 1 and 2, not the first move.

Surface reduction is cheaper and more durable than guard proliferation: it is one edit instead of N,
it cannot be forgotten at the next call site, and it collapses the review surface to something a
single bounded lens can actually cover.

> **This is the 2026-07-24 cross-AAR review's P0 recommendation**
> (`docs/project_plans/reports/weekly-aar-review-2026-07-24.html`), restated as a design rule:
> "Turn cross-cutting invariants into non-bypassable routes … when every operation of type X must go
> through seam Y, land Y first and fail CI if anything bypasses it." Its verdict line is the whole
> argument: **"Review is finding the defects. Architecture should prevent their class."**
>
> Pairs with the same-class stop rule (`references/execution-doctrine.md` rule 1): when a class
> recurs, this section is *what the design change actually is*.

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
- **The baseline is one lens.** `Σ lenses` is `1` for every F1/M phase — which, under step 1, is most
  of them. Only a phase with a named step-2 trigger contributes `2`. A projection that assumes two
  lenses per phase is projecting the retired ruleset and will overstate review cost by roughly 2×.
- Review estimate per phase ≈ `Σ lenses × ~165k` **× fix-cycle rounds**, where fix-cycle rounds is now
  **capped at 2** by `execution-doctrine.md` § "The six execution rules" rule 1's gate budget — a hard
  cap, not an expectation. (Disambiguation: that file has a second, unrelated rule 1 under § "Leg
  scoping", which is the *leg* budget and is scaled off the 355k band in this section.)
  Assume up to 2 rounds for any phase carrying `security`, up to 1 otherwise (the retro needed two);
  budget for a 3rd round never happens under the doctrine — a scope × lens that would need one instead
  auto-escalates to re-scope/redesign and exits this cost model rather than inflating it.
  **This cap is exactly what the measured fix-cycle cost above justifies**: one fix cycle runs
  ~376–388k tokens (§4 table, "Fix cycle" row) — the same order as a full Tier-3 implementer pass
  (355k) — so the uncapped multi-pass loop this cap replaced wasn't a cheap retry, it was re-running
  the single most expensive line item in the table, repeatedly, past the point of diminishing signal.
- Each duplicate lens dropped saves ~165k per round it would have run.

**Inversion warning.** Flag any phase where `projected_review > projected_implementation`. That is the
signal the gate structure is wrong for that phase — name which lens to cut or merge to correct it. A
uniform "two lenses every round" structure inverts on mechanical phases (P3/P4 in the worked example);
the recommended structure does not.

**Two-lens phases must be enumerable.** The cost projection lists every phase carrying two lenses
**with its `gate_lens_reason`**, so the second-lens count is auditable against the three triggers
rather than accumulating silently. If that list is longer than the set of phases you could defend as
untrusted-input / authz-boundary / irreversible-outward surfaces, the classification is wrong — not
the budget.

---

## 5. Worked example — RF Operator MCP P1 (the calibration case, n=1)

This is the labelled example the ruleset is calibrated against, and the P1 acceptance target. Running
the ruleset in §2 over the RF Operator MCP plan's `wave_plan.phases[]` reproduces the gate assignments
now live in that plan (`research-foundry-operator-mcp-v1.md`):

| Phase | Surface | Matched rule | `gate_lens_reason` | Original (plan's first cut) | Recommended `gate_lens` | `gate_shared_with` |
|---|---|---|---|---|---|---|
| P1 | Authorization contract (policy, tokens, RBAC) | R1 + R3 | `authz-boundary` | security + validator | `[security, validator, karen]` | `null` |
| P2 | Consumption CAS / atomicity | R7 (durability = security) | `irreversible-outward` | validator + karen | `[security, karen]` | `null` |
| P3 | Mechanical adapter extraction | M1 | — (one lens) | validator | `[validator]` | `null` |
| P4 | Adapter wrapping same files as P3 | M1 + file-ownership overlap | — (one lens) | validator + karen | `[validator]` | `P3` |
| P5 | Writeback-preview negative proof | R5 | `irreversible-outward` | security + validator | `[security, validator]` | `null` |
| P6 | Docs + deferred shaping | M3, last phase | — (one lens) | validator then karen (per-phase) | `[validator, karen-final-tree-only]` | `null` |

> **Re-run under the two-step tier, this table is unchanged** — which is the point. Every phase that
> kept two lenses here does so because it names a real trigger (P1 authz, P2/P5 irreversible-outward),
> and every phase that dropped to one was mechanical. The v4.1 restructure did not loosen this plan's
> coverage; it removed the *tie-break* that would have escalated an unclassified ordinary phase to the
> same two lenses without a trigger. Note P1's reason is now `authz-boundary` rather than the retired
> D1 "keeps both" — the trigger, not the tie, is what earns its second lens.

**Duplicate-lens report for this plan** (output 2 format):

| Phase | Two lenses originally? | Kept | Cut | Rationale |
|---|---|---|---|---|
| P2 | validator + karen | security + karen | validator | Atomicity is a security property (R7); validator would approve a read-then-write CAS. Karen kept for the end-of-foundational-phase reality-check. |
| P4 | validator + karen | (rides P3's validator) | its own karen + own validator pass | Same files as P3, serialized for ownership not review reasons → `gate_shared_with: P3`. |
| P6 | validator + per-phase karen | validator + `karen-final-tree-only` | per-phase karen | Per-phase karen duplicates the single final-tree pass. |

**The one divergence, named honestly.** The retro's §4.1 "collapse duplicates" rule, read literally,
would trim P1 to `[security, karen]` (drop the validator as a duplicate of the security lens). The live
plan keeps `[security, validator, karen]` — a deliberate judgment call: P1 is the foundational authorization
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
