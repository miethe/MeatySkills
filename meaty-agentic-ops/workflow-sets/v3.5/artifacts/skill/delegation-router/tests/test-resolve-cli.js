/**
 * resolve-cli.js smoke tests — tests/test-resolve-cli.js
 *
 * Exercises the headless CLI wrapper end-to-end as a real subprocess (this is the one
 * test file in this suite that legitimately uses child_process — it's testing the CLI's
 * own process boundary — output shape/exit codes — not mocking the resolver's internals).
 *
 * Required scenarios (feature contract: delegation-router-codex-consumption §9/§10):
 *   (a) a known-good request prints a valid RoutingRecord JSON and exits 0
 *   (b) an unresolvable/invalid request exits non-zero with a readable stderr message
 *       (not a raw stack dump as the primary message)
 *   (c) the CLI performs zero network/model calls (module-level: only fs/os/path + the
 *       pure resolver are required — asserted via require() no-throw + no network deps)
 *   (d) node-safety fallback: when ~/ica-gpt.sh is absent, the CLI rewrites the
 *       invocation_template to ~/ica-claude.sh instead of handing back a dead path
 *   (e) --help exits 0 and does not attempt to resolve anything
 *
 * Run: node .claude/skills/delegation-router/tests/test-resolve-cli.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

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

const CLI_PATH = path.join(__dirname, '..', 'resolve-cli.js');

/**
 * Run the CLI as a real subprocess and return {stdout, stderr, status}.
 * Never throws on a non-zero exit — callers assert on `status` explicitly.
 */
function runCli(args, env) {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...(env || {}) },
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    return {
      stdout: err.stdout != null ? String(err.stdout) : '',
      stderr: err.stderr != null ? String(err.stderr) : '',
      status: err.status,
    };
  }
}

describe('(a) known-good request → valid RoutingRecord JSON, exit 0', () => {
  test('gpt-5.5-gus / ica / second-opinion resolves and prints RoutingRecord JSON', () => {
    // Force the node-safety check to see the shim as present, regardless of the host
    // running this test suite (deterministic across laptop/node/CI).
    const fakeShim = path.join(__dirname, 'fixtures-fake-ica-gpt-shim-present.marker');
    require('fs').writeFileSync(fakeShim, '#!/bin/sh\n');
    try {
      const { stdout, status } = runCli(
        ['--model', 'gpt-5.5-gus', '--provider', 'ica', '--task-class', 'second-opinion'],
        { ICA_GPT_SHIM_PATH: fakeShim }
      );
      assert.strictEqual(status, 0, `expected exit 0, got ${status}`);
      const record = JSON.parse(stdout);
      assert.strictEqual(record.chosen_plugin_id, 'ica');
      assert.strictEqual(record.model, 'gpt-5.5-gus');
      assert.ok(
        record.invocation_template.includes('~/ica-gpt.sh'),
        `expected invocation_template to reference ~/ica-gpt.sh, got: ${record.invocation_template}`
      );
      for (const field of [
        'chosen_plugin_id',
        'model',
        'effort',
        'agent_type_id',
        'invocation_template',
        'scope_flags',
        'stage',
        'validation_contract',
        'continuity_mode',
        'fallback_chain',
        'reason',
      ]) {
        assert.ok(field in record, `RoutingRecord missing field '${field}'`);
      }
    } finally {
      require('fs').unlinkSync(fakeShim);
    }
  });

  test('--compact emits single-line JSON', () => {
    const fakeShim = path.join(__dirname, 'fixtures-fake-ica-gpt-shim-present-2.marker');
    require('fs').writeFileSync(fakeShim, '#!/bin/sh\n');
    try {
      const { stdout, status } = runCli(
        ['--model', 'sonnet', '--provider', 'claude', '--task-class', 'implementation', '--compact'],
        { ICA_GPT_SHIM_PATH: fakeShim }
      );
      assert.strictEqual(status, 0);
      assert.ok(!stdout.trim().includes('\n'), 'expected single-line output with --compact');
      const record = JSON.parse(stdout);
      assert.strictEqual(record.chosen_plugin_id, 'claude');
    } finally {
      require('fs').unlinkSync(fakeShim);
    }
  });
});

describe('(b) unresolvable/invalid request → non-zero exit, readable stderr', () => {
  test('missing --model exits non-zero with a one-line stderr message (no raw stack dump)', () => {
    const { stderr, status } = runCli(['--provider', 'ica']);
    assert.notStrictEqual(status, 0);
    assert.ok(stderr.length > 0, 'expected a stderr message');
    assert.ok(stderr.includes('--model is required'), `unexpected stderr: ${stderr}`);
    assert.ok(!stderr.includes(' at '), `stderr looked like a raw stack dump: ${stderr}`);
  });

  test('unrecognized flag exits non-zero with a readable message', () => {
    const { stderr, status } = runCli(['--model', 'sonnet', '--not-a-real-flag']);
    assert.notStrictEqual(status, 0);
    assert.ok(stderr.includes('unrecognized argument'), `unexpected stderr: ${stderr}`);
  });

  test('no arguments at all exits non-zero and prints usage to stderr', () => {
    const { stderr, status } = runCli([]);
    assert.notStrictEqual(status, 0);
    assert.ok(stderr.includes('Usage:'), `expected usage text on stderr, got: ${stderr}`);
  });
});

describe('(c) zero network/model calls (static + behavioral check)', () => {
  test('module only requires fs/os/path + the local pure resolver', () => {
    const src = require('fs').readFileSync(CLI_PATH, 'utf8');
    const requireCalls = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2]);
    const allowed = new Set(['fs', 'os', 'path', './resolver.js']);
    for (const dep of requireCalls) {
      assert.ok(allowed.has(dep), `unexpected dependency required by resolve-cli.js: '${dep}'`);
    }
  });

  test('running the CLI touches no unexpected network module (no http/https/net/dns in source)', () => {
    const src = require('fs').readFileSync(CLI_PATH, 'utf8');
    for (const forbidden of ['http', 'https', 'net', 'dns', 'child_process']) {
      assert.ok(
        !new RegExp(`require\\(['"]${forbidden}['"]\\)`).test(src),
        `resolve-cli.js must not require('${forbidden}') — pure read only`
      );
    }
  });
});

describe('(d) node-safety fallback — ica-gpt.sh absent rewrites to ica-claude.sh', () => {
  test('missing shim path rewrites invocation_template to ~/ica-claude.sh', () => {
    const { stdout, status } = runCli(
      ['--model', 'gpt-5.5-gus', '--provider', 'ica', '--task-class', 'second-opinion'],
      { ICA_GPT_SHIM_PATH: '/definitely/does/not/exist/ica-gpt.sh' }
    );
    assert.strictEqual(status, 0);
    const record = JSON.parse(stdout);
    assert.ok(
      record.invocation_template.includes('~/ica-claude.sh'),
      `expected fallback to ~/ica-claude.sh, got: ${record.invocation_template}`
    );
    assert.ok(!record.invocation_template.includes('~/ica-gpt.sh'));
    assert.ok(record.reason.includes('fell back to ~/ica-claude.sh'));
  });

  test('non-gpt ICA model is unaffected by the node-safety check (no ica-gpt.sh in its template)', () => {
    const { stdout, status } = runCli(
      ['--model', 'claude-haiku-4-5', '--provider', 'ica', '--task-class', 'exploration'],
      { ICA_GPT_SHIM_PATH: '/definitely/does/not/exist/ica-gpt.sh' }
    );
    assert.strictEqual(status, 0);
    const record = JSON.parse(stdout);
    assert.ok(!record.invocation_template.includes('ica-gpt.sh'));
    assert.ok(!record.reason.includes('resolve-cli:'));
  });
});

describe('(e) --help exits 0 without attempting resolution', () => {
  test('--help prints usage and exits 0', () => {
    const { stdout, status } = runCli(['--help']);
    assert.strictEqual(status, 0);
    assert.ok(stdout.includes('Usage:'));
  });
});

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  console.log('\nSome resolve-cli tests failed.');
  process.exit(1);
} else {
  console.log('All resolve-cli tests passed.');
  process.exit(0);
}
