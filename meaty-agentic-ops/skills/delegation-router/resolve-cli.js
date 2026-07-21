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

const { resolve } = require('./resolver.js');

const ICA_GPT_SHIM_MARKER = '~/ica-gpt.sh';
const ICA_CLAUDE_FALLBACK = '~/ica-claude.sh';

function printHelp(stream) {
  stream.write(
    [
      'Usage: node resolve-cli.js --model <id> [--provider <id>] [--task-class <class>]',
      '                            [--effort <level>] [--profile <name>] [--resume-active]',
      '                            [--compact] [--registry-path <path>]',
      '',
      'Prints the delegation-router RoutingRecord (JSON) for the given routing request and',
      'exits 0. Exits non-zero with a readable message on stderr when the request cannot be',
      'resolved. Pure read: no network, no model calls, no writes.',
      '',
      'Flags:',
      '  --model <id>          Model class/id to route (e.g. sonnet, gpt-5.5-gus). Required.',
      '  --provider <id>       Requested provider (claude|ica|bob|gemini|codex). Default: claude.',
      '  --task-class <class>  Task class driving MUST-stay + chain lookup (e.g. second_opinion).',
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
      case '--provider':
        args.provider = argv[++i];
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

function main() {
  const argv = process.argv.slice(2);

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
    process.stderr.write(`resolve-cli: could not resolve routing request — ${err.message}\n`);
    process.exit(1);
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
