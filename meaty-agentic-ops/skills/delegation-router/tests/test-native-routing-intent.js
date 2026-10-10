'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  appendEntry,
  appendNativeIntent,
  appendRealization,
  readEntries,
} = require('../audit-log.js');

const cli = path.join(__dirname, '..', 'log-cli.js');

function fixture(overrides = {}) {
  return {
    routing_log: [{
      kind: 'decision',
      task_id: 'native:9:session-7:7:call-11',
      chosen_plugin_id: 'codex',
      intended_model: 'gpt-6-luna',
      reason: 'native spawn routing intent; execution not measured',
      routing_record: {
        chosen_plugin_id: 'codex', model: 'gpt-6-luna', effort: 'medium',
        reason: 'native spawn routing intent; execution not measured',
      },
      prompt: 'PRIVATE_PROMPT', message: 'PRIVATE_MESSAGE',
      tool_response: 'PRIVATE_RESPONSE', transcript_path: '/private/path',
      unknown: 'PRIVATE_UNKNOWN',
      ...overrides,
    }],
  };
}
function nativeTaskId(session, toolUse) {
  return `native:${Array.from(session).length}:${session}:${Array.from(toolUse).length}:${toolUse}`;
}

function tempdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'native-routing-writer-')); }
function cliRun(logPath, input) {
  return spawnSync(process.execPath, [cli, '--native-intent', '-', '--log-path', logPath], {
    input: JSON.stringify(input), encoding: 'utf8',
  });
}
function cliSpawn(logPath, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--native-intent', '-', '--log-path', logPath]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

const root = tempdir();
(async () => {
try {
  const ledger = path.join(root, 'routing.jsonl');
  const first = appendNativeIntent(fixture(), { log_path: ledger });
  assert.strictEqual(first.status, 'written');
  const second = appendNativeIntent(fixture(), { log_path: ledger });
  assert.deepStrictEqual(second, { status: 'duplicate', task_id: 'native:9:session-7:7:call-11' });
  let rows = readEntries(ledger);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].intended_model, 'gpt-6-luna');
  assert.strictEqual(rows[0].routing_record.effort, 'medium');
  assert.strictEqual(rows[0].actual_provider_used, null);
  assert.strictEqual(rows[0].realized_model, null);
  assert.strictEqual(rows[0].realization_confirmed, false);
  const stored = fs.readFileSync(ledger, 'utf8');
  for (const marker of ['PRIVATE_PROMPT', 'PRIVATE_MESSAGE', 'PRIVATE_RESPONSE', 'PRIVATE_UNKNOWN', '/private/path']) {
    assert(!stored.includes(marker), `private field leaked: ${marker}`);
  }

  appendRealization({ task_id: first.task_id, realized_model: 'gpt-6-luna', realization_evidence: 'synthetic independent measurement', log_path: ledger });
  const afterRealization = fs.readFileSync(ledger, 'utf8');
  assert.strictEqual(appendNativeIntent(fixture(), { log_path: ledger }).status, 'duplicate');
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), afterRealization);
  assert.strictEqual(readEntries(ledger).length, 2);

  const changedIntent = fixture({ intended_model: 'gpt-6-sol' });
  changedIntent.routing_log[0].routing_record.model = 'gpt-6-sol';
  assert.throws(() => appendNativeIntent(changedIntent, { log_path: ledger }), /conflict/);
  const conflictCli = cliRun(ledger, changedIntent);
  assert.strictEqual(conflictCli.status, 1);
  assert.strictEqual(conflictCli.stderr, 'log-cli: native_intent_write_refused\n');
  assert.strictEqual(conflictCli.stdout, '');
  assert(!conflictCli.stderr.includes('PRIVATE_'));
  const wrongProvider = fixture({ chosen_plugin_id: 'other' });
  wrongProvider.routing_log[0].routing_record.chosen_plugin_id = 'other';
  assert.throws(() => appendNativeIntent(wrongProvider, { log_path: ledger }), /projection is invalid/);
  // One event cannot acquire a second key through noncanonical length spelling.
  assert.throws(() => appendNativeIntent(fixture({ task_id: 'native:09:session-7:7:call-11' }),
    { log_path: ledger }), /projection is invalid/);

  for (const [body, expected] of [['{}\n', /routing_log/], ['[]\n', /envelope/]]) {
    const bad = path.join(root, `bad-${Math.random()}.jsonl`);
    assert.throws(() => appendNativeIntent(JSON.parse(body), { log_path: bad }), expected);
  }

  const malformed = path.join(root, 'malformed.jsonl');
  fs.writeFileSync(malformed, '{bad}\n');
  assert.throws(() => appendNativeIntent(fixture(), { log_path: malformed }), /ledger_malformed/);
  const partial = path.join(root, 'partial.jsonl');
  fs.writeFileSync(partial, '{"kind":"decision"}');
  assert.throws(() => appendNativeIntent(fixture(), { log_path: partial }), /ledger_partial_line/);

  // A failed destination leaves no dedup state: repair the destination and retry.
  const blockedParent = path.join(root, 'is-directory');
  fs.mkdirSync(blockedParent);
  const failedLedger = path.join(blockedParent, 'routing.jsonl');
  fs.mkdirSync(failedLedger);
  assert.throws(() => appendNativeIntent(fixture(), { log_path: failedLedger }), /ledger_unreadable/);
  fs.rmdirSync(failedLedger);
  assert.strictEqual(appendNativeIntent(fixture(), { log_path: failedLedger }).status, 'written');

  // Competing processes use the ledger lock as the only idempotency authority.
  const concurrent = path.join(root, 'concurrent.jsonl');
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => cliSpawn(concurrent, fixture())));
  assert(outcomes.every(result => result.status === 0), outcomes.map(r => r.stderr).join('\n'));
  const statuses = outcomes.map(result => JSON.parse(result.stdout).status).sort();
  assert.deepStrictEqual(statuses, ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'written']);
  assert.strictEqual(readEntries(concurrent).length, 1);

  // The existing decision, realization, and canonical CLI paths remain usable.
  const legacy = path.join(root, 'legacy.jsonl');
  appendEntry({ task_id: 'legacy-task', chosen_plugin_id: 'codex', intended_model: 'gpt-6-luna', log_path: legacy });
  appendRealization({ task_id: 'legacy-task', realized_model: 'gpt-6-luna', realization_evidence: 'synthetic test', log_path: legacy });
  assert.deepStrictEqual(readEntries(legacy).map(row => row.kind), ['decision', 'realization']);

  const unicodeLedger = path.join(root, 'unicode.jsonl');
  const unicodeIds = fixture({ task_id: nativeTaskId('s:42😀', 't:7λ') });
  assert.strictEqual(appendNativeIntent(unicodeIds, { log_path: unicodeLedger }).status, 'written');
  for (const invalidId of [
    'native:99:session-7:7:call-11',
    nativeTaskId('unknown-session', 'call-11'),
    nativeTaskId('   ', 'call-11'),
    nativeTaskId('bad\nvalue', 'call-11'),
    nativeTaskId('x'.repeat(257), 'call-11'),
  ]) {
    assert.throws(() => appendNativeIntent(fixture({ task_id: invalidId }), { log_path: unicodeLedger }), /projection is invalid/);
  }
  for (const invalidPin of [
    { model: 'x'.repeat(129), effort: 'medium' },
    { model: 'gpt-6-luna\n', effort: 'medium' },
    { model: 'gpt-6-luna', effort: 'x'.repeat(129) },
    { model: 'gpt-6-luna', effort: 'med\nium' },
  ]) {
    const invalid = fixture({ intended_model: invalidPin.model });
    invalid.routing_log[0].routing_record.model = invalidPin.model;
    invalid.routing_log[0].routing_record.effort = invalidPin.effort;
    assert.throws(() => appendNativeIntent(invalid, { log_path: unicodeLedger }), /projection is invalid/);
  }

  const cliOutput = cliRun(path.join(root, 'cli.jsonl'), fixture());
  assert.strictEqual(cliOutput.status, 0);
  assert.strictEqual(cliOutput.stdout.trim(), '{"status":"written"}');
  assert.strictEqual(cliOutput.stderr, '');
  for (const marker of ['PRIVATE_PROMPT', 'PRIVATE_MESSAGE', 'PRIVATE_RESPONSE', '/private/path']) {
    assert(!cliOutput.stdout.includes(marker));
    assert(!cliOutput.stderr.includes(marker));
  }
  const invalidCliArgs = spawnSync(process.execPath, [cli, '--native-intent', '-', '--unexpected'], {
    input: JSON.stringify(fixture()), encoding: 'utf8',
  });
  assert.strictEqual(invalidCliArgs.status, 2);
  assert.strictEqual(invalidCliArgs.stderr, 'log-cli: native_intent_arguments_invalid\n');
  assert.strictEqual(invalidCliArgs.stdout, '');
  const oversizedCli = spawnSync(process.execPath, [cli, '--native-intent', '-'], {
    input: ' '.repeat(8193), encoding: 'utf8',
  });
  assert.strictEqual(oversizedCli.status, 2);
  assert.strictEqual(oversizedCli.stderr, 'log-cli: native_intent_input_too_large\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

process.stdout.write('native routing intent writer tests passed\n');
})().catch(error => {
  fs.rmSync(root, { recursive: true, force: true });
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
