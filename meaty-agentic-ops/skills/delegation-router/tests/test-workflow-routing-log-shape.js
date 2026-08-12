#!/usr/bin/env node
/**
 * test-workflow-routing-log-shape.js — the SHIPPED routing-log literals, run for real.
 *
 * Run: `node tests/test-workflow-routing-log-shape.js` (zero deps; exits non-zero on failure).
 *
 * Why this shape of test. The defect this guards (node_01KZSAN7QA6FQVT49DF29BS9Z6) was that 13
 * routing-log blocks across 5 workflows copied the routing INTENT into `actual_provider_used`
 * at decision time and carried no model in either direction — so every entry was born
 * unconfirmed-but-looking-confirmed and model-blind. A test asserting "the correct pattern appears
 * somewhere in the file" would have passed against the defect. So this test EXTRACTS each shipped
 * literal out of the workflow source, evaluates it, and feeds it through the real `audit-log.js`.
 * Same reasoning as `tests/test_workflow_mode_d_routing.py` in the launchpad, which runs the
 * shipped regex literals rather than asserting the table is present.
 *
 * SCOPE, updated 2026-08-12 (node_01KZVV9R3EK13DJXS44VCQ8E9C). This header used to end with a
 * boundary saying nothing in this estate consumed these payloads: they were handed to `agent()`
 * as a `_routing_log` opts key, `_routing_log` was not in the documented opts allowlist, and the
 * runtime discarded all 14. That is FIXED — the payloads now go to a `routeLog()` accumulator and
 * ride out on the report as `routing_log`, which `log-cli.js --ingest` drains into
 * `.claude/logs/routing-decisions.jsonl` after the run.
 *
 * What this file still does and does not prove, stated precisely:
 *   - CASES 1–3 prove the shipped literals are SCHEMA-CORRECT and audit correctly. They read
 *     source text; they do not run a workflow.
 *   - CASE 4 proves the WIRE is intact in the shipped source: the dead opts key is gone, every
 *     payload reaches an accumulator, and every workflow exit carries `routing_log` — so a future
 *     exit added without the wrapper fails here rather than silently dropping a run's audit trail.
 *   - Neither proves a live workflow run writes an entry. That is
 *     `test-routing-log-run-drain.js`, which ingests a RECORDED report from a real run.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  appendEntry,
  appendRealization,
  readEntries,
  findUnconfirmedEntries,
  findModelSubstitutions,
} = require('../audit-log');

// Override exists so the negative control is reproducible: point it at a pre-change checkout of
// the workflows and CASE 1 must FAIL. A guard that passes against the defect is decoration.
const WORKFLOWS = process.env.ROUTING_LOG_WORKFLOWS_DIR
  ? path.resolve(process.env.ROUTING_LOG_WORKFLOWS_DIR)
  : path.resolve(__dirname, '../../../workflows');
const FILES = ['explore.js', 'spike.js', 'execute-contract.js', 'execute-plan.js', 'review-council.js'];

function tmpLog() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rlshape-')), 'routing-decisions.jsonl');
}

/**
 * Pull every routing-log object literal out of a workflow source, by brace-matching from the
 * opening `{` so nested objects and braces inside template literals do not truncate the capture.
 *
 * Two call shapes carry a literal: the 13 direct `routeLog({...})` accumulator calls, and the one
 * payload passed as a positional argument (review-council's fallback, which hands it to
 * `collectEvidenceOnPrimary` and is accumulated inside). `routeLog(routingLog)` — the pass-through
 * inside that function — takes an identifier, not a literal, so it is deliberately not matched here.
 */
function extractLiterals(src, file) {
  const out = [];
  const re = /(?:routeLog\(\s*|collectEvidenceOnPrimary\([^)]*?,\s*)\{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const start = src.indexOf('{', m.index + m[0].length - 1);
    let depth = 0;
    let i = start;
    let inTmpl = false;
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      const prev = src[i - 1];
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (inTmpl) {
        if (c === '`' && prev !== '\\') inTmpl = false;
        continue;
      }
      if (c === '`') { inTmpl = true; continue; }
      if (c === "'" || c === '"') { inStr = c; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    const text = src.slice(start, i + 1);
    const line = src.slice(0, start).split('\n').length;
    out.push({ file, line, text });
    re.lastIndex = i;
  }
  return out;
}

/**
 * Evaluate a literal that references workflow-local identifiers (`chosenPluginId`, `p.model`,
 * `bobFailureMode`, …). Unknown identifiers resolve through a Proxy to a stand-in string, so the
 * literal's STRUCTURE is exercised without reimplementing the workflow. `model`-ish names resolve
 * to a model string; everything else to a generic token.
 */
function evalLiteral(text) {
  // A stand-in for one workflow identifier. Must answer Symbol.toPrimitive, because template
  // interpolation (`${label}`) coerces via that symbol before any string method is reached.
  const token = (name) =>
    new Proxy(
      {},
      {
        has: () => true,
        get: (_t, k) => {
          if (k === Symbol.toPrimitive) return () => `<${name}>`;
          if (k === 'toString' || k === Symbol.toStringTag) return () => `<${name}>`;
          if (typeof k !== 'string') return undefined;
          if (/model/i.test(k)) return 'claude-sonnet-5[1m]';
          return `<${name}.${k}>`;
        },
      }
    );
  const stub = new Proxy(
    {},
    {
      has: () => true,
      get: (_t, name) => {
        if (typeof name !== 'string') return undefined;
        if (/model/i.test(name)) return 'claude-sonnet-5[1m]';
        return token(name);
      },
    }
  );
  // eslint-disable-next-line no-new-func
  const fn = new Function('__stub', `with (__stub) { return (${text}); }`);
  const raw = fn(stub);
  // Coerce stand-in leaves to strings. Without this a bare identifier value (e.g.
  // `chosen_plugin_id: chosenPluginId`) stays a Proxy, which is truthy — so structural checks pass
  // — but serializes to `{}` in a JSONL log, which is not what the workflow would ever write. CASE 2
  // round-trips through the real writer, so the values it writes must be realistically typed.
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' ? v : String(v);
  }
  return out;
}

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error(`  FAIL: ${msg}`); }
}

// ---------------------------------------------------------------------------
// CASE 1 — the defect itself: no DECISION entry may carry actual_provider_used.
// ---------------------------------------------------------------------------
console.log('CASE 1: no decision-time realized field, and every decision names its intended model');

const all = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');
  for (const lit of extractLiterals(src, f)) {
    let obj;
    try { obj = evalLiteral(lit.text); } catch (e) {
      failures++; console.error(`  FAIL: ${f}:${lit.line} literal did not evaluate: ${e.message}`);
      continue;
    }
    all.push({ ...lit, obj });
  }
}

check(all.length === 14, `expected 14 routing-log payloads across the 5 workflows, found ${all.length}`);

// Every payload must carry a per-leg task_ref. Without it the whole run collapses onto one
// task_id, and because findUnconfirmedEntries() settles by joining on task_id, ONE leg's
// realization would mark every other decision in the run CONFIRMED — `audit --unconfirmed`
// reading clean over decisions nothing measured. Measured 2026-08-12 while proving this wire
// end-to-end: the first version of the ingest did exactly that.
for (const e of all) {
  check(
    typeof e.obj.task_ref === 'string' && e.obj.task_ref.length > 0,
    `${e.file}:${e.line} payload has no task_ref — its entries would share the run's task_id and cross-settle`
  );
}

// Global invariant, stated independently of `kind` so it holds even if a payload is mis-tagged or
// untagged: the ONLY payloads allowed to name a realized provider are the measured fallback hops.
const namesRealized = all.filter((e) => 'actual_provider_used' in e.obj);
check(
  namesRealized.length === all.filter((e) => e.obj.kind === 'realization').length,
  `${namesRealized.length} payload(s) name actual_provider_used but only the measured realizations may — ` +
    `offenders: ${namesRealized.filter((e) => e.obj.kind !== 'realization').map((e) => `${e.file}:${e.line}`).join(', ') || '(none)'}`
);

const decisions = all.filter((e) => e.obj.kind === 'decision');
const realizations = all.filter((e) => e.obj.kind === 'realization');
check(decisions.length + realizations.length === all.length, 'every payload must carry kind: decision|realization');
check(decisions.length === 8, `expected 8 decision payloads, found ${decisions.length}`);
check(realizations.length === 6, `expected 6 realization payloads, found ${realizations.length}`);

for (const d of decisions) {
  check(
    !('actual_provider_used' in d.obj),
    `${d.file}:${d.line} decision sets actual_provider_used — omitted means UNCONFIRMED (this IS the defect)`
  );
  check(!('realized_model' in d.obj), `${d.file}:${d.line} decision sets realized_model`);
  check('intended_model' in d.obj, `${d.file}:${d.line} decision carries no intended_model`);
  check(d.obj.chosen_plugin_id, `${d.file}:${d.line} decision has no chosen_plugin_id`);
}

for (const r of realizations) {
  check(r.obj.actual_provider_used, `${r.file}:${r.line} realization has no actual_provider_used`);
  check('intended_model' in r.obj, `${r.file}:${r.line} realization carries no intended_model`);
  check(
    typeof r.obj.realization_evidence === 'string' && r.obj.realization_evidence.trim().length > 0,
    `${r.file}:${r.line} realization has no evidence — a self-report is not a measurement`
  );
  check(r.obj.fallback_applied === true, `${r.file}:${r.line} realization must set fallback_applied: true`);
}
console.log(`  ${decisions.length} decision + ${realizations.length} realization payloads inspected`);

// ---------------------------------------------------------------------------
// CASE 2 — the shipped payloads are ACCEPTED by audit-log v2 and audit correctly.
// A decision alone must read UNCONFIRMED; its realization must flip it to confirmed.
// ---------------------------------------------------------------------------
console.log('CASE 2: shipped payloads round-trip through audit-log v2 with the right verdicts');

for (const d of decisions) {
  const log = tmpLog();
  const written = appendEntry({ task_id: `T-${d.file}-${d.line}`, ...d.obj, log_path: log });
  check(written.actual_provider_used === null, `${d.file}:${d.line} wrote a non-null realized provider`);
  check(written.realization_confirmed === false, `${d.file}:${d.line} wrote realization_confirmed: true`);
  check(written.model_substituted === null, `${d.file}:${d.line} model_substituted should be null (unknowable)`);
  check(findUnconfirmedEntries(log).length === 1, `${d.file}:${d.line} decision should read as UNCONFIRMED`);
}

for (const r of realizations) {
  const log = tmpLog();
  const taskId = `T-${r.file}-${r.line}`;
  // The decision this realization belongs to (same intent, no realized fields).
  appendEntry({
    task_id: taskId,
    chosen_plugin_id: r.obj.chosen_plugin_id,
    intended_model: r.obj.intended_model,
    reason: 'decision preceding the measured fallback',
    log_path: log,
  });
  check(findUnconfirmedEntries(log).length === 1, `${r.file}:${r.line} decision should start UNCONFIRMED`);

  const real = appendRealization({ task_id: taskId, ...r.obj, log_path: log });
  check(real.kind === 'realization', `${r.file}:${r.line} not written as a realization`);
  check(real.realization_confirmed === true, `${r.file}:${r.line} evidence did not yield confirmation`);
  check(real.fallback_applied === true, `${r.file}:${r.line} fallback_applied did not survive`);
  check(readEntries(log).length === 2, `${r.file}:${r.line} decision entry was mutated instead of appended to`);
  check(readEntries(log)[0].realized_model === null, `${r.file}:${r.line} decision entry was mutated`);
  check(
    findUnconfirmedEntries(log).length === 0,
    `${r.file}:${r.line} realization did not clear the unconfirmed decision — this is what AC3 reads`
  );
}
console.log('  every decision reads unconfirmed; every realization confirms its own task');

// ---------------------------------------------------------------------------
// CASE 3 — a realization whose realized model differs from the intent is DETECTED.
// Guards the model dimension the 13 sites were blind to.
// ---------------------------------------------------------------------------
console.log('CASE 3: a model substitution on a shipped realization payload is detectable');
if (!realizations.length) {
  failures++;
  console.error('  FAIL: no realization payloads were extracted — CASE 3 cannot run');
} else {
  const log = tmpLog();
  const r = realizations[0];
  appendEntry({ task_id: 'T-SUB', chosen_plugin_id: r.obj.chosen_plugin_id, intended_model: 'claude-sonnet-5[1m]', log_path: log });
  appendRealization({
    task_id: 'T-SUB',
    ...r.obj,
    intended_model: 'claude-sonnet-5[1m]',
    realized_model: 'claude-haiku-4-5',
    log_path: log,
  });
  const subs = findModelSubstitutions(log);
  check(subs.length === 1, `expected 1 detected substitution, got ${subs.length}`);
  check(subs[0].intended_model === 'claude-sonnet-5[1m]', 'intended model not recovered');
  check(subs[0].realized_model === 'claude-haiku-4-5', 'realized model not recorded');
  check(!!subs[0].evidence, 'substitution reported without the evidence that established it');
}
console.log('  substitution detected with evidence attached');

// ---------------------------------------------------------------------------
// CASE 4 — THE WIRE IS INTACT IN THE SHIPPED SOURCE.
//
// CASES 1–3 prove the payloads are well-shaped. That is exactly what was already true on
// 2026-08-12 while NOT ONE of them reached the log, because they were handed to `agent()` on an
// opts key the runtime discards. Well-shaped and connected are different properties, and only
// the first had a test. This case tests the second:
//
//   4a. No `_routing_log:` opts key survives anywhere. That key is inert by construction; its
//       reappearance means someone restored the dead pattern from an old copy.
//   4b. Every workflow declares the accumulator and returns it.
//   4c. Every workflow EXIT is wrapped. An exit is a `return {...}` whose object carries a
//       `status:`; the wrapper is `withRouting(`. A new exit added without it drops the whole
//       run's audit trail on that path — silently, and most likely on a bail-out right after a
//       fallback fired, which is the path whose routing you most wanted to see.
// ---------------------------------------------------------------------------
console.log('CASE 4: the wire is intact — no dead opts key, and every workflow exit carries routing_log');
for (const f of FILES) {
  const src = fs.readFileSync(path.join(WORKFLOWS, f), 'utf8');
  const lines = src.split('\n');

  // 4a — the dead key, as a KEY (a mention in a comment is history, not a wire).
  lines.forEach((l, i) => {
    check(
      !/^\s*_routing_log:/.test(l),
      `${f}:${i + 1} restored the dead \`_routing_log\` opts key — the runtime discards it (see this file's header)`
    );
  });

  // 4b — the accumulator exists and leaves the script.
  check(/const __routingLog = \[\]/.test(src), `${f} declares no __routingLog accumulator`);
  check(/routing_log: __routingLog/.test(src), `${f} never returns routing_log — entries cannot leave the script`);

  // 4c — every exit is wrapped.
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)return (withRouting\()?\{/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1];
    let body;
    if (lines[i].trimEnd().endsWith('}') || lines[i].trimEnd().endsWith('})')) {
      body = [lines[i]];
    } else {
      let close = -1;
      for (let j = i; j < lines.length; j++) {
        if (lines[j] === `${indent}}` || lines[j] === `${indent}})`) { close = j; break; }
      }
      if (close === -1) continue;
      body = lines.slice(i, close + 1);
    }
    const isExit = body.some(b => /^\s*status: /.test(b)) || /\{ status: /.test(lines[i]);
    if (!isExit) continue;
    check(
      Boolean(m[2]),
      `${f}:${i + 1} is a workflow exit that is NOT wrapped in withRouting() — this run's routing_log would be dropped on that path`
    );
  }
}
console.log('  no dead opts key; accumulator declared, returned, and every exit wrapped');

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed (4 cases).');
