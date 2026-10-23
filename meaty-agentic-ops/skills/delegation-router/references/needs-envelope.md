# Abstract needs and capability envelope (node sizing v1)

Target nodes: N7 `node_01M5N38319CGZVF3BKW0SRVHHN`, N10 `node_01M5N3846PHKZ4JA6V8VDSV1EP`.

Use the registry-v3 resolver with a task class and abstract needs:

```javascript
resolve({
  task_class: 'implementation', size: 'm', requires_write: true,
  capabilities: ['long_context_500k'], modifiers: [],
  sizing: { human_minutes_est: 80, shaping: 'direct' },
});
```

The same inputs can come from a node's `effort_size` and `execution_contract`
(`sizing`, `capabilities`, `modifiers`, `model`, approval metadata). Pass that node as
`node_contract`, or pass `execution_contract` and `size` directly. The v3 CLI accepts
`resolve --task-class implementation --size m --needs-file needs.json --json`;
`--needs-file` contains only needs/approval fields, never registry paths or routing flags.
Legacy TOML/v1 paths refuse abstract needs rather than silently ignoring them.

`capability_providers` maps each capability to a task-class holder, a set of lanes, a
harness feature or a context minimum. `image_generation` currently binds native Codex
Primary; `svg_generation` uses its class holder. Browser, simulator, SSH and network
require an explicitly declared harness feature. They are unavailable until the relevant
lane declares that feature; this table alone never grants browser/network/SSH access.

`taste_high` chooses `design_judgment`. `cross_family_review` returns a complete reviewer
RoutingRecord from another model family, with the original class's lane minimum retained;
it refuses if none is eligible. `cost_tail_ok` is recorded intent and grants no broader
size, lane or retry permission. Class changes preserve original minimums and required
harness capabilities. Provider tool restrictions and explicit write needs also filter lanes.
`requires_write: true` emits a workspace-write Codex invocation at the selected reasoning
effort; an explicitly read-only profile conflicts and is refused.

For sized requests, `envelope.cells` is keyed by model, lane/account and reasoning effort.
Each cell carries `p80_horizon_minutes`, `source: prior|measured`, `n`, `date`, coarse
admitted `sizes`, optional class-specific sizes, and separately dated health evidence.
The priors and coarse admissions follow design §5.2. When a human-minute estimate is
supplied, it must additionally fit `p80_horizon_minutes / messiness_divisor` (currently 2).
Coarse admissions are not AC-verified horizon measurements. An estimate requires size.
Health expires after the configured interval; missing, stale or unavailable cells cannot
appear in either the chosen lane or its fallback chain. Unprobed subscription Claude and
Secondary cells explicitly remain unknown. Refresh those signals before admitting them.

The explicit `escalation_ladders` try cheap holders first and then frontier holders,
retaining quality bars and class minimums. `m` implementation selects Sol rather than Luna.
The record carries `escalation_ladder` and `escalation_policy` (two attempts total,
at most three automatic continuations within an attempt, then blocked). The executor
must apply that policy, retain both attempts' evidence and obey authorization refusals;
the pure router never executes or automatically retries anything. l/xl return
`needs_decomposition`; only a separate explicit one-shot decision can handle them.
No router path creates a one-shot. AUTONOMY-RELEASE §2b and hop's default xs/s grant are unchanged.

Every exact v3 pin, including the existing top-level `model` argument, now requires
`pin_reason`, a future `pin_expires`, and `preapproval_ref` or an approval gate ref from
`execution_contract.autonomy.gates_to_achieve`. The reference is a prerequisite, not proof
of a HumanRequest decision: the N8 consumer owns approval scope/hash validation before
execution. A pin still obeys quality, eligibility, capability and envelope checks.
A retired/superseded pin resolves by class and emits a structured finding in
`needs_decision.findings`; the dispatch owner must persist that finding in IntentTree.
Approval provenance is carried in `needs_decision.pin`.

Verify with `node test-needs-envelope.js` and the existing `tests/` suites. Build with
`python3 scripts/build-model-registry.py --in model-registry.yaml` from this skill's
upstream directory; the explicit `--in` is essential because the builder otherwise defaults
to the deployed global registry. `scripts/check-registry-fresh.py` verifies both generated
artifacts. After merge, deploy the upstream router (including `needs-routing.js`) and
registry via SkillMeat. Do not hand-copy over divergent deployed copies.
