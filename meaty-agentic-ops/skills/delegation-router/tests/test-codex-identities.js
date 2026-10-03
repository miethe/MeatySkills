const assert = require('assert');
const {spawnSync} = require('child_process');
const path = require('path');
const {resolve} = require('../resolver.js');
const input = {model:'gpt-6-luna', provider:'codex', effort:'medium', task_class:'implementation'};
const previous = process.env.AOS_CODEX_IDENTITY;
delete process.env.AOS_CODEX_IDENTITY;
try {
 const secondary = resolve(input);
 assert.equal(secondary.chosen_plugin_id, 'codex');
 assert.equal(secondary.identity_ref, 'codex_secondary');
 assert(secondary.invocation_template.includes('aos-codex-exec --identity codex_secondary exec'));
 const primary = resolve({...input, identity_ref:'codex_primary'});
 assert.equal(primary.model, secondary.model);
 assert.equal(primary.identity_ref, 'codex_primary');
 assert.deepEqual(primary.scope_flags, secondary.scope_flags);
 assert.throws(()=>resolve({...input,identity_ref:'typo'}), /Unknown Codex/);
 const roleDefault = resolve({...input,task_class:'orchestration'});
 const rolePrimary = resolve({...input,task_class:'orchestration',identity_ref:'codex_primary'});
 assert.equal(rolePrimary.chosen_plugin_id, roleDefault.chosen_plugin_id);
 assert.equal(rolePrimary.model, roleDefault.model);
 assert.deepEqual(rolePrimary.scope_flags, roleDefault.scope_flags);

 const cli = path.join(__dirname, '..', 'resolve-cli.js');
 for (const identity of ['codex_primary', 'codex_secondary']) {
  const result = spawnSync(process.execPath, [cli, '--model', 'gpt-6-luna', '--provider', 'codex', '--effort', 'medium', '--identity', identity, '--compact'], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.chosen_plugin_id, 'codex');
  assert.equal(record.identity_ref, identity);
  assert(record.invocation_template.includes(`aos-codex-exec --identity ${identity} exec`));
 }
 const nonCodex = spawnSync(process.execPath, [cli, '--model', 'sonnet', '--provider', 'claude', '--effort', 'medium', '--compact'], {encoding:'utf8'});
 assert.equal(nonCodex.status, 0, nonCodex.stderr);
 const nonCodexRecord = JSON.parse(nonCodex.stdout);
 assert.equal(nonCodexRecord.chosen_plugin_id, 'claude');
 assert(!Object.hasOwn(nonCodexRecord, 'identity_ref'));
 const ignoredIdentity = spawnSync(process.execPath, [cli, '--model', 'sonnet', '--provider', 'claude', '--effort', 'medium', '--identity', 'codex_primary', '--compact'], {encoding:'utf8'});
 assert.equal(ignoredIdentity.status, 2);
 assert.match(ignoredIdentity.stderr, /--identity requires a Codex route/);
 assert.equal(ignoredIdentity.stdout, '');
 console.log('Codex account routing tests passed');
} finally { if(previous === undefined) delete process.env.AOS_CODEX_IDENTITY; else process.env.AOS_CODEX_IDENTITY=previous; }
