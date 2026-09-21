/**
 * Sovereignty-ladder tests — tests/test-sovereignty-ladder.js
 *
 * Covers the ladder that REPLACED the unconditional "MUST-stay ⇒ chosen_plugin_id = 'claude'"
 * jump in resolveFromRegistry. A lane (endpoint + auth) carries a sovereignty class; a task class
 * declares a MINIMUM RUNG; selection keeps only candidates at or above it.
 *
 *   local          (2, highest)  our own hardware; nothing leaves the LAN
 *   subscription   (1)           an account we control and pay for directly (Claude sub, Codex sub)
 *   shared_gateway (0, lowest)   third-party-mediated shared pool (ICA)
 *
 * THE TWO INVARIANTS THIS FILE EXISTS TO HOLD (both were paid for in real incidents):
 *
 *   1. EACH DECLARED MINIMUM CARRIES ITS REASON — cost_policy | quality_bar | egress_absolute.
 *      An `egress_absolute` minimum is NOT negotiable by any automated, empirical, or feedback
 *      path. Without the reason field a cost-tuning pass cannot tell a cost knob from a privacy
 *      boundary, and the one it would relax is the boundary. §1 below.
 *
 *   2. THE CLASS BELONGS TO THE LANE, NEVER TO A VENDOR OR A MODEL ID. Codex reached THROUGH the
 *      shared ICA gateway is NOT a Codex subscription. §2 below is the same model id arriving on
 *      two lanes with two different outcomes — the estate has already been bitten once by
 *      treating a model-id suffix as a lane marker, and this is the test that would catch it
 *      coming back.
 *
 * ⚠️ NOTE ON WHAT A FAILURE HERE MEANS. §2's `same model id, two lanes` case and §4's
 * fail-closed cases are REAL GUARDS. If a future change makes one of them fail, the change is
 * wrong — do not relax the assertion. §3's "a codex subscription satisfies the verdict floor" is
 * the deliberate CONTRACT CHANGE (the old contract said "claude"); it is the one assertion in
 * this file that encodes a decision rather than a safety property.
 *
 * NO shell, NO child_process. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-sovereignty-ladder.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passCount++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failures.push({ name, error: e.message });
    failCount++;
  }
}

function describe(suiteName, fn) {
  console.log(`\n${suiteName}`);
  fn();
}

const resolverPath = path.join(__dirname, '..', 'resolver.js');
const { resolve, minRungFor, laneFor, ladderIsLive, clearsFloor } = require(resolverPath);
const { FEEDBACK_SOURCE } = require(path.join(__dirname, '..', 'routing-feedback.js'));
const {
  loadRoutingFeedbackContract,
} = require(path.join(__dirname, '..', 'task-class-vocabulary.js'));
// An otherwise-identical contract with the consumption gate FLIPPED. The committed contract stays
// disabled; enabling it is a separate reviewed step, so the actuation tests inject this rather
// than mutating the real file. Same construction test-routing-feedback.js uses.
const enabledContract = { ...loadRoutingFeedbackContract(), live_consumption: 'enabled' };
const {
  SOVEREIGNTY_RUNGS,
  SOVEREIGNTY_CLASSES,
  SOVEREIGNTY_UNKNOWN,
  SOVEREIGNTY_UNKNOWN_RUNG,
  SOVEREIGNTY_MINIMUM_REASONS,
  sovereigntyRung,
  validateRoutingRecord,
  createEmptyRecord,
} = require(path.join(__dirname, '..', 'routing-record.js'));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function writeTmp(obj, ext = '.json') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sov-'));
  const p = path.join(dir, `fixture${ext}`);
  fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  return p;
}

function resolveWith(reg, params, localToml) {
  const regPath = writeTmp(reg);
  const extra = {};
  if (localToml !== undefined) extra._localConfigPath = writeTmp(localToml, '.toml');
  return resolve({ ...params, ...extra, _registryPath: regPath });
}

/**
 * A LADDER-LIVE registry (it declares `lanes:`), carrying the case invariant 2 turns on:
 * `gpt-5.6-terra` exists on BOTH a codex subscription lane and the shared ICA gateway lane —
 * same weights, different sovereignty, distinguishable ONLY by the declared lane.
 */
function ladderRegistry() {
  return {
    version: 1,
    sovereignty_ladder: ['shared_gateway', 'subscription', 'local'],
    lanes: {
      claude_subscription:        { sovereignty: 'subscription',   endpoint: 'anthropic_default', auth: 'anthropic_oauth_subscription' },
      codex_subscription:         { sovereignty: 'subscription',   endpoint: 'openai_default',    auth: 'codex_account' },
      ica_gateway_messages:       { sovereignty: 'shared_gateway', endpoint: 'ica_gateway',       auth: 'ica_team_key' },
      ica_gateway_responses_shim: { sovereignty: 'shared_gateway', endpoint: 'ica_gateway_shim',  auth: 'ica_team_key' },
      mystery_lane:               { sovereignty: 'unknown',        endpoint: 'unknown',           auth: 'unknown' },
    },
    task_class_sovereignty: {
      verdict:         { min_rung: 'subscription', reason: 'quality_bar' },
      orchestration:   { min_rung: 'subscription', reason: 'quality_bar' },
      mode_d:          { min_rung: 'subscription', reason: 'quality_bar' },
      journal_reflect: { min_rung: 'local',        reason: 'egress_absolute' },
    },
    routing_policy: {
      exploration:  { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'], enabled: true },
      // Chain deliberately leads with a SHARED-GATEWAY entry for a floored class, so a passing
      // test proves the floor filter acted rather than that claude happened to be first anyway.
      verdict:      { chain: ['ica/claude-haiku-4-5', 'claude/claude-opus-5'], enabled: true },
      journal_reflect: { chain: ['ica/claude-haiku-4-5', 'claude/claude-opus-5'], enabled: true },
    },
    must_stay_primary: [],
    models: {
      'claude-opus-5': {
        family: 'claude', class: 'opus', sampling: 'deterministic', status: 'active',
        providers: [
          { provider: 'claude', lane: 'claude_subscription', model_id: 'claude-opus-5', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
          { provider: 'ica', lane: 'ica_gateway_messages', model_id: 'claude-opus-5[1m]', cost_tier: 'premium', allowance: 'shared_token_pool', enabled: true, priority: 2 },
        ],
      },
      'claude-haiku-4-5': {
        family: 'claude', class: 'haiku', sampling: 'stochastic', status: 'active',
        providers: [
          { provider: 'ica', lane: 'ica_gateway_messages', model_id: 'claude-haiku-4-5', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
          { provider: 'claude', lane: 'claude_subscription', model_id: 'claude-haiku-4-5', cost_tier: 'billed', allowance: 'billed', enabled: true, priority: 2 },
        ],
      },
      // INVARIANT 2, in the data: one model key whose two instances carry the SAME model id
      // family on two different lanes. `-dzus` is a shim name in the invocation table, NOT a
      // sovereignty marker — the lane is what says which is which.
      'gpt-5.6-terra': {
        family: 'gpt', class: 'terra', sampling: 'deterministic', status: 'active',
        providers: [
          { provider: 'codex', lane: 'codex_subscription', model_id: 'gpt-5.6-terra', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
          { provider: 'ica', lane: 'ica_gateway_responses_shim', model_id: 'gpt-5.6-terra-dzus', cost_tier: 'standard', allowance: 'shared_token_pool', enabled: true, priority: 2 },
        ],
      },
    },
  };
}

/** A PRE-LADDER registry: no `lanes:` table anywhere. Regime (A). */
function legacyRegistry() {
  return {
    version: 1,
    routing_policy: {
      exploration:   { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'], enabled: true },
      orchestration: { chain: ['claude/claude-opus-5'] },
    },
    must_stay_primary: ['orchestration', 'verdict', 'mode_d', 'council_review', 'synthesis'],
    models: {
      'claude-opus-5': {
        family: 'claude', class: 'opus', sampling: 'deterministic', status: 'active',
        providers: [{ provider: 'claude', model_id: 'claude-opus-5', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 }],
      },
      'claude-haiku-4-5': {
        family: 'claude', class: 'haiku', sampling: 'stochastic', status: 'active',
        providers: [
          { provider: 'ica', model_id: 'claude-haiku-4-5', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
          { provider: 'claude', model_id: 'claude-haiku-4-5', cost_tier: 'billed', allowance: 'billed', enabled: true, priority: 2 },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// (0) The ladder itself
// ---------------------------------------------------------------------------

describe('(0) the ladder is ordered, and `unknown` sits below every real rung', () => {
  test('three rungs, ascending, with local highest', () => {
    assert.deepStrictEqual(SOVEREIGNTY_CLASSES, ['shared_gateway', 'subscription', 'local']);
    assert.ok(SOVEREIGNTY_RUNGS.local > SOVEREIGNTY_RUNGS.subscription);
    assert.ok(SOVEREIGNTY_RUNGS.subscription > SOVEREIGNTY_RUNGS.shared_gateway);
  });

  test('unknown is BELOW shared_gateway, so it clears no minimum', () => {
    assert.strictEqual(sovereigntyRung(SOVEREIGNTY_UNKNOWN), SOVEREIGNTY_UNKNOWN_RUNG);
    assert.ok(SOVEREIGNTY_UNKNOWN_RUNG < SOVEREIGNTY_RUNGS.shared_gateway,
      'an unmeasured lane must never satisfy the lowest rung either — "could not check" is not "fine"');
    for (const bad of [null, undefined, '', 'subscription ', 'SUBSCRIPTION', 'lan']) {
      assert.strictEqual(sovereigntyRung(bad), SOVEREIGNTY_UNKNOWN_RUNG, `${JSON.stringify(bad)} must not resolve to a rung`);
    }
  });

  test('the reason vocabulary is exactly the three declared classes', () => {
    assert.deepStrictEqual(SOVEREIGNTY_MINIMUM_REASONS, ['cost_policy', 'quality_bar', 'egress_absolute']);
  });

  test('clearsFloor is >=, not ==: a HIGHER rung satisfies a lower minimum', () => {
    const floor = { rung: SOVEREIGNTY_RUNGS.subscription };
    assert.ok(clearsFloor({ rung: SOVEREIGNTY_RUNGS.subscription }, floor));
    assert.ok(clearsFloor({ rung: SOVEREIGNTY_RUNGS.local }, floor), 'a floor is a floor, never a ceiling');
    assert.ok(!clearsFloor({ rung: SOVEREIGNTY_RUNGS.shared_gateway }, floor));
    assert.ok(clearsFloor({ rung: SOVEREIGNTY_UNKNOWN_RUNG }, null), 'no floor clears trivially');
  });
});

// ---------------------------------------------------------------------------
// (1) INVARIANT 1 — every declared minimum carries its reason
// ---------------------------------------------------------------------------

describe('(1) INVARIANT: a declared minimum without a valid reason makes the registry UNLOADABLE', () => {
  test('a minimum with NO reason throws (not warns)', () => {
    const reg = ladderRegistry();
    reg.task_class_sovereignty.verdict = { min_rung: 'subscription' };
    assert.throws(
      () => resolveWith(reg, { model: 'opus', task_class: 'verdict' }),
      /reason is REQUIRED/,
      'an unreasoned minimum must fail loudly — it is what a cost-tuning pass relaxes silently'
    );
  });

  test('a minimum with an OUT-OF-VOCABULARY reason throws', () => {
    const reg = ladderRegistry();
    reg.task_class_sovereignty.verdict = { min_rung: 'subscription', reason: 'because_i_said_so' };
    assert.throws(() => resolveWith(reg, { model: 'opus', task_class: 'verdict' }), /reason is REQUIRED/);
  });

  test('a minimum with an unknown min_rung throws', () => {
    const reg = ladderRegistry();
    reg.task_class_sovereignty.verdict = { min_rung: 'on_prem', reason: 'quality_bar' };
    assert.throws(() => resolveWith(reg, { model: 'opus', task_class: 'verdict' }), /min_rung must be one of/);
  });

  test('the reason reaches the emitted record, so a decision is auditable without the registry', () => {
    const r = resolveWith(ladderRegistry(), { model: 'opus', provider: 'ica', task_class: 'verdict' });
    assert.deepStrictEqual(r.sovereignty_floor, { min_rung: 'subscription', reason: 'quality_bar' });
    assert.ok(/quality_bar/.test(r.reason), `the reason string must name the reason class; got: ${r.reason}`);
    assert.ok(/subscription/.test(r.reason), `the reason string must name the floor; got: ${r.reason}`);
  });

  test('all three reason classes are accepted', () => {
    for (const reason of SOVEREIGNTY_MINIMUM_REASONS) {
      const reg = ladderRegistry();
      reg.task_class_sovereignty.verdict = { min_rung: 'subscription', reason };
      const r = resolveWith(reg, { model: 'opus', task_class: 'verdict' });
      assert.strictEqual(r.sovereignty_floor.reason, reason);
    }
  });
});

// ---------------------------------------------------------------------------
// (2) INVARIANT 2 — the class belongs to the LANE, never to a vendor or a model id
// ---------------------------------------------------------------------------

describe('(2) INVARIANT: sovereignty attaches to the lane, not the vendor or the model id', () => {
  test('THE CASE: the same model on a codex SUBSCRIPTION lane clears the floor, on the SHARED ICA lane it does not', () => {
    const reg = ladderRegistry();

    const viaSubscription = resolveWith(reg, { model: 'gpt-5.6-terra', provider: 'codex', task_class: 'verdict' });
    assert.strictEqual(viaSubscription.lane, 'codex_subscription');
    assert.strictEqual(viaSubscription.sovereignty, 'subscription');
    assert.strictEqual(viaSubscription.chosen_plugin_id, 'codex');

    // Same weights, reached through the shared gateway. MUST NOT satisfy the same floor.
    const viaGateway = resolveWith(reg, { model: 'gpt-5.6-terra-dzus', provider: 'ica', task_class: 'verdict' });
    assert.notStrictEqual(viaGateway.chosen_plugin_id, 'ica',
      'Codex reached THROUGH the shared ICA gateway is NOT a Codex subscription');
    assert.strictEqual(viaGateway.sovereignty, 'subscription');
    assert.ok(viaGateway.lane !== 'ica_gateway_responses_shim');
  });

  test('a model-id SUFFIX carries no sovereignty: `[1m]` on a shared lane is still shared', () => {
    const reg = ladderRegistry();
    const r = resolveWith(reg, { model: 'claude-opus-5[1m]', provider: 'ica', task_class: 'verdict' });
    assert.notStrictEqual(r.lane, 'ica_gateway_messages',
      '`[1m]` is a context-window marker; the ICA lane it sits on is shared_gateway and fails a subscription floor');
    assert.strictEqual(r.sovereignty, 'subscription');
  });

  test('laneFor reads the DECLARED lane and never infers one from the provider', () => {
    const reg = ladderRegistry();
    const codexInst = reg.models['gpt-5.6-terra'].providers[0];
    const icaInst = reg.models['gpt-5.6-terra'].providers[1];
    assert.deepStrictEqual(laneFor(reg, codexInst), { lane: 'codex_subscription', sovereignty: 'subscription', rung: 1 });
    assert.deepStrictEqual(laneFor(reg, icaInst), { lane: 'ica_gateway_responses_shim', sovereignty: 'shared_gateway', rung: 0 });

    // Strip the declaration: the provider string alone must yield NOTHING.
    const stripped = { ...codexInst };
    delete stripped.lane;
    assert.deepStrictEqual(laneFor(reg, stripped), { lane: null, sovereignty: SOVEREIGNTY_UNKNOWN, rung: SOVEREIGNTY_UNKNOWN_RUNG },
      'a provider string is not a lane — inferring one here would rebuild the defect the ladder removes');
  });

  test('no rule names a vendor: a floored class routes to codex when codex is what fits', () => {
    // The old contract hardcoded chosen_plugin_id = 'claude' for this class. This assertion is
    // the deliberate CONTRACT CHANGE, not a safety property (see the header note).
    const r = resolveWith(ladderRegistry(), { model: 'gpt-5.6-terra', provider: 'codex', task_class: 'verdict' });
    assert.strictEqual(r.chosen_plugin_id, 'codex',
      'a Codex subscription satisfies "verdict requires >= subscription" with no rule naming a vendor');
  });
});

// ---------------------------------------------------------------------------
// (3) The floor is a FILTER at every selection site
// ---------------------------------------------------------------------------

describe('(3) the minimum is enforced at every selection site, not just one', () => {
  test('explicit-provider request BELOW the floor is refused, not honored', () => {
    const r = resolveWith(ladderRegistry(), { model: 'haiku', provider: 'ica', task_class: 'verdict' });
    assert.notStrictEqual(r.chosen_plugin_id, 'ica',
      'naming a provider does not outrank a declared minimum — that request is what the floor exists to refuse');
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
  });

  test('a routing_policy chain LEADING with a sub-floor entry skips it', () => {
    // verdict's chain is ['ica/claude-haiku-4-5', 'claude/claude-opus-5'] — shared gateway first.
    const r = resolveWith(ladderRegistry(), { model: 'opus', task_class: 'verdict' });
    assert.strictEqual(r.chosen_plugin_id, 'claude');
    assert.strictEqual(r.lane, 'claude_subscription');
  });

  test('cost/priority ranking (no chain) never returns a sub-floor instance', () => {
    const reg = ladderRegistry();
    delete reg.routing_policy.verdict;   // force step 3
    const r = resolveWith(reg, { model: 'haiku', task_class: 'verdict' });
    // free-first would otherwise pick the free ICA haiku.
    assert.strictEqual(r.sovereignty, 'subscription');
    assert.strictEqual(r.chosen_plugin_id, 'claude');
  });

  test('the FALLBACK CHAIN carries no sub-floor entry either', () => {
    const r = resolveWith(ladderRegistry(), { model: 'opus', task_class: 'verdict' });
    const reg = ladderRegistry();
    const laneOf = (pluginId, modelId) => {
      for (const m of Object.values(reg.models)) {
        for (const p of m.providers) if (p.provider === pluginId && p.model_id === modelId) return p.lane;
      }
      return null;
    };
    for (const entry of r.fallback_chain) {
      const lane = laneOf(entry.plugin_id, entry.model);
      const sov = lane ? reg.lanes[lane].sovereignty : SOVEREIGNTY_UNKNOWN;
      assert.ok(sovereigntyRung(sov) >= SOVEREIGNTY_RUNGS.subscription,
        `fallback ${entry.plugin_id}/${entry.model} is on '${sov}' — a fallback below the floor is not a fallback`);
    }
  });

  test('an UNFLOORED class is untouched: the free shared-gateway lane still wins', () => {
    const r = resolveWith(ladderRegistry(), { model: 'haiku', task_class: 'exploration' });
    assert.strictEqual(r.chosen_plugin_id, 'ica', 'the ladder must not quietly ban offload for unfloored work');
    assert.strictEqual(r.sovereignty, 'shared_gateway');
    assert.strictEqual(r.sovereignty_floor, null);
  });
});

// ---------------------------------------------------------------------------
// (4) FAIL-CLOSED — an unclassified lane satisfies nothing
// ---------------------------------------------------------------------------

describe('(4) fail-closed: "could not determine the lane" never reads as "the lane is fine"', () => {
  test('an instance with NO lane in a ladder-live registry clears no floor', () => {
    const reg = ladderRegistry();
    delete reg.models['claude-opus-5'].providers[0].lane;   // strip claude's declaration
    delete reg.routing_policy.verdict;
    const r = resolveWith(reg, { model: 'gpt-5.6-terra', task_class: 'verdict' });
    assert.notStrictEqual(r.lane, null, 'the unclassified claude instance must not have been used');
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
  });

  test('a lane declared but ABSENT from the lanes table is a dangling reference, not a pass', () => {
    const reg = ladderRegistry();
    reg.models['claude-opus-5'].providers[0].lane = 'lane_that_does_not_exist';
    const got = laneFor(reg, reg.models['claude-opus-5'].providers[0]);
    assert.strictEqual(got.sovereignty, SOVEREIGNTY_UNKNOWN);
    assert.strictEqual(got.rung, SOVEREIGNTY_UNKNOWN_RUNG);
  });

  test('a lane whose sovereignty is literally `unknown` clears no floor', () => {
    const reg = ladderRegistry();
    reg.models['claude-opus-5'].providers[0].lane = 'mystery_lane';
    assert.strictEqual(laneFor(reg, reg.models['claude-opus-5'].providers[0]).rung, SOVEREIGNTY_UNKNOWN_RUNG);
  });

  test('when NOTHING clears the floor the resolver REFUSES rather than dropping a rung', () => {
    // journal_reflect declares min_rung: local; the fixture has zero local lanes, exactly like
    // the real registry. Being unroutable is the CORRECT outcome for an egress rule.
    assert.throws(
      () => resolveWith(ladderRegistry(), { model: 'opus', task_class: 'journal_reflect' }),
      /UNROUTABLE/,
      'silently dropping to a lower rung here would defeat the declared minimum'
    );
  });

  test('the refusal names the floor, the reason, and that it is a refusal', () => {
    let msg = '';
    try { resolveWith(ladderRegistry(), { model: 'opus', task_class: 'journal_reflect' }); }
    catch (e) { msg = e.message; }
    assert.ok(/egress_absolute/.test(msg), msg);
    assert.ok(/'local'/.test(msg), msg);
    assert.ok(/refusal, not a failure to find a fallback/.test(msg), msg);
  });
});

// ---------------------------------------------------------------------------
// (5) egress_absolute is immune to every relaxation path
// ---------------------------------------------------------------------------

describe('(5) an egress_absolute minimum is not negotiable by any channel', () => {
  test('a routing.local.toml override of a floored class is IGNORED', () => {
    const toml = [
      '[routing_policy_overrides.journal_reflect]',
      'chain = ["ica/claude-haiku-4-5"]',
      '',
    ].join('\n');
    assert.throws(
      () => resolveWith(ladderRegistry(), { model: 'opus', task_class: 'journal_reflect' }, toml),
      /UNROUTABLE/,
      'a routing.local.toml is not a sign-off path for an egress boundary'
    );
  });

  test('a local override cannot re-route a quality_bar floored class onto a shared lane either', () => {
    const toml = [
      '[routing_policy_overrides.verdict]',
      'chain = ["ica/claude-haiku-4-5"]',
      '',
    ].join('\n');
    const r = resolveWith(ladderRegistry(), { model: 'opus', task_class: 'verdict' }, toml);
    assert.notStrictEqual(r.chosen_plugin_id, 'ica');
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
  });

  test('disabling every subscription instance does NOT downgrade the class — it refuses', () => {
    const reg = ladderRegistry();
    for (const m of Object.values(reg.models)) {
      for (const p of m.providers) if (reg.lanes[p.lane].sovereignty === 'subscription') p.enabled = false;
    }
    assert.throws(
      () => resolveWith(reg, { model: 'opus', task_class: 'verdict' }),
      /UNROUTABLE/,
      'scarcity is not a reason to cross a floor'
    );
  });

  test('a floored class is immune to empirical routing feedback WITH THE GATE OPEN', () => {
    // ⚠️ Asserting `routing_feedback === null` with feedback DISABLED would prove nothing — it is
    // null for every record by default. This test therefore opens the gate exactly the way
    // test-routing-feedback.js does (an injected contract with live_consumption flipped, no kill
    // switch, a real state file carrying a demotion), and only then asserts immunity.
    //
    // The immunity key moved from "is in must_stay_primary" to "declares a minimum" precisely so
    // an `egress_absolute` class that is NOT must_stay is still immune. `sovereign_review` below
    // is such a class: it appears in NEITHER `must_stay_primary` (empty in this fixture) NOR the
    // routing-record literal list, so under the OLD key it would have had an adjustable surface.
    const reg = ladderRegistry();
    assert.deepStrictEqual(reg.must_stay_primary, [], 'fixture precondition: nothing is MUST-stay here');
    reg.task_class_sovereignty.sovereign_review = { min_rung: 'subscription', reason: 'egress_absolute' };
    reg.routing_policy.sovereign_review = { chain: ['claude/claude-haiku-4-5', 'claude/claude-opus-5'], enabled: true };

    const state = {
      schema_version: 1,
      source: FEEDBACK_SOURCE,
      overrides: {
        sovereign_review: {
          demotions: [{
            entry: 'claude/claude-haiku-4-5',
            combined_signal: 0.45,
            evidence: { success_rate: null, cost_index: 2.5, regression_rate: null, sample_count: 80, confidence: 0.9, terms_live: ['cost'] },
            expires_at: '2099-01-01T00:00:00Z',
            source: FEEDBACK_SOURCE,
          }],
        },
      },
    };

    const regPath = writeTmp(reg);
    const statePath = writeTmp(state);
    const noLocal = path.join(os.tmpdir(), `sov-nolocal-${process.pid}.toml`);
    const rec = resolve({
      model: 'haiku', task_class: 'sovereign_review',
      _registryPath: regPath, _localConfigPath: noLocal,
      _feedbackContract: enabledContract, _feedbackEnv: {}, _feedbackStatePath: statePath,
    });

    assert.strictEqual(rec.routing_feedback, null,
      'a class with a declared minimum has no adjustable surface — feedback provenance on it is a governance breach, not a note');
    assert.strictEqual(rec.modelId === undefined ? rec.model : rec.model, 'haiku');
    assert.ok(!/empirical-feedback re-ranked/.test(rec.reason),
      `the demotion must not have been applied; got: ${rec.reason}`);
  });

  test('CONTROL: the same demotion DOES apply to an unfloored class, so the test above is not vacuous', () => {
    // Without this control, the immunity assertion would pass equally well if the harness were
    // simply not wired up. This proves the gate really is open and the demotion really does bite.
    const reg = ladderRegistry();
    const state = {
      schema_version: 1,
      source: FEEDBACK_SOURCE,
      overrides: {
        exploration: {
          demotions: [{
            entry: 'ica/claude-haiku-4-5',
            combined_signal: 0.45,
            evidence: { success_rate: null, cost_index: 2.5, regression_rate: null, sample_count: 80, confidence: 0.9, terms_live: ['cost'] },
            expires_at: '2099-01-01T00:00:00Z',
            source: FEEDBACK_SOURCE,
          }],
        },
      },
    };
    const rec = resolve({
      model: 'haiku', task_class: 'exploration',
      _registryPath: writeTmp(reg),
      _localConfigPath: path.join(os.tmpdir(), `sov-nolocal-${process.pid}.toml`),
      _feedbackContract: enabledContract, _feedbackEnv: {}, _feedbackStatePath: writeTmp(state),
    });
    assert.strictEqual(rec.chosen_plugin_id, 'claude', 'the demoted ica lane should have lost to claude');
    assert.ok(rec.routing_feedback, 'the adjustment must actually have been applied here');
  });
});

// ---------------------------------------------------------------------------
// (5b) AXIS PRECEDENCE — the sovereignty floor outranks the other two filters
// ---------------------------------------------------------------------------

describe('(5b) the sovereignty floor is the stated cause, not the determinism/write axis', () => {
  // test-write-authority.js already pins this on a PRE-LADDER fixture, where it reads
  // `/MUST-stay-primary/`. That test is a real guard and is left exactly as it is. This is the
  // case it cannot reach: the same precedence question with the ladder LIVE.
  test('mode_d + requires_write + provider=ica reports the FLOOR, not the write filter', () => {
    const r = resolveWith(ladderRegistry(), {
      model: 'haiku', provider: 'ica', task_class: 'mode_d', effort: 'low', requires_write: true,
    });
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
    assert.ok(/sovereignty floor/.test(r.reason),
      `the floor must be the stated cause; got: ${r.reason}`);
    assert.ok(!/Write-authority filter/.test(r.reason),
      'reporting the write filter would make the sovereignty boundary vanish from the record');
  });

  test('and the write filter still applies ON TOP of the floor (both, never either)', () => {
    // gemini is write-incapable AND (here) on a subscription lane, so it clears the floor and
    // must still be excluded by the write axis — proving the floor did not swallow the other
    // filters when it took precedence in the reason string.
    const reg = ladderRegistry();
    reg.lanes.gemini_direct = { sovereignty: 'subscription', endpoint: 'google_ai_studio', auth: 'gemini_api_key' };
    reg.models['claude-haiku-4-5'].providers.unshift(
      { provider: 'gemini', lane: 'gemini_direct', model_id: 'gemini-3-5-flash', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 0 }
    );
    delete reg.routing_policy.verdict;
    const r = resolveWith(reg, {
      model: 'haiku', task_class: 'verdict', requires_write: true,
    });
    assert.notStrictEqual(r.chosen_plugin_id, 'gemini',
      'a write-incapable lane must stay excluded even though its rung clears the floor');
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
  });

  test('determinism filter likewise still applies alongside a floor', () => {
    const reg = ladderRegistry();
    delete reg.routing_policy.verdict;
    const r = resolveWith(reg, {
      model: 'opus', provider: 'ica', task_class: 'verdict', resume_active: true,
    });
    assert.notStrictEqual(r.chosen_plugin_id, 'ica');
    assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription);
  });
});

// ---------------------------------------------------------------------------
// (6) Regime A — a pre-ladder registry keeps its exact pre-ladder behavior
// ---------------------------------------------------------------------------

describe('(6) a registry with no `lanes:` table keeps the pre-ladder contract verbatim', () => {
  test('ladderIsLive is false without a lanes table, true with one', () => {
    assert.strictEqual(ladderIsLive(legacyRegistry()), false);
    assert.strictEqual(ladderIsLive(ladderRegistry()), true);
    assert.strictEqual(ladderIsLive({ lanes: {} }), false, 'an empty table is not a deployed ladder');
  });

  test('MUST-stay still forces claude there — strictly NARROWER than >= subscription, never wider', () => {
    const r = resolveWith(legacyRegistry(), { model: 'haiku', provider: 'ica', task_class: 'orchestration' });
    assert.strictEqual(r.chosen_plugin_id, 'claude');
    assert.ok(/no lanes: table/.test(r.reason), `the record must say WHY the old rule applied; got: ${r.reason}`);
  });

  test('and it emits null sovereignty fields rather than guessing a rung', () => {
    const r = resolveWith(legacyRegistry(), { model: 'haiku', task_class: 'exploration' });
    assert.strictEqual(r.lane, null, 'a registry with no lanes table has no lane to name');
    assert.strictEqual(r.sovereignty, null, 'never assert a rung for a registry that declares none');
    assert.strictEqual(r.sovereignty_floor, null);
    // And the contrast, so this is a comparison rather than an assertion about nothing: the SAME
    // resolve against a ladder-live registry does populate all three.
    const live = resolveWith(ladderRegistry(), { model: 'haiku', task_class: 'exploration' });
    assert.strictEqual(live.lane, 'ica_gateway_messages');
    assert.strictEqual(live.sovereignty, 'shared_gateway');
  });

  test('the legacy must_stay_primary desugar applies when a ladder IS live but the class is undeclared', () => {
    const reg = ladderRegistry();
    reg.must_stay_primary = ['council_review'];
    delete reg.task_class_sovereignty.council_review;
    const floor = minRungFor(reg, 'council_review', ['council_review']);
    assert.deepStrictEqual(
      { min_rung: floor.min_rung, reason: floor.reason },
      { min_rung: 'subscription', reason: 'quality_bar' }
    );
    assert.ok(/desugar/.test(floor.source), 'the desugar must be visible in the provenance, not silent');
  });

  test('hyphen and underscore spellings of a class resolve to the same floor', () => {
    const reg = ladderRegistry();
    const a = minRungFor(reg, 'mode_d', []);
    const b = minRungFor(reg, 'mode-d', []);
    assert.deepStrictEqual([a.min_rung, a.reason], [b.min_rung, b.reason]);
  });
});

// ---------------------------------------------------------------------------
// (7) The record-level backstop
// ---------------------------------------------------------------------------

describe('(7) validateRoutingRecord rejects a record that violates its own declared floor', () => {
  test('a sub-floor record throws at validation, whoever built it', () => {
    const rec = createEmptyRecord();
    rec.lane = 'ica_gateway_messages';
    rec.sovereignty = 'shared_gateway';
    rec.sovereignty_floor = { min_rung: 'subscription', reason: 'quality_bar' };
    assert.throws(() => validateRoutingRecord(rec), /violates its own sovereignty floor/);
  });

  test('an at-floor and an above-floor record both validate', () => {
    for (const sov of ['subscription', 'local']) {
      const rec = createEmptyRecord();
      rec.sovereignty = sov;
      rec.sovereignty_floor = { min_rung: 'subscription', reason: 'quality_bar' };
      assert.doesNotThrow(() => validateRoutingRecord(rec));
    }
  });

  test('a floor with no reason is not a valid record', () => {
    const rec = createEmptyRecord();
    rec.sovereignty = 'subscription';
    rec.sovereignty_floor = { min_rung: 'subscription' };
    assert.throws(() => validateRoutingRecord(rec), /reason must be present/);
  });

  test('absent sovereignty fields are tolerated (11–14-field legacy records)', () => {
    const rec = createEmptyRecord();
    delete rec.lane; delete rec.sovereignty; delete rec.sovereignty_floor;
    assert.doesNotThrow(() => validateRoutingRecord(rec));
  });

  test('an unclassified lane under a live floor is rejected, not waved through', () => {
    const rec = createEmptyRecord();
    rec.sovereignty = SOVEREIGNTY_UNKNOWN;
    rec.sovereignty_floor = { min_rung: 'subscription', reason: 'quality_bar' };
    assert.throws(() => validateRoutingRecord(rec), /violates its own sovereignty floor/);
  });
});

// ---------------------------------------------------------------------------
// (8) The shipped registry
// ---------------------------------------------------------------------------

describe('(8) the shipped model-registry declares a complete, non-dangling ladder', () => {
  const shipped = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'model-registry.generated.json'), 'utf8')
  );

  test('every provider instance declares a lane, and every lane is defined', () => {
    const undeclared = [];
    for (const [key, m] of Object.entries(shipped.models)) {
      for (const p of (m.providers || [])) {
        if (!p.lane) undeclared.push(`${key}: ${p.provider}/${p.model_id} (no lane)`);
        else if (!shipped.lanes[p.lane]) undeclared.push(`${key}: ${p.provider}/${p.model_id} -> '${p.lane}' undefined`);
      }
    }
    assert.deepStrictEqual(undeclared, []);
  });

  test('every declared minimum carries a valid reason', () => {
    for (const [cls, decl] of Object.entries(shipped.task_class_sovereignty)) {
      assert.ok(SOVEREIGNTY_CLASSES.includes(decl.min_rung), `${cls}.min_rung`);
      assert.ok(SOVEREIGNTY_MINIMUM_REASONS.includes(decl.reason), `${cls}.reason`);
    }
  });

  test('every one of the 7 formerly-MUST-stay classes still carries a floor of at least subscription', () => {
    // The ladder replaced the vendor pin; it must not have DROPPED any class on the way.
    for (const cls of ['orchestration', 'verdict', 'mode_d', 'council_review', 'synthesis', 'schema_recovery', 'cross_wave_merge']) {
      const decl = shipped.task_class_sovereignty[cls];
      assert.ok(decl, `class '${cls}' lost its protection entirely`);
      assert.ok(sovereigntyRung(decl.min_rung) >= SOVEREIGNTY_RUNGS.subscription, `${cls} floor too low`);
    }
  });

  test('the `local` rung has ZERO lanes — declared, and stated rather than discovered', () => {
    // .claude/rules/built-lane-no-writers.md: name the absent member up front. If a local
    // inference lane is ever added this assertion flips and should simply be updated — it is
    // recording a measured fact, not forbidding one.
    const localLanes = Object.entries(shipped.lanes).filter(([, l]) => l.sovereignty === 'local');
    assert.deepStrictEqual(localLanes.map(([k]) => k), [],
      'if this now fails, a local lane exists and journal_reflect became routable — verify that is intended');
  });

  test('every UNVERIFIED lane classification is either `unknown` or carries a probe', () => {
    for (const [id, lane] of Object.entries(shipped.lanes)) {
      if (lane.verified === false) {
        assert.ok(lane.probe, `lane '${id}' is unverified and must name the probe that would settle it`);
      }
    }
  });

  test('the shipped registry resolves a floored class to a subscription lane end to end', () => {
    const regPath = path.join(__dirname, '..', 'model-registry.generated.json');
    for (const tc of ['orchestration', 'verdict', 'mode_d', 'synthesis']) {
      const r = resolve({ model: 'opus', provider: 'ica', task_class: tc, _registryPath: regPath });
      assert.ok(sovereigntyRung(r.sovereignty) >= SOVEREIGNTY_RUNGS.subscription,
        `${tc} landed on '${r.sovereignty}' via lane '${r.lane}'`);
    }
  });

  test('and REFUSES the egress_absolute class rather than downgrading it', () => {
    const regPath = path.join(__dirname, '..', 'model-registry.generated.json');
    assert.throws(
      () => resolve({ model: 'sonnet', task_class: 'journal_reflect', _registryPath: regPath }),
      /UNROUTABLE/
    );
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(70)}`);
console.log(`sovereignty-ladder: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('='.repeat(70));
