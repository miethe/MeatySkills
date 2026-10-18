const assert = require('assert');
const {spawnSync} = require('child_process');
const path = require('path');
const {resolve} = require('../resolver.js');
const input = {model:'gpt-6-luna', provider:'codex', effort:'medium', task_class:'implementation'};
const previous = process.env.AOS_CODEX_IDENTITY;
delete process.env.AOS_CODEX_IDENTITY;
try {
 // Nick, 2026-10-16: codex_secondary is downgraded until 2026-11-12; every Codex default names
 // codex_primary. Secondary stays selectable as an explicit routing decision.
 const primary = resolve(input);
 assert.equal(primary.chosen_plugin_id, 'codex');
 assert.equal(primary.identity_ref, 'codex_primary');
 assert(primary.invocation_template.includes('aos-codex-exec --identity codex_primary exec'));
 const secondary = resolve({...input, identity_ref:'codex_secondary'});
 assert.equal(secondary.model, primary.model);
 assert.equal(secondary.identity_ref, 'codex_secondary');
 assert(secondary.invocation_template.includes('aos-codex-exec --identity codex_secondary exec'));
 assert.deepEqual(secondary.scope_flags, primary.scope_flags);
 assert.throws(()=>resolve({...input,identity_ref:'typo'}), /Unknown Codex|does not serve/);
 const roleDefault = resolve({...input,task_class:'orchestration'});
 const roleSecondary = resolve({...input,task_class:'orchestration',identity_ref:'codex_secondary'});
 assert.equal(roleSecondary.chosen_plugin_id, roleDefault.chosen_plugin_id);
 assert.equal(roleSecondary.model, roleDefault.model);
 assert.deepEqual(roleSecondary.scope_flags, roleDefault.scope_flags);

 const cli = path.join(__dirname, '..', 'resolve-cli.js');
 for (const identity of ['codex_primary', 'codex_secondary']) {
  const result = spawnSync(process.execPath, [cli, '--model', 'gpt-6-luna', '--provider', 'codex', '--effort', 'medium', '--task-class', 'implementation', '--identity', identity, '--compact'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.chosen_plugin_id, 'codex');
  assert.equal(record.identity_ref, identity);
  assert(record.invocation_template.includes(`aos-codex-exec --identity ${identity} exec`));
 }
 const nonCodex = spawnSync(process.execPath, [cli, '--model', 'claude-sonnet-5-5', '--provider', 'claude', '--effort', 'medium', '--task-class', 'implementation', '--compact'], {encoding:'utf8'});
 assert.equal(nonCodex.status, 0, nonCodex.stderr);
 const nonCodexRecord = JSON.parse(nonCodex.stdout);
 assert.equal(nonCodexRecord.chosen_plugin_id, 'claude');
 assert.equal(nonCodexRecord.identity_ref, null); // v3 records always carry the field; null off Codex
 const ignoredIdentity = spawnSync(process.execPath, [cli, '--model', 'claude-sonnet-5-5', '--provider', 'claude', '--effort', 'medium', '--task-class', 'implementation', '--identity', 'codex_primary', '--compact'], {encoding:'utf8'});
 assert.equal(ignoredIdentity.status, 2);
 assert.match(ignoredIdentity.stderr, /--identity requires a Codex route/);
 assert.equal(ignoredIdentity.stdout, '');
 console.log('Codex account routing tests passed');
} finally { if(previous === undefined) delete process.env.AOS_CODEX_IDENTITY; else process.env.AOS_CODEX_IDENTITY=previous; }
