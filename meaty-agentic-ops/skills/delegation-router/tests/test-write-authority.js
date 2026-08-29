/**
 * Write-authority filter tests — tests/test-write-authority.js
 *
 * Covers the `requires_write` input added 2026-08-17 (node_01M06NSPRWSS987V5DMZXHRVJ5).
 *
 * WHY THIS AXIS EXISTS. The task-class taxonomy classifies the KIND OF COGNITION, never
 * whether a leg must emit a file — `implementation`, `documentation` and `mechanical` are all
 * `routable`, so all three were eligible for an agent type that cannot write. Three
 * file-authoring legs were routed to `ica-executor` on 2026-08-16 and produced zero files for
 * ~610k subagent tokens. Nothing in the record told the resolver those legs authored anything.
 *
 * THE MOST IMPORTANT CASE HERE IS (d): `requires_write: true` must still choose `ica`.
 * ica-executor GAINED write authority in the same change, so a test that merely asserted
 * "requires_write avoids offload" would pass while silently re-breaking the free lane. If (d)
 * ever starts failing, the fix regressed into a blanket offload ban.
 *
 * NO shell, NO child_process. Node built-in assert + fs only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-write-authority.js
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
const { resolve } = require(resolverPath);
const {
  AGENT_TYPE_ID_MAP,
  WRITE_INCAPABLE_AGENT_TYPES,
  WRITE_INCAPABLE_PROVIDERS,
} = require(path.join(__dirname, '..', 'routing-record.js'));

// ---------------------------------------------------------------------------
// Fixture: a registry where BOTH a write-capable offload provider (ica) and a
// write-incapable one (gemini) are enabled for the same model, so a test can tell
// "excluded because write-incapable" apart from "excluded because unavailable".
// ---------------------------------------------------------------------------

function writeRegistry(reg) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wa-reg-')), 'registry.json');
  fs.writeFileSync(p, JSON.stringify(reg));
  return p;
}

function resolveWith(reg, params) {
  const p = writeRegistry(reg);
  try {
    return resolve({ ...params, _registryPath: p });
  } finally {
    fs.unlinkSync(p);
  }
}

function baseRegistry() {
  return {
    version: 1,
    routing_policy: {
      // gemini FIRST in the chain, so a passing test proves the filter acted rather
      // than that ica simply happened to rank higher anyway.
      documentation: {
        chain: ['gemini/gemini-3-5-flash', 'ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'],
        enabled: true,
      },
      exploration: {
        chain: ['gemini/gemini-3-5-flash', 'claude/claude-haiku-4-5'],
        enabled: true,
      },
    },
    must_stay_primary: ['orchestration', 'verdict', 'mode_d', 'council_review', 'synthesis'],
    models: {
      'claude-haiku-4-5': {
        family: 'claude', class: 'haiku', sampling: 'stochastic', status: 'active',
        providers: [
          { provider: 'gemini', model_id: 'gemini-3-5-flash', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 1 },
          { provider: 'ica', model_id: 'claude-haiku-4-5', cost_tier: 'free', allowance: 'unlimited', enabled: true, priority: 2 },
          { provider: 'claude', model_id: 'claude-haiku-4-5', cost_tier: 'billed', allowance: 'billed', enabled: true, priority: 3 },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// (a) the constant is DERIVED, not a second hand-maintained list
// ---------------------------------------------------------------------------

describe('(a) WRITE_INCAPABLE_PROVIDERS is derived from the agent-type map', () => {
  test('every listed provider maps to a write-incapable agent type', () => {
    for (const pid of WRITE_INCAPABLE_PROVIDERS) {
      assert.ok(
        WRITE_INCAPABLE_AGENT_TYPES.includes(AGENT_TYPE_ID_MAP[pid]),
        `provider '${pid}' is listed write-incapable but maps to '${AGENT_TYPE_ID_MAP[pid]}'`
      );
    }
  });

  test('and every write-incapable agent type has its provider listed (no silent gap)', () => {
    for (const [pid, agentType] of Object.entries(AGENT_TYPE_ID_MAP)) {
      if (WRITE_INCAPABLE_AGENT_TYPES.includes(agentType)) {
        assert.ok(WRITE_INCAPABLE_PROVIDERS.includes(pid),
          `agent type '${agentType}' is write-incapable but provider '${pid}' is not listed`);
      }
    }
  });

  test('ica-executor is NOT write-incapable — it gained write authority 2026-08-17', () => {
    assert.ok(!WRITE_INCAPABLE_AGENT_TYPES.includes('ica-executor'),
      'ica-executor must be write-capable; re-adding it re-breaks authoring legs');
    assert.ok(!WRITE_INCAPABLE_PROVIDERS.includes('ica'));
  });

  test('codex-executor and bob-delegate-executor are write-capable too', () => {
    for (const a of ['codex-executor', 'bob-delegate-executor']) {
      assert.ok(!WRITE_INCAPABLE_AGENT_TYPES.includes(a), `${a} must stay write-capable`);
    }
  });
});

// ---------------------------------------------------------------------------
// (b) default is OFF — omitting requires_write changes nothing
// ---------------------------------------------------------------------------

describe('(b) requires_write defaults to false (no behavior change for existing callers)', () => {
  test('omitted → gemini (chain head) is still selected', () => {
    const r = resolveWith(baseRegistry(), { model: 'haiku', task_class: 'documentation', effort: 'low' });
    assert.strictEqual(r.chosen_plugin_id, 'gemini',
      `baseline must select the chain head; got ${r.chosen_plugin_id}`);
    assert.strictEqual(r.agent_type_id, 'gemini-executor');
  });

  test('explicit false → byte-identical record to omitting it', () => {
    const a = resolveWith(baseRegistry(), { model: 'haiku', task_class: 'documentation', effort: 'low' });
    const b = resolveWith(baseRegistry(), { model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: false });
    assert.deepStrictEqual(b, a, 'requires_write:false must not perturb the record');
  });

  test('a non-boolean truthy value does NOT enable the filter (strict === true)', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: 'yes',
    });
    assert.strictEqual(r.chosen_plugin_id, 'gemini',
      'only a literal true may arm the filter; a truthy string must not');
  });
});

// ---------------------------------------------------------------------------
// (c) requires_write:true excludes the write-incapable provider
// ---------------------------------------------------------------------------

describe('(c) requires_write:true excludes write-incapable providers', () => {
  test('chain head gemini is skipped → ica (next write-capable entry) is chosen', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: true,
    });
    assert.notStrictEqual(r.chosen_plugin_id, 'gemini', 'gemini must be excluded');
    assert.strictEqual(r.chosen_plugin_id, 'ica',
      `expected the next write-capable chain entry; got ${r.chosen_plugin_id}`);
  });

  test('an EXPLICITLY requested write-incapable provider routes to claude, not silently honored', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low',
      provider: 'gemini', requires_write: true,
    });
    assert.strictEqual(r.chosen_plugin_id, 'claude');
    assert.strictEqual(r.agent_type_id, 'claude');
    assert.ok(/write-incapable/i.test(r.reason),
      `reason must name the cause; got: ${r.reason}`);
  });

  test('the fallback_chain carries no write-incapable provider either', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: true,
    });
    for (const entry of r.fallback_chain || []) {
      assert.ok(!WRITE_INCAPABLE_PROVIDERS.includes(entry.plugin_id),
        `fallback_chain leaked write-incapable provider '${entry.plugin_id}' — a retry would produce no file`);
    }
  });

  test('the reason string records that the filter was applied', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: true,
    });
    assert.ok(/requires_write=true/.test(r.reason),
      `reason must be auditable; got: ${r.reason}`);
  });
});

// ---------------------------------------------------------------------------
// (d) THE REGRESSION GUARD — offload is NOT banned, only write-incapable targets are
// ---------------------------------------------------------------------------

describe('(d) requires_write:true still offloads to write-CAPABLE providers', () => {
  test('explicit provider=ica is HONORED under requires_write:true', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low',
      provider: 'ica', requires_write: true,
    });
    assert.strictEqual(r.chosen_plugin_id, 'ica',
      'ica is write-capable since 2026-08-17; excluding it turns this fix into a blanket offload ban');
    assert.strictEqual(r.agent_type_id, 'ica-executor');
  });

  test('the free lane survives: a write leg still lands on a free ICA instance', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'documentation', effort: 'low', requires_write: true,
    });
    assert.strictEqual(r.chosen_plugin_id, 'ica');
    assert.notStrictEqual(r.chosen_plugin_id, 'claude',
      'a write requirement must not force everything onto the paid subscription');
  });
});

// ---------------------------------------------------------------------------
// (e) MUST-stay still wins — the new axis cannot weaken an existing protection
// ---------------------------------------------------------------------------

describe('(e) MUST-stay-primary is unaffected', () => {
  test('mode_d + requires_write:true → claude, via the MUST-stay path', () => {
    const r = resolveWith(baseRegistry(), {
      model: 'haiku', task_class: 'mode_d', effort: 'low',
      provider: 'ica', requires_write: true,
    });
    assert.strictEqual(r.chosen_plugin_id, 'claude');
    assert.ok(/MUST-stay-primary/.test(r.reason),
      `MUST-stay must be the stated cause, not the write filter; got: ${r.reason}`);
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(70)}`);
console.log(`write-authority: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  for (const f of failures) console.error(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
console.log('='.repeat(70));
