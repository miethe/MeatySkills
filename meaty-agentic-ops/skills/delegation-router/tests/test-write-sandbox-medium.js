/**
 * Write-class sandbox at every effort - node_01M66GTTE463RMGWDN9ZV2V2H4.
 * Run: node tests/test-write-sandbox-medium.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { resolve } = require(path.join(__dirname, '..', 'resolver.js'));

const TOML = [
  '[providers.claude]', 'id = "claude"', 'availability_check = "which claude"',
  '[[providers.claude.models]]', 'name = "sonnet"', 'cost_tier = "standard"', 'capabilities = ["implementation"]', 'max_context = 200000', 'sampling = "deterministic"',
  '[providers.claude.invocation_template]', "base = 'claude -p \"{prompt}\" --model {model}'",
  '[providers.codex]', 'id = "codex"', 'availability_check = "which codex"',
  '[[providers.codex.models]]', 'name = "gpt-5.6-terra"', 'cost_tier = "premium"', 'capabilities = ["agentic-coding", "exploration"]', 'max_context = 400000', 'sampling = "deterministic"',
  '[providers.codex.invocation_template]', "base = 'codex exec --sandbox {sandbox_mode} \"{prompt}\"'",
  '[routing_rules]', 'deterministic_providers = ["claude", "codex"]', 'nondeterministic_providers = []',
].join('\n');
const CFG = path.join(require('os').tmpdir(), 'wsm-provider-plugins.toml');
require('fs').writeFileSync(CFG, TOML, 'utf8');

let fail = 0;
function test(name, fn) {
  try { fn(); console.log('  PASS  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n        ' + e.message); fail++; }
}
function req(extra) {
  return Object.assign({ _configPath: CFG, model: 'gpt-5.6-terra', provider: 'codex', effort: 'medium' }, extra);
}
function sandbox(r) {
  const f = r.scope_flags.find(function (x) { return x.indexOf('--sandbox ') === 0; });
  return f ? f.slice(10) : '';
}

test('medium + task_class write -> workspace-write', function () {
  const r = resolve(req({ task_class: 'agentic-coding', requires_write: true }));
  assert.strictEqual(r.chosen_plugin_id, 'codex');
  assert.strictEqual(sandbox(r), 'workspace-write');
  assert.ok(r.invocation_template.includes('--sandbox workspace-write'));
});
test('medium + requires_write -> workspace-write', function () {
  assert.strictEqual(sandbox(resolve(req({ task_class: 'agentic-coding', requires_write: true }))), 'workspace-write');
});
test('medium + read-class -> read-only', function () {
  assert.strictEqual(sandbox(resolve(req({ task_class: 'exploration' }))), 'read-only');
});
test('explicit read-only pin wins over write', function () {
  assert.strictEqual(sandbox(resolve(req({ task_class: 'agentic-coding', requires_write: true, profile: 'sandbox=read-only' }))), 'read-only');
});
test('missing task_class -> read-only, never widened', function () {
  assert.strictEqual(sandbox(resolve(req({ task_class: 'agentic-coding' }))), 'read-only');
});
test('high and xhigh unchanged', function () {
  assert.strictEqual(sandbox(resolve(req({ effort: 'high', task_class: 'agentic-coding', requires_write: true }))), 'workspace-write');
  assert.strictEqual(sandbox(resolve(req({ effort: 'xhigh', task_class: 'agentic-coding', requires_write: true }))), 'danger-full-access');
});
if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('ok');
