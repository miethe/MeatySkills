# Execution Doctrine (Claude-5 generation)

> The execution half of the Claude-5-generation doctrine. Authoring half:
> `.claude/skills/planning/references/plan-doctrine.md`. Long form + evidence:
> `docs/project_plans/design-specs/claude5-plan-doctrine-v1.md`.
>
> Applies to runs of **new** doctrine plans. In-flight plans finish under their own rules.

## Why this exists

Gate loops replayed the full plan-plus-diff context up to five times on a single phase before a
human made a re-scope call the plan structure had prevented the executor from making. Retries,
not implementation, were the dominant cost: measured ~1000:1 in:out ratios concentrated in fix
loops, and 186-489% context utilization in single sessions. The levers are **how often gates
fire, how much context each one carries, and whether a fix re-ingests everything**.

## The six execution rules

**1. Gate budget: 2 re-passes, then re-scope — and a same-class recurrence ends it sooner.** Any
adversarial or validator gate on the **same scope** gets at most two re-passes. The third failure
does not escalate to "a human looks at it"; it **auto-escalates to re-scope/redesign**. Three
failures against the same lens is evidence the scope is wrong, not that the fix was sloppy — the
five-pass path was measured as strictly worse on every axis. Count re-passes per *scope x lens*,
not per dispatch: re-spawning an executor does not reset the budget.

> **The same-class stop rule (hard).** If **two consecutive rounds surface the same defect class**,
> the next action is a **design change — not a third review**, even when the gate budget still has a
> re-pass left. The budget counts *rounds*; this rule reads *what the rounds found*. Recurrence of a
> class means the review is rediscovering an expanding diff rather than verifying a bounded route:
> each round hardens one more call site and the next round finds the sibling. That is a shape
> problem, and a third review of the same shape buys nothing.
>
> What "a design change" means concretely is `references/gate-risk-classes.md` §3b — make the unsafe
> state unrepresentable, or route every caller through one choke point, then review the choke point
> once. Re-scope around it and re-enter the gate against the *new* shape (budget resets, because the
> scope changed).
>
> Two rounds finding *different* classes is normal review progress and does not trigger this. The
> test is class identity, not failure count.
>
> Source: the 2026-07-24 cross-AAR review's P0 recommendation — "after two reviews find a new layer
> of the same defect class, stop reviewing the expanding diff and re-scope around the choke point."

> **Enforcement is uneven — know which path you are on.** The scripted workflow path enforces both
> caps mechanically (`fixLoop` hard-caps at 2 cycles, and exits `needs_redesign` when a round repeats
> the previous round's `defect_class`). The manual orchestrated path has **no counter**: there both
> are rules the orchestrator follows, not mechanisms that stop it. Count the re-passes yourself, and
> name each round's defect class as you go — you cannot apply the same-class rule if you never
> labelled the classes.

**2. Delta context, not the full stack.** A gate dispatch carries the **delta**: the failure
summary, the touched files, and the AC actually in question. It does not carry the full plan, the
cumulative diff, or the progress file. A reviewer that needs the whole plan to judge one AC is a
signal the AC is under-specified — fix the AC, do not widen the packet.

**3. Continue; don't re-dispatch. Reserve fresh context for verification.** Fix loops should reuse
the existing agent session: it is cache-warm and already holds the context the fix depends on. A
fresh re-dispatch re-ingests everything to relearn what the previous session already knew.
Fresh context belongs on the **verifier** — a fresh-context verifier outperforms self-critique,
and inherited-context validators rubber-stamp. Today's default is exactly inverted: implementers
get re-spawned and validators inherit stale context. Invert it.

> **Where this is real today, and where it isn't.** The Tier 1 sprint path genuinely continues one
> session (`feature-sprint-executor` holds context across its fix cycles), and the manual
> phase-owner loop preserves the session and its branch rather than deleting and re-spawning.
> The **scripted workflow path cannot yet**: the documented primitive set (`agent`, `parallel`,
> `pipeline`, …) has no session-continuation call, so `fixLoop` issues a fresh `agent()` dispatch.
> That is a known gap, not a described capability — see `orchestration/workflow-patterns.md`.
> Prefer the paths that can continue; do not claim the scripted one does.

> **Bounded above by the packet-file rule.** "Continue" assumes a *small* warm session. Past
> ~150k tokens the replay cost of one more continuation exceeds the cache benefit, and the rule
> inverts: write the delta to a packet **file** and dispatch fresh. See § "Leg scoping" rule 2 —
> that is the boundary between this rule and rule 4's tripwire, not a contradiction of either.

**4. Context tripwire at 150%.** Above 150% context utilization in one session, split or
summarize-forward **before continuing** — it is not a post-hoc AAR observation, it is a live
execution signal. Carrying on past the tripwire is how a fix loop becomes a retry storm.

**5. Prefer the narrowest reproducible measurement.** When you need to know whether something works,
reach for the smallest check that answers *exactly* that question — one test, one function call, one
`curl`, one query — not the suite that happens to contain it.

**If a check takes more than about two minutes, stop and ask what ten-second version answers the
same question.** There almost always is one, and finding it is faster than waiting: run the single
test instead of the file, the file instead of the suite; call the function directly instead of
driving the UI; query the row instead of rebuilding the index. A full-suite run to verify a one-line
change is not thoroughness, it is a two-minute pause repeated once per iteration — and iteration
count is what actually sets execution cost.

Two boundaries on this, so it does not become an excuse:

- **Narrow the measurement, not the claim.** Report what you actually verified. "The single
  savepoint test passes" is honest and useful; "tests pass" on the back of one test is a fabricated
  transcript (`gate-risk-classes.md` §3 item 4).
- **The full suite still runs at the boundary** — before the reviewer gate, before the commit, before
  the PR. Narrow measurements are for the *loop*; the broad one is for the *gate*.

**6. Dispatch a leg contract, not a milestone.** Plans stay thin and orchestrator-facing — that is
rule 1 of the plan doctrine and it is measurably working (W1→W2: cost/session −63%, severe context
ballooning 16.9%→3.8%). What a **mid-tier executor** (Sonnet-class, ICA, Codex) needs is not more
*plan* prose; it is a bounded **leg contract** composed at dispatch time. Handing a delegate a whole
milestone and handing it a leg contract are different acts, and only the second is in scope for one
dispatch.

Every delegated implementation leg carries all five fields. A leg dispatched without them is not a
thin plan being trusted, it is an unspecified leg:

| Field | What it says | Why |
|---|---|---|
| **File-ownership boundary** | the exact paths this leg may write; everything else is read-only | one boundary per leg — the scoping unit, see § "Leg scoping" rule 1 |
| **Interface names** | the real symbols to call or implement, verbatim from the tree | a paraphrased name is a name the executor will invent |
| **Endpoint / field names** | the real wire names — routes, request/response fields, env vars, CLI flags — verbatim | the measured W2 defect signature is an offline fake echoing the *wrong field name* |
| **Verification path** | *test through the path production takes, and name it* — the command or entry point that exercises it | see below; this is the load-bearing field |
| **Budget + exit** | the token/tool-use envelope and what to do on reaching it | prevents an unscoped multi-band leg from looking like diligence — sized per § "Leg scoping" rule 1 |

**The verification-path clause is the one that earns this rule.** The dominant W2 delegate failure
was not scope drift — zero AARs report a delegate building the wrong feature. It was a confident
executor delivering code that **passes its own green suite while the suite exercises a path
production never takes**: offline fakes with wrong field names, code paths reachable only from
tests, dry-runs that never check what `apply` later requires (8 bug findings in 6 days; five
instances in one program). So the clause names the real path *and* what does not count as evidence
for it. A green test against a fake is not a verification of the fake's subject.

> **State the escape, or you will get a confident guess.** The same corpus records *never a
> clarifying question and never an undershoot* — a mid-tier executor's failure mode is confident
> wrong delivery, not hesitation. So the contract must say what to do when it is insufficient:
> **if a name in this contract does not exist in the tree, stop and report it; do not substitute a
> nearby one.** Without that sentence the executor resolves the mismatch silently, which is exactly
> how a wrong field name reaches a passing test.

Composing the contract is a **render**, not plan mass — the same relationship as model-conditional
task expansion (`planning/references/plan-doctrine.md` § "Model-conditional expansion"): the
orchestrator derives it from the milestone AC plus the tree at dispatch time, and it is never
stored in the plan. Dispatch surfaces: `orchestration/batch-delegation.md` § "Task Delegation
Template", `orchestration/agent-assignments.md` § "Delegation Template".

## Leg scoping

Three standing rules, promoted here from the session notes of the run that violated all three
(adjudicated in `docs/project_plans/reports/workflow-v41-delegate-retro-2026-08-06.md` § Verdict
item 4; originating session notes: the `attention-contract-v1` run's implementation notes). That
run's M1 leg burned **535,601 tokens / 224 tool uses** across two rounds — an orchestration error,
not a model error. All three rules were already written down in a worknote only the session that
wrote it would ever read, which is the argument for them living here.

> **Corrected magnitude — and one withdrawn claim.** The session notes measured that burn against a
> **25–30k** target and called it *~20×*. The arithmetic is right; the comparison **crosses units**.
> The 25–30k it cites is `SKILL.md` § "Budget Targets" — "per execution phase (Tier 2/3)". Its
> sibling rows read as a **200K-window allocation** rather than cumulative spend: orchestration ~52K
> *baseline*, ~148K *available for work in 200K* (52 + 148 = 200), Tier 1 sprint ≤80K, and ~5 phases
> × ~30K ≈ that 148K of working room. ⚠️ **That reading is an inference, and it cannot currently be
> settled from this corpus:** `SKILL.md` § "Token Discipline" names `.claude/rules/context-budget.md`
> as authoritative for the figure and **that file does not exist**, while
> `modes/plan-execution.md` § "Token Discipline" calls the same number a per-phase-owner *token*
> budget. **The comparison fails under either reading** — a resident allocation and a cumulative
> multi-round total are not the same quantity; and if 25–30k really is cumulative, it contradicts
> `gate-risk-classes.md` §4's *measured* 355k implementer pass by ~12×, so it still cannot be the
> yardstick. Dividing 535,601 by
> it measures how many turns ran, not how far over budget anything went. (A second ~25–30k figure
> exists and is also not a per-leg spend budget: the cheap Sonnet-class **pre-gate security sweep**,
> `modes/plan-optimization.md` §6 — "a fixed first-pass default, not tuned". No per-leg spend budget
> existed here before these rules.) The missing authority and the two-file disagreement are filed as
> `node_01KZC46658QXCR7MGDRHC2P8PB`.
>
> The instrument for cumulative spend is `references/gate-risk-classes.md` §4: one Tier-3 implementer
> pass = **355k**, one fix cycle = **376–388k**. ⚠️ **The plan never declared an effort size for M1**
> (`docs/project_plans/implementation_plans/features/attention-contract-v1.md` carries `points: 31`
> and `context_class: C3`, no per-milestone `effort`), and §4's scaler keys on `effort` — so no band is
> strictly derivable and the figure below is a **reviewer estimate**, not a doctrine output. On the
> scope its originating session notes record (16 files, 87 tests, 4 API modules — not independently
> re-counted here) M1 sits at `l`–`xl`, which brackets the answer tightly
> enough to settle the question: implementer band 266k–355k → 535,601 is **~1.5–2.0×** the bare
> implementer line; implementation-plus-fix envelope 642k–743k → **~0.7–0.8×, inside the envelope
> either way**. Not ~20×. **The diagnosis survives the correction intact:** a whole C3 milestone
> scoped to one leg is a scoping failure whether or not the tokens overran — which is rule 1. That
> §4 could not be applied without an undeclared field is its own finding.
>
> **Withdrawn as unverifiable:** that § "The six execution rules" rule 4's 150% tripwire "already
> existed and was not applied". Rule 4 is denominated in **% context utilization**; this run's
> evidence and rule 2 below are in **absolute tokens**, and no conversion exists — `SKILL.md`'s
> Do-Not-Say table records that tripwire as executor-observed with no CCDash-fed enforcement, and the
> CCDash reading for the same program (leg-A: 291.2% utilization alongside `observedTokens` = 144.3M)
> does not divide out to any context window (144.3M ÷ 2.912 ≈ 49.6M), so that util% is not a
> session-tokens-over-window measure at all.
>
> **Four non-convertible burn units are now live across the doctrine** — and the axis that matters is
> *resident footprint vs cumulative spend vs ratio*: context class in **tokens-in, millions**
> (`planning/references/plan-doctrine.md` § "Context class"); per-pass **cumulative spend, hundreds of
> thousands** (`gate-risk-classes.md` §4, and rules 1–2 here); per-phase **tens of thousands**
> (`SKILL.md` § "Budget Targets" — *unit unsettled*, per the caveat above); and the tripwire in
> **% utilization** (rule 4).
> Reconciling them is tracked on `node_01KZC05ZRKJDB7R1FVT61WS2BH`. Until it lands: **never compare
> figures across those four without saying which unit you are in** — this section shipped that exact
> mistake once already.

**1. One leg = one file-ownership boundary**, budgeted as an **effort-scaled fraction of the 355k
implementer band** (`references/gate-risk-classes.md` §4, that section's own scaler: xs≈0.15×,
s≈0.3×, m≈0.5×, l≈0.75×, xl≈1×), **hard-capped by rule 2 at ~150k** (≈0.42× of the band). So a real
leg runs ~50k (xs) to ~150k, and **an effort size whose scaled band exceeds the cap — m and above —
is by construction more than one boundary: split it before dispatch, not after.** That cap is what
makes "split before dispatch" a numeric trigger rather than a judgment call, and it is why rules 1
and 2 compose instead of colliding: rule 1 sizes the leg inside the range, rule 2 is the ceiling at
the top of it. At the run's observed ~2.4k tokens per tool use (535,601 ÷ 224, n=1) the range implies
roughly **20–60 tool uses** — a sanity check on the token budget, not a second independent cap. The
M1 overrun was a whole C3 milestone — envelope model + choke point + run-health + AST scanner +
wiring across 4 API modules + 87 tests, 16 files — scoped to a single agent. An expensive lane is an
argument for a *smaller* leg, never for accepting a large one.

**2. Never continue a session past ~150k tokens.** Write the delta to a **packet file** and dispatch
fresh. This bounds rule 3's continue-don't-redispatch default, which assumes a small warm session;
past this point replay cost exceeds cache benefit — two resume-from-transcript continuations replayed
~400k tokens to deliver ~800 words of directives. A fix packet that is a *file* is picked up by a
fresh agent at ~15k and survives the session that wrote it; durable-artifact-over-conversation-state
is what kept that blast radius recoverable. Corollary: **a fix that is really a redesign gets a
fresh, freshly-scoped dispatch** — not a continuation.

**3. Batch every gate lens before dispatching a fix.** No addenda to an in-flight fix session.
Dispatching a fix while a third lens is still running cost ~400k tokens of replay for findings that
were ~20 minutes away. Wait for the full lens set, then compose one packet.

## Implementation notes over halt-and-gate

Executors **log and keep going**. A deviation — a conservative choice, an assumption, a
discovered constraint — goes into the run's implementation-notes file with its rationale, and is
reviewed at the **milestone boundary**.

The distinction is **deviation vs blocker**, not "how bad does it feel". A deviation is a choice
you made and could defend — log it and continue. A blocker is work that cannot correctly proceed.
Blockers still stop, and always did: a failing test on the current work, an unsatisfiable declared
artifact, an exhausted recovery path. Those are not exceptions to this rule; they are simply not
deviations.

Beyond blockers, mid-milestone halts are reserved for three cases:

1. a **destructive** action (deletion, force-push, migration, secret rotation),
2. a **real scope change** (the work is not what the plan describes), or
3. **input only the operator has**.

Everything else is a note, not a stop. Mode-D boundaries are unchanged and non-negotiable: auth,
payments, billing, schema migrations, data deletion, secret rotation, infrastructure.

## Frequency, composition, not existence

Reviewer gates **stay**. What shrinks is how often they fire, how much they carry, and **how many
lenses each one runs**. Nothing in this doctrine authorizes dropping a phase's only security lens —
that is a scope cut disguised as gate optimization, and it remains prohibited
(`references/gate-risk-classes.md`). Validator and review re-runs are scoped to reviewers whose
governed surface actually changed; there is no unconditional exact-tree re-review at every boundary.

**The default is one adversarial lens.** A second is added only when the phase matches one of three
named triggers — the surface parses untrusted input, it is an authorization/identity boundary, or its
effect is irreversible or leaves the system (`gate-risk-classes.md` §2, step 2). Most work — CRUD, UI,
reporting, read paths — is *implement → tests → one review → ship*: no pre-gate, no second lens, no
per-phase karen. Where a pre-gate does run, it runs only ahead of a security lens, which means only
on a triggered phase; it is the cheap-first rung of the second lens, never an extra step on the
one-lens path.

Running two lenses on an untriggered phase is not caution — it is, in the grounding retro's words,
"one lens's worth of defect-finding at two lenses' cost."

## Bookkeeping demotions

Per-hop bookkeeping was measured as pure overhead at task granularity and real value at milestone
granularity:

| Bookkeeping | Was | Now |
|---|---|---|
| IntentTree lookup/claim/sync 3-step | every task start | **once per milestone** |
| Delivery-dossier regeneration | every phase boundary + every wave | **end of plan** |
| Plan-level completion report | written at plan close | **retired** — the reviewer verdict + `commit_refs` is the record |
| Phase Summary prose table | mandatory in every plan | **deleted** (duplicated the wave plan) |
| `orchestrator_model` frontmatter | plan + per-phase | **deleted** (advisory, never read; the loop cannot switch its own model mid-run) |

Everything else in the DoD stays: worktree -> PR -> squash, AOS writeback gates, SkillMeat
registration, ephemeral teardown, changelog discipline.

## Terminology

**Plan milestone** = a reviewable state of the system, the coarse unit *above* phases, as
authored by the plan doctrine. Older text in this skill uses "milestone" for a batch boundary
inside a phase; where both senses could be read, write **plan milestone** for the new one.
