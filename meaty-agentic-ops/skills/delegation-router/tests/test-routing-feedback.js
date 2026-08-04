/**
 * Empirical routing feedback tests — tests/test-routing-feedback.js (DI-1)
 *
 * Covers the ratified merge algorithm (§2.2, computed verbatim) and the ratified discrete
 * actuation surface (§2.4 ADR Option C) from
 *   CCDash/docs/project_plans/design-specs/routing-feedback-router-merge-handoff.md
 *
 * Organised by acceptance criterion so a failure names the contract it broke:
 *   A. §2.2 combined_signal, verbatim (weights, clamps, thresholds, null handling)
 *   B. §2.4.7 retirement ledger — the retired params must NOT exist
 *   C. §2.4.5.3 demotion-only, one-position actuation
 *   D. §2.4.5.1 structural precedence + MUST-stay immunity
 *   E. §2.4.6 discrete guardrails (hysteresis, TTL, floor, feature disable, min-sample)
 *   F. SPEC invariants 9/11 — fail-closed join discipline
 *   G. §2.4.5.4 RoutingRecord provenance (action AND reason)
 *   H. end-to-end: feedback actually changes a resolver decision
 *
 * NO shell, NO child_process, NO network. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-routing-feedback.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passCount++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failCount++;
  }
}

function describe(suite, fn) {
  console.log(`\n${suite}`);
  fn();
}

const skillDir = path.join(__dirname, '..');
const {
  MERGE_PARAMS,
  ACTUATION_PARAMS,
  FEEDBACK_SOURCE,
  isFeedbackConsumptionEnabled,
  computeCombinedSignal,
  evaluateRow,
  mergeFeedback,
  loadFeedbackState,
  writeFeedbackState,
  humanOverriddenTargets,
  demoteChain,
  applyChainFeedback,
  buildFeedbackProvenance,
} = require(path.join(skillDir, 'routing-feedback.js'));

const { resolve } = require(path.join(skillDir, 'resolver.js'));
const {
  validateRoutingRecord,
  finalizeRoutingRecord,
  createEmptyRecord,
  MAX_RANK_DISPLACEMENT,
} = require(path.join(skillDir, 'routing-record.js'));
const {
  loadTaskClassVocabulary,
  loadRoutingFeedbackContract,
} = require(path.join(skillDir, 'task-class-vocabulary.js'));

const vocabulary = loadTaskClassVocabulary();
const pinnedContract = loadRoutingFeedbackContract();
const producer = pinnedContract.accepted_producers.ccdash;

// An otherwise-identical contract with the gate FLIPPED, used to exercise the actuation path.
// The committed contract stays disabled; enabling it is a separate, deliberate, reviewed step
// (DI-4f + DI-4e), so every actuation test injects this instead of mutating the real file.
const enabledContract = { ...pinnedContract, live_consumption: 'enabled' };
const ENABLED_ENV = {};  // no AOS_ROUTING_FEEDBACK key = kill switch not engaged

function envelope(overrides = {}) {
  return {
    producer: 'ccdash',
    contract_id: pinnedContract.contract_id,
    contract_version: pinnedContract.contract_version,
    taxonomy_id: vocabulary.taxonomy_id,
    taxonomy_version: vocabulary.taxonomy_version,
    taxonomy_digest: vocabulary.taxonomy_digest,
    mapping_id: producer.mapping_id,
    mapping_version: producer.mapping_version,
    mapping_digest: producer.mapping_digest,
    ...overrides,
  };
}

/** A row that clears eligibility + confidence, so tests vary only what they mean to vary. */
function row(overrides = {}) {
  return {
    source_skill_name: 'dev-execution',
    task_class: 'implementation',
    model: 'claude-sonnet-5',
    provider: 'claude',
    sample_count: 50,
    success_rate: null,
    cost_index: 1.0,
    cost_coverage_fraction: 1.0,
    regression_rate: null,
    confidence: 0.9,
    eligible_for_adjustment: true,
    window_start: '2026-07-27T00:00:00Z',
    window_end: '2026-08-03T00:00:00Z',
    ...overrides,
  };
}

const NEAR = 1e-9;
function assertClose(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < NEAR, `${msg || ''} expected ${expected}, got ${actual}`);
}

// ===========================================================================
describe('A. §2.2 combined_signal — computed verbatim (params SURVIVE the §2.4 ADR)', () => {
// ===========================================================================

  test('ratified params are exactly the D9 values', () => {
    assert.equal(MERGE_PARAMS.weight_failure, 0.5);
    assert.equal(MERGE_PARAMS.weight_cost, 0.3);
    assert.equal(MERGE_PARAMS.weight_regression, 0.2);
    assert.equal(MERGE_PARAMS.regression_half_weight, 0.5);
    assert.equal(MERGE_PARAMS.confidence_threshold, 0.7);
    // weights sum to 1.0
    assertClose(
      MERGE_PARAMS.weight_failure + MERGE_PARAMS.weight_cost + MERGE_PARAMS.weight_regression, 1.0
    );
  });

  test('§2.2 extreme worked example: sr 0.20 / ci 2.0 / rr 0.50 → combined_signal 0.750', () => {
    const { combined_signal, terms_live } = computeCombinedSignal(
      row({ success_rate: 0.20, cost_index: 2.0, regression_rate: 0.50 })
    );
    assertClose(combined_signal, 0.750);
    assert.deepEqual(terms_live.sort(), ['cost', 'failure', 'regression']);
  });

  test('penalty_for_failure = 1 - success_rate, weighted 0.5', () => {
    const { combined_signal } = computeCombinedSignal(row({ success_rate: 0.4, cost_index: 1.0 }));
    assertClose(combined_signal, 0.6 * 0.5);
  });

  test('regression carries HALF weight before its 0.2 term weight', () => {
    const { combined_signal } = computeCombinedSignal(row({ regression_rate: 0.8, cost_index: 1.0 }));
    assertClose(combined_signal, 0.8 * 0.5 * 0.2);
  });

  test('D9c cost clamp: a cheaper-than-baseline model earns NO bonus', () => {
    const cheap = computeCombinedSignal(row({ cost_index: 0.25 }));
    assertClose(cheap.combined_signal, 0.0);
    assert.ok(cheap.combined_signal >= 0, 'combined_signal must never go negative');
    // and it cannot offset a real failure rate
    const failingButCheap = computeCombinedSignal(row({ success_rate: 0.2, cost_index: 0.1 }));
    assertClose(failingButCheap.combined_signal, 0.8 * 0.5);
  });

  test('D9c cost clamp: above-baseline cost is the only cost contribution', () => {
    const { combined_signal } = computeCombinedSignal(row({ cost_index: 2.5 }));
    assertClose(combined_signal, 1.5 * 0.3);
  });

  test('null terms contribute 0 and weights are NOT re-normalized (cost-only merge stays bounded)', () => {
    // Today's real envelope: success_rate null (DI-4e), regression_rate permanently null.
    const { combined_signal, terms_live } = computeCombinedSignal(
      row({ success_rate: null, regression_rate: null, cost_index: 2.0 })
    );
    assert.deepEqual(terms_live, ['cost']);
    // 1.0 above baseline * weight 0.3. If the weights were re-normalized to sum to 1.0 over the
    // surviving term this would be 1.0 — a 3.3x more aggressive signal than ratified.
    assertClose(combined_signal, 0.3);
  });

  test('a null success_rate is never coerced to 0 (which would read as 100% failure)', () => {
    const { combined_signal, terms } = computeCombinedSignal(row({ success_rate: null, cost_index: 1.0 }));
    assert.equal(terms.failure, 0, 'failure term must be absent, not 1.0');
    assertClose(combined_signal, 0.0);
  });

  test('regression_rate null is treated as permanently absent, not pending', () => {
    // Same signal with regression_rate null and with regression_rate 0.0 — the null case must not
    // wait, warn, or change the outcome.
    const a = computeCombinedSignal(row({ success_rate: 0.5, regression_rate: null }));
    const b = computeCombinedSignal(row({ success_rate: 0.5, regression_rate: 0.0 }));
    assertClose(a.combined_signal, b.combined_signal);
    assert.ok(!a.terms_live.includes('regression'));
    assert.ok(b.terms_live.includes('regression'));
  });

  test('min_cost_coverage is DEFAULT-OFF (§2.2 stays verbatim) but discounts thin coverage when set', () => {
    const thin = row({ cost_index: 3.0, cost_coverage_fraction: 0.05 });
    assertClose(computeCombinedSignal(thin).combined_signal, 2.0 * 0.3, 'default-off');
    const gated = computeCombinedSignal(thin, { min_cost_coverage: 0.5 });
    assert.deepEqual(gated.terms_live, [], 'cost term dropped below coverage floor');
    assertClose(gated.combined_signal, 0.0);
  });

  test('confidence below 0.7 is skipped', () => {
    const d = evaluateRow(row({ confidence: 0.69, cost_index: 5.0 }), envelope());
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'low_confidence');
  });

  test('confidence exactly at the 0.7 threshold is accepted', () => {
    const d = evaluateRow(row({ confidence: 0.7, cost_index: 5.0 }), envelope());
    assert.equal(d.action, 'demote');
  });

  test('a row with every metric null never actuates in EITHER direction', () => {
    const d = evaluateRow(
      row({ success_rate: null, cost_index: null, regression_rate: null }),
      envelope(),
      { wasDemoted: true }
    );
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'no_live_terms');
    assertClose(d.combined_signal, 0.0);
  });
});

// ===========================================================================
describe('B. §2.4.7 retirement ledger — retired params must NOT be present', () => {
// ===========================================================================

  const feedbackSrc = fs.readFileSync(path.join(skillDir, 'routing-feedback.js'), 'utf8');
  const resolverSrc = fs.readFileSync(path.join(skillDir, 'resolver.js'), 'utf8');
  const recordSrc = fs.readFileSync(path.join(skillDir, 'routing-record.js'), 'utf8');

  // Strip block/line comments so the retirement ledger's own prose (which necessarily NAMES the
  // retired params in order to retire them) is not mistaken for an implementation of them.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = [feedbackSrc, resolverSrc, recordSrc].map(stripComments).join('\n');

  test('score_delta is RETIRED — the field does not exist in any code path', () => {
    assert.ok(!/score_delta/.test(code), 'score_delta must not appear in executable code');
  });

  test('max_adjustment_cap is RETIRED as a magnitude', () => {
    assert.ok(!/max_adjustment_cap/.test(code));
    assert.ok(!('max_adjustment_cap' in MERGE_PARAMS));
    assert.ok(!('max_adjustment_cap' in ACTUATION_PARAMS));
    assert.ok(!('cap' in MERGE_PARAMS));
  });

  test('the max(-combined_signal, cap) clamp is RETIRED — no negative adjustment magnitude', () => {
    assert.ok(!/-\s*0\.15\b/.test(code), 'the -0.15 magnitude must not appear in code');
    // combined_signal is compared to theta directly and is never negated into a delta.
    const { combined_signal } = computeCombinedSignal(row({ success_rate: 0.2, cost_index: 2.0, regression_rate: 0.5 }));
    assert.ok(combined_signal > 0, 'positive-for-bad convention (the D9b lesson) is preserved');
  });

  test('|0.15| survives ONLY as the demotion threshold theta', () => {
    assert.equal(ACTUATION_PARAMS.theta, 0.15);
    assert.equal(ACTUATION_PARAMS.theta_restore, 0.08);
    assert.equal(ACTUATION_PARAMS.max_rank_displacement, 1);
    assert.equal(ACTUATION_PARAMS.ttl_windows, 1);
  });

  test('the -0.150 cap-bound worked example is replaced by 0.750 >= theta → demote 1 position', () => {
    const d = evaluateRow(row({ success_rate: 0.20, cost_index: 2.0, regression_rate: 0.50 }), envelope());
    assertClose(d.combined_signal, 0.750);
    assert.equal(d.action, 'demote');
    const { displacements } = demoteChain(['ica/x', 'claude/y'], ['ica/x']);
    assert.equal(displacements.length, 1);
    assert.equal(displacements[0].to - displacements[0].from, 1);
  });
});

// ===========================================================================
describe('C. §2.4.5.3 actuation — demotion-only, max 1 position, nothing removed', () => {
// ===========================================================================

  test('a demoted entry moves exactly one position later', () => {
    const { chain, displacements } = demoteChain(['a', 'b', 'c'], ['a']);
    assert.deepEqual(chain, ['b', 'a', 'c']);
    assert.deepEqual(displacements, [{ entry: 'a', from: 0, to: 1 }]);
  });

  test('promotion is impossible — a demoted entry never moves earlier', () => {
    const { chain } = demoteChain(['a', 'b', 'c'], ['c']);
    assert.deepEqual(chain, ['a', 'b', 'c'], 'the last entry has nowhere to be demoted to');
    for (const target of ['a', 'b', 'c']) {
      const out = demoteChain(['a', 'b', 'c'], [target]);
      const before = ['a', 'b', 'c'].indexOf(target);
      const after = out.chain.indexOf(target);
      assert.ok(after >= before, `${target}: index moved earlier (${before} → ${after})`);
    }
  });

  test('each entry is displaced at most ONCE per application (max_rank_displacement = 1)', () => {
    const { chain, displacements } = demoteChain(['a', 'b', 'c', 'd'], ['a']);
    assert.deepEqual(chain, ['b', 'a', 'c', 'd']);
    assert.equal(displacements.filter(d => d.entry === 'a').length, 1);
  });

  test('never-empty / length-invariant: actuation is a permutation, never a removal', () => {
    const chains = [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']];
    for (const c of chains) {
      for (const demoted of [['a'], ['a', 'b'], ['a', 'b', 'c'], c]) {
        const out = demoteChain(c, demoted);
        assert.equal(out.chain.length, c.length, `length changed for ${JSON.stringify(c)}`);
        assert.deepEqual(out.chain.slice().sort(), c.slice().sort(), 'membership changed');
      }
    }
  });

  test('last-candidate floor: a single-entry chain is a hard no-op', () => {
    const out = demoteChain(['claude/claude-sonnet-5'], ['claude/claude-sonnet-5']);
    assert.deepEqual(out.chain, ['claude/claude-sonnet-5']);
    assert.equal(out.displacements.length, 0);
  });

  test('a demoted entry is never swapped past another demoted entry (no peer promotion)', () => {
    const out = demoteChain(['a', 'b', 'c'], ['a', 'b']);
    // `a` stays put: its only move would promote `b`, an equally-demoted peer, which has no
    // evidentiary basis. `b` demotes past the non-demoted `c`. So a chain of adjacent bad
    // candidates converges slowly rather than churning — bounded by design, not a miss.
    assert.deepEqual(out.chain, ['a', 'c', 'b']);
    assert.deepEqual(out.displacements.map(d => d.entry), ['b']);
  });

  test('all-demoted chain: order is preserved, nothing churns', () => {
    const out = demoteChain(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.deepEqual(out.chain, ['a', 'b', 'c']);
    assert.equal(out.displacements.length, 0);
  });
});

// ===========================================================================
describe('D. §2.4.5.1 structural precedence + MUST-stay immunity', () => {
// ===========================================================================

  const overridesFor = (entry) => ({ exploration: { demotions: [{ entry, combined_signal: 0.9 }] } });

  test('feedback state is a DEDICATED file — routing.local.toml is never read or written by it', () => {
    const src = fs.readFileSync(path.join(skillDir, 'routing-feedback.js'), 'utf8');
    assert.ok(!/routing\.local\.toml['"]/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      'routing-feedback.js must not reference routing.local.toml as a path');
    assert.ok(/routing-feedback-overrides\.json/.test(src));
  });

  test('MUST-stay class is immune even with a matching demotion present', () => {
    const out = applyChainFeedback({
      taskClass: 'orchestration',
      chain: ['claude/claude-opus-5', 'claude/claude-sonnet-5'],
      feedbackOverrides: { orchestration: { demotions: [{ entry: 'claude/claude-opus-5' }] } },
      isMustStay: true,
    });
    assert.equal(out.applied, false);
    assert.equal(out.reason, 'must_stay_immune');
    assert.deepEqual(out.chain, ['claude/claude-opus-5', 'claude/claude-sonnet-5']);
  });

  test('human routing_policy_overrides for a class blocks ALL machine feedback on it', () => {
    const human = humanOverriddenTargets({ routing_policy_overrides: { exploration: { chain: ['claude/claude-haiku-4-5'] } } });
    const out = applyChainFeedback({
      taskClass: 'exploration',
      chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'],
      feedbackOverrides: overridesFor('ica/claude-haiku-4-5'),
      humanTargets: human,
    });
    assert.equal(out.applied, false);
    assert.equal(out.reason, 'human_override_precedence');
  });

  test('human priority_overrides makes that specific instance immune', () => {
    const human = humanOverriddenTargets({ priority_overrides: { '"ica/claude-haiku-4-5"': 0 } });
    assert.ok(human.entries.has('ica/claude-haiku-4-5'), 'TOML quoting is stripped');
    const out = applyChainFeedback({
      taskClass: 'exploration',
      chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'],
      feedbackOverrides: overridesFor('ica/claude-haiku-4-5'),
      humanTargets: human,
    });
    assert.equal(out.applied, false);
    assert.deepEqual(out.skipped, [{ entry: 'ica/claude-haiku-4-5', reason: 'human_override_precedence' }]);
  });

  test('precedence order is MUST-stay > human > machine > registry', () => {
    // MUST-stay beats human beats machine, checked as a chain of dominations rather than asserted
    // as prose: each stronger channel nullifies the weaker one's effect.
    const machine = overridesFor('ica/claude-haiku-4-5');
    const chain = ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'];
    const machineOnly = applyChainFeedback({ taskClass: 'exploration', chain, feedbackOverrides: machine });
    assert.equal(machineOnly.applied, true, 'machine beats registry default order');

    const vsHuman = applyChainFeedback({
      taskClass: 'exploration', chain, feedbackOverrides: machine,
      humanTargets: humanOverriddenTargets({ routing_policy_overrides: { exploration: {} } }),
    });
    assert.equal(vsHuman.applied, false, 'human beats machine');

    const vsMustStay = applyChainFeedback({
      taskClass: 'exploration', chain, feedbackOverrides: machine, isMustStay: true,
    });
    assert.equal(vsMustStay.applied, false, 'MUST-stay beats everything');
  });

  test('priority_overrides is NEVER emitted as the actuation lever', () => {
    const src = [
      fs.readFileSync(path.join(skillDir, 'routing-feedback.js'), 'utf8'),
      fs.readFileSync(path.join(skillDir, 'resolver.js'), 'utf8'),
    ].join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The resolver still READS priority_overrides (human channel, pre-existing). What must not
    // exist is feedback WRITING one: no assignment or object literal keyed by it in the feedback path.
    assert.ok(!/priority_overrides\s*[:=]\s*\{/.test(src), 'feedback must not construct priority_overrides');
    const merged = mergeFeedback({
      envelope: envelope(),
      rows: [row({ cost_index: 3.0 })],
      now: Date.parse('2026-08-03T00:00:00Z'),
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    assert.ok(!JSON.stringify(merged.state).includes('priority_overrides'));
  });
});

// ===========================================================================
describe('E. §2.4.6 discrete guardrails', () => {
// ===========================================================================

  const NOW = Date.parse('2026-08-03T00:00:00Z');

  test('demote fires at theta = 0.15 and not below', () => {
    // cost_index 1.5 → 0.5 * 0.3 = 0.15 exactly
    assert.equal(evaluateRow(row({ cost_index: 1.5 }), envelope()).action, 'demote');
    // cost_index 1.4 → 0.4 * 0.3 = 0.12 < theta
    assert.equal(evaluateRow(row({ cost_index: 1.4 }), envelope()).action, 'neutral');
  });

  test('restore below theta_restore = 0.08, only for an already-demoted key', () => {
    // cost_index 1.2 → 0.06 < 0.08
    const restored = evaluateRow(row({ cost_index: 1.2 }), envelope(), { wasDemoted: true });
    assert.equal(restored.action, 'restore');
    const neverDemoted = evaluateRow(row({ cost_index: 1.2 }), envelope(), { wasDemoted: false });
    assert.equal(neverDemoted.action, 'neutral');
  });

  test('anti-flap hysteresis band [0.08, 0.15) HOLDS an existing demotion', () => {
    // cost_index 1.4 → 0.12, inside the band
    const held = evaluateRow(row({ cost_index: 1.4 }), envelope(), { wasDemoted: true });
    assert.equal(held.action, 'hold');
    assert.ok(held.combined_signal >= ACTUATION_PARAMS.theta_restore);
    assert.ok(held.combined_signal < ACTUATION_PARAMS.theta);
  });

  test('hysteresis prevents flapping across a sequence of windows', () => {
    // A key oscillating inside the band must stay demoted, not toggle every window.
    let demoted = false;
    for (const ci of [1.6, 1.4, 1.35, 1.45, 1.4]) {
      const d = evaluateRow(row({ cost_index: ci }), envelope(), { wasDemoted: demoted });
      if (d.action === 'demote') demoted = true;
      else if (d.action === 'restore') demoted = false;
      assert.notEqual(d.action, 'restore', `ci=${ci} should not restore inside the band`);
    }
    assert.equal(demoted, true);
  });

  test('an override expires after its TTL window and stops being applied', () => {
    const merged = mergeFeedback({
      envelope: envelope(),
      rows: [row({ cost_index: 3.0 })],
      now: NOW,
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    const statePath = path.join(os.tmpdir(), `rf-state-${process.pid}-ttl.json`);
    writeFeedbackState(merged.state, { statePath });
    try {
      const fresh = loadFeedbackState({ statePath, now: NOW + 1000 });
      assert.ok(fresh.overrides.implementation, 'override live inside its window');
      // window is 7 days; TTL = 1 window → expired 8 days later
      const stale = loadFeedbackState({ statePath, now: NOW + (8 * 24 * 3600 * 1000) });
      assert.deepEqual(stale.overrides, {}, 'expired override must be dropped');
      assert.equal(stale.expired, 1);
    } finally {
      fs.unlinkSync(statePath);
    }
  });

  test('a re-confirmed override refreshes its expiry (TTL = not re-confirmed, not absolute age)', () => {
    const first = mergeFeedback({
      envelope: envelope(), rows: [row({ cost_index: 3.0 })], now: NOW,
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    const later = NOW + (6 * 24 * 3600 * 1000);
    const second = mergeFeedback({
      envelope: envelope(), rows: [row({ cost_index: 3.0 })], now: later,
      priorState: first.state,
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    const firstExp = Date.parse(first.state.overrides.implementation.demotions[0].expires_at);
    const secondExp = Date.parse(second.state.overrides.implementation.demotions[0].expires_at);
    assert.ok(secondExp > firstExp, 're-confirmation must push the expiry forward');
  });

  test('minimum-sample defense: eligible_for_adjustment=false contributes nothing', () => {
    const d = evaluateRow(row({ eligible_for_adjustment: false, cost_index: 9.0 }), envelope());
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'not_eligible_for_adjustment');
    const merged = mergeFeedback({
      envelope: envelope(),
      rows: [row({ eligible_for_adjustment: false, cost_index: 9.0 })],
      now: NOW, opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    assert.deepEqual(merged.state.overrides, {});
  });

  test('instant feature disable: AOS_ROUTING_FEEDBACK=0 turns consumption off', () => {
    for (const v of ['0', 'false', 'no', 'off', 'OFF']) {
      const gate = isFeedbackConsumptionEnabled({ contract: enabledContract, env: { AOS_ROUTING_FEEDBACK: v } });
      assert.equal(gate.enabled, false, `value '${v}' must disable`);
      assert.equal(gate.reason, 'env_disabled');
    }
    assert.equal(isFeedbackConsumptionEnabled({ contract: enabledContract, env: ENABLED_ENV }).enabled, true);
  });

  test('the COMMITTED contract keeps live_consumption disabled (the DI-1 gate is not flipped)', () => {
    assert.notEqual(pinnedContract.live_consumption, 'enabled');
    const gate = isFeedbackConsumptionEnabled({ env: ENABLED_ENV });
    assert.equal(gate.enabled, false);
    assert.equal(gate.reason, 'live_consumption_disabled');
  });

  test('merge runs as an inspectable DRY RUN while the gate is closed', () => {
    const merged = mergeFeedback({
      envelope: envelope(), rows: [row({ cost_index: 3.0 })], now: NOW,
      opts: { env: ENABLED_ENV },  // real, still-disabled contract
    });
    assert.equal(merged.applied, false);
    assert.equal(merged.gate_reason, 'live_consumption_disabled');
    assert.ok(merged.state.overrides.implementation, 'state is still computed for inspection');
  });

  test('a missing / malformed / future-schema state file degrades to no overrides, never throws', () => {
    assert.deepEqual(loadFeedbackState({ statePath: '/nonexistent/rf.json' }).overrides, {});
    const bad = path.join(os.tmpdir(), `rf-state-${process.pid}-bad.json`);
    fs.writeFileSync(bad, '{not json', 'utf8');
    try {
      assert.deepEqual(loadFeedbackState({ statePath: bad }).overrides, {});
    } finally { fs.unlinkSync(bad); }
    const future = path.join(os.tmpdir(), `rf-state-${process.pid}-v99.json`);
    fs.writeFileSync(future, JSON.stringify({ schema_version: 99, overrides: { exploration: { demotions: [{ entry: 'x' }] } } }), 'utf8');
    try {
      const out = loadFeedbackState({ statePath: future });
      assert.deepEqual(out.overrides, {});
      assert.equal(out.load_reason, 'schema_mismatch');
    } finally { fs.unlinkSync(future); }
  });
});

// ===========================================================================
describe('F. SPEC invariants 9 + 11 — fail-closed join discipline', () => {
// ===========================================================================

  test('raw source_skill_name is never passed to resolve() as a task_class', () => {
    const src = fs.readFileSync(path.join(skillDir, 'routing-feedback.js'), 'utf8');
    assert.ok(!/require\(['"]\.\/resolver/.test(src),
      'routing-feedback.js must not import the resolver (no path from a raw skill_name to resolve())');
    assert.ok(/validateFeedbackJoin/.test(src), 'the join validator is the only entry point');
  });

  test('an unmapped source_skill_name yields no adjustment', () => {
    const d = evaluateRow(row({ source_skill_name: 'totally-unknown-skill', cost_index: 9.0 }), envelope());
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'join_rejected:unmapped_source_skill_name');
  });

  test('a digest mismatch yields no adjustment', () => {
    const d = evaluateRow(row({ cost_index: 9.0 }), envelope({ mapping_digest: 'sha256:deadbeef' }));
    assert.equal(d.reason, 'join_rejected:mapping_mismatch');
    const t = evaluateRow(row({ cost_index: 9.0 }), envelope({ taxonomy_digest: 'sha256:deadbeef' }));
    assert.equal(t.reason, 'join_rejected:taxonomy_mismatch');
  });

  test('an unknown producer yields no adjustment', () => {
    const d = evaluateRow(row({ cost_index: 9.0 }), envelope({ producer: 'some-other-tool' }));
    assert.equal(d.reason, 'join_rejected:unknown_producer');
  });

  test('_unclassified / telemetry-only keys yield no adjustment', () => {
    const d = evaluateRow(
      row({ source_skill_name: 'codex', task_class: '_unclassified', cost_index: 9.0 }),
      envelope()
    );
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'join_rejected:telemetry_only_class');
  });

  test('a MUST-stay key yields no adjustment even with a terrible signal', () => {
    const d = evaluateRow(
      row({ source_skill_name: 'op', task_class: 'orchestration', success_rate: 0.0, cost_index: 5.0 }),
      envelope()
    );
    assert.equal(d.action, 'skip');
    assert.equal(d.reason, 'join_rejected:must_stay_primary_no_adjustment');
  });

  test('a source→class mismatch (coincidental string match) yields no adjustment', () => {
    const d = evaluateRow(
      row({ source_skill_name: 'dev-execution', task_class: 'mechanical', cost_index: 9.0 }),
      envelope()
    );
    assert.equal(d.reason, 'join_rejected:source_task_class_mismatch');
  });

  test('rejected rows never reach the state file', () => {
    const merged = mergeFeedback({
      envelope: envelope(),
      rows: [
        row({ source_skill_name: 'unknown-x', cost_index: 9.0 }),
        row({ source_skill_name: 'op', task_class: 'orchestration', cost_index: 9.0 }),
        row({ source_skill_name: 'codex', task_class: '_unclassified', cost_index: 9.0 }),
      ],
      now: Date.parse('2026-08-03T00:00:00Z'),
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    assert.deepEqual(merged.state.overrides, {});
    assert.equal(merged.decisions.filter(d => d.action === 'demote').length, 0);
  });
});

// ===========================================================================
describe('G. §2.4.5.4 RoutingRecord provenance — the action AND the reason', () => {
// ===========================================================================

  test('provenance carries rank_displacement plus combined_signal and the evidence block', () => {
    const d = evaluateRow(row({ success_rate: 0.2, cost_index: 2.0, regression_rate: 0.5 }), envelope());
    const prov = buildFeedbackProvenance({
      taskClass: 'implementation',
      actuation: 'chain_demotion',
      displacements: [{ entry: 'claude/claude-sonnet-5', from: 0, to: 1, combined_signal: d.combined_signal, evidence: d.evidence }],
      selectedEntry: 'claude/other',
    });
    assert.equal(prov.source, FEEDBACK_SOURCE);
    assert.equal(prov.actuation, 'chain_demotion');
    assert.equal(prov.rank_displacement.length, 1);
    assertClose(prov.rank_displacement[0].combined_signal, 0.750);
    const ev = prov.rank_displacement[0].evidence;
    for (const field of ['success_rate', 'cost_index', 'regression_rate', 'sample_count', 'confidence']) {
      assert.ok(field in ev, `evidence must carry ${field}`);
    }
    assert.deepEqual(ev.terms_live.sort(), ['cost', 'failure', 'regression']);
    assert.equal(prov.selected_entry_displaced, false);
  });

  test('provenance is null when nothing was applied (no empty blocks in the audit log)', () => {
    assert.equal(buildFeedbackProvenance({ taskClass: 'x', actuation: 'chain_demotion', displacements: [] }), null);
  });

  test('validateRoutingRecord rejects a PROMOTION disguised as provenance', () => {
    const r = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [{ entry: 'a', from: 2, to: 1 }] } };
    assert.throws(() => validateRoutingRecord(r), /demotion-only/);
  });

  test('validateRoutingRecord rejects a displacement larger than the bound', () => {
    assert.equal(MAX_RANK_DISPLACEMENT, 1);
    const r = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [{ entry: 'a', from: 0, to: 2 }] } };
    assert.throws(() => validateRoutingRecord(r), /exceeds the bounded maximum/);
  });

  test('validateRoutingRecord rejects a provenance block with no applied action', () => {
    const r = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [] } };
    assert.throws(() => validateRoutingRecord(r), /non-empty array/);
  });

  test('validateRoutingRecord rejects a displacement with no combined_signal (unauditable)', () => {
    const r = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [{ entry: 'a', from: 0, to: 1 }] } };
    assert.throws(() => validateRoutingRecord(r), /must be present/);
  });

  test('routing_feedback is additive+optional — an 11-field legacy record still validates', () => {
    const legacy = createEmptyRecord();
    delete legacy.routing_feedback;
    delete legacy.context_ref;
    delete legacy.context_class;
    assert.doesNotThrow(() => validateRoutingRecord(legacy));
  });

  test('MUST-stay immunity is enforced at the EMITTER: provenance is stripped', () => {
    const r = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [{ entry: 'a', from: 0, to: 1, combined_signal: 0.4 }] } };
    finalizeRoutingRecord(r, 'orchestration');
    assert.equal(r.routing_feedback, null);
    const ok = { ...createEmptyRecord(), routing_feedback: { rank_displacement: [{ entry: 'a', from: 0, to: 1, combined_signal: 0.4 }] } };
    finalizeRoutingRecord(ok, 'implementation');
    assert.ok(ok.routing_feedback, 'a routable class keeps its provenance');
  });
});

// ===========================================================================
describe('H. end-to-end — feedback actually changes a resolver decision', () => {
// ===========================================================================

  function testRegistry() {
    return {
      version: 1,
      routing_policy: {
        exploration: { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'], enabled: true },
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

  function withFixtures(state, fn) {
    const regPath = path.join(os.tmpdir(), `rf-reg-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
    const statePath = path.join(os.tmpdir(), `rf-st-${process.pid}-${Math.floor(process.hrtime()[1])}.json`);
    fs.writeFileSync(regPath, JSON.stringify(testRegistry()), 'utf8');
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
    // Point cwd-relative local-override discovery at a path that does not exist, so the human
    // channel is genuinely absent rather than accidentally inherited from the runner's cwd.
    const noLocal = path.join(os.tmpdir(), `rf-nolocal-${process.pid}.toml`);
    try {
      return fn({ regPath, statePath, noLocal });
    } finally {
      fs.unlinkSync(regPath);
      fs.unlinkSync(statePath);
    }
  }

  const demotionState = (entry) => ({
    schema_version: 1,
    source: FEEDBACK_SOURCE,
    overrides: {
      exploration: {
        demotions: [{
          entry,
          combined_signal: 0.45,
          evidence: { success_rate: null, cost_index: 2.5, regression_rate: null, sample_count: 80, confidence: 0.9, terms_live: ['cost'] },
          expires_at: '2099-01-01T00:00:00Z',
          source: FEEDBACK_SOURCE,
        }],
      },
    },
  });

  test('baseline (no feedback): exploration resolves to the chain head, ica', () => {
    withFixtures(demotionState('ica/claude-haiku-4-5'), ({ regPath, noLocal }) => {
      const rec = resolve({
        model: 'haiku', task_class: 'exploration',
        _registryPath: regPath, _localConfigPath: noLocal,
        // feedback left at its real (disabled) contract → must not apply
      });
      assert.equal(rec.chosen_plugin_id, 'ica');
      assert.equal(rec.routing_feedback, null);
    });
  });

  test('with the gate open and a demotion present, the chain head is demoted and claude is chosen', () => {
    withFixtures(demotionState('ica/claude-haiku-4-5'), ({ regPath, statePath, noLocal }) => {
      const rec = resolve({
        model: 'haiku', task_class: 'exploration',
        _registryPath: regPath, _localConfigPath: noLocal,
        _feedbackContract: enabledContract, _feedbackEnv: ENABLED_ENV, _feedbackStatePath: statePath,
      });
      assert.equal(rec.chosen_plugin_id, 'claude', 'the demoted ica lane must lose to claude');
      assert.ok(rec.routing_feedback, 'the applied adjustment is recorded');
      assert.equal(rec.routing_feedback.actuation, 'chain_demotion');
      assert.deepEqual(rec.routing_feedback.rank_displacement.map(d => [d.entry, d.from, d.to]),
        [['ica/claude-haiku-4-5', 0, 1]]);
      assertClose(rec.routing_feedback.rank_displacement[0].combined_signal, 0.45);
      assert.ok(/empirical-feedback re-ranked/.test(rec.reason), 'the human-readable reason says so too');
    });
  });

  test('the kill switch restores baseline behavior with the state file still on disk', () => {
    withFixtures(demotionState('ica/claude-haiku-4-5'), ({ regPath, statePath, noLocal }) => {
      const rec = resolve({
        model: 'haiku', task_class: 'exploration',
        _registryPath: regPath, _localConfigPath: noLocal,
        _feedbackContract: enabledContract, _feedbackEnv: { AOS_ROUTING_FEEDBACK: '0' },
        _feedbackStatePath: statePath,
      });
      assert.equal(rec.chosen_plugin_id, 'ica');
      assert.equal(rec.routing_feedback, null);
    });
  });

  test('an expired override is not applied even with the gate open', () => {
    const expired = demotionState('ica/claude-haiku-4-5');
    expired.overrides.exploration.demotions[0].expires_at = '2020-01-01T00:00:00Z';
    withFixtures(expired, ({ regPath, statePath, noLocal }) => {
      const rec = resolve({
        model: 'haiku', task_class: 'exploration',
        _registryPath: regPath, _localConfigPath: noLocal,
        _feedbackContract: enabledContract, _feedbackEnv: ENABLED_ENV, _feedbackStatePath: statePath,
      });
      assert.equal(rec.chosen_plugin_id, 'ica');
      assert.equal(rec.routing_feedback, null);
    });
  });

  test('a MUST-stay class still routes to claude with no provenance, gate open', () => {
    const state = demotionState('claude/claude-opus-5');
    state.overrides.orchestration = state.overrides.exploration;
    withFixtures(state, ({ regPath, statePath, noLocal }) => {
      const rec = resolve({
        model: 'opus', task_class: 'orchestration',
        _registryPath: regPath, _localConfigPath: noLocal,
        _feedbackContract: enabledContract, _feedbackEnv: ENABLED_ENV, _feedbackStatePath: statePath,
      });
      assert.equal(rec.chosen_plugin_id, 'claude');
      assert.ok(!rec.routing_feedback);
    });
  });

  test('a demotion on the LAST chain entry changes nothing (floor holds end-to-end)', () => {
    withFixtures(demotionState('claude/claude-haiku-4-5'), ({ regPath, statePath, noLocal }) => {
      const rec = resolve({
        model: 'haiku', task_class: 'exploration',
        _registryPath: regPath, _localConfigPath: noLocal,
        _feedbackContract: enabledContract, _feedbackEnv: ENABLED_ENV, _feedbackStatePath: statePath,
      });
      assert.equal(rec.chosen_plugin_id, 'ica');
      assert.equal(rec.routing_feedback, null);
    });
  });

  test('full loop: CCDash rows → mergeFeedback → state file → changed decision', () => {
    const merged = mergeFeedback({
      envelope: envelope(),
      rows: [row({
        source_skill_name: 'firecrawl', task_class: 'web_research',
        model: 'claude-haiku-4-5', provider: 'ica',
        cost_index: 2.5, success_rate: null, regression_rate: null,
      })],
      now: Date.parse('2026-08-03T00:00:00Z'),
      opts: { contract: enabledContract, env: ENABLED_ENV },
    });
    assert.equal(merged.applied, true);
    const demotion = merged.state.overrides.web_research.demotions[0];
    assert.equal(demotion.entry, 'ica/claude-haiku-4-5');
    assertClose(demotion.combined_signal, 1.5 * 0.3);

    const reg = testRegistry();
    reg.routing_policy.web_research = { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'], enabled: true };
    const regPath = path.join(os.tmpdir(), `rf-reg-loop-${process.pid}.json`);
    const statePath = path.join(os.tmpdir(), `rf-st-loop-${process.pid}.json`);
    fs.writeFileSync(regPath, JSON.stringify(reg), 'utf8');
    writeFeedbackState(merged.state, { statePath });
    try {
      const rec = resolve({
        model: 'haiku', task_class: 'web_research',
        _registryPath: regPath,
        _localConfigPath: path.join(os.tmpdir(), 'rf-absent.toml'),
        _feedbackContract: enabledContract, _feedbackEnv: ENABLED_ENV, _feedbackStatePath: statePath,
        _feedbackNow: Date.parse('2026-08-04T00:00:00Z'),
      });
      assert.equal(rec.chosen_plugin_id, 'claude', 'the expensive ica lane was demoted by its own evidence');
      assert.equal(rec.routing_feedback.rank_displacement[0].entry, 'ica/claude-haiku-4-5');
    } finally {
      fs.unlinkSync(regPath);
      fs.unlinkSync(statePath);
    }
  });
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount === 0) console.log('All routing-feedback tests passed.');
process.exit(failCount > 0 ? 1 : 0);
