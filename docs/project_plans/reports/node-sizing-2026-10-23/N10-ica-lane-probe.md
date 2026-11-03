# N10 ICA serving and delivery evidence — 2026-10-23

Target-Node: node_01M5N3846PHKZ4JA6V8VDSV1EP

The six ICA Sol runs in A2 were **successful model executions followed by write-delivery guard failures**. All six dispatch receipts name `provider_terminal: success` and `realized_model: gpt-6.1-sol`. Two have `reason: uncommitted_work`; four have `reason: no_diff`; all have wrapper `rc: 3`. Their result rows have `subtype: success`, `is_error: false`. This explains the 0/6 clean-wrapper-exit statistic without treating it as a serving failure or an AC success rate. The six span 2026-10-21T23:25Z through 2026-10-22T04:18Z (the original label “2026-10-21” describes their dispatch campaign).

[N10-historical-exits.json](N10-historical-exits.json) carries a minimal projection, source paths, result line numbers and source SHA-256s. No transcript bodies or credentials are copied. The actual wrapper branches are `infra/dispatch/leg` in agentic_meta_dev: `write_leg_has_diff` sets `uncommitted_work`, and a write-class run without repository delivery sets `no_diff`; both set RC=3. Each original `*-ica.stderr.log` retains the matching `LEG-UNCOMMITTED-WORK` or `LEG-NO-DIFF` line. This task does not change those delivery gates.

The existing `scripts/probe-ica-models.sh` helper was run against the current key's ccx endpoint, with unique prompts, using repeated `--model` flags. [N10-ica-nonce-probe.json](N10-ica-nonce-probe.json) records exact nonce echoes and finish=stop for bare `claude-haiku-5-5`, `claude-sonnet-5-5`, `gpt-6-luna`, and `gpt-6.1-sol`. The helper process exits zero. It now rejects a stale/wrong echo or incomplete completion, bounds network waits, and skips retries on authorization refusals. Scoped probes do not infer catalog drift from models they did not probe.

[N10-ica-wire-probe.json](N10-ica-wire-probe.json) preserves the initial minimal calls: the four IDs above returned completed text; `gpt-6.1-sol-dzus` was denied (negative control), and `claude-opus-5-5` returned `E003: Model not available for Coding Agents. Please use Advantage Assist models`. No alternate Opus lane was tried. This is evidence about this key and chat/completions only; the messages/Claude-Code transport was not re-probed. Opus's provider health is therefore degraded, with its older wrapper receipt explicitly marked stale. It is not a claim that Opus weights are unavailable everywhere.

The Haiku and Sonnet descriptors now agree with their existing ICA provider rows and live served state. Allowance declarations remain Nick's existing decisions; these calls do not measure pricing. Sol's existing tool restriction remains: a minimal text call does not establish tool-loop support. Historical successful tool loops likewise do not waive that separate declared constraint.

Validation: `python3 meaty-agentic-ops/skills/delegation-router/tests/test-ica-probe.py` (healthy echo, stale-cache negative, authorization-denial negative, scoped drift and credential redaction). Registry build validates the upstream YAML and refreshes its generated JSON.

After merge: deploy the changed upstream delegation-router artifact and registry through SkillMeat to global/project consumers; do not copy over divergent deployed versions. No deploy was performed here.
