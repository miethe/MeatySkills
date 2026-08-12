/**
 * feedback-cli.js tests — tests/test-feedback-cli.js (DI-1 producer-side driver)
 *
 * Exercises the driver that closes the CCDash proof→routing loop: rollup fetch → merge →
 * gated state write. Unlike tests/test-resolve-cli.js (which legitimately spawns a real
 * subprocess to test a process boundary), this file drives the exported `run(argv, deps)`
 * core directly with an INJECTED fetch and a tmp state path — so there is no network, no
 * child_process, and no dependence on the operator's real ~/.claude/state file.
 *
 * Required scenarios:
 *   (a) dry-run is the default — no state file is written even when a row would demote
 *   (b) --apply is gated: refused (exit 3, nothing written) when the merge gate is closed;
 *       writes only when result.applied === true
 *   (c) data.enabled === false → exit 0, nothing written
 *   (d) empty data.keys → exit 0, nothing written
 *   (e) idempotence — two --apply runs on the same rollup produce a byte-identical state file
 *   (f) missing --project → non-zero exit with a readable stderr message (no raw stack)
 *
 * HOW THE GATE-OPEN PATH IS TESTED HONESTLY. The committed contract pins
 * `live_consumption: "disabled_pending_ccdash_di4f_and_di4e"`, so a real run today ALWAYS
 * refuses to apply — that is the shipped behavior, and (b)'s refusal half asserts it against
 * the real file. To exercise the write path without mutating the committed contract, the
 * gate-open tests inject an otherwise-identical contract with the gate flipped through
 * feedback-cli's documented `deps.mergeOpts` seam — exactly the `enabledContract` technique
 * tests/test-routing-feedback.js already uses. The merge math, join validation, actuation, and
 * write are all the real code paths; only the reviewed gate value is injected.
 *
 * NO shell, NO child_process, NO network. Node built-in assert + fs/os/path only.
 *
 * Run: node .claude/skills/delegation-router/tests/test-feedback-cli.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

function describe(suite, fn) {
  console.log(`\n${suite}`);
  fn();
}

const skillDir = path.join(__dirname, '..');
const { parseArgs, run } = require(path.join(skillDir, 'feedback-cli.js'));
const {
  loadTaskClassVocabulary,
  loadRoutingFeedbackContract,
} = require(path.join(skillDir, 'task-class-vocabulary.js'));

const vocabulary = loadTaskClassVocabulary();
const pinnedContract = loadRoutingFeedbackContract();
const ccdashProducer = pinnedContract.accepted_producers.ccdash;

// The committed contract stays disabled; flipping it for real is a separate reviewed step
// (DI-4f + DI-4e). Gate-open tests inject this instead of touching the file.
const enabledContract = { ...pinnedContract, live_consumption: 'enabled' };

const FIXED_NOW = Date.parse('2026-08-11T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixtures — a canned REST body, shaped exactly like GET /api/v1/routing/rollup
// ---------------------------------------------------------------------------

/** A key row that clears eligibility + confidence and whose cost_index forces a demotion. */
function keyRow(overrides = {}) {
  return {
    producer: 'ccdash',
    source_skill_name: 'dev-execution',
    task_class: 'implementation',
    model: 'claude-sonnet-5',
    provider: 'claude',
    success_rate: null,
    cost_index: 9.0,           // cost term (9.0 - 1.0) * 0.3 = 2.4 >= theta 0.15 → demote
    cost_coverage_fraction: 1.0,
    regression_rate: null,
    sample_count: 50,
    confidence: 0.9,
    eligible_for_adjustment: true,
    window_start: '2026-08-04T00:00:00Z',
    window_end: '2026-08-11T00:00:00Z',
    ...overrides,
  };
}

function rollupData(overrides = {}) {
  return {
    enabled: true,
    generated_at: '2026-08-11T00:00:00Z',
    contract_id: pinnedContract.contract_id,
    contract_version: pinnedContract.contract_version,
    taxonomy_id: vocabulary.taxonomy_id,
    taxonomy_version: vocabulary.taxonomy_version,
    taxonomy_digest: vocabulary.taxonomy_digest,
    mapping_id: ccdashProducer.mapping_id,
    mapping_version: ccdashProducer.mapping_version,
    mapping_digest: ccdashProducer.mapping_digest,
    mapped_count: 1,
    unclassified_count: 0,
    distinct_unmapped_skill_names: 0,
    keys: [keyRow()],
    ...overrides,
  };
}

/** A fetch stand-in that records its calls and returns a canned {status, data, meta} body. */
function mockFetch(data, { ok = true, status = 200 } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => ({ status: 'ok', data, meta: { project_id: 'p1' } }),
    };
  };
  impl.calls = calls;
  return impl;
}

function sink() {
  const chunks = [];
  return { write: s => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

let tmpDirs = [];

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccdash-feedback-cli-'));
  tmpDirs.push(dir);
  return path.join(dir, 'nested', 'routing-feedback-overrides.json');
}

/** Baseline deps: canned fetch, tmp state path, fixed clock, captured streams. */
function deps(extra = {}) {
  const statePath = extra.statePath || tmpStatePath();
  const stdout = extra.stdout || sink();
  const stderr = extra.stderr || sink();
  return {
    fetchImpl: extra.fetchImpl || mockFetch(rollupData()),
    env: extra.env || { CCDASH_API_URL: 'http://10.42.10.76:8090', CCDASH_TOKEN: 'test-token' },
    statePath,
    now: extra.now !== undefined ? extra.now : FIXED_NOW,
    stdout,
    stderr,
    ...(extra.mergeOpts ? { mergeOpts: extra.mergeOpts } : {}),
    ...(extra.registry ? { registry: extra.registry } : {}),
  };
}

// `run()` is async, and a synchronous test() body cannot await it without blocking the single
// event loop that would resolve it. So async cases are registered on an explicit queue and
// awaited in order by runQueue() below, reporting through the same pass/fail counters as test().
const queue = [];
function asyncTest(name, fn) {
  queue.push({ name, fn });
}

async function runQueue() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passCount++;
    } catch (e) {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${e.message}`);
      failures.push({ name, error: e.message });
      failCount++;
    }
  }
}

// ---------------------------------------------------------------------------
// Synchronous unit coverage
// ---------------------------------------------------------------------------

describe('parseArgs — flags and defaults', () => {
  test('dry-run is the default (apply=false with no flags)', () => {
    const a = parseArgs(['--project', 'p1']);
    assert.strictEqual(a.apply, false);
    assert.strictEqual(a.project, 'p1');
  });

  test('--apply sets apply, --dry-run wins when it comes later', () => {
    assert.strictEqual(parseArgs(['--apply']).apply, true);
    assert.strictEqual(parseArgs(['--apply', '--dry-run']).apply, false);
  });

  test('an unrecognized flag throws a readable error', () => {
    assert.throws(() => parseArgs(['--nope']), /unrecognized argument '--nope'/);
  });

  test('--url / --state-path / --json are captured', () => {
    const a = parseArgs(['--project', 'p1', '--url', 'http://x', '--state-path', '/tmp/s.json', '--json']);
    assert.strictEqual(a.url, 'http://x');
    assert.strictEqual(a.statePath, '/tmp/s.json');
    assert.strictEqual(a.json, true);
  });
});

// ---------------------------------------------------------------------------
// (a) dry-run default writes nothing
// ---------------------------------------------------------------------------

asyncTest('(a) dry-run default writes NO state file even when a row demotes', async () => {
  const d = deps();
  const res = await run(['--project', 'p1'], d);

  assert.strictEqual(res.exitCode, 0, `expected exit 0, got ${res.exitCode}: ${d.stderr.text()}`);
  assert.strictEqual(res.state_written, null, 'dry run must not report a written path');
  assert.strictEqual(fs.existsSync(d.statePath), false, 'dry run must not create the state file');

  const out = d.stdout.text();
  assert.ok(out.includes('demote'), `expected a demote decision in the table, got:\n${out}`);
  assert.ok(/dry run/.test(out), 'dry run must say so on stdout');
});

asyncTest('(a) dry-run still reports the gate verdict and fetches with a bearer header', async () => {
  const fetchImpl = mockFetch(rollupData());
  const d = deps({ fetchImpl });
  const res = await run(['--project', 'proj-42', '--json'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.applied, false, 'the committed contract keeps the gate closed');
  assert.strictEqual(res.gate_reason, 'live_consumption_disabled');

  assert.strictEqual(fetchImpl.calls.length, 1, 'exactly one HTTP GET');
  const { url, init } = fetchImpl.calls[0];
  assert.ok(url.includes('/api/v1/routing/rollup'), `unexpected path: ${url}`);
  assert.ok(url.includes('project_id=proj-42'), `project_id not in query: ${url}`);
  assert.strictEqual(init.headers.Authorization, 'Bearer test-token');

  const parsed = JSON.parse(d.stdout.text());
  assert.ok(Array.isArray(parsed.decisions) && parsed.decisions.length === 1);
  assert.strictEqual(parsed.state_written, null);
});

// ---------------------------------------------------------------------------
// (b) --apply is gated
// ---------------------------------------------------------------------------

asyncTest('(b) --apply against the REAL (disabled) contract exits 3 and writes nothing', async () => {
  const d = deps();
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 3, `expected exit 3, got ${res.exitCode}`);
  assert.strictEqual(res.applied, false);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.existsSync(d.statePath), false, 'a refused apply must not write');

  const err = d.stderr.text();
  assert.ok(/refusing to apply: live_consumption_disabled/.test(err), `stderr was:\n${err}`);
  assert.ok(!/\n\s+at /.test(err), 'stderr must not contain a raw stack trace');
});

asyncTest('(b) --apply with the env kill switch engaged exits 3 and writes nothing', async () => {
  const d = deps({
    env: { CCDASH_API_URL: 'http://x', CCDASH_TOKEN: 't', AOS_ROUTING_FEEDBACK: '0' },
    mergeOpts: { contract: enabledContract },  // contract gate open; env switch must still win
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 3);
  assert.strictEqual(res.gate_reason, 'env_disabled');
  assert.strictEqual(fs.existsSync(d.statePath), false);
});

asyncTest('(b) --apply with the gate OPEN writes the state file and reports the path', async () => {
  const d = deps({ mergeOpts: { contract: enabledContract } });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0, `expected exit 0, got ${res.exitCode}: ${d.stderr.text()}`);
  assert.strictEqual(res.applied, true, 'gate open → applied must be true');
  assert.strictEqual(res.gate_reason, 'enabled');
  assert.strictEqual(res.state_written, d.statePath);
  assert.ok(fs.existsSync(d.statePath), 'the state file must exist (parent dirs created)');

  const state = JSON.parse(fs.readFileSync(d.statePath, 'utf8'));
  assert.strictEqual(state.schema_version, 1);
  const demotions = state.overrides.implementation.demotions;
  assert.strictEqual(demotions.length, 1, 'exactly one demotion for the single row');
  assert.strictEqual(demotions[0].entry, 'claude/claude-sonnet-5');
  assert.strictEqual(demotions[0].action, 'demote');
  assert.ok(demotions[0].expires_at, 'every override must carry a TTL (fail-safe lapse)');
  assert.ok(Date.parse(demotions[0].expires_at) > FIXED_NOW, 'TTL must be in the future');

  assert.ok(d.stdout.text().includes('state written:'), 'stdout must report the written path');
});

asyncTest('(b) a neutral row leaves overrides empty even with the gate open', async () => {
  const d = deps({
    fetchImpl: mockFetch(rollupData({ keys: [keyRow({ cost_index: 1.0 })] })),
    mergeOpts: { contract: enabledContract },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.applied, true);
  const state = JSON.parse(fs.readFileSync(d.statePath, 'utf8'));
  assert.deepStrictEqual(state.overrides, {}, 'a healthy row must not demote anything');
});

// ---------------------------------------------------------------------------
// (g) Node …0J — the CLI wires chains/must_stay from the registry into mergeFeedback,
//     so the WRITTEN state file is immunity-annotated (DI-1). This is the whole point of
//     the wiring: without it, mergeFeedback's `reportImmunity` never turns on and the state
//     file the resolver reads cannot tell a demotable class from an immune one.
// ---------------------------------------------------------------------------

asyncTest('(g) --apply annotates the written state with per-class immunity from the registry', async () => {
  // The registry topology the CLI must forward. Each row's source_skill_name is chosen so the
  // vocabulary join ACCEPTS it for the intended class (dev-execution→implementation,
  // ccdash→mechanical, delegation-router→orchestration); a class/skill mismatch is join-rejected
  // upstream and never reaches this annotation. `implementation` is single-entry (immune),
  // `mechanical` is multi-entry (a real peer exists → NOT immune), `orchestration` is MUST-stay.
  const immunityRegistry = {
    version: 1,
    routing_policy: {
      implementation: { chain: ['claude/claude-sonnet-5'] },                        // single-entry
      mechanical: { chain: ['ica/claude-haiku-4-5', 'claude/claude-haiku-4-5'] },    // multi-entry
      orchestration: { chain: ['claude/claude-opus-5'] },                            // MUST-stay
    },
    must_stay_primary: ['orchestration'],
    // chain_join is annotation-only and never gates the write; the state file we assert on
    // carries `overrides[class].immunity`, not chain_join — so an empty models map is fine.
    models: {},
  };
  const d = deps({
    registry: immunityRegistry,
    mergeOpts: { contract: enabledContract },
    fetchImpl: mockFetch(rollupData({
      keys: [
        keyRow({ source_skill_name: 'dev-execution', task_class: 'implementation', model: 'claude-sonnet-5', provider: 'claude' }),
        keyRow({ source_skill_name: 'ccdash', task_class: 'mechanical', model: 'claude-haiku-4-5', provider: 'ica' }),
        keyRow({ source_skill_name: 'delegation-router', task_class: 'orchestration', model: 'claude-opus-5', provider: 'claude' }),
      ],
    })),
  });

  const res = await run(['--project', 'p1', '--apply', '--json'], d);
  assert.strictEqual(res.exitCode, 0, `expected exit 0, got ${res.exitCode}: ${d.stderr.text()}`);
  assert.strictEqual(res.applied, true, 'gate open → applied');

  // The decisions envelope proves BOTH inputs reached mergeFeedback: the single_entry_chain /
  // immune:false labels come from `chains`, and the must_stay label can ONLY come from `must_stay`.
  const decisions = JSON.parse(d.stdout.text()).decisions;
  const byClass = Object.fromEntries(decisions.map(x => [x.task_class, x]));
  assert.strictEqual(byClass.implementation.immunity.kind, 'single_entry_chain');
  assert.strictEqual(byClass.mechanical.immunity.immune, false);
  assert.strictEqual(byClass.orchestration.immunity.kind, 'must_stay',
    'a MUST-stay class label proves the `must_stay` input flowed through, not just `chains`');

  // AC2 — the WRITTEN state file labels a single-entry class single_entry_chain and a multi-entry
  // class immune:false. (A MUST-stay class is join-rejected before it can demote, so it correctly
  // never lands in overrides — its immunity lives only on the decision row asserted above.)
  const state = JSON.parse(fs.readFileSync(d.statePath, 'utf8'));
  assert.strictEqual(state.overrides.implementation.immunity.kind, 'single_entry_chain',
    'a single-entry class must be labelled single_entry_chain in the written state');
  assert.strictEqual(state.overrides.implementation.immunity.immune, true);
  assert.strictEqual(state.overrides.mechanical.immunity.immune, false,
    'a multi-entry class must be written immune:false');
  assert.strictEqual(state.overrides.mechanical.immunity.kind, null);
  assert.ok(!('orchestration' in state.overrides),
    'a MUST-stay class is rejected upstream and must never be recorded as a demotion');
});

// ---------------------------------------------------------------------------
// (c) / (d) nothing-to-merge exits 0 without writing
// ---------------------------------------------------------------------------

asyncTest('(c) data.enabled === false → exit 0, no write, explicit message', async () => {
  const d = deps({ fetchImpl: mockFetch(rollupData({ enabled: false, keys: [keyRow()] })) });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.existsSync(d.statePath), false, 'a disabled rollup must not clobber state');
  assert.ok(/nothing to merge/.test(d.stdout.text()), `stdout was:\n${d.stdout.text()}`);
});

asyncTest('(d) empty keys → exit 0, no write', async () => {
  const d = deps({ fetchImpl: mockFetch(rollupData({ keys: [] })) });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.existsSync(d.statePath), false, 'an empty rollup must not clobber state');
  assert.ok(/nothing to merge/.test(d.stdout.text()));
});

asyncTest('(d) an existing state file survives an empty rollup untouched', async () => {
  const statePath = tmpStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const sentinel = '{\n  "schema_version": 1,\n  "overrides": {}\n}\n';
  fs.writeFileSync(statePath, sentinel, 'utf8');

  const d = deps({ statePath, fetchImpl: mockFetch(rollupData({ keys: [] })) });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), sentinel, 'state must be byte-untouched');
});

// ---------------------------------------------------------------------------
// (e) idempotence
// ---------------------------------------------------------------------------

asyncTest('(e) two --apply runs on the same rollup produce a byte-identical state file', async () => {
  const statePath = tmpStatePath();
  const mergeOpts = { contract: enabledContract };

  const first = await run(['--project', 'p1', '--apply'], deps({ statePath, mergeOpts }));
  assert.strictEqual(first.exitCode, 0);
  assert.strictEqual(first.applied, true);
  const bytes1 = fs.readFileSync(statePath, 'utf8');

  // Second run reads the state it just wrote as priorState (wasDemoted → hysteresis path).
  const second = await run(['--project', 'p1', '--apply'], deps({ statePath, mergeOpts }));
  assert.strictEqual(second.exitCode, 0);
  assert.strictEqual(second.applied, true);
  const bytes2 = fs.readFileSync(statePath, 'utf8');

  assert.strictEqual(bytes2, bytes1, 're-running must refresh, not duplicate or drift');

  const state = JSON.parse(bytes2);
  assert.strictEqual(
    state.overrides.implementation.demotions.length,
    1,
    'demotions must not accumulate across runs'
  );
});

// ---------------------------------------------------------------------------
// (f) usage errors
// ---------------------------------------------------------------------------

asyncTest('(f) missing --project exits non-zero with a readable stderr message', async () => {
  const d = deps();
  const res = await run(['--url', 'http://x'], d);

  assert.notStrictEqual(res.exitCode, 0);
  assert.strictEqual(res.exitCode, 2);
  assert.strictEqual(res.state_written, null);

  const err = d.stderr.text();
  assert.ok(/--project is required/.test(err), `stderr was:\n${err}`);
  assert.ok(!/\n\s+at /.test(err), 'stderr must not contain a raw stack trace');
  assert.strictEqual(d.fetchImpl.calls.length, 0, 'a usage error must not hit the network');
});

asyncTest('(f) missing base URL exits 2 without fetching', async () => {
  const d = deps({ env: {} });
  const res = await run(['--project', 'p1'], d);

  assert.strictEqual(res.exitCode, 2);
  assert.ok(/CCDASH_API_URL/.test(d.stderr.text()));
  assert.strictEqual(d.fetchImpl.calls.length, 0);
});

asyncTest('(f) an unrecognized flag exits 2 with a readable message', async () => {
  const d = deps();
  const res = await run(['--project', 'p1', '--bogus'], d);

  assert.strictEqual(res.exitCode, 2);
  assert.ok(/unrecognized argument '--bogus'/.test(d.stderr.text()));
  assert.strictEqual(d.fetchImpl.calls.length, 0);
});

asyncTest('(f) no args prints usage to stderr and exits 2; --help prints to stdout and exits 0', async () => {
  const bare = deps();
  const bareRes = await run([], bare);
  assert.strictEqual(bareRes.exitCode, 2);
  assert.ok(/Usage:/.test(bare.stderr.text()), 'no-args usage must go to stderr');
  assert.strictEqual(bare.stdout.text(), '');

  const helped = deps();
  const helpRes = await run(['--help'], helped);
  assert.strictEqual(helpRes.exitCode, 0);
  const help = helped.stdout.text();
  assert.ok(/Usage:/.test(help));
  for (const flag of ['--project', '--url', '--apply', '--dry-run', '--state-path', '--json', '--help']) {
    assert.ok(help.includes(flag), `--help must document ${flag}`);
  }
  assert.ok(/cron/i.test(help), '--help must document the on-demand-vs-cron decision');
  assert.strictEqual(helped.fetchImpl.calls.length, 0, '--help must not fetch');
});

asyncTest('(f) a non-2xx rollup response exits 1 without writing', async () => {
  const d = deps({ fetchImpl: mockFetch(rollupData(), { ok: false, status: 503 }) });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 1);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.existsSync(d.statePath), false);
  assert.ok(/HTTP 503/.test(d.stderr.text()), `stderr was:\n${d.stderr.text()}`);
});

// ---------------------------------------------------------------------------
// (g) all-rows-rejected must NOT clobber live state — the discriminator is the
//     decisions, not the resulting override map
// ---------------------------------------------------------------------------

/** A state file with one LIVE demotion, so a clobber is detectable byte-for-byte. */
function seedLiveState(statePath) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const bytes = JSON.stringify(
    {
      schema_version: 1,
      source: 'ccdash-routing-feedback-v1.0.0',
      generated_at: '2026-08-10T00:00:00.000Z',
      overrides: {
        implementation: {
          demotions: [
            {
              entry: 'claude/claude-sonnet-5',
              combined_signal: 2.4,
              action: 'demote',
              confirmed_at: '2026-08-10T00:00:00.000Z',
              expires_at: '2026-09-01T00:00:00.000Z',
              source: 'ccdash-routing-feedback-v1.0.0',
            },
          ],
        },
      },
    },
    null,
    2
  ) + '\n';
  fs.writeFileSync(statePath, bytes, 'utf8');
  return bytes;
}

asyncTest('(g) rows present but ALL join-rejected: exit 0, no write, live state byte-untouched', async () => {
  const statePath = tmpStatePath();
  const seeded = seedLiveState(statePath);

  // A stale taxonomy_digest rejects every row at the join, before any arithmetic.
  const d = deps({
    statePath,
    fetchImpl: mockFetch(rollupData({ taxonomy_digest: 'sha256:stale' })),
    mergeOpts: { contract: enabledContract },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0, `expected exit 0, got ${res.exitCode}: ${d.stderr.text()}`);
  assert.strictEqual(res.state_written, null, 'an unmeasurable rollup must not write');
  assert.strictEqual(
    fs.readFileSync(statePath, 'utf8'),
    seeded,
    'a rollup of join-rejected rows must NOT lift live demotions ahead of their TTL'
  );
  assert.strictEqual(res.gate_reason, 'not_actionable:all_rows_skipped');
  assert.ok(/none were actionable/.test(d.stdout.text()), `stdout was:\n${d.stdout.text()}`);
});

asyncTest('(g) all-ineligible rows are equally non-writing (not just join failures)', async () => {
  const statePath = tmpStatePath();
  const seeded = seedLiveState(statePath);

  const d = deps({
    statePath,
    fetchImpl: mockFetch(
      rollupData({
        keys: [
          keyRow({ eligible_for_adjustment: false }),
          keyRow({ model: 'claude-opus-5', confidence: 0.1 }),
        ],
      })
    ),
    mergeOpts: { contract: enabledContract },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.readFileSync(statePath, 'utf8'), seeded, 'state must be byte-untouched');
});

asyncTest('(g) ONE actionable row among skips still writes (skips must not veto real evidence)', async () => {
  const statePath = tmpStatePath();
  const d = deps({
    statePath,
    fetchImpl: mockFetch(
      rollupData({
        keys: [
          keyRow({ source_skill_name: 'totally-unknown-skill' }),  // join-rejected → skip
          keyRow(),                                               // actionable → demote
        ],
      })
    ),
    mergeOpts: { contract: enabledContract },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0);
  assert.strictEqual(res.applied, true);
  assert.strictEqual(res.state_written, statePath);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.strictEqual(state.overrides.implementation.demotions.length, 1);
});

asyncTest('(g) a NEUTRAL row still writes an empty override map (lifting a stale demotion)', async () => {
  const statePath = tmpStatePath();
  seedLiveState(statePath);

  // cost_index 1.0 → combined_signal 0.0 with the cost term live → restore/neutral, not skip.
  const d = deps({
    statePath,
    fetchImpl: mockFetch(rollupData({ keys: [keyRow({ cost_index: 1.0 })] })),
    mergeOpts: { contract: enabledContract },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 0, `expected exit 0, got ${res.exitCode}: ${d.stderr.text()}`);
  assert.strictEqual(res.state_written, statePath, 'measured-and-healthy MUST still write');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepStrictEqual(state.overrides, {}, 'the stale demotion must be lifted, not preserved');
});

// ---------------------------------------------------------------------------
// (h) the kill switch cannot be displaced by the test seam (opts spread order)
// ---------------------------------------------------------------------------

asyncTest('(h) an injected mergeOpts.env cannot override the real AOS_ROUTING_FEEDBACK switch', async () => {
  const d = deps({
    env: { CCDASH_API_URL: 'http://x', CCDASH_TOKEN: 't', AOS_ROUTING_FEEDBACK: 'off' },
    // A seam that tried to disarm the kill switch by supplying a clean env must lose.
    mergeOpts: { contract: enabledContract, env: {} },
  });
  const res = await run(['--project', 'p1', '--apply'], d);

  assert.strictEqual(res.exitCode, 3, 'the env kill switch must still close the gate');
  assert.strictEqual(res.gate_reason, 'env_disabled');
  assert.strictEqual(fs.existsSync(d.statePath), false);
});

// ---------------------------------------------------------------------------
// (i) flag-value validation
// ---------------------------------------------------------------------------

describe('parseArgs — value-taking flags reject a missing value', () => {
  for (const flag of ['--project', '--url', '--state-path', '--timeout']) {
    test(`${flag} with no value throws instead of silently falling through`, () => {
      assert.throws(() => parseArgs([flag]), new RegExp(`\\${flag} requires a value`));
    });
    test(`${flag} followed by another flag throws`, () => {
      assert.throws(() => parseArgs([flag, '--json']), new RegExp(`\\${flag} requires a value`));
    });
  }

  test('--timeout rejects a non-positive or non-numeric value', () => {
    assert.throws(() => parseArgs(['--timeout', '0']), /--timeout must be a positive number/);
    assert.throws(() => parseArgs(['--timeout', 'soon']), /--timeout must be a positive number/);
    assert.strictEqual(parseArgs(['--timeout', '5']).timeoutSeconds, 5);
  });

  test('--timeout defaults to 30 seconds', () => {
    assert.strictEqual(parseArgs(['--project', 'p1']).timeoutSeconds, 30);
  });
});

asyncTest('(i) --state-path with no value exits 2 and never touches the real default path', async () => {
  const d = deps();
  const res = await run(['--project', 'p1', '--state-path'], d);

  assert.strictEqual(res.exitCode, 2);
  assert.ok(/--state-path requires a value/.test(d.stderr.text()));
  assert.strictEqual(d.fetchImpl.calls.length, 0, 'must not fetch');
});

asyncTest('(i) --project with no value exits 2 and never fetches project_id=--json', async () => {
  const d = deps();
  const res = await run(['--project', '--json'], d);

  assert.strictEqual(res.exitCode, 2);
  assert.strictEqual(d.fetchImpl.calls.length, 0, 'must not fetch a flag as a project id');
});

// ---------------------------------------------------------------------------
// (j) fetch timeout
// ---------------------------------------------------------------------------

/** A fetch stand-in that rejects, for transport-failure paths. */
function throwingFetch(err) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    throw err;
  };
  impl.calls = calls;
  return impl;
}

asyncTest('(j) an abort/timeout rejection exits 1 with a readable timeout message', async () => {
  const timeoutErr = new Error('The operation was aborted due to timeout');
  timeoutErr.name = 'TimeoutError';

  const d = deps({ fetchImpl: throwingFetch(timeoutErr) });
  const res = await run(['--project', 'p1', '--apply', '--timeout', '2'], d);

  assert.strictEqual(res.exitCode, 1);
  assert.strictEqual(res.state_written, null);
  assert.strictEqual(fs.existsSync(d.statePath), false);
  const err = d.stderr.text();
  assert.ok(/timed out after 2s/.test(err), `stderr was:\n${err}`);
  assert.ok(!/\n\s+at /.test(err), 'stderr must not contain a raw stack trace');
});

asyncTest('(j) the fetch carries an abort signal so it cannot hang forever', async () => {
  const d = deps();
  await run(['--project', 'p1'], d);

  const { init } = d.fetchImpl.calls[0];
  assert.ok(init.signal, 'fetch init must carry a timeout AbortSignal');
  assert.strictEqual(typeof init.signal.aborted, 'boolean');
});

// ---------------------------------------------------------------------------
// (k) --json is emitted on every exit path
// ---------------------------------------------------------------------------

asyncTest('(k) --json emits an envelope on a usage error', async () => {
  const d = deps();
  const res = await run(['--json', '--url', 'http://x'], d);

  assert.strictEqual(res.exitCode, 2);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 2);
  assert.strictEqual(parsed.applied, false);
  assert.strictEqual(parsed.state_written, null);
  assert.ok(/--project is required/.test(parsed.error), `error was: ${parsed.error}`);
});

asyncTest('(k) --json emits an envelope on an unrecognized flag (before parseArgs succeeds)', async () => {
  const d = deps();
  const res = await run(['--json', '--bogus'], d);

  assert.strictEqual(res.exitCode, 2);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 2);
  assert.ok(/unrecognized argument/.test(parsed.error));
});

asyncTest('(k) --json emits an envelope on a transport failure', async () => {
  const d = deps({ fetchImpl: mockFetch(rollupData(), { ok: false, status: 503 }) });
  const res = await run(['--project', 'p1', '--json'], d);

  assert.strictEqual(res.exitCode, 1);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 1);
  assert.ok(/HTTP 503/.test(parsed.error));
});

asyncTest('(k) --json emits an envelope on a gate refusal, carrying the decisions', async () => {
  const d = deps();
  const res = await run(['--project', 'p1', '--apply', '--json'], d);

  assert.strictEqual(res.exitCode, 3);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 3);
  assert.strictEqual(parsed.applied, false);
  assert.strictEqual(parsed.gate_reason, 'live_consumption_disabled');
  assert.strictEqual(parsed.state_written, null);
  assert.strictEqual(parsed.decisions.length, 1, 'a refusal must still explain what it saw');
});

asyncTest('(k) --json emits a single parseable envelope on the nothing-to-merge path', async () => {
  const d = deps({ fetchImpl: mockFetch(rollupData({ keys: [] })) });
  const res = await run(['--project', 'p1', '--json'], d);

  assert.strictEqual(res.exitCode, 0);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 0);
  assert.deepStrictEqual(parsed.decisions, []);
  assert.ok(/nothing_to_merge/.test(parsed.gate_reason));
});

asyncTest('(k) --json emits an envelope with state_written on the success path', async () => {
  const d = deps({ mergeOpts: { contract: enabledContract } });
  const res = await run(['--project', 'p1', '--apply', '--json'], d);

  assert.strictEqual(res.exitCode, 0);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.exit_code, 0);
  assert.strictEqual(parsed.applied, true);
  assert.strictEqual(parsed.state_written, d.statePath);
  assert.strictEqual(parsed.error, undefined, 'a success envelope must carry no error field');
});

// ---------------------------------------------------------------------------
// (m) DI-1 §5 — chain_join surfaced per-decision AND as a visible majority-mismatch summary
// ---------------------------------------------------------------------------

// This repo's own registry — injected via the documented `deps.registry` seam so the test
// stays offline/deterministic regardless of what (if anything) is at ~/.claude/config on the
// machine running it.
const realRegistry = JSON.parse(fs.readFileSync(path.join(skillDir, 'model-registry.generated.json'), 'utf8'));

asyncTest('(m) a case-mismatched, dated-slug row now joins as in_chain (was the silent entry_not_in_chain bug)', async () => {
  const row = keyRow({
    task_class: 'mechanical', source_skill_name: 'symbols',
    provider: 'Claude', model: 'claude-haiku-4-5-20251001',
  });
  const d = deps({
    fetchImpl: mockFetch(rollupData({ keys: [row] })),
    mergeOpts: { contract: enabledContract },
    registry: realRegistry,
  });
  const res = await run(['--project', 'p1', '--json'], d);

  assert.strictEqual(res.exitCode, 0);
  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.decisions.length, 1);
  assert.strictEqual(parsed.decisions[0].chain_join, 'in_chain');
  assert.strictEqual(parsed.chain_join_summary.majority_mismatch, false);
  assert.strictEqual(parsed.chain_join_summary.counts.in_chain, 1);
});

asyncTest('(m) an out-of-vocabulary provider surfaces chain_join=unknown_provider, distinct from entry_not_in_chain', async () => {
  const row = keyRow({
    task_class: 'mechanical', source_skill_name: 'symbols',
    provider: 'OpenAI', model: 'gpt-5.4',
  });
  const d = deps({
    fetchImpl: mockFetch(rollupData({ keys: [row] })),
    mergeOpts: { contract: enabledContract },
    registry: realRegistry,
  });
  const res = await run(['--project', 'p1', '--json'], d);

  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.decisions[0].chain_join, 'unknown_provider');
  assert.notStrictEqual(parsed.decisions[0].chain_join, 'entry_not_in_chain');
});

asyncTest('(m) a non-in_chain MAJORITY prints a visible text-mode warning banner (not merely a buried column)', async () => {
  const rows = [
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: 'OpenAI', model: 'gpt-5.4' }),
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: '<synthetic>', model: '<synthetic>' }),
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: 'claude', model: 'claude-haiku-4-5' }),
  ];
  const d = deps({
    fetchImpl: mockFetch(rollupData({ keys: rows })),
    mergeOpts: { contract: enabledContract },
    registry: realRegistry,
  });
  const res = await run(['--project', 'p1'], d); // text mode, no --json

  assert.strictEqual(res.exitCode, 0);
  const out = d.stdout.text();
  assert.ok(/CHAIN_JOIN/.test(out), 'the decisions table must carry a CHAIN_JOIN column');
  assert.ok(/WARNING: chain_join mismatch on a MAJORITY/.test(out), `expected a visible majority-mismatch banner, got:\n${out}`);
});

asyncTest('(m) the same majority-mismatch case carries chain_join_summary.majority_mismatch=true in --json', async () => {
  const rows = [
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: 'OpenAI', model: 'gpt-5.4' }),
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: '<synthetic>', model: '<synthetic>' }),
    keyRow({ task_class: 'mechanical', source_skill_name: 'symbols', provider: 'claude', model: 'claude-haiku-4-5' }),
  ];
  const d = deps({
    fetchImpl: mockFetch(rollupData({ keys: rows })),
    mergeOpts: { contract: enabledContract },
    registry: realRegistry,
  });
  const res = await run(['--project', 'p1', '--json'], d);

  const parsed = JSON.parse(d.stdout.text());
  assert.strictEqual(parsed.chain_join_summary.majority_mismatch, true);
  assert.strictEqual(parsed.chain_join_summary.counts.unknown_provider, 2);
  assert.strictEqual(parsed.chain_join_summary.counts.in_chain, 1);
});

// ---------------------------------------------------------------------------
// (l) INVARIANT 1 as a test: the network lives ONLY in this CLI
// ---------------------------------------------------------------------------

describe('(l) purity — the resolve path performs no network I/O', () => {
  const NET_REQUIRE = /require\(\s*['"](http|https|net|dns|http2|tls|node:http|node:https|node:net|node:dns|node:http2|node:tls)['"]\s*\)/;

  for (const file of ['routing-feedback.js', 'resolver.js']) {
    test(`${file} contains no fetch( call`, () => {
      const src = fs.readFileSync(path.join(skillDir, file), 'utf8');
      assert.ok(
        !/fetch\s*\(/.test(src),
        `${file} must not call fetch — a routing decision may never depend on the network`
      );
    });

    test(`${file} requires no network module`, () => {
      const src = fs.readFileSync(path.join(skillDir, file), 'utf8');
      const hit = src.match(NET_REQUIRE);
      assert.ok(!hit, `${file} must not require a network module (found ${hit && hit[0]})`);
    });
  }

  test('feedback-cli.js is the one place that does fetch', () => {
    const src = fs.readFileSync(path.join(skillDir, 'feedback-cli.js'), 'utf8');
    assert.ok(/fetchImpl\(/.test(src), 'the driver is expected to be the sole network caller');
  });
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

(async () => {
  try {
    console.log('\nfeedback-cli — rollup fetch → merge → gated write');
    await runQueue();
  } finally {
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // best effort — a leftover tmpdir must never fail the suite
      }
    }
    tmpDirs = [];
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`);
    }
    console.log('\nSome feedback-cli tests failed.');
    process.exit(1);
  } else {
    console.log('All feedback-cli tests passed.');
    process.exit(0);
  }
})();
