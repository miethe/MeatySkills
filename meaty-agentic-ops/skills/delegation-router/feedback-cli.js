#!/usr/bin/env node
/**
 * delegation-router/feedback-cli.js
 *
 * The PRODUCER-SIDE DRIVER for the CCDash proof→routing feedback loop (DI-1). It is the
 * missing link that makes the loop live rather than inert: it fetches CCDash's routing
 * rollup, merges it through routing-feedback.js's ratified merge + actuation math, and
 * (only under an explicit `--apply` that also clears the merge gate) persists the
 * machine-owned override state file the resolver reads.
 *
 * Before this file existed, `routing-feedback.js` could merge and `resolver.js` could read
 * ~/.claude/state/routing-feedback-overrides.json — but NOTHING fetched the rollup or wrote
 * that file, so the loop had a producer and a consumer and no wire between them.
 *
 * USAGE
 *   node feedback-cli.js --project <pid> [--url <base>] [--apply | --dry-run]
 *                        [--state-path <p>] [--timeout <seconds>] [--json]
 *   node feedback-cli.js --help
 *
 * OUTPUT
 *   Prints a per-row decisions table (task_class, entry, action, combined_signal, reason)
 *   plus the `applied` verdict and its `gate_reason` to stdout, and exits 0. With --json,
 *   prints {decisions?, applied, gate_reason, state_written, exit_code, error?} instead — on
 *   EVERY exit path, so a JSON consumer never gets empty stdout. On a usage error, fetch
 *   failure, or a refused --apply, prints a one-line human-readable message to stderr
 *   (never a raw stack trace as the primary message) and exits non-zero.
 *
 * EXIT CODES
 *   0  merged successfully (dry-run, applied, or nothing actionable to merge)
 *   1  could not fetch or merge the rollup (includes fetch timeout)
 *   2  usage error (bad/missing flag or flag value)
 *   3  --apply refused because the merge gate is closed (nothing was written)
 *
 * INVARIANTS (routing-feedback-router-merge-handoff.md §2.4; node_01KZ6Z3C37W3CM84BT5F3550Y7):
 *   - THE NETWORK FETCH LIVES ONLY HERE. resolver.js and the whole resolve path stay pure
 *     and offline — a routing decision must never depend on an HTTP call. routing-feedback.js
 *     likewise does no network I/O (its own header: "NO MODEL CALL, NO NETWORK, NO SHELL").
 *     Never add a fetch to either; this CLI is the environment-aware edge, exactly as
 *     resolve-cli.js is the environment-aware edge for the shim probe. Enforced as a static
 *     source assertion in tests/test-feedback-cli.js, not merely as a convention.
 *   - DRY-RUN IS THE DEFAULT. Writing requires BOTH `--apply` AND `result.applied === true`.
 *     `applied` is mergeFeedback's own gate verdict (the pinned contract's `live_consumption`
 *     must be exactly 'enabled' AND the AOS_ROUTING_FEEDBACK kill switch must not be falsy),
 *     so the gate is VISIBLE AT THE PRODUCER STEP and not only later in the resolver. An
 *     operator who runs --apply while the gate is closed gets an explicit refusal on stderr
 *     and exit 3 — not a silently-written file the resolver then silently ignores.
 *   - A WRITE REQUIRES AT LEAST ONE ACTIONABLE DECISION. An empty `overrides` map means two
 *     completely different things and they must not share a code path:
 *       * "measured, and healthy" — rows evaluated to `neutral`, which legitimately LIFTS a
 *         stale demotion. That write MUST happen; suppressing it would strand a demotion
 *         until its TTL on evidence that already says it should go.
 *       * "nothing was measurable" — every row came back `skip` (join_rejected /
 *         not_eligible_for_adjustment / low_confidence / no_live_terms). Writing that empty
 *         map would lift EVERY live demotion at once on the strength of no evidence at all,
 *         which is precisely the failure the nothing-to-merge guard exists to prevent.
 *     So the discriminator is the DECISIONS, never the resulting override map: write iff at
 *     least one decision's action is in {neutral, demote, hold, restore}. Absence of evidence
 *     is not evidence of health (the same principle routing-feedback.js applies per row when
 *     it refuses to actuate on `no_live_terms`), applied here at whole-rollup scope.
 *   - IDEMPOTENT. mergeFeedback rebuilds `overrides` from the rows on every call; this CLI
 *     never accumulates or appends. Re-running on the same rollup refreshes confirmed_at /
 *     expires_at and re-asserts the same demotions; it does not duplicate them. Prior state
 *     is read only to supply hysteresis (`wasDemoted`), never merged into the output.
 *   - NO MODEL CALL. One HTTP GET, one JSON read, one JSON write. Nothing else.
 *
 * AUTOMATION DECISION (AC4 — cron vs on-demand): v1 IS AN ON-DEMAND OPERATOR COMMAND,
 * dry-run by default. A future Hermes cron firing once per TTL window is the automation
 * path, but it is a DELIBERATE FUTURE DECISION, not a default — and the reason it is safe to
 * defer is that the failure mode points the right way: every override written here carries a
 * TTL derived from its own rollup window (§2.4.6, "expires if the next window does not
 * re-confirm it"). If a cron driver STOPS running, loadFeedbackState() drops each demotion as
 * it expires and routing returns to registry order on its own. A dead driver therefore LIFTS
 * live demotions rather than freezing stale ones — fail-safe, not fail-dangerous. The cost of
 * running this by hand is a slightly staler signal; the cost of an unattended driver is an
 * unattended writer on the routing path. v1 takes the former.
 */

'use strict';

const {
  DEFAULT_STATE_PATH,
  loadFeedbackState,
  mergeFeedback,
  writeFeedbackState,
} = require('./routing-feedback.js');
const {
  loadDefaultRegistry,
  canonicalizeEntryString,
} = require('./entry-key.js');

const ROLLUP_PATH = '/api/v1/routing/rollup';
const DEFAULT_TIMEOUT_SECONDS = 30;

/**
 * The actions that constitute a measurement. `skip` is deliberately absent: it means the row
 * never reached the merge math at all, so a rollup of nothing but skips carries no verdict to
 * persist. See the "A WRITE REQUIRES AT LEAST ONE ACTIONABLE DECISION" invariant above.
 */
const ACTIONABLE_ACTIONS = new Set(['neutral', 'demote', 'hold', 'restore']);

function printHelp(stream) {
  stream.write(
    [
      'Usage: node feedback-cli.js --project <pid> [--url <base>] [--apply | --dry-run]',
      '                            [--state-path <p>] [--timeout <seconds>] [--json]',
      '',
      "Fetches CCDash's routing rollup, merges it through the ratified routing-feedback",
      'merge + discrete actuation math, prints the per-row decisions, and (only with --apply,',
      'and only when the merge gate is open) writes the machine-owned override state file the',
      'resolver reads. The network fetch lives ONLY in this CLI — the resolve path stays pure.',
      '',
      'Flags:',
      '  --project <pid>       CCDash project_id to roll up. Required for a real run.',
      '  --url <base>          CCDash API base URL. Default: $CCDASH_API_URL || $CCDASH_URL.',
      '  --dry-run             Merge and report, write nothing. THE DEFAULT.',
      '  --apply               Write the merged state — but only if the merge gate is open.',
      '                        If it is closed, refuses with the gate_reason and exits 3',
      '                        without writing. Also refuses (exit 0, no write) when no row',
      '                        was actionable, so a rollup of join-rejected or ineligible',
      '                        rows can never lift live demotions ahead of their TTL.',
      '  --state-path <p>      Override the state file path.',
      `                        Default: $AOS_ROUTING_FEEDBACK_STATE || ${DEFAULT_STATE_PATH}`,
      `  --timeout <seconds>   Rollup fetch timeout. Default: ${DEFAULT_TIMEOUT_SECONDS}.`,
      '  --json                Emit {decisions, applied, gate_reason, state_written,',
      '                        exit_code, error?} as JSON — on every exit path.',
      '  --help, -h            Show this help and exit 0.',
      '',
      'Environment:',
      '  CCDASH_API_URL / CCDASH_URL   API base URL (--url wins).',
      '  CCDASH_TOKEN                  Bearer token for the rollup read.',
      '  AOS_ROUTING_FEEDBACK          Instant kill switch; 0|false|no|off closes the gate.',
      '  AOS_ROUTING_FEEDBACK_STATE    State file path (--state-path wins).',
      '',
      'Exit codes: 0 merged (dry-run, applied, or nothing actionable) · 1 fetch/merge failure',
      '            2 usage error · 3 --apply refused, gate closed (nothing written)',
      '',
      'Automation: v1 is an ON-DEMAND operator command. A Hermes cron firing once per TTL',
      'window is the automation path, but it is a deliberate future decision, not a default.',
      'It is safe to defer because the failure mode is fail-safe: every override carries a TTL',
      'derived from its own rollup window, so if a cron driver STOPS running, every live',
      'demotion LIFTS as it expires and routing returns to registry order — a dead driver',
      'never freezes a stale demotion in place.',
      '',
    ].join('\n')
  );
}

/**
 * Read the value that follows a value-taking flag.
 *
 * A missing value must be a hard usage error, never a silent fallthrough: `--state-path` with
 * no value would otherwise resolve to the REAL DEFAULT_STATE_PATH (so a test/debug invocation
 * would write the operator's live routing state), and `--project --json` would fire a real
 * fetch for project_id='--json'. Rejecting a `--`-prefixed value is the cheap, unambiguous
 * way to catch both; no flag here legitimately takes a value that starts with `--`.
 */
function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || String(value).startsWith('--')) {
    throw new Error(`${flag} requires a value (see --help)`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    project: undefined,
    url: undefined,
    apply: false,
    statePath: undefined,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--project':
        args.project = takeValue(argv, ++i, flag);
        break;
      case '--url':
        args.url = takeValue(argv, ++i, flag);
        break;
      case '--apply':
        args.apply = true;
        break;
      case '--dry-run':
        args.apply = false;
        break;
      case '--state-path':
        args.statePath = takeValue(argv, ++i, flag);
        break;
      case '--timeout': {
        const raw = takeValue(argv, ++i, flag);
        const seconds = Number(raw);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new Error(`--timeout must be a positive number of seconds, got '${raw}'`);
        }
        args.timeoutSeconds = seconds;
        break;
      }
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`unrecognized argument '${flag}' (see --help)`);
    }
  }

  return args;
}

/**
 * The machine-readable envelope. Emitted on every exit path under --json so a consumer can
 * always distinguish "refused", "failed", and "succeeded with nothing to do" from each other —
 * and never has to parse an empty stdout.
 */
function jsonEnvelope({ decisions, chain_join_summary, applied, gate_reason, state_written, exitCode, error }) {
  const out = {};
  if (decisions !== undefined) out.decisions = decisions;
  // Present alongside decisions whenever they are (including the empty-decisions success
  // path) so a --json consumer can see the majority-mismatch verdict without re-deriving it
  // from the per-row `chain_join` fields itself (DI-1 §5: visible, not buried).
  if (chain_join_summary !== undefined) out.chain_join_summary = chain_join_summary;
  out.applied = applied;
  out.gate_reason = gate_reason;
  out.state_written = state_written;
  out.exit_code = exitCode;
  if (error !== undefined) out.error = error;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * GET the CCDash routing rollup. The ONLY network call in the delegation-router skill.
 *
 * @param {Object} params
 * @param {string} params.baseUrl
 * @param {string} params.projectId
 * @param {string} [params.token]
 * @param {number} params.timeoutSeconds
 * @param {Function} params.fetchImpl
 * @param {Object} params.stderr
 * @returns {Promise<Object>} the rollup body's `data` object
 */
async function fetchRollup({ baseUrl, projectId, token, timeoutSeconds, fetchImpl, stderr }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const url = `${base}${ROLLUP_PATH}?project_id=${encodeURIComponent(projectId)}`;

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    stderr.write('feedback-cli: CCDASH_TOKEN is not set — sending an unauthenticated read\n');
  }

  const init = { method: 'GET', headers };
  // A driver that hangs forever on an unreachable node is worse than one that fails: an
  // operator waiting on a prompt learns nothing, and a future cron would pile up workers.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(Math.round(timeoutSeconds * 1000));
  }

  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    const name = err && err.name ? String(err.name) : '';
    const message = err && err.message ? String(err.message) : String(err);
    if (name === 'TimeoutError' || name === 'AbortError' || /abort/i.test(message)) {
      const timedOut = new Error(`rollup fetch timed out after ${timeoutSeconds}s (GET ${url})`);
      timedOut.isTimeout = true;
      throw timedOut;
    }
    throw new Error(`GET ${url} failed — ${message}`);
  }

  if (!res.ok) {
    throw new Error(`GET ${url} returned HTTP ${res.status}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`GET ${url} returned a body that is not JSON — ${err.message}`);
  }

  if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') {
    throw new Error(`GET ${url} returned no {status, data, meta} envelope`);
  }

  return body.data;
}

/**
 * Recombine the envelope identity fields the merge join needs.
 *
 * `producer` is NOT a top-level field on the REST response — CCDash carries it per key row —
 * so it is lifted from the first row. Every row in a rollup shares one producer by
 * construction, and a mismatch is caught downstream anyway: validateFeedbackJoin() rejects
 * per row with `unknown_producer`, fail-closed.
 */
function buildEnvelope(data) {
  const firstRow = (data.keys || [])[0] || {};
  return {
    producer: firstRow.producer,
    contract_id: data.contract_id,
    contract_version: data.contract_version,
    taxonomy_id: data.taxonomy_id,
    taxonomy_version: data.taxonomy_version,
    taxonomy_digest: data.taxonomy_digest,
    mapping_id: data.mapping_id,
    mapping_version: data.mapping_version,
    mapping_digest: data.mapping_digest,
  };
}

function fmtSignal(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

/**
 * DI-1 §5 — the join failure this whole file exists to close was SILENT: mergeFeedback ran
 * clean, `applied` looked healthy, and the ACTUAL chain join (`entry_not_in_chain`) only
 * happened later, inside the resolver's `applyChainFeedback`, where merge-time decisions never
 * see it. `chain_join` re-evaluates that same join here, at merge time, so a decisions table
 * that "ran fine" can no longer hide a feedback channel that is, in fact, inert.
 *
 * Registry chains list PER-PROVIDER MODEL IDS (e.g. `ica/claude-sonnet-4-6[1m]`), not bare
 * aliases — so both sides of the comparison go through the same entry-key.js canonicalizer.
 */
function resolvePolicyChain(taskClass, registry) {
  const policy = (registry && registry.routing_policy) || {};
  const keys = [
    taskClass,
    String(taskClass).replace(/-/g, '_'),
    String(taskClass).replace(/_/g, '-'),
  ];
  for (const k of keys) {
    if (policy[k] && Array.isArray(policy[k].chain)) return policy[k].chain;
  }
  return null;
}

/**
 * DI-1 immunity topology — the opt-in `{chains, must_stay}` mergeFeedback needs to annotate (and
 * the resolver to enforce) which task_classes are immune to demotion. This is the ONE place that
 * reads the registry for that purpose: routing-feedback.js stays a pure function of its opts and
 * never touches the registry or the filesystem (AC3). Keys are emitted in BOTH dash and underscore
 * spellings so a decision's task_class matches whichever the rollup reported — the same tolerance
 * resolvePolicyChain applies.
 *
 * @param {Object} registry  loaded model registry (routing_policy + must_stay_primary)
 * @returns {{chains: Object<string, string[]>, must_stay: Set<string>}}
 */
function buildImmunityTopology(registry) {
  const variantsOf = key => [
    key,
    String(key).replace(/-/g, '_'),
    String(key).replace(/_/g, '-'),
  ];
  const policy = (registry && registry.routing_policy) || {};
  const chains = {};
  for (const [taskClass, spec] of Object.entries(policy)) {
    if (!spec || !Array.isArray(spec.chain)) continue;
    for (const k of variantsOf(taskClass)) chains[k] = spec.chain;
  }
  const must_stay = new Set();
  for (const cls of (registry && registry.must_stay_primary) || []) {
    for (const k of variantsOf(cls)) must_stay.add(k);
  }
  return { chains, must_stay };
}

/**
 * @param {Object} decision   one row from mergeFeedback's `decisions[]` (task_class + entry)
 * @param {Object} registry   loaded model registry (entry-key.js canonicalization source)
 * @returns {'in_chain'|'entry_not_in_chain'|'unknown_provider'|'unknown_model'|'no_chain_for_class'}
 */
function chainJoinStatus(decision, registry) {
  if (decision.task_class == null || decision.entry == null) return 'no_chain_for_class';
  const chain = resolvePolicyChain(decision.task_class, registry);
  if (!chain || chain.length === 0) return 'no_chain_for_class';

  const canon = canonicalizeEntryString(decision.entry, registry);
  if (!canon.ok) return canon.reason; // 'unknown_provider' | 'unknown_model'

  for (const chainEntry of chain) {
    const chainCanon = canonicalizeEntryString(chainEntry, registry);
    if (chainCanon.ok && chainCanon.key === canon.key) return 'in_chain';
  }
  return 'entry_not_in_chain';
}

/** Reasons that mean "this row's feedback cannot possibly reach the routing chain." */
const CHAIN_JOIN_FAILURE_REASONS = new Set(['entry_not_in_chain', 'unknown_provider', 'unknown_model']);

/**
 * Summarize `chain_join` across all decisions so a non-`in_chain` majority is a single visible
 * fact rather than something a reader has to tally from the table themselves.
 */
function summarizeChainJoin(decisions) {
  const counts = {
    in_chain: 0,
    entry_not_in_chain: 0,
    unknown_provider: 0,
    unknown_model: 0,
    no_chain_for_class: 0,
  };
  for (const d of decisions) {
    if (Object.prototype.hasOwnProperty.call(counts, d.chain_join)) counts[d.chain_join]++;
  }
  const failingCount = [...CHAIN_JOIN_FAILURE_REASONS].reduce((n, r) => n + counts[r], 0);
  const total = decisions.length;
  return {
    counts,
    majority_mismatch: total > 0 && failingCount * 2 > total,
  };
}

/** Render the per-row decisions as a padded text table. */
function formatDecisionsTable(decisions) {
  const header = ['TASK_CLASS', 'ENTRY', 'ACTION', 'SIGNAL', 'REASON', 'CHAIN_JOIN'];
  const rows = decisions.map(d => [
    String(d.task_class == null ? '—' : d.task_class),
    String(d.entry == null ? '—' : d.entry),
    String(d.action),
    fmtSignal(d.combined_signal),
    String(d.reason || ''),
    String(d.chain_join || '—'),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length), 0)
  );
  const line = cells =>
    cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');

  return [line(header), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/**
 * Dependency-injectable core. No network and no process exit — so a test can drive the whole
 * flow with a canned fetch and a tmp state path.
 *
 * @param {string[]} argv
 * @param {Object} [deps]
 * @param {Function} [deps.fetchImpl]  defaults to globalThis.fetch
 * @param {Object}   [deps.env]        defaults to process.env
 * @param {string}   [deps.statePath]  default state path when --state-path is absent
 * @param {number}   [deps.now]        epoch ms (injectable, for deterministic output)
 * @param {Object}   [deps.stdout]     defaults to process.stdout
 * @param {Object}   [deps.stderr]     defaults to process.stderr
 * @param {Object}   [deps.mergeOpts]  TEST-ONLY seam: extra opts spread into mergeFeedback's
 *   `opts` (e.g. an injected `contract` to exercise the gate-open path without mutating the
 *   committed contract file, mirroring how tests/test-routing-feedback.js injects
 *   `enabledContract`). Production callers pass nothing and get the pinned contract. `env` is
 *   applied AFTER this spread, so an injected mergeOpts can never displace the real
 *   AOS_ROUTING_FEEDBACK kill switch — a test seam must not be able to disarm a kill switch.
 * @returns {Promise<{exitCode: number, applied: boolean, gate_reason: string|null,
 *                    state_written: string|null}>}
 */
async function run(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const env = deps.env || process.env;
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  // Read before parseArgs so even a parse failure can still answer in JSON.
  const wantJson = argv.includes('--json');

  const finish = (exitCode, opts = {}) => {
    const {
      decisions,
      chain_join_summary,
      error,
      applied = false,
      gate_reason = null,
      state_written = null,
    } = opts;
    if (wantJson) {
      stdout.write(jsonEnvelope({ decisions, chain_join_summary, applied, gate_reason, state_written, exitCode, error }));
    }
    return { exitCode, applied, gate_reason, state_written };
  };

  const fail = (exitCode, message, opts = {}) => {
    stderr.write(`feedback-cli: ${message}\n`);
    return finish(exitCode, { ...opts, error: message });
  };

  // Help is its own payload, so it never also emits the JSON envelope — a --json consumer that
  // asked for help gets the help text, and the no-args case cannot carry --json at all.
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp(argv.length === 0 ? stderr : stdout);
    return { exitCode: argv.length === 0 ? 2 : 0, applied: false, gate_reason: null, state_written: null };
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return fail(2, err.message);
  }

  if (!args.project) {
    return fail(2, '--project is required (see --help)');
  }

  const baseUrl = args.url || env.CCDASH_API_URL || env.CCDASH_URL;
  if (!baseUrl) {
    return fail(2, 'no CCDash base URL — pass --url or set CCDASH_API_URL / CCDASH_URL');
  }

  if (typeof fetchImpl !== 'function') {
    return fail(2, 'no global fetch available (needs Node 18+)');
  }

  const statePath = args.statePath || deps.statePath || env.AOS_ROUTING_FEEDBACK_STATE || DEFAULT_STATE_PATH;

  let data;
  try {
    data = await fetchRollup({
      baseUrl,
      projectId: args.project,
      token: env.CCDASH_TOKEN,
      timeoutSeconds: args.timeoutSeconds,
      fetchImpl,
      stderr,
    });
  } catch (err) {
    return fail(1, err.isTimeout ? err.message : `could not fetch the routing rollup — ${err.message}`);
  }

  const rows = Array.isArray(data.keys) ? data.keys : [];

  // Nothing to merge is a NORMAL, successful outcome — and it must not write. Clobbering a
  // live state file with an empty one because the producer flag happened to be off would lift
  // every demotion on a transient producer-side condition. Silence means "no new evidence";
  // the existing overrides stay put and expire on their own TTL.
  if (data.enabled === false || rows.length === 0) {
    const why = data.enabled === false ? 'rollup disabled at the producer' : 'rollup returned no keys';
    if (!wantJson) {
      stdout.write(`nothing to merge (${why}) — state left untouched at ${statePath}\n`);
    }
    return finish(0, { decisions: [], gate_reason: `nothing_to_merge:${why}` });
  }

  const envelope = buildEnvelope(data);
  const prior = loadFeedbackState({ statePath, env, now: deps.now });

  // The registry is the ONLY source of the immunity topology, and it is read HERE (the CLI),
  // never inside routing-feedback.js (AC3). Passing `chains`/`must_stay` is what turns on
  // mergeFeedback's immunity annotations: a single-entry chain is labelled `single_entry_chain`
  // and a MUST-stay class is held immune, so neither is demoted by the machine feedback loop.
  // Loaded once here and reused for the chain_join evaluation below.
  const registry = deps.registry || loadDefaultRegistry();
  const { chains: immunityChains, must_stay: immunityMustStay } = buildImmunityTopology(registry);

  let result;
  try {
    result = mergeFeedback({
      envelope,
      rows,
      priorState: { overrides: prior.overrides },
      now: deps.now,
      // chains/must_stay come from the registry; a test may override them via mergeOpts, but env
      // stays LAST so a test-injected mergeOpts can never replace the real kill switch.
      opts: { chains: immunityChains, must_stay: immunityMustStay, ...(deps.mergeOpts || {}), env },
    });
  } catch (err) {
    return fail(1, `merge failed — ${err.message}`);
  }

  // DI-1 §5: evaluate the chain join NOW, at merge time — this is the seam the bug lived in.
  // mergeFeedback ran clean and `applied` looked healthy while the ACTUAL join only happened
  // later, inside the resolver's applyChainFeedback, where a merge-time decisions table never
  // saw it. Attaching `chain_join` here means a non-`in_chain` majority can no longer hide
  // behind a run that otherwise "looks fine".
  const decisions = result.decisions.map(d => ({ ...d, chain_join: chainJoinStatus(d, registry) }));
  const chainJoinSummary = summarizeChainJoin(decisions);
  const maybeWarnChainJoin = () => {
    if (wantJson || !chainJoinSummary.majority_mismatch) return;
    stdout.write(
      `WARNING: chain_join mismatch on a MAJORITY of rows — feedback for these rows cannot ` +
      `reach the routing chain (entry_not_in_chain / unknown_provider / unknown_model). ` +
      `counts: ${JSON.stringify(chainJoinSummary.counts)}\n`
    );
  };

  // Rows arrived but not one of them was measurable — every decision is `skip`. That is the
  // same epistemic state as an empty rollup (no evidence), NOT the state of a healthy route,
  // so it must not write: persisting the resulting empty override map would lift every live
  // demotion at once on the strength of nothing. Note the discriminator is the decisions and
  // never `overrides === {}`; a genuinely NEUTRAL row also produces an empty map and that
  // write must still happen, because it is real evidence that a stale demotion should lift.
  const actionable = decisions.filter(d => ACTIONABLE_ACTIONS.has(d.action));
  if (actionable.length === 0) {
    if (!wantJson) {
      stdout.write(`${formatDecisionsTable(decisions)}\n\n`);
      stdout.write(
        `${rows.length} row(s) returned but none were actionable ` +
        `(join-rejected / ineligible) — state left untouched at ${statePath}\n`
      );
      stdout.write(`gate verdict was: ${result.gate_reason}\n`);
      maybeWarnChainJoin();
    }
    return finish(0, {
      decisions,
      chain_join_summary: chainJoinSummary,
      gate_reason: 'not_actionable:all_rows_skipped',
    });
  }

  // --apply is necessary but NOT sufficient: the merge's own gate must also be open. Surfacing
  // the refusal here is the point — the operator learns the gate is shut at the producer step
  // rather than wondering why a written file changed nothing.
  if (args.apply && result.applied !== true) {
    return fail(3, `refusing to apply: ${result.gate_reason}`, {
      decisions,
      chain_join_summary: chainJoinSummary,
      gate_reason: result.gate_reason,
    });
  }

  let stateWritten = null;
  if (args.apply) {
    try {
      stateWritten = writeFeedbackState(result.state, { statePath });
    } catch (err) {
      return fail(1, `could not write state to ${statePath} — ${err.message}`, {
        decisions,
        chain_join_summary: chainJoinSummary,
        applied: result.applied,
        gate_reason: result.gate_reason,
      });
    }
  }

  if (!wantJson) {
    stdout.write(`${formatDecisionsTable(decisions)}\n\n`);
    stdout.write(`applied: ${result.applied}  gate_reason: ${result.gate_reason}\n`);
    if (stateWritten) {
      stdout.write(`state written: ${stateWritten}\n`);
    } else {
      stdout.write(`dry run — nothing written (would write ${statePath}; pass --apply)\n`);
    }
    maybeWarnChainJoin();
  }

  return finish(0, {
    decisions,
    chain_join_summary: chainJoinSummary,
    applied: result.applied,
    gate_reason: result.gate_reason,
    state_written: stateWritten,
  });
}

function main() {
  // Set process.exitCode instead of calling process.exit(): a --json run can emit ~150 decision
  // rows, and process.exit() truncates whatever is still sitting in a piped stdout buffer.
  // Letting the event loop drain naturally is the only way the last row reliably survives
  // `| jq`. Nothing here keeps a handle open once the fetch settles.
  run(process.argv.slice(2)).then(
    ({ exitCode }) => {
      process.exitCode = exitCode;
    },
    err => {
      process.stderr.write(`feedback-cli: ${err && err.message ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  );
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, run, main };
