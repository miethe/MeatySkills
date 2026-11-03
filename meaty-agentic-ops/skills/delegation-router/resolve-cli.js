#!/usr/bin/env node
/**
 * delegation-router/resolve-cli.js
 *
 * Headless CLI wrapper over resolver.js's pure `resolve()`. Lets a non-Claude-Code
 * harness (Codex, a shell script, a Hermes-driven agent, …) obtain the SAME
 * RoutingRecord Claude Code would, without re-implementing the resolver engine.
 *
 * USAGE
 *   node resolve-cli.js --model <id> [--provider <id>] [--task-class <class>]
 *                        [--effort <level>] [--profile <name>] [--resume-active]
 *                        [--compact] [--registry-path <path>]
 *   node resolve-cli.js --help
 *
 * OUTPUT
 *   Prints the validated RoutingRecord as JSON to stdout and exits 0.
 *   On an unresolvable/invalid request, prints a one-line human-readable message to
 *   stderr (never a raw stack trace as the primary message) and exits non-zero.
 *
 * INVARIANTS (feature contract: delegation-router-codex-consumption, §5/§8):
 *   - Pure read: no network calls, no model calls, no writes. The only I/O is the
 *     registry file read resolver.js already performs (its existing 3-tier lookup:
 *     MODEL_REGISTRY_PATH env → project-local .claude/config → global ~/.claude/config)
 *     plus, below, a single fs.existsSync stat for the node-safety check.
 *   - Does NOT modify resolver.js's selection pipeline or RoutingRecord schema.
 *   - Does NOT touch Track 1's `buildRegistryInvocation` gpt-branch in resolver.js —
 *     that logic is explicitly protected by the feature contract (§8, "Must not change").
 *     The node-safety fallback below is CLI-side post-processing of the record the
 *     resolver already emitted, not a resolver change.
 *
 * NODE-SAFETY FALLBACK (operator review addition, 2026-07-21):
 *   resolver.js's gpt-branch always emits `~/ica-gpt.sh …` for gpt-* models on the ICA
 *   provider (the /messages param-strip shim — see agentic_meta_dev/infra/ica-gpt-shim/).
 *   That shim is laptop-only today; the agentic node has no ~/ica-gpt.sh (deploy support
 *   for the node is tracked in the same feature contract). A resolve-cli invocation
 *   running ON THE NODE (or any host without the shim) would otherwise hand back an
 *   invocation_template pointing at a file that doesn't exist. This CLI checks for the
 *   shim's presence and rewrites the template to the raw `~/ica-claude.sh` path when
 *   absent, so the CLI's output is always directly runnable on the host it executes on.
 *   The resolver stays a pure, environment-agnostic oracle; the CLI is the
 *   environment-aware consumer — see resolver.js's own INVARIANTS comment (no shell I/O
 *   in the resolver) for why this doesn't belong there.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolve, loadRegistry, buildRoutingTable } = require('./resolver.js');

const ICA_GPT_SHIM_MARKER = '~/ica-gpt.sh';
const ICA_CLAUDE_FALLBACK = '~/ica-claude.sh';

function printHelp(stream) {
  stream.write(
    [
      'Usage: node resolve-cli.js --model <id> [--provider <id>] [--task-class <class>]',
      '                            [--effort <level>] [--profile <name>] [--resume-active]',
      '                            [--compact] [--registry-path <path>] [--size xs|s|m]',
      '                            [--needs-file <json>] (capabilities, modifiers, sizing, pin approval)',
      '',
      'Prints the delegation-router RoutingRecord (JSON) for the given routing request and',
      'exits 0. Exits non-zero with a readable message on stderr when the request cannot be',
      'resolved. Pure read: no network, no model calls, no writes.',
      '',
      'Flags:',
      '  --model <id>          Model class/id to route (e.g. sonnet, gpt-5.5-gus). Required.',
      '  --provider <id>       Requested provider (claude|ica|bob|gemini|codex). Default: claude.',
      '  --task-class <class>  Task class driving MUST-stay + chain lookup (e.g. second_opinion).',
      '  --identity <name>     Explicit codex_primary or codex_secondary account.',
      '  --effort <level>      Effort level (low|standard|high|xhigh|…). Default: standard.',
      '  --profile <name>      Profile name (e.g. free-tier).',
      '  --resume-active       Set resume_active=true (excludes nondeterministic providers on',
      '                        structural stages).',
      '  --registry-path <p>   Override the model registry path (test/debug only).',
      '  --compact             Emit single-line JSON instead of pretty-printed JSON.',
      '  --help, -h            Show this help and exit 0.',
      '',
    ].join('\n')
  );
}

function parseArgs(argv) {
  const args = {
    model: undefined,
    provider: undefined,
    effort: undefined,
    profile: undefined,
    task_class: undefined,
    resume_active: false,
    _registryPath: undefined,
    pretty: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--model':
        args.model = argv[++i];
        break;
      case '--size':
        args.size = argv[++i];
        break;
      case '--needs-file':
        Object.assign(args, readNeedsFile(argv[++i]));
        break;
      case '--provider':
        args.provider = argv[++i];
        break;
      case '--identity':
        args.identity_ref = argv[++i];
        if (!['codex_primary', 'codex_secondary'].includes(args.identity_ref)) throw new Error('Unknown Codex subscription identity');
        break;
      case '--effort':
        args.effort = argv[++i];
        break;
      case '--profile':
        args.profile = argv[++i];
        break;
      case '--task-class':
        args.task_class = argv[++i];
        break;
      case '--resume-active':
        args.resume_active = true;
        break;
      case '--registry-path':
        args._registryPath = argv[++i];
        break;
      case '--compact':
        args.pretty = false;
        break;
      default:
        throw new Error(`unrecognized argument '${flag}' (see --help)`);
    }
  }

  return args;
}

/**
 * CLI-side node-safety fallback: rewrite the invocation_template's ica-gpt.sh reference
 * to ica-claude.sh when the shim is not present on this host. Does not mutate any other
 * field except `reason`, which gets an appended note explaining the substitution.
 *
 * @param {import('./routing-record.js').RoutingRecord} record
 * @returns {import('./routing-record.js').RoutingRecord}
 */
function applyNodeSafetyFallback(record) {
  if (typeof record.invocation_template !== 'string') return record;
  if (!record.invocation_template.includes(ICA_GPT_SHIM_MARKER)) return record;

  // Test/debug seam: allow overriding the probed path without touching $HOME.
  const shimPath = process.env.ICA_GPT_SHIM_PATH || path.join(os.homedir(), 'ica-gpt.sh');

  if (fs.existsSync(shimPath)) return record;

  record.invocation_template = record.invocation_template.split(ICA_GPT_SHIM_MARKER).join(ICA_CLAUDE_FALLBACK);
  record.reason = `${record.reason} [resolve-cli: ${ICA_GPT_SHIM_MARKER} not found on this host — fell back to ${ICA_CLAUDE_FALLBACK}]`;
  return record;
}

function readNeedsFile(filename) {
  if (!filename) return {};
  const needs = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const allowed = ['size', 'effort_size', 'capabilities', 'modifiers', 'sizing', 'human_minutes_est',
    'preapproval_ref', 'pin_reason', 'pin_expires', 'execution_contract', 'requires_write'];
  if (!needs || typeof needs !== 'object' || Array.isArray(needs) || Object.keys(needs).some(key => !allowed.includes(key))) {
    throw new Error('--needs-file must contain only abstract needs and pin approval metadata');
  }
  return needs;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === 'table' || argv[0] === 'resolve') {
    const command = argv.shift();
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
      const key = argv[i];
      if (key === '--json') { flags.json = true; continue; }
      if (['--task-class', '--model', '--capacity-file', '--registry', '--identity', '--effort', '--size', '--needs-file'].includes(key)) {
        if (i + 1 >= argv.length) { process.stderr.write(`resolve-cli: ${key} requires a value\n`); process.exit(2); return; }
        flags[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
        continue;
      }
      process.stderr.write(`resolve-cli: unrecognized argument '${key}'\n`); process.exit(2); return;
    }
    try {
      const registry = loadRegistry(flags.registry);
      if (command === 'table') {
        process.stdout.write(JSON.stringify(buildRoutingTable(registry), null, 2) + '\n');
        process.exit(0); return;
      }
      if (!flags.taskClass) throw new Error('--task-class is required');
      const capacity = flags.capacityFile ? JSON.parse(fs.readFileSync(flags.capacityFile, 'utf8')) : {};
      const needs = readNeedsFile(flags.needsFile);
      const record = resolve({ ...needs, size: flags.size || needs.size, task_class: flags.taskClass, model: flags.model, identity_ref: flags.identity, effort: flags.effort, capacity, _registryPath: flags.registry });
      process.stdout.write(JSON.stringify(record, null, 2) + '\n');
      process.exit(record.floor_breached ? 1 : 0); return;
    } catch (err) {
      process.stderr.write(`resolve-cli: ${err.message}\n`); process.exit(1); return;
    }
  }

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp(argv.length === 0 ? process.stderr : process.stdout);
    process.exit(argv.length === 0 ? 2 : 0);
    return;
  }

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`resolve-cli: ${err.message}\n`);
    process.exit(2);
    return;
  }

  if (!args.model) {
    process.stderr.write('resolve-cli: --model is required (see --help)\n');
    process.exit(2);
    return;
  }

  let record;
  try {
    record = resolve(args);
  } catch (err) {
    // Registry v3 rejects an identity the selected model has no eligible lane for inside resolve();
    // keep the CLI's documented contract (exit 2, "--identity requires a Codex route") for a
    // non-Codex route instead of surfacing it as a generic resolution failure.
    if (args.identity_ref && /identity\/lane override/.test(err.message) && args.provider !== 'codex') {
      process.stderr.write('resolve-cli: --identity requires a Codex route; the selected route is not Codex\n');
      process.exit(2);
      return;
    }
    process.stderr.write(`resolve-cli: could not resolve routing request — ${err.message}\n`);
    process.exit(1);
    return;
  }

  if (args.identity_ref && record.chosen_plugin_id !== 'codex') {
    process.stderr.write('resolve-cli: --identity requires a Codex route; the selected route is not Codex\n');
    process.exit(2);
    return;
  }

  record = applyNodeSafetyFallback(record);

  const json = args.pretty ? JSON.stringify(record, null, 2) : JSON.stringify(record);
  process.stdout.write(json + '\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, applyNodeSafetyFallback, main };
