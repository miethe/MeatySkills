const assert = require('assert');
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
 console.log('Codex account routing tests passed');
} finally { if(previous === undefined) delete process.env.AOS_CODEX_IDENTITY; else process.env.AOS_CODEX_IDENTITY=previous; }
