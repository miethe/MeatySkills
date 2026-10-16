'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const fixture = path.join(__dirname, 'fixtures', 'v3', 'registry.json');
const cli = path.join(__dirname, '..', 'resolve-cli.js');
const result = spawnSync(process.execPath, [cli, 'table', '--registry', fixture, '--json'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const table = JSON.parse(result.stdout);
const registry = JSON.parse(fs.readFileSync(fixture, 'utf8'));
assert.deepEqual(Object.keys(table.classes).sort(), Object.keys(registry.task_class_defaults).sort());
for (const [taskClass, spec] of Object.entries(registry.task_class_defaults)) {
  assert.deepEqual(table.classes[taskClass].holders.map(item => item.model), spec.holders);
  for (const holder of table.classes[taskClass].holders) {
    assert(Object.prototype.hasOwnProperty.call(holder, 'q'), `${taskClass}/${holder.model} is missing q`);
    assert(Object.prototype.hasOwnProperty.call(holder, 'bar'), `${taskClass}/${holder.model} is missing bar`);
    assert(holder.lanes.every(lane => lane.eligibility_reason && typeof lane.eligible === 'boolean'));
  }
}
assert(!result.stdout.includes('/'));

console.log('test-routing-table.js: static v3 table assertions passed');
