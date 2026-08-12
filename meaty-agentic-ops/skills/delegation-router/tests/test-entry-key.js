/**
 * entry-key.js tests — tests/test-entry-key.js (DI-1)
 *
 * Covers the canonicalizer itself: (provider, model) → `provider/alias`, fail-closed on an
 * out-of-vocabulary provider or an unresolvable model, and NEVER a guessed coercion.
 *
 *   AC1: canonicalizeEntry / canonicalizeEntryString resolve via exact alias hit, reverse
 *        providers[*].model_id lookup, and registry-declared observed_ids — in that order.
 *   AC3: an out-of-vocabulary provider token fails closed with a DISTINCT reason
 *        (`unknown_provider`), never silently lowercased into a coincidental match, and
 *        `OpenAI` specifically must NOT be coerced to `codex`.
 *   (no prefix match): a plausible-but-unobserved dated slug fails closed — `unknown_model`,
 *        not a truncated alias.
 *
 * Uses this repo's own model-registry.generated.json (the real, injected registry — this
 * module's registry param is what keeps it offline: no network, no fs write, deterministic).
 *
 * NO shell, NO child_process, NO network. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-entry-key.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
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
  providerVocabulary,
  buildModelIndex,
  canonicalizeEntry,
  canonicalizeEntryString,
} = require(path.join(skillDir, 'entry-key.js'));
const { chainEntryKey, applyChainFeedback } = require(path.join(skillDir, 'routing-feedback.js'));

// The REAL registry, injected explicitly (offline: fs.readFileSync of a file already on disk,
// no network) — proves the fix against the actual observed_ids this contract requires, not a
// hand-idealized stand-in.
const registry = JSON.parse(fs.readFileSync(path.join(skillDir, 'model-registry.generated.json'), 'utf8'));

// The live fixture — 56 rows captured verbatim from the CCDash node rollup on 2026-08-11.
// Provider casing, dated model slugs, and out-of-vocabulary provider tokens are exactly as the
// producer emits them (see the fixture's own `_README`).
const fixture = JSON.parse(
  fs.readFileSync(path.join(skillDir, 'tests', 'fixtures', 'ccdash-routing-rollup.live.json'), 'utf8')
);
const rows = fixture.rows;

function findRow(pred) {
  const row = rows.find(pred);
  assert.ok(row, 'expected fixture row not found — has the fixture changed shape?');
  return row;
}

// ===========================================================================
describe('AC1 — canonicalization resolves via alias / model_id / observed_ids', () => {
// ===========================================================================

  test('provider vocabulary is the exact registry union (bob, claude, codex, gemini, ica, nano-banana, sora)', () => {
    assert.deepEqual(
      [...providerVocabulary(registry)].sort(),
      ['bob', 'claude', 'codex', 'gemini', 'ica', 'nano-banana', 'sora']
    );
  });

  test('exact alias hit: model already equals a `models` key', () => {
    const res = canonicalizeEntry('claude', 'claude-haiku-4-5', registry);
    assert.deepEqual(res, { ok: true, key: 'claude/claude-haiku-4-5' });
  });

  test('reverse providers[*].model_id lookup resolves an ICA [1m]-suffixed model id to its alias', () => {
    const res = canonicalizeEntry('ica', 'claude-sonnet-4-6[1m]', registry);
    assert.equal(res.ok, true);
    assert.equal(res.key, 'ica/claude-sonnet-4-6');
  });

  test('the dated slug appears NOWHERE via alias/model_id — only observed_ids resolves it', () => {
    const { byAlias, idToAlias } = buildModelIndex(registry);
    assert.ok(!byAlias.has('claude-haiku-4-5-20251001'));
    // it DOES resolve overall (through observed_ids specifically)
    assert.equal(idToAlias.get('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  });

  test('provider case-fold: "Claude" resolves the same as "claude"', () => {
    const upper = canonicalizeEntry('Claude', 'claude-haiku-4-5', registry);
    const lower = canonicalizeEntry('claude', 'claude-haiku-4-5', registry);
    assert.deepEqual(upper, lower);
  });

  test('AC2 — a REAL fixture row (provider "Claude", dated haiku slug) canonicalizes to claude/claude-haiku-4-5', () => {
    const row = findRow(r => r.provider === 'Claude' && r.model === 'claude-haiku-4-5-20251001' && r.task_class === 'mechanical');
    const rawEntry = chainEntryKey(row); // "Claude/claude-haiku-4-5-20251001" — unchanged, as documented
    assert.equal(rawEntry, 'Claude/claude-haiku-4-5-20251001');
    const res = canonicalizeEntryString(rawEntry, registry);
    assert.deepEqual(res, { ok: true, key: 'claude/claude-haiku-4-5' });
  });

  test('AC2 — the same row JOINS a chain that literally contains "claude/claude-haiku-4-5" (not entry_not_in_chain)', () => {
    const row = findRow(r => r.provider === 'Claude' && r.model === 'claude-haiku-4-5-20251001' && r.task_class === 'mechanical');
    const out = applyChainFeedback({
      taskClass: 'mechanical',
      chain: ['claude/claude-haiku-4-5', 'claude/claude-sonnet-5'],
      feedbackOverrides: { mechanical: { demotions: [{ entry: chainEntryKey(row), combined_signal: 0.9 }] } },
      registry,
    });
    assert.equal(out.applied, true, 'the join succeeded and produced a displacement');
    assert.equal(out.skipped.length, 0, 'nothing was skipped — the dated/cased row joined cleanly');
    assert.deepEqual(out.chain, ['claude/claude-sonnet-5', 'claude/claude-haiku-4-5']);
  });

  test('the returned chain preserves ORIGINAL entry strings — a non-alias [1m] entry is not rewritten', () => {
    const row = findRow(r => r.provider === 'Claude' && r.model === 'claude-haiku-4-5-20251001' && r.task_class === 'mechanical');
    // A chain with a per-provider model id that is NOT itself the alias — proves the join
    // canonicalizes for COMPARISON only and never mutates a chain entry into its canonical form.
    const chain = ['claude/claude-haiku-4-5', 'ica/claude-sonnet-4-6[1m]'];
    const out = applyChainFeedback({
      taskClass: 'mechanical',
      chain,
      feedbackOverrides: { mechanical: { demotions: [{ entry: chainEntryKey(row), combined_signal: 0.9 }] } },
      registry,
    });
    assert.equal(out.applied, true);
    assert.deepEqual(out.chain, ['ica/claude-sonnet-4-6[1m]', 'claude/claude-haiku-4-5']);
    assert.equal(out.chain[0], 'ica/claude-sonnet-4-6[1m]', 'the [1m] entry survives untouched, not rewritten to its canonical form');
    assert.deepEqual(out.displacements.map(d => d.entry), ['claude/claude-haiku-4-5'], 'displacement entry is the ORIGINAL chain string');
  });
});

// ===========================================================================
describe('AC3 — fail-closed on an out-of-vocabulary provider (never a guessed coercion)', () => {
// ===========================================================================

  test('"OpenAI" fails closed as unknown_provider — and specifically is NOT coerced to "codex"', () => {
    const row = findRow(r => r.provider === 'OpenAI');
    const res = canonicalizeEntry(row.provider, row.model, registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_provider' });
    // Directly rule out the tempting-but-forbidden guess: codex is a real provider in-vocab,
    // so a same-family coercion would silently succeed rather than fail — assert it does not.
    const wouldBeCodex = canonicalizeEntry('codex', row.model, registry);
    assert.notDeepEqual(res, { ok: true, key: wouldBeCodex.ok ? wouldBeCodex.key : undefined });
  });

  test('"<synthetic>" fails closed as unknown_provider', () => {
    const row = findRow(r => r.provider === '<synthetic>');
    const res = canonicalizeEntry(row.provider, row.model, registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_provider' });
  });

  test('"" (empty provider) fails closed as unknown_provider', () => {
    const row = findRow(r => r.provider === '');
    const res = canonicalizeEntry(row.provider, row.model, registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_provider' });
  });

  test('all three out-of-vocabulary rows produce NO adjustment when run through applyChainFeedback', () => {
    for (const provider of ['OpenAI', '<synthetic>', '']) {
      const row = findRow(r => r.provider === provider);
      const out = applyChainFeedback({
        taskClass: 'mechanical',
        chain: ['claude/claude-haiku-4-5', 'claude/claude-sonnet-5'],
        feedbackOverrides: { mechanical: { demotions: [{ entry: chainEntryKey(row), combined_signal: 0.9 }] } },
        registry,
      });
      assert.equal(out.applied, false, `provider '${provider}' must not actuate`);
      assert.equal(out.skipped.length, 1);
      assert.equal(out.skipped[0].reason, 'unknown_provider', `provider '${provider}' must be reported distinctly, not entry_not_in_chain`);
    }
  });

  test('a valid provider with a genuinely unrecognized model fails closed as unknown_model, distinct from unknown_provider', () => {
    const res = canonicalizeEntry('claude', 'claude-does-not-exist', registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_model' });
  });
});

// ===========================================================================
describe('no prefix match / no regex date-stripping', () => {
// ===========================================================================

  test('a plausible-but-unobserved dated slug for a model WITH observed_ids fails closed rather than truncating to the alias', () => {
    // claude-haiku-4-5's observed_ids is exactly ["claude-haiku-4-5-20251001"] (§2 of the DI-1
    // contract) — a different, equally plausible dated slug for the SAME model must not be
    // accepted by any prefix/regex trick; only ids actually observed on the wire resolve.
    const res = canonicalizeEntry('claude', 'claude-haiku-4-5-20260615', registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_model' });
  });

  test('a dated slug for a model with NO observed_ids entry at all fails closed', () => {
    const res = canonicalizeEntry('claude', 'claude-sonnet-4-6-20250101', registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_model' });
  });

  test('splitEntry-level malformed input (no separator) fails closed as unknown_provider, not a crash', () => {
    const res = canonicalizeEntryString('not-a-provider-model-string', registry);
    assert.deepEqual(res, { ok: false, reason: 'unknown_provider' });
  });
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount === 0) console.log('All entry-key tests passed.');
process.exit(failCount > 0 ? 1 : 0);
