/**
 * Tool-mode gate + Sol->Terra->Sol sandwich tests — tests/test-tool-mode-and-sandwich.js
 *
 * Covers the `needs_tools` input and `resolveSandwich()` helper added 2026-08-27
 * (node_01M122PQQ86YWJWDA9GT83PBWQ, citing node_01M0Z7JP9YT7W15X94Z843AM9Y).
 *
 * WHY THIS AXIS EXISTS. gpt-5.6-sol reasons genuinely on the ICA ccx lane ONLY when no tool
 * call is made — reasoning_tokens=0 the instant one is, on both /v1/chat/completions and
 * /v1/responses (measured 2026-08-26/27). Rather than leaving the whole ica/gpt-5.6-sol
 * instance disabled, the registry row is enabled with `tool_mode: "none"` and the resolver
 * refuses to route a tool-requiring request there. Mirrors the shape of the `requires_write`
 * axis (see test-write-authority.js) but is per-INSTANCE, not per-provider: codex/gpt-5.6-sol
 * (native codex CLI) is NOT restricted, only the ICA row is.
 *
 * THE MOST IMPORTANT CASE HERE IS (b): the DEFAULT (no needs_tools passed) must exclude the
 * restricted instance. The polarity is deliberately inverted from requires_write (which
 * defaults false/permissive) — an undeclared caller might attempt a tool call, and a
 * restricted instance would silently forfeit reasoning rather than error, so the safe default
 * is exclusion, not inclusion.
 *
 * NO shell, NO child_process. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-tool-mode-and-sandwich.js
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
const { resolve, resolveSandwich } = require(resolverPath);

// ---------------------------------------------------------------------------
// Fixture: a registry with a tool-restricted ica/gpt-5.6-sol row, an UNrestricted
// codex/gpt-5.6-sol row (native codex CLI is not subject to the ICA-only constraint), and a
// codex/gpt-5.6-terra row for the sandwich's execute leg.
// ---------------------------------------------------------------------------

function writeRegistry(reg) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-reg-')), 'registry.json');
  fs.writeFileSync(p, JSON.stringify(reg));
  return p;
}

const FIXTURE_REGISTRY = {
  version: 1,
  routing_policy: {
    review: { chain: ['ica/gpt-5.6-sol'], enabled: true },
    mechanical: { chain: ['ica/claude-haiku-4-5'], enabled: true },
    implementation: { chain: ['codex/gpt-5.6-terra'], enabled: true },
  },
  must_stay_primary: [],
  models: {
    'gpt-5.6-sol': {
      class: 'codex',
      sampling: 'deterministic',
      status: 'active',
      providers: [
        { provider: 'codex', model_id: 'gpt-5.6-sol', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
        { provider: 'ica', model_id: 'gpt-5.6-sol', cost_tier: 'premium', allowance: 'shared_token_pool', enabled: true, priority: 2, tool_mode: 'none' },
      ],
    },
    'gpt-5.6-terra': {
      class: 'codex',
      sampling: 'deterministic',
      status: 'active',
      providers: [
        { provider: 'codex', model_id: 'gpt-5.6-terra', cost_tier: 'premium', allowance: 'billed', enabled: true, priority: 1 },
      ],
    },
    'claude-haiku-4-5': {
      class: 'haiku',
      sampling: 'deterministic',
      status: 'active',
      providers: [
        { provider: 'ica', model_id: 'claude-haiku-4-5', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
      ],
    },
  },
};

const registryPath = writeRegistry(FIXTURE_REGISTRY);

// ---------------------------------------------------------------------------

describe('(a) needs_tools:false reaches the tool_mode:"none" instance', () => {
  test('task_class=review + needs_tools:false resolves to ica/gpt-5.6-sol', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', needs_tools: false, _registryPath: registryPath,
    });
    assert.equal(record.chosen_plugin_id, 'ica');
    assert.equal(record.model, 'gpt-5.6-sol');
  });

  test('the invocation_template carries --allowedTools "" (real enforcement, not description-only)', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', needs_tools: false, _registryPath: registryPath,
    });
    assert.ok(record.invocation_template.includes('--allowedTools ""'),
      `invocation_template missing --allowedTools "": ${record.invocation_template}`);
  });

  test('scope_flags also carries the tool-less marker', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', needs_tools: false, _registryPath: registryPath,
    });
    assert.ok(record.scope_flags.includes('--allowedTools ""'));
  });

  test('reason string documents the tool_mode restriction', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', needs_tools: false, _registryPath: registryPath,
    });
    assert.ok(/tool_mode:"none"/.test(record.reason), record.reason);
  });
});

describe('(b) DEFAULT (no needs_tools) excludes the restricted instance — the important case', () => {
  test('task_class=review with NO needs_tools falls through to codex/gpt-5.6-sol, not ica', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', _registryPath: registryPath,
    });
    assert.notEqual(record.chosen_plugin_id, 'ica');
    assert.equal(record.chosen_plugin_id, 'codex');
  });

  test('explicit needs_tools:true has the same effect as omitting it', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', needs_tools: true, _registryPath: registryPath,
    });
    assert.equal(record.chosen_plugin_id, 'codex');
  });

  test('chosen codex instance carries no --allowedTools restriction', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', task_class: 'review', _registryPath: registryPath,
    });
    assert.ok(!record.invocation_template.includes('--allowedTools'));
    assert.ok(!record.scope_flags.includes('--allowedTools ""'));
  });
});

describe('(c) explicit provider=ica override respects the same gate', () => {
  // task_class deliberately has NO routing_policy entry in the fixture, so selection falls
  // through the explicit-provider path (step 1) and, when that is excluded, the per-model
  // ranked fallback (step 3) — never an unrelated chain (step 2) picking a different model.
  test('needs_tools:false + explicit provider=ica resolves to the restricted instance', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', provider: 'ica', task_class: 'no_such_class', needs_tools: false, _registryPath: registryPath,
    });
    assert.equal(record.chosen_plugin_id, 'ica');
    assert.equal(record.model, 'gpt-5.6-sol');
  });

  test('needs_tools unset + explicit provider=ica falls through to codex/gpt-5.6-sol (ica excluded)', () => {
    const record = resolve({
      model: 'gpt-5.6-sol', provider: 'ica', task_class: 'no_such_class', _registryPath: registryPath,
    });
    assert.equal(record.chosen_plugin_id, 'codex');
    assert.equal(record.model, 'gpt-5.6-sol');
  });
});

describe('(d) an unrelated model/class is unaffected by the gate', () => {
  test('a non-restricted model resolves normally regardless of needs_tools', () => {
    const record = resolve({
      model: 'claude-haiku-4-5', task_class: 'mechanical', _registryPath: registryPath,
    });
    assert.equal(record.chosen_plugin_id, 'ica');
    assert.equal(record.model, 'claude-haiku-4-5');
  });
});

describe('(e) resolveSandwich() composes three independently-valid legs', () => {
  test('plan leg is tool-less Sol', () => {
    const { plan } = resolveSandwich({ _registryPath: registryPath });
    assert.equal(plan.chosen_plugin_id, 'ica');
    assert.equal(plan.model, 'gpt-5.6-sol');
    assert.ok(plan.invocation_template.includes('--allowedTools ""'));
  });

  test('execute leg is Terra WITH tools (no --allowedTools restriction)', () => {
    const { execute } = resolveSandwich({ _registryPath: registryPath });
    assert.equal(execute.chosen_plugin_id, 'codex');
    assert.equal(execute.model, 'gpt-5.6-terra');
    assert.ok(!execute.invocation_template.includes('--allowedTools'));
  });

  test('review leg is tool-less Sol, same shape as plan', () => {
    const { review } = resolveSandwich({ _registryPath: registryPath });
    assert.equal(review.chosen_plugin_id, 'ica');
    assert.equal(review.model, 'gpt-5.6-sol');
    assert.ok(review.invocation_template.includes('--allowedTools ""'));
  });

  test('a caller-supplied task_class is ignored per-leg (each leg pins its own)', () => {
    const { plan, execute, review } = resolveSandwich({ task_class: 'mechanical', _registryPath: registryPath });
    assert.equal(plan.chosen_plugin_id, 'ica');
    assert.equal(execute.chosen_plugin_id, 'codex');
    assert.equal(review.chosen_plugin_id, 'ica');
  });

  test('legOverrides.execute can repoint the execute leg', () => {
    const { execute } = resolveSandwich(
      { _registryPath: registryPath },
      { execute: { task_class: 'mechanical', model: 'claude-haiku-4-5', provider: 'ica' } },
    );
    assert.equal(execute.chosen_plugin_id, 'ica');
    assert.equal(execute.model, 'claude-haiku-4-5');
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('All tool-mode/sandwich tests passed.');
