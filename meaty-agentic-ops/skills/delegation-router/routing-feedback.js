/**
 * routing-feedback.js — empirical routing feedback: merge (§2.2) + discrete actuation (§2.4).
 *
 * DI-1, the consumer half of the CCDash proof→routing loop. Authoritative design:
 *   CCDash/docs/project_plans/design-specs/routing-feedback-router-merge-handoff.md
 *   §2.2 (merge math, ratified) + §2.4 ADR Option (C) (landing surface, ratified 2026-08-03).
 *
 * THE SHAPE, IN ONE PARAGRAPH. CCDash is evidence-only: it emits per-(skill × model) rows with
 * success_rate / cost_index / regression_rate. This module aggregates each row into a single
 * scalar `combined_signal` (§2.2 step 2, verbatim — weights 0.5/0.3/0.2, regression half-weight
 * 0.5, D9c cost clamp, confidence threshold 0.7) and then uses that scalar ONLY as a trigger for
 * a bounded DISCRETE DEMOTION: a routing_policy chain entry may move at most one position later,
 * and may never be promoted. There is no continuous score in the resolver to apply a delta to
 * (§2.4.2, source-verified), so §2.2's `score_delta` is retired as an applied value and survives
 * only as evidence.
 *
 * WHAT IS RETIRED and deliberately absent from this file (§2.4.7):
 *   - `max_adjustment_cap = -0.15` as a MAGNITUDE. |0.15| is re-purposed as the demotion
 *     threshold θ only.
 *   - the `max(-combined_signal, cap)` clamp (D9b). `combined_signal` is positive-for-bad, so we
 *     compare `combined_signal >= θ` directly. The D9b *lesson* (sign convention) is preserved by
 *     that comparison direction; the clamp itself goes away with the magnitude.
 *   - the `score_delta` RoutingRecord field, replaced by `rank_displacement`.
 *   - the -0.150 cap-bound worked example. Its replacement: combined_signal 0.750 >= θ 0.15 →
 *     demote 1 position.
 *
 * PRECEDENCE IS STRUCTURAL, NOT CONVENTIONAL (§2.4.5.1). This module reads and writes a DEDICATED
 * machine-owned state file and NEVER `routing.local.toml`:
 *   MUST-stay (absolute) > routing.local.toml (human) > routing-feedback state (machine) > registry
 * Two writers on one field with no discriminator is precisely what makes "human override wins"
 * unenforceable, so the channels are physically separate and the human channel wins by class.
 *
 * NO MODEL CALL, NO NETWORK, NO SHELL. Pure functions plus one JSON read/write.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadRoutingFeedbackContract,
  validateFeedbackJoin,
} = require('./task-class-vocabulary.js');
const {
  canonicalizeEntry,
  canonicalizeEntryString,
} = require('./entry-key.js');

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * §2.2 merge parameters. These SURVIVE the §2.4 ADR unchanged — they aggregate evidence into
 * `combined_signal`, which is still computed verbatim. Do not "modernize" them here; they are
 * ratified (D9) and each is covered by a test.
 *
 * @readonly
 */
const MERGE_PARAMS = Object.freeze({
  weight_failure: 0.5,
  weight_cost: 0.3,
  weight_regression: 0.2,
  regression_half_weight: 0.5,
  confidence_threshold: 0.7,
});

/**
 * §2.4.6 discrete guardrails — the re-ratification of SPEC invariant 10's continuous vocabulary.
 * A magnitude cap is meaningless when there is exactly one available action, so boundedness comes
 * from displacement limits and hysteresis instead.
 *
 *   theta (θ)          demotion trigger. 0.15 is the §2.2 SATURATION point, not its sensitivity
 *                      point (§2.2 triggered at 0.01): a full rank displacement is a full-strength
 *                      action, so it must fire where the old design saturated.
 *   theta_restore      anti-flap band (≈ θ/2). Below this, an existing demotion is lifted.
 *   max_rank_displacement  1 position. Demotion-only; promotion is forbidden.
 *   ttl_windows        an override expires if the next window does not re-confirm it.
 *
 * @readonly
 */
const ACTUATION_PARAMS = Object.freeze({
  theta: 0.15,
  theta_restore: 0.08,
  max_rank_displacement: 1,
  ttl_windows: 1,
});

const FEEDBACK_SOURCE = 'ccdash-routing-feedback-v1.0.0';
const STATE_SCHEMA_VERSION = 1;
const DEFAULT_WINDOW_SECONDS = 7 * 24 * 60 * 60;  // used only when a row carries no window bounds

/**
 * The machine-owned state file. NEVER routing.local.toml (§2.4.5.1) — that file is the
 * human channel, and a shared field with two writers cannot express "human wins".
 */
const DEFAULT_STATE_PATH = path.join(os.homedir(), '.claude', 'state', 'routing-feedback-overrides.json');

// ---------------------------------------------------------------------------
// Feature disable (instant, §2.4.6 / SPEC invariant 10)
// ---------------------------------------------------------------------------

const FALSY = new Set(['0', 'false', 'no', 'off']);

/**
 * Is empirical feedback allowed to change a routing decision right now?
 *
 * Two independent kill switches, both of which must pass:
 *   1. the pinned contract's `live_consumption` must be exactly 'enabled' (the reviewed,
 *      committed gate — same field validateFeedbackJoin() enforces);
 *   2. `AOS_ROUTING_FEEDBACK` must not be an explicit falsy value (the instant operator
 *      kill switch — no commit, no deploy, takes effect on the next resolve).
 *
 * Default-deny is the point: with no state file, no contract flip, and no env var, this returns
 * false and the resolver behaves exactly as it does today.
 *
 * @param {Object} [opts]
 * @param {Object} [opts.contract]  injected contract (tests); defaults to the pinned file
 * @param {Object} [opts.env]       injected environment (tests); defaults to process.env
 * @returns {{enabled: boolean, reason: string}}
 */
function isFeedbackConsumptionEnabled(opts = {}) {
  const env = opts.env || process.env;
  const raw = env.AOS_ROUTING_FEEDBACK;
  if (raw !== undefined && FALSY.has(String(raw).trim().toLowerCase())) {
    return { enabled: false, reason: 'env_disabled' };
  }

  let contract = opts.contract;
  if (!contract) {
    try {
      contract = loadRoutingFeedbackContract();
    } catch (e) {
      return { enabled: false, reason: 'contract_unreadable' };
    }
  }
  if (!contract || contract.live_consumption !== 'enabled') {
    return { enabled: false, reason: 'live_consumption_disabled' };
  }
  return { enabled: true, reason: 'enabled' };
}

// ---------------------------------------------------------------------------
// §2.2 step 2 — combined_signal (computed verbatim)
// ---------------------------------------------------------------------------

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Aggregate one CCDash row into `combined_signal` per §2.2 step 2, verbatim.
 *
 *   penalty_for_failure    = 1.0 - success_rate
 *   penalty_for_cost       = max(cost_index - 1.0, 0.0)     // D9c: cheapness earns no bonus
 *   penalty_for_regression = regression_rate * 0.5          // half weight
 *   combined_signal        = failure*0.5 + cost*0.3 + regression*0.2
 *
 * `combined_signal >= 0` always; larger = worse.
 *
 * NULL TERMS CONTRIBUTE 0 AND THE WEIGHTS ARE **NOT** RE-NORMALIZED. This is load-bearing, not an
 * oversight. As of 2026-08-03 `success_rate` is null until DI-4e ships and `regression_rate` is
 * *permanently* null (no signal exists — test_results/test_runs are 0 rows, no retry linkage), so
 * a merge running today is cost-only: 1 of 3 terms live, carrying weight 0.3. Re-normalizing to
 * make the surviving term sum to 1.0 would silently promote a 0.3-weight cost signal to full
 * strength and make a cost-only merge FAR more aggressive than the ratified design — the opposite
 * of bounded. A missing term means "no evidence", not "evidence of nothing".
 *
 * Note also that a null `success_rate` must never be coerced to 0: that reads as a 100% failure
 * rate (penalty 1.0) and would demote every route with no data.
 *
 * @param {Object} row  a RoutingFeedbackKeyDTO row
 * @param {Object} [opts]
 * @param {number} [opts.min_cost_coverage=0]  when > 0, the cost term is dropped for rows whose
 *   `cost_coverage_fraction` is below it. DEFAULT-OFF so §2.2 stays verbatim; available because
 *   DI-4c (CCDash schema v47) now persists real per-key coverage, so a cost_index derived from a
 *   thin covered subset can finally be discounted rather than trusted.
 * @returns {{combined_signal: number, terms: Object, terms_live: string[]}}
 */
function computeCombinedSignal(row, opts = {}) {
  const p = MERGE_PARAMS;
  const minCoverage = isFiniteNumber(opts.min_cost_coverage) ? opts.min_cost_coverage : 0;

  const terms = { failure: 0, cost: 0, regression: 0 };
  const termsLive = [];

  if (isFiniteNumber(row.success_rate)) {
    terms.failure = 1.0 - row.success_rate;
    termsLive.push('failure');
  }

  if (isFiniteNumber(row.cost_index)) {
    const coverage = row.cost_coverage_fraction;
    const coverageOk = minCoverage <= 0 || (isFiniteNumber(coverage) && coverage >= minCoverage);
    if (coverageOk) {
      terms.cost = Math.max(row.cost_index - 1.0, 0.0);  // D9c clamp
      termsLive.push('cost');
    }
  }

  if (isFiniteNumber(row.regression_rate)) {
    terms.regression = row.regression_rate * p.regression_half_weight;
    termsLive.push('regression');
  }

  const combined_signal =
    (terms.failure * p.weight_failure) +
    (terms.cost * p.weight_cost) +
    (terms.regression * p.weight_regression);

  return { combined_signal, terms, terms_live: termsLive };
}

// ---------------------------------------------------------------------------
// Per-row evaluation (eligibility + join + hysteresis)
// ---------------------------------------------------------------------------

/**
 * Build the fail-closed join payload for one row from the envelope's identity fields.
 * CCDash carries contract/taxonomy/mapping identity on the ENVELOPE, not per row, so the two
 * are recombined here — this is the only place a row becomes a join candidate.
 */
function joinPayloadFor(envelope, row) {
  return {
    producer: envelope.producer,
    contract_id: envelope.contract_id,
    contract_version: envelope.contract_version,
    taxonomy_id: envelope.taxonomy_id,
    taxonomy_version: envelope.taxonomy_version,
    taxonomy_digest: envelope.taxonomy_digest,
    mapping_id: envelope.mapping_id,
    mapping_version: envelope.mapping_version,
    mapping_digest: envelope.mapping_digest,
    source_skill_name: row.source_skill_name,
    task_class: row.task_class,
  };
}

/**
 * Evaluate one row into a discrete decision.
 *
 * Order matters: the join is validated BEFORE any arithmetic, so an unknown / aliased /
 * digest-mismatched / telemetry-only / MUST-stay key can never contribute a signal even
 * accidentally (SPEC invariant 9 + 11 — "resolver fallback behavior must never be used as join
 * validation", so raw `source_skill_name` is never passed to resolve()).
 *
 * @param {Object} row       RoutingFeedbackKeyDTO row
 * @param {Object} envelope  envelope identity fields (see joinPayloadFor)
 * @param {Object} [opts]
 * @param {boolean} [opts.wasDemoted=false]  prior state for this key (drives hysteresis)
 * @param {number}  [opts.theta]
 * @param {number}  [opts.theta_restore]
 * @param {number}  [opts.min_cost_coverage]
 * @param {Function} [opts.validateJoin]  injectable (tests)
 * @returns {Object} decision
 */
function evaluateRow(row, envelope, opts = {}) {
  const theta = isFiniteNumber(opts.theta) ? opts.theta : ACTUATION_PARAMS.theta;
  const thetaRestore = isFiniteNumber(opts.theta_restore) ? opts.theta_restore : ACTUATION_PARAMS.theta_restore;
  const validateJoin = opts.validateJoin || validateFeedbackJoin;
  const wasDemoted = Boolean(opts.wasDemoted);

  const base = {
    task_class: row.task_class,
    model: row.model,
    provider: row.provider,
    source_skill_name: row.source_skill_name,
    combined_signal: null,
    evidence: null,
    action: 'skip',
    reason: '',
  };

  // --- Join discipline (fail closed) ---------------------------------------
  const join = validateJoin(joinPayloadFor(envelope, row));
  if (!join.join_valid) {
    return { ...base, reason: `join_rejected:${join.reason}` };
  }
  // join_valid but !accepted means the ONLY thing standing in the way is the
  // live_consumption gate. We still evaluate, so the state file can be produced and
  // inspected in dry-run before the flip — but mergeFeedback marks it not-applied.
  base.task_class = join.canonical_task_class || row.task_class;

  // --- Minimum-sample defense-in-depth (producer-side flag, re-checked here) ---
  if (row.eligible_for_adjustment !== true) {
    return { ...base, reason: 'not_eligible_for_adjustment' };
  }
  if (!isFiniteNumber(row.confidence) || row.confidence < MERGE_PARAMS.confidence_threshold) {
    return { ...base, reason: 'low_confidence' };
  }

  // --- §2.2 step 2 ---------------------------------------------------------
  const { combined_signal, terms, terms_live } = computeCombinedSignal(row, opts);
  const evidence = {
    success_rate: isFiniteNumber(row.success_rate) ? row.success_rate : null,
    cost_index: isFiniteNumber(row.cost_index) ? row.cost_index : null,
    cost_coverage_fraction: isFiniteNumber(row.cost_coverage_fraction) ? row.cost_coverage_fraction : null,
    regression_rate: isFiniteNumber(row.regression_rate) ? row.regression_rate : null,
    sample_count: isFiniteNumber(row.sample_count) ? row.sample_count : null,
    confidence: row.confidence,
    terms,
    terms_live,
    window_start: row.window_start || null,
    window_end: row.window_end || null,
  };
  const withSignal = { ...base, combined_signal, evidence };

  // A row where every term is null has combined_signal 0.0, which is numerically
  // indistinguishable from "measured, and fine". It must never actuate in either direction —
  // absence of evidence is not evidence of health, and restoring on it would silently lift a
  // demotion the moment a producer field regresses to null.
  if (terms_live.length === 0) {
    return { ...withSignal, reason: 'no_live_terms' };
  }

  // --- §2.4.6 hysteresis ---------------------------------------------------
  if (combined_signal >= theta) {
    return { ...withSignal, action: 'demote', reason: `combined_signal ${combined_signal.toFixed(4)} >= theta ${theta}` };
  }
  if (wasDemoted && combined_signal < thetaRestore) {
    return { ...withSignal, action: 'restore', reason: `combined_signal ${combined_signal.toFixed(4)} < theta_restore ${thetaRestore}` };
  }
  if (wasDemoted) {
    return { ...withSignal, action: 'hold', reason: `combined_signal ${combined_signal.toFixed(4)} in anti-flap band [${thetaRestore}, ${theta})` };
  }
  return { ...withSignal, action: 'neutral', reason: `combined_signal ${combined_signal.toFixed(4)} < theta ${theta}` };
}

// ---------------------------------------------------------------------------
// Merge — rows + prior state → next state
// ---------------------------------------------------------------------------

/**
 * Deliberately the RAW producer-reported "provider/model" join — NOT canonicalized here.
 *
 * The value returned is what gets persisted into the machine-owned state file
 * (`overrides[taskClass].demotions[].entry`), so keeping it raw preserves exactly what the
 * producer reported for audit/debugging. Canonicalization (case-fold provider, resolve model
 * to its registry alias via entry-key.js) happens at COMPARISON time in `applyChainFeedback`,
 * which has access to both sides of the join (this entry AND the registry chain entries, which
 * are themselves per-provider model ids — e.g. `ica/claude-sonnet-4-6[1m]` — not bare aliases)
 * and can therefore report a precise `unknown_provider` / `unknown_model` / `entry_not_in_chain`
 * reason (DI-1 §4) instead of this function silently baking in a guess.
 */
function chainEntryKey(row) {
  return `${row.provider}/${row.model}`;
}

function isoPlusSeconds(nowMs, seconds) {
  return new Date(nowMs + (seconds * 1000)).toISOString();
}

/**
 * Derive the TTL expiry for an override from the row's own window length (§2.4.6: "expires if not
 * re-confirmed by the next window"). Falls back to a 7-day window when the row carries no bounds,
 * so a malformed row expires rather than persisting forever.
 */
function expiryFor(row, nowMs, ttlWindows) {
  let windowSeconds = DEFAULT_WINDOW_SECONDS;
  const start = row.window_start ? Date.parse(row.window_start) : NaN;
  const end = row.window_end ? Date.parse(row.window_end) : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    windowSeconds = (end - start) / 1000;
  }
  return isoPlusSeconds(nowMs, windowSeconds * ttlWindows);
}

/**
 * Merge a CCDash rollup into the machine-owned override state.
 *
 * This is the "merge" half of DI-1 and is intentionally SEPARATE from actuation: it can be run,
 * inspected, and diffed while `live_consumption` is still disabled. When consumption is disabled
 * the returned state is marked `applied: false` — it is a dry run, and the resolver will not read
 * it (isFeedbackConsumptionEnabled() gates the read path independently).
 *
 * @param {Object} args
 * @param {Object} args.envelope    envelope identity fields + optional window bounds
 * @param {Object[]} args.rows      RoutingFeedbackKeyDTO rows
 * @param {Object} [args.priorState] previously persisted state (for hysteresis + TTL refresh)
 * @param {number} [args.now]        epoch ms (injectable; defaults to Date.now())
 * @param {Object} [args.opts]       theta / theta_restore / ttl_windows / min_cost_coverage / env / contract
 * @param {Object<string, string[]>} [args.opts.chains]  opt-in task_class → routing_policy chain
 *   topology for decision-report immunity annotations. Absent means byte-for-byte legacy reports.
 * @param {Set<string>|string[]} [args.opts.must_stay]  opt-in MUST-stay classes for those annotations
 * @returns {{state: Object, decisions: Object[], applied: boolean, gate_reason: string}}
 */
function mergeFeedback(args) {
  const { envelope, rows } = args;
  const opts = args.opts || {};
  const nowMs = isFiniteNumber(args.now) ? args.now : Date.now();
  const ttlWindows = isFiniteNumber(opts.ttl_windows) ? opts.ttl_windows : ACTUATION_PARAMS.ttl_windows;
  // This report annotation is strictly opt-in: callers that do not pass topology retain the exact
  // decision and state-file shapes they had before DI-1 immunity reporting was introduced.
  const reportImmunity = opts.chains !== undefined;
  const chains = opts.chains && typeof opts.chains === 'object' ? opts.chains : {};
  const mustStay = opts.must_stay instanceof Set
    ? opts.must_stay
    : new Set(Array.isArray(opts.must_stay) ? opts.must_stay : []);
  const immunityFor = (taskClass) => classifyImmunity({
    taskClass,
    chain: chains[taskClass],
    isMustStay: mustStay.has(taskClass),
  });

  const prior = normalizeState(args.priorState);
  const priorDemoted = new Set();
  for (const [taskClass, cls] of Object.entries(prior.overrides)) {
    for (const d of cls.demotions) priorDemoted.add(`${taskClass}::${d.entry}`);
  }

  const overrides = {};
  const decisions = [];

  for (const row of (rows || [])) {
    const entry = chainEntryKey(row);
    const decision = evaluateRow(row, envelope, {
      ...opts,
      wasDemoted: priorDemoted.has(`${row.task_class}::${entry}`),
    });
    const reportedDecision = { ...decision, entry };
    if (reportImmunity) reportedDecision.immunity = immunityFor(decision.task_class);
    decisions.push(reportedDecision);

    if (decision.action !== 'demote' && decision.action !== 'hold') continue;

    const taskClass = decision.task_class;
    if (!overrides[taskClass]) {
      overrides[taskClass] = { demotions: [] };
      if (reportImmunity) overrides[taskClass].immunity = immunityFor(taskClass);
    }
    overrides[taskClass].demotions.push({
      entry,
      combined_signal: decision.combined_signal,
      evidence: decision.evidence,
      action: decision.action,
      confirmed_at: new Date(nowMs).toISOString(),
      expires_at: expiryFor(row, nowMs, ttlWindows),
      source: FEEDBACK_SOURCE,
    });
  }

  const gate = isFeedbackConsumptionEnabled(opts);

  return {
    state: {
      schema_version: STATE_SCHEMA_VERSION,
      source: FEEDBACK_SOURCE,
      generated_at: new Date(nowMs).toISOString(),
      params: { ...MERGE_PARAMS, ...ACTUATION_PARAMS },
      overrides,
    },
    decisions,
    applied: gate.enabled,
    gate_reason: gate.reason,
  };
}

// ---------------------------------------------------------------------------
// State I/O
// ---------------------------------------------------------------------------

function normalizeState(raw) {
  const out = { schema_version: STATE_SCHEMA_VERSION, overrides: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const overrides = raw.overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return out;
  for (const [taskClass, cls] of Object.entries(overrides)) {
    if (!cls || typeof cls !== 'object') continue;
    const demotions = Array.isArray(cls.demotions) ? cls.demotions : [];
    out.overrides[taskClass] = {
      demotions: demotions.filter(d => d && typeof d.entry === 'string' && d.entry),
    };
  }
  return out;
}

/**
 * Read the machine-owned override state, dropping TTL-expired entries.
 *
 * Fail-safe by construction: a missing file, unreadable file, malformed JSON, or unknown schema
 * version all degrade to "no overrides" rather than breaking routing. A feedback channel that can
 * take down the router is worse than no feedback channel.
 *
 * @param {Object} [opts]
 * @param {string} [opts.statePath]  defaults to ~/.claude/state/routing-feedback-overrides.json
 * @param {number} [opts.now]        epoch ms (injectable)
 * @returns {{overrides: Object, expired: number, load_reason: string}}
 */
function loadFeedbackState(opts = {}) {
  const statePath = opts.statePath || (opts.env && opts.env.AOS_ROUTING_FEEDBACK_STATE) || DEFAULT_STATE_PATH;
  const nowMs = isFiniteNumber(opts.now) ? opts.now : Date.now();

  let raw;
  try {
    if (!fs.existsSync(statePath)) return { overrides: {}, expired: 0, load_reason: 'absent' };
    raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (e) {
    console.warn(`[delegation-router] failed to read routing-feedback state ${statePath}; ignoring: ${e.message}`);
    return { overrides: {}, expired: 0, load_reason: 'unreadable' };
  }
  if (raw && raw.schema_version !== undefined && raw.schema_version !== STATE_SCHEMA_VERSION) {
    console.warn(
      `[delegation-router] routing-feedback state schema_version ${raw.schema_version} != ` +
      `${STATE_SCHEMA_VERSION}; ignoring (forward-compatible degrade).`
    );
    return { overrides: {}, expired: 0, load_reason: 'schema_mismatch' };
  }

  const normalized = normalizeState(raw);
  const overrides = {};
  let expired = 0;
  for (const [taskClass, cls] of Object.entries(normalized.overrides)) {
    const live = cls.demotions.filter(d => {
      if (!d.expires_at) return true;  // no TTL recorded → treat as live; the writer owns expiry
      const exp = Date.parse(d.expires_at);
      if (!Number.isFinite(exp)) return true;
      if (exp <= nowMs) { expired++; return false; }
      return true;
    });
    if (live.length > 0) overrides[taskClass] = { demotions: live };
  }
  return { overrides, expired, load_reason: 'loaded' };
}

/**
 * Persist the machine-owned override state. Creates the parent directory when absent.
 * Deliberately NOT called by the resolver — the resolve path is read-only.
 */
function writeFeedbackState(state, opts = {}) {
  const statePath = opts.statePath || DEFAULT_STATE_PATH;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

// ---------------------------------------------------------------------------
// Human-override precedence (§2.4.5.1)
// ---------------------------------------------------------------------------

/**
 * Derive which routing targets the HUMAN has spoken for in routing.local.toml.
 *
 * Machine feedback must not reorder a class the operator has explicitly pinned, and must not
 * displace an instance whose rank the operator has explicitly set. Because the two channels are
 * separate files, "human wins" is decidable here rather than being a convention nobody can
 * enforce: if the class or entry appears below, the machine simply does not act on it.
 *
 * @param {Object|null} overrides  parsed routing.local.toml
 * @returns {{classes: Set<string>, entries: Set<string>}}
 */
function humanOverriddenTargets(overrides) {
  const classes = new Set();
  const entries = new Set();
  if (!overrides || typeof overrides !== 'object') return { classes, entries };

  const policy = overrides.routing_policy_overrides;
  if (policy && typeof policy === 'object') {
    for (const k of Object.keys(policy)) {
      const bare = String(k).replace(/^["']|["']$/g, '');
      classes.add(bare);
      classes.add(bare.replace(/-/g, '_'));
      classes.add(bare.replace(/_/g, '-'));
    }
  }
  const priorities = overrides.priority_overrides;
  if (priorities && typeof priorities === 'object') {
    for (const k of Object.keys(priorities)) {
      entries.add(String(k).replace(/^["']|["']$/g, ''));
    }
  }
  return { classes, entries };
}

// ---------------------------------------------------------------------------
// Actuation — the pure (chain, feedback) → chain' reorder
// ---------------------------------------------------------------------------

/**
 * Demotion-only, one-position, order-preserving reorder.
 *
 * Guarantees, each covered by a test:
 *   - DEMOTION-ONLY: a non-demoted entry is never moved later than it already was. It can be
 *     promoted only as the mirror of a demotion (the swap partner), never on its own evidence.
 *   - MAX 1 POSITION: each demoted entry is displaced at most once per application.
 *   - NEVER EMPTY / LAST-CANDIDATE FLOOR: this is a permutation, so no candidate is ever removed
 *     and length is invariant. A single-entry chain is a hard no-op.
 *   - NO PEER PROMOTION: a demoted entry is not swapped past another demoted entry — moving a bad
 *     candidate ahead of an equally-bad one is churn with no evidentiary basis.
 *
 * @param {string[]} chain            routing_policy chain, "provider/model_id" entries
 * @param {Iterable<string>} demoted  entries flagged for demotion — keyed the same way `keyFn`
 *   keys the chain (i.e. if `keyFn` canonicalizes, `demoted` must hold canonical keys too)
 * @param {(entry: string) => string} [keyFn]  maps a chain entry to the key compared against
 *   `demoted`. Defaults to identity, which preserves this function's original raw-string
 *   signature/behavior exactly. DI-1 callers pass a canonicalizing keyFn (entry-key.js) so a
 *   chain entry like `ica/claude-sonnet-4-6[1m]` (a per-provider model id, not an alias) can
 *   still be recognized as a match — but the returned `chain`/`displacements[].entry` values
 *   are always the ORIGINAL, uncanonicalized chain strings; only the comparison is keyed.
 * @returns {{chain: string[], displacements: Array<{entry: string, from: number, to: number}>}}
 */
function demoteChain(chain, demoted, keyFn) {
  const key = typeof keyFn === 'function' ? keyFn : (entry) => entry;
  const result = Array.isArray(chain) ? chain.slice() : [];
  const displacements = [];
  if (result.length <= 1) return { chain: result, displacements };  // last-candidate floor

  const flagged = demoted instanceof Set ? demoted : new Set(demoted || []);
  const moved = new Set();

  for (let i = 0; i < result.length - 1; i++) {
    const entry = result[i];
    const entryKey = key(entry);
    if (!flagged.has(entryKey)) continue;
    if (moved.has(entryKey)) continue;         // max_rank_displacement = 1
    const next = result[i + 1];
    const nextKey = key(next);
    if (flagged.has(nextKey)) continue;        // never promote a demoted peer
    result[i] = next;
    result[i + 1] = entry;
    moved.add(entryKey);
    displacements.push({ entry, from: i, to: i + 1 });
  }

  return { chain: result, displacements };
}

/**
 * Classify structural immunity before feedback is allowed to consider a chain reorder.
 *
 * A MUST-stay classification always wins: its protection is intentional policy, whereas a
 * single-entry chain is an immutable consequence of there being no candidate to swap with.
 *
 * @param {Object} args
 * @param {string} args.taskClass
 * @param {string[]} args.chain
 * @param {boolean} args.isMustStay
 * @returns {{immune: boolean, kind: 'must_stay'|'single_entry_chain'|null, permanent: boolean, detail: string}}
 */
function classifyImmunity({ taskClass, chain, isMustStay }) {
  if (isMustStay) {
    return {
      immune: true,
      kind: 'must_stay',
      permanent: true,
      detail: `${taskClass} is MUST-stay primary and cannot be changed by empirical feedback.`,
    };
  }
  if (!Array.isArray(chain) || chain.length <= 1) {
    return {
      immune: true,
      kind: 'single_entry_chain',
      permanent: true,
      detail: 'This single-entry chain is immune by construction: no peer exists to receive a demotion.',
    };
  }
  return { immune: false, kind: null, permanent: false, detail: '' };
}

/**
 * Filter state-file demotions against the current chain and human entry overrides.
 *
 * Kept in one place so suppressed single-entry signals and live multi-entry actuation use exactly
 * the same eligibility rules.
 *
 * @param {Object[]} demotions
 * @param {string[]} chain
 * @param {Set<string>} humanEntries
 * @returns {{eligible: Map<string, Object>, skipped: Array<{entry: string, reason: string}>}}
 */
function eligibleDemotions(demotions, chain, humanEntries) {
  const skipped = [];
  const eligible = new Map();
  for (const d of demotions) {
    if (humanEntries.has(d.entry)) {
      skipped.push({ entry: d.entry, reason: 'human_override_precedence' });
      continue;
    }
    if (!chain.includes(d.entry)) {
      skipped.push({ entry: d.entry, reason: 'entry_not_in_chain' });
      continue;
    }
    eligible.set(d.entry, d);
  }
  return { eligible, skipped };
}

/**
 * Apply feedback to one task_class's routing_policy chain. This is the new resolver stage — a pure
 * function inserted before the position-based chain walk, leaving the three-stage structure intact.
 *
 * Returns the ORIGINAL chain unchanged (and `applied: false`) whenever anything is off: feedback
 * disabled, MUST-stay class, human-pinned class, no state for the class, or nothing to move.
 *
 * @param {Object} args
 * @param {string} args.taskClass
 * @param {string[]} args.chain
 * @param {Object} [args.feedbackOverrides]  loadFeedbackState().overrides
 * @param {{classes: Set, entries: Set}} [args.humanTargets]
 * @param {boolean} [args.isMustStay=false]
 * @param {Object} [args.registry]  injectable model registry for entry-key.js canonicalization
 *   (DI-1 §1); defaults to entry-key.js's own file-loaded registry when omitted. Tests should
 *   always inject this so the join stays offline/deterministic.
 * @returns {{chain: string[], applied: boolean, reason: string, displacements: Array, skipped: Array, immunity: Object, suppressed_demotions: Array}}
 */
function applyChainFeedback(args) {
  const chain = Array.isArray(args.chain) ? args.chain : [];
  const overrides = args.feedbackOverrides || {};
  const human = args.humanTargets || { classes: new Set(), entries: new Set() };
  const immunity = classifyImmunity({ taskClass: args.taskClass, chain, isMustStay: args.isMustStay });
  const noop = (reason, extra = {}) => ({
    chain,
    applied: false,
    reason,
    displacements: [],
    skipped: [],
    immunity,
    suppressed_demotions: [],
    ...extra,
  });

  if (immunity.kind === 'must_stay') return noop('must_stay_immune');
  if (human.classes.has(args.taskClass)) return noop('human_override_precedence');

  const cls = overrides[args.taskClass]
    || overrides[String(args.taskClass).replace(/-/g, '_')]
    || overrides[String(args.taskClass).replace(/_/g, '-')];
  if (!cls || !Array.isArray(cls.demotions) || cls.demotions.length === 0) {
    return noop('no_feedback_for_class');
  }

  // Canonicalize once per chain entry — resolves a per-provider model id (e.g.
  // `ica/claude-sonnet-4-6[1m]`), which is NOT itself a registry alias, to its canonical
  // `provider/alias` key. A chain entry that fails to canonicalize (should not happen for a
  // registry-sourced chain, but the registry could drift) falls back to its own raw string as
  // the key — it simply cannot collide with a real canonical key, so it just never matches.
  const registry = args.registry;
  const keyFn = (entry) => {
    const res = canonicalizeEntryString(entry, registry);
    return res.ok ? res.key : entry;
  };
  const chainKeys = chain.map(keyFn);

  // Adversarial-review DEFECT 3 fix: a canonical-key COLLISION inside the chain itself (e.g.
  // two entries that differ only by provider case, or a per-provider model id alongside its own
  // alias) breaks the Set-based membership check downstream — demoteChain only swaps the FIRST
  // matching position, so a duplicate canonical key would demote/promote inconsistently. A
  // well-formed routing_policy chain never lists the same provider/model twice, so this is a
  // malformed-input guard, not a real routing scenario: refuse to actuate the whole class rather
  // than mis-actuate on an ambiguous chain.
  const keyCounts = new Map();
  for (const k of chainKeys) keyCounts.set(k, (keyCounts.get(k) || 0) + 1);
  if ([...keyCounts.values()].some(count => count > 1)) {
    return { chain, applied: false, reason: 'ambiguous_chain', displacements: [], skipped: [], immunity, suppressed_demotions: [] };
  }

  const chainCanonicalKeys = new Set(chainKeys);

  // Entries the human has ranked by hand are immune individually, not just class-wide.
  const skipped = [];
  const demotionByCanonicalKey = new Map();
  for (const d of cls.demotions) {
    if (human.entries.has(d.entry)) {
      skipped.push({ entry: d.entry, reason: 'human_override_precedence' });
      continue;
    }
    // Canonicalize the DEMOTION side (provider case-fold, model → registry alias, resolving
    // through observed_ids for dated/versioned slugs). Fails closed with a distinct reason —
    // never a silent non-match, never a guessed coercion (DI-1 §1).
    const canon = canonicalizeEntryString(d.entry, registry);
    if (!canon.ok) {
      skipped.push({ entry: d.entry, reason: canon.reason });
      continue;
    }
    if (!chainCanonicalKeys.has(canon.key)) {
      // A genuine post-canonicalization miss: the demotion's model really is not in this
      // task_class's chain (as opposed to a join failure above).
      skipped.push({ entry: d.entry, reason: 'entry_not_in_chain' });
      continue;
    }
    demotionByCanonicalKey.set(canon.key, d);
  }
  // §2.4.5.1 immunity is reported BEFORE the empty-set early return so a single-entry
  // chain distinguishes 'nothing was eligible' from 'something was eligible and is
  // permanently suppressed'. The demotion is preserved in suppressed_demotions, never
  // silently dropped.
  if (immunity.kind === 'single_entry_chain') {
    return noop('single_entry_chain', {
      skipped,
      suppressed_demotions: Array.from(demotionByCanonicalKey.values()).map(d => ({
        entry: d.entry,
        combined_signal: d.combined_signal ?? null,
        reason: 'single_entry_chain',
      })),
    });
  }
  if (demotionByCanonicalKey.size === 0) {
    return { chain, applied: false, reason: 'no_eligible_demotions', displacements: [], skipped, immunity, suppressed_demotions: [] };
  }

  const { chain: reordered, displacements } = demoteChain(chain, new Set(demotionByCanonicalKey.keys()), keyFn);
  if (displacements.length === 0) {
    return { chain, applied: false, reason: 'no_displacement_possible', displacements: [], skipped, immunity, suppressed_demotions: [] };
  }

  return {
    chain: reordered,
    applied: true,
    reason: 'chain_demotion',
    displacements: displacements.map(d => {
      const rec = demotionByCanonicalKey.get(keyFn(d.entry)) || {};
      return {
        ...d,
        combined_signal: rec.combined_signal ?? null,
        evidence: rec.evidence ?? null,
        source: rec.source || FEEDBACK_SOURCE,
      };
    }),
    skipped,
    immunity,
    suppressed_demotions: [],
  };
}

/**
 * Secondary actuation path (§2.4.5.2) — for a task_class with NO routing_policy chain, where the
 * primary lever does not exist.
 *
 * §2.4.5 says such a class "nudges stage-3 `priority` instead". We deliberately do NOT mutate
 * `priority`: commit b0ab62d established that `priority` is a WITHIN-model rank that "must never
 * be compared across different models", so writing a cross-model nudge into it would corrupt a
 * live invariant to express a demotion. Instead the identical one-position demotion is applied to
 * the ALREADY-RANKED candidate list, which honors §2.4.6's bound exactly (demotion-only, max 1
 * position, nothing removed) without touching the rank field's meaning.
 *
 * @param {Object[]} ranked  candidates already sorted by the stage-3 comparator
 * @param {Object} args      same shape as applyChainFeedback (minus chain)
 * @returns {{ranked: Object[], applied: boolean, reason: string, displacements: Array, skipped: Array, immunity: Object, suppressed_demotions: Array}}
 */
function applyRankedFeedback(ranked, args) {
  const list = Array.isArray(ranked) ? ranked : [];
  // Same canonicalizer as the chain path (DI-1 §3): resolve to a `provider/alias` key when
  // possible, falling back to the raw join only when canonicalization itself fails (so
  // `byKey` below stays internally consistent either way — `chain` and `byKey` are always
  // built from the SAME keyOf).
  const keyOf = (c) => {
    const res = canonicalizeEntry(c.providerId, c.modelId, args && args.registry);
    return res.ok ? res.key : `${c.providerId}/${c.modelId}`;
  };
  const result = applyChainFeedback({ ...args, chain: list.map(keyOf) });
  if (!result.applied) {
    return {
      ranked: list,
      applied: false,
      reason: result.reason,
      displacements: [],
      skipped: result.skipped,
      immunity: result.immunity,
      suppressed_demotions: result.suppressed_demotions,
    };
  }
  const byKey = new Map(list.map(c => [keyOf(c), c]));
  return {
    ranked: result.chain.map(k => byKey.get(k)).filter(Boolean),
    applied: true,
    reason: 'priority_nudge',
    displacements: result.displacements,
    skipped: result.skipped,
    immunity: result.immunity,
    suppressed_demotions: result.suppressed_demotions,
  };
}

/**
 * Build the RoutingRecord provenance block for an applied adjustment (§2.4.5.4).
 *
 * Carries BOTH the action (`rank_displacement`) and the reason (`combined_signal` + the §2.2
 * evidence block), so `skillmeat routing audit --violations` can answer "what changed and on
 * what basis" from the record alone, without re-fetching the producer.
 */
function buildFeedbackProvenance(args) {
  const { taskClass, actuation, displacements, selectedEntry } = args;
  if (!displacements || displacements.length === 0) return null;
  return {
    source: FEEDBACK_SOURCE,
    task_class: taskClass,
    actuation,                                  // 'chain_demotion' | 'priority_nudge'
    params: { theta: ACTUATION_PARAMS.theta, theta_restore: ACTUATION_PARAMS.theta_restore,
              max_rank_displacement: ACTUATION_PARAMS.max_rank_displacement },
    rank_displacement: displacements.map(d => ({
      entry: d.entry,
      from: d.from,
      to: d.to,
      combined_signal: d.combined_signal ?? null,
      evidence: d.evidence ?? null,
    })),
    selected_entry: selectedEntry || null,
    selected_entry_displaced: Boolean(selectedEntry && displacements.some(d => d.entry === selectedEntry)),
  };
}

module.exports = {
  MERGE_PARAMS,
  ACTUATION_PARAMS,
  FEEDBACK_SOURCE,
  STATE_SCHEMA_VERSION,
  DEFAULT_STATE_PATH,
  isFeedbackConsumptionEnabled,
  computeCombinedSignal,
  evaluateRow,
  mergeFeedback,
  normalizeState,
  loadFeedbackState,
  writeFeedbackState,
  humanOverriddenTargets,
  demoteChain,
  classifyImmunity,
  applyChainFeedback,
  applyRankedFeedback,
  buildFeedbackProvenance,
  chainEntryKey,
};
