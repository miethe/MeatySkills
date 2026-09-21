/**
 * RoutingRecord — canonical JSON schema for the delegation-router resolver output.
 *
 * Design spec reference: delegation-router-multimodel.md §3 (Shape C, Hybrid/Resolver-Record).
 * Every field documented here MUST be present in every RoutingRecord emitted by resolver.js.
 *
 * Integration seam P2-INT-001: agent_type_id values MUST match agentType definition filenames:
 *   ica          → ica-executor
 *   bob          → bob-delegate-executor
 *   gemini       → gemini-executor
 *   codex        → codex-executor
 *   claude       → 'claude' (native, no agentType wrapper file)
 */

'use strict';

/**
 * @typedef {Object} FallbackEntry
 * @property {string} plugin_id  - Provider id from provider-plugins.toml (e.g. 'ica', 'claude')
 * @property {string} model      - Model name within that provider (e.g. 'sonnet', 'haiku')
 */

/**
 * @typedef {Object} RoutingRecord
 * @property {string}          chosen_plugin_id   - The selected provider id ('claude'|'ica'|'bob'|'gemini'|'codex')
 * @property {string}          model              - The model to use (e.g. 'haiku', 'sonnet', 'opus', 'gpt-5.6-terra')
 * @property {string}          effort             - Effort level ('none'|'low'|'standard'|'high'|'extended'|'xhigh'|'adaptive')
 * @property {string}          agent_type_id      - agentType filename to instantiate (see P2-INT-001 seam)
 * @property {string}          invocation_template - Shell invocation template string (provider-specific; from provider-plugins.toml)
 * @property {string[]}        scope_flags        - Additional CLI scope flags to apply (e.g. ['--sandbox read-only'])
 * @property {string}          stage              - Two-stage structuring indicator: 'A' (primary) | 'B' (schema-validator) | 'none'
 * @property {string}          validation_contract - Structuring contract: 'none' | '{schema}' | custom JSON schema string
 * @property {string}          continuity_mode    - Provider continuity capability: 'stateless' | 'resumable'
 * @property {FallbackEntry[]} fallback_chain     - Ordered fallback candidates; walker stops at first available
 * @property {string}          reason             - Human-readable explanation of routing decision (ranking rationale)
 * @property {string|null}     context_ref        - Absolute path to the assembled delegation context bundle, or
 *                                                    null. 12th field (additive, optional; default null). FORCED to
 *                                                    null for MUST-STAY classes and for bob by finalizeRoutingRecord
 *                                                    (FR-10, flat-legs-only invariant). See delegation-context.md v2.
 * @property {string|null}     context_class      - Declared context class of the milestone this leg serves:
 *                                                    'C1'|'C2'|'C3'|'C4', or null when the plan declares none.
 *                                                    13th field (additive, optional; default null). PASSTHROUGH ONLY —
 *                                                    it is carried onto the record so realized burn can be joined
 *                                                    against declared class in the weekly review; it is NEVER a
 *                                                    resolver input and never influences ranking. Distinct from
 *                                                    context_ref, which is a bundle PATH. See the Claude-5 plan
 *                                                    doctrine (agentic_meta_dev planning/references/plan-doctrine.md).
 * @property {Object|null}     routing_feedback   - Provenance for an EMPIRICAL adjustment that was
 *                                                    actually applied to this decision, or null.
 *                                                    14th field (additive, optional; default null).
 *                                                    Carries the action (`rank_displacement`) AND the
 *                                                    reason (`combined_signal` + the §2.2 evidence
 *                                                    block) so an audit can answer "what changed and
 *                                                    on what basis" from the record alone. FORCED to
 *                                                    null for MUST-STAY classes — a protected class
 *                                                    has no adjustable surface, so a non-null value
 *                                                    there would be a governance breach, not a note.
 *                                                    Replaces the RETIRED `score_delta` field (see
 *                                                    routing-feedback-router-merge-handoff.md §2.4.7);
 *                                                    `score_delta` must never reappear — there is no
 *                                                    score in the resolver for a delta to apply to.
 * @property {string|null}     lane               - The LANE id (endpoint + auth unit) this decision
 *                                                    landed on, e.g. 'claude_subscription' /
 *                                                    'ica_gateway_messages'. 15th field (additive,
 *                                                    optional; default null). Recorded because
 *                                                    `chosen_plugin_id` ALONE CANNOT IDENTIFY A LANE:
 *                                                    codex/gpt-5.6-terra (subscription) and
 *                                                    ica/gpt-5.6-terra-dzus (shared gateway) are the
 *                                                    same weights on different sovereignty, and an
 *                                                    auditor forced to re-derive the lane from the
 *                                                    model id would re-create the suffix-as-lane-marker
 *                                                    defect one layer down.
 * @property {string|null}     sovereignty        - The rung the chosen lane actually carries:
 *                                                    'local'|'subscription'|'shared_gateway', the
 *                                                    'unknown' sentinel, or null when the registry
 *                                                    declares no ladder at all. 16th field (additive,
 *                                                    optional; default null).
 * @property {Object|null}     sovereignty_floor  - The minimum this task class REQUIRED and why:
 *                                                    {min_rung, reason} where reason ∈
 *                                                    SOVEREIGNTY_MINIMUM_REASONS. 17th field
 *                                                    (additive, optional; default null). Non-null only
 *                                                    when the ladder was live for this resolution.
 *                                                    When BOTH this and `sovereignty` are present,
 *                                                    validateRoutingRecord ASSERTS the ladder held —
 *                                                    which is why the pair is on the record rather
 *                                                    than only in the reason string.
 */

/**
 * MUST-STAY-PRIMARY task classes (design_spec §7).
 * Any task_class in this set is unconditionally routed to provider='claude'.
 * The resolver rejects any non-claude provider assignment for these classes.
 *
 * @readonly
 * @type {string[]}
 */
/**
 * Declared context classes (Claude-5 plan doctrine §3). Sizes the AGENT CONTEXT a milestone
 * needs, which is what predicts burn — as opposed to points, which size human-scale behavior.
 * Carried through as an audit passthrough so realized burn can be joined against declared class;
 * NEVER read by the resolver's ranking.
 *
 * @readonly
 * @type {string[]}
 */
const CONTEXT_CLASSES = ['C1', 'C2', 'C3', 'C4'];

/**
 * Maximum rank displacement an empirical adjustment may apply (§2.4.6 of
 * routing-feedback-router-merge-handoff.md). Declared HERE, on the record schema, rather than only
 * in routing-feedback.js: the bound is a property of what a valid record may claim, so a record
 * asserting a larger move is rejected at validation regardless of which producer built it.
 *
 * @readonly
 * @type {number}
 */
const MAX_RANK_DISPLACEMENT = 1;

/**
 * THE SOVEREIGNTY LADDER — three rungs, ascending.
 *
 * A LANE (endpoint + auth) carries a sovereignty class. A task class declares a MINIMUM RUNG,
 * never a named vendor or model. `verdict requires >= subscription` REPLACES `verdict pins to
 * subscription Claude`, so a Codex subscription satisfies it with no rule naming a vendor.
 *
 *   local          (2, highest)  runs on our own hardware; nothing leaves the LAN
 *   subscription   (1)           an account we control and pay for directly (Claude sub, Codex sub)
 *   shared_gateway (0, lowest)   third-party-mediated shared pool (ICA)
 *
 * ⚠️ INVARIANT — THE CLASS BELONGS TO THE LANE, NEVER TO A VENDOR OR A MODEL ID.
 * Codex reached THROUGH the shared ICA gateway is NOT a Codex subscription. The same model id
 * can arrive over a subscription lane or a shared lane and the sovereignty differs. This estate
 * has already been bitten by treating a model-id SUFFIX (`[1m]`) as a lane marker — endpoint +
 * auth define the lane; the id does not, and no consumer of this constant may derive a rung by
 * pattern-matching a model id.
 *
 * Declared HERE, on the record schema, for the same reason MAX_RANK_DISPLACEMENT is: the ladder
 * is a property of what a valid record may CLAIM, so a record asserting it ran below its own
 * declared floor is rejected at validation regardless of which producer built it.
 *
 * @readonly
 * @type {Record<string, number>}
 */
const SOVEREIGNTY_RUNGS = {
  shared_gateway: 0,
  subscription: 1,
  local: 2,
};

/**
 * The rung labels, ascending. The ARRAY INDEX is not the rung — read SOVEREIGNTY_RUNGS for that.
 * @readonly
 * @type {string[]}
 */
const SOVEREIGNTY_CLASSES = Object.keys(SOVEREIGNTY_RUNGS)
  .sort((a, b) => SOVEREIGNTY_RUNGS[a] - SOVEREIGNTY_RUNGS[b]);

/**
 * Sentinel for a lane that could not be classified — an instance with no `lane`, or a `lane`
 * absent from the registry's `lanes:` table.
 *
 * FAIL-CLOSED: `unknown` sits BELOW every real rung (-1) and therefore satisfies NO minimum.
 * "I could not determine the lane" must never read as "the lane is fine" — same posture as
 * `aos-git`'s UNMEASURED and artifact-provisioning's absence rule. Never default to
 * `subscription`.
 *
 * @readonly
 */
const SOVEREIGNTY_UNKNOWN = 'unknown';
const SOVEREIGNTY_UNKNOWN_RUNG = -1;

/**
 * The REASON vocabulary for a declared minimum. REQUIRED on every declaration — a minimum with
 * no reason is exactly what a future cost-tuning pass relaxes silently.
 *
 *   cost_policy      negotiable; a tuning pass may revisit it
 *   quality_bar      negotiable on evidence
 *   egress_absolute  NOT negotiable by ANY automated, empirical, or feedback path
 *
 * WHY THE FIELD EXISTS AT ALL. "Stay off the shared gateway for the verdict" is a cost/quality
 * judgement. "Stay local for the private journal / the personal-chat corpus" is an EGRESS rule
 * with no sign-off path at all. If both were merely "a minimum rung" they would be
 * indistinguishable to a tuning pass, and the privacy boundary is the one that would move. The
 * reason field is what keeps them separable.
 *
 * @readonly
 * @type {string[]}
 */
const SOVEREIGNTY_MINIMUM_REASONS = ['cost_policy', 'quality_bar', 'egress_absolute'];

/**
 * Resolve a sovereignty label to its numeric rung. Anything unrecognized (including null,
 * undefined and the `unknown` sentinel) resolves to SOVEREIGNTY_UNKNOWN_RUNG, which clears no
 * floor. Single point of truth so no caller hand-rolls the comparison.
 *
 * @param {string|null|undefined} sovereignty
 * @returns {number}
 */
function sovereigntyRung(sovereignty) {
  const r = SOVEREIGNTY_RUNGS[sovereignty];
  return typeof r === 'number' ? r : SOVEREIGNTY_UNKNOWN_RUNG;
}

const MUST_STAY_PRIMARY_CLASSES = [
  'orchestration',
  'verdict',
  'mode-d',
  'council-review',
  'schema-recovery',
  'cross-wave-merge',
  'synthesis',
];

/**
 * Canonical agent_type_id mapping (P2-INT-001 seam).
 * Maps provider_id → agentType definition filename (without .md extension).
 * 'claude' is native (no agentType wrapper); value is 'claude' as a sentinel.
 *
 * @readonly
 * @type {Record<string, string>}
 */
const AGENT_TYPE_ID_MAP = {
  claude: 'claude',
  ica: 'ica-executor',
  bob: 'bob-delegate-executor',
  gemini: 'gemini-executor',
  codex: 'codex-executor',
};

/**
 * Agent types that CANNOT author a file, and therefore must never receive a leg whose
 * deliverable is a file. Lives next to AGENT_TYPE_ID_MAP on purpose: the constraint is a
 * property of the agent type that map yields, not of the provider, and keeping the two
 * apart is how they drift.
 *
 * Membership test is the agent definition's `disallowedTools` covering Write/Edit/MultiEdit.
 * ⚠️ That frontmatter is NOT an enforcement mechanism — Bash stays enabled for every executor
 * (shelling out is their contract) and a leg wrote two files through Bash redirection under it
 * on 2026-08-11 (`node_01KZS943C1NBSNFCY4DH1EMSVD`); skillmeat's own tool_canonicalization
 * classifies `disallowedTools` as `descriptive_only` for claude_code. So read this set as
 * "will not reliably produce a file", which is the only claim the router needs: routing an
 * authoring leg here is a structurally guaranteed no-op, measured at ~610k subagent tokens for
 * zero files on 2026-08-16 (`node_01M06NSPRWSS987V5DMZXHRVJ5`).
 *
 * `ica-executor` was in this set until 2026-08-17 and was REMOVED when Nick granted it write
 * authority; its write scope now travels on the invocation's `--allowedTools`, which the inner
 * Claude Code instance actually checks. `codex-executor` and `bob-delegate-executor` never
 * carried `disallowedTools`. So the set is deliberately down to one member — do not read a
 * one-element set as a placeholder.
 *
 * @readonly
 * @type {string[]}
 */
const WRITE_INCAPABLE_AGENT_TYPES = ['gemini-executor'];

/**
 * Providers whose mapped agent type is write-incapable. DERIVED from the two constants above
 * rather than restated, so adding a provider or flipping an agent type's write capability
 * cannot leave a second hand-maintained list behind.
 *
 * @readonly
 * @type {string[]}
 */
const WRITE_INCAPABLE_PROVIDERS = Object.keys(AGENT_TYPE_ID_MAP)
  .filter(pid => WRITE_INCAPABLE_AGENT_TYPES.includes(AGENT_TYPE_ID_MAP[pid]));

/**
 * Providers that NEVER receive a context bundle (FR-10). `bob` has no delegate-executor skill,
 * so its context channel is deferred (DEF-1) — context_ref stays null until the transport exists.
 *
 * @readonly
 * @type {string[]}
 */
const CONTEXT_REF_NULL_PROVIDERS = ['bob'];

/**
 * Validates that a RoutingRecord has all required fields with correct types.
 * Throws a descriptive error if validation fails.
 *
 * @param {RoutingRecord} record
 * @returns {RoutingRecord} The same record (pass-through for chaining)
 * @throws {Error} If any required field is missing or mistyped
 */
function validateRoutingRecord(record) {
  const required = [
    'chosen_plugin_id',
    'model',
    'effort',
    'agent_type_id',
    'invocation_template',
    'scope_flags',
    'stage',
    'validation_contract',
    'continuity_mode',
    'fallback_chain',
    'reason',
  ];

  for (const field of required) {
    if (record[field] === undefined || record[field] === null) {
      throw new Error(`RoutingRecord missing required field: '${field}'`);
    }
  }

  if (!Array.isArray(record.scope_flags)) {
    throw new Error(`RoutingRecord.scope_flags must be an array; got ${typeof record.scope_flags}`);
  }

  if (!Array.isArray(record.fallback_chain)) {
    throw new Error(`RoutingRecord.fallback_chain must be an array; got ${typeof record.fallback_chain}`);
  }

  for (const entry of record.fallback_chain) {
    if (typeof entry.plugin_id !== 'string' || typeof entry.model !== 'string') {
      throw new Error(
        `RoutingRecord.fallback_chain entry must have {plugin_id: string, model: string}; got ${JSON.stringify(entry)}`
      );
    }
  }

  if (!['A', 'B', 'none'].includes(record.stage)) {
    throw new Error(`RoutingRecord.stage must be 'A', 'B', or 'none'; got '${record.stage}'`);
  }

  if (!['stateless', 'resumable'].includes(record.continuity_mode)) {
    throw new Error(
      `RoutingRecord.continuity_mode must be 'stateless' or 'resumable'; got '${record.continuity_mode}'`
    );
  }

  // context_ref is the 12th field: additive + optional. Absent is tolerated (backward-compatible
  // with 11-field records); when present it MUST be a string path or null.
  if (record.context_ref !== undefined && record.context_ref !== null &&
      typeof record.context_ref !== 'string') {
    throw new Error(
      `RoutingRecord.context_ref must be a string path or null; got ${typeof record.context_ref}`
    );
  }

  // context_class is the 13th field: additive + optional, same backward-compatibility posture as
  // context_ref. Absent is tolerated; when present it MUST be one of the four declared classes or
  // null. Passthrough only — never read on the resolve path.
  if (record.context_class !== undefined && record.context_class !== null &&
      !CONTEXT_CLASSES.includes(record.context_class)) {
    throw new Error(
      `RoutingRecord.context_class must be one of ${CONTEXT_CLASSES.join('|')} or null; ` +
      `got ${JSON.stringify(record.context_class)}`
    );
  }

  // routing_feedback is the 14th field: additive + optional, same backward-compatibility posture
  // as context_ref/context_class. Absent is tolerated; when present it MUST be null or an object
  // carrying BOTH halves of the provenance contract — the action and the reason. A provenance
  // block that records a displacement without its combined_signal is unauditable, so the shape is
  // enforced here rather than trusted.
  if (record.routing_feedback !== undefined && record.routing_feedback !== null) {
    const fb = record.routing_feedback;
    if (typeof fb !== 'object' || Array.isArray(fb)) {
      throw new Error(
        `RoutingRecord.routing_feedback must be an object or null; got ${typeof fb}`
      );
    }
    if (!Array.isArray(fb.rank_displacement) || fb.rank_displacement.length === 0) {
      throw new Error(
        'RoutingRecord.routing_feedback.rank_displacement must be a non-empty array ' +
        '(a provenance block with no applied action must be null instead)'
      );
    }
    for (const d of fb.rank_displacement) {
      if (!d || typeof d.entry !== 'string' || typeof d.from !== 'number' || typeof d.to !== 'number') {
        throw new Error(
          `RoutingRecord.routing_feedback.rank_displacement entry must have ` +
          `{entry: string, from: number, to: number}; got ${JSON.stringify(d)}`
        );
      }
      if (d.to <= d.from) {
        throw new Error(
          `RoutingRecord.routing_feedback is demotion-only: to (${d.to}) must be later than ` +
          `from (${d.from}) for entry '${d.entry}'`
        );
      }
      if ((d.to - d.from) > MAX_RANK_DISPLACEMENT) {
        throw new Error(
          `RoutingRecord.routing_feedback rank displacement ${d.to - d.from} exceeds the ` +
          `bounded maximum of ${MAX_RANK_DISPLACEMENT} position for entry '${d.entry}'`
        );
      }
      // The reason half of the contract. It must be PRESENT (number, or an explicit null when the
      // producer had no signal) — omitting it yields a displacement nobody can audit, which is the
      // exact failure §2.4.5.4 exists to prevent, so `undefined` is rejected rather than defaulted.
      if (!('combined_signal' in d) ||
          (d.combined_signal !== null && typeof d.combined_signal !== 'number')) {
        throw new Error(
          `RoutingRecord.routing_feedback.rank_displacement.combined_signal must be present and ` +
          `a number or null (an unauditable displacement is not a valid record); ` +
          `got ${JSON.stringify(d.combined_signal)} for entry '${d.entry}'`
        );
      }
    }
  }

  // ---- Sovereignty ladder: fields 15–17, additive + optional, same backward-compatibility
  // posture as context_ref/context_class/routing_feedback. Absent is tolerated (records emitted
  // before the ladder, and records from a registry that declares no `lanes:` table).

  if (record.lane !== undefined && record.lane !== null && typeof record.lane !== 'string') {
    throw new Error(`RoutingRecord.lane must be a lane id string or null; got ${typeof record.lane}`);
  }

  if (record.sovereignty !== undefined && record.sovereignty !== null &&
      !SOVEREIGNTY_CLASSES.includes(record.sovereignty) &&
      record.sovereignty !== SOVEREIGNTY_UNKNOWN) {
    throw new Error(
      `RoutingRecord.sovereignty must be one of ${SOVEREIGNTY_CLASSES.join('|')}|` +
      `${SOVEREIGNTY_UNKNOWN} or null; got ${JSON.stringify(record.sovereignty)}`
    );
  }

  if (record.sovereignty_floor !== undefined && record.sovereignty_floor !== null) {
    const floor = record.sovereignty_floor;
    if (typeof floor !== 'object' || Array.isArray(floor)) {
      throw new Error(
        `RoutingRecord.sovereignty_floor must be an object or null; got ${typeof floor}`
      );
    }
    if (!SOVEREIGNTY_CLASSES.includes(floor.min_rung)) {
      throw new Error(
        `RoutingRecord.sovereignty_floor.min_rung must be one of ` +
        `${SOVEREIGNTY_CLASSES.join('|')}; got ${JSON.stringify(floor.min_rung)}`
      );
    }
    // The REASON half is mandatory, for the same argument routing_feedback.combined_signal is:
    // a minimum with no reason cannot be told apart from a cost knob by whoever tunes cost next,
    // and the one it would move is the egress boundary. `undefined` is rejected, never defaulted.
    if (!SOVEREIGNTY_MINIMUM_REASONS.includes(floor.reason)) {
      throw new Error(
        `RoutingRecord.sovereignty_floor.reason must be present and one of ` +
        `${SOVEREIGNTY_MINIMUM_REASONS.join('|')} (a minimum with no stated reason is not a ` +
        `valid record — see SOVEREIGNTY_MINIMUM_REASONS); got ${JSON.stringify(floor.reason)}`
      );
    }

    // THE LADDER ASSERTION. This is the emit-time backstop, and it lives in
    // validateRoutingRecord rather than finalizeRoutingRecord DELIBERATELY: finalizeRoutingRecord
    // documents itself as the emitter's enforcement point but resolver.js has never called it
    // (validateRoutingRecord is what every emitted record actually passes through). Putting the
    // assertion on the path that is genuinely taken is the difference between an enforced
    // invariant and a documented one.
    if (record.sovereignty !== undefined && record.sovereignty !== null) {
      const actual = sovereigntyRung(record.sovereignty);
      const required = sovereigntyRung(floor.min_rung);
      if (actual < required) {
        throw new Error(
          `RoutingRecord violates its own sovereignty floor: chose a '${record.sovereignty}' ` +
          `lane (${record.lane || 'unclassified'}) for a class requiring >= '${floor.min_rung}' ` +
          `(reason: ${floor.reason})`
        );
      }
    }
  }

  return record;
}

/**
 * Enforce the context_ref policy at emit time (FR-10). MUST-STAY classes and providers in
 * CONTEXT_REF_NULL_PROVIDERS (bob) ALWAYS emit context_ref: null, regardless of what the caller
 * passed — a delegation context bundle is only ever threaded to flat, delegatable legs. This is
 * enforced by the emitter, not merely a default, so a non-null context_ref cannot leak onto a
 * MUST-STAY leg and escape audit (Risk-2, governance).
 *
 * The resolver MUST route every emitted record through this function before returning it.
 *
 * @param {RoutingRecord} record   - The record being emitted (mutated in place and returned)
 * @param {string} [taskClass]     - The task_class driving the routing decision
 * @returns {RoutingRecord} The same record with the context_ref invariant applied + validated
 */
function finalizeRoutingRecord(record, taskClass) {
  if (record.context_ref === undefined) {
    record.context_ref = null;
  }
  // context_class is a pure audit passthrough: default it, but never force or clear it the way
  // context_ref is gated. It carries no context, so it cannot leak anything on a MUST-STAY leg.
  if (record.context_class === undefined) {
    record.context_class = null;
  }
  if (record.routing_feedback === undefined) {
    record.routing_feedback = null;
  }
  // Sovereignty fields default like the audit passthroughs above; they are never FORCED here.
  // A floor is a property of the decision the resolver made, not something the emitter can
  // invent after the fact — clearing or synthesizing one here would make the ladder assertion
  // in validateRoutingRecord un-triggerable, which is the opposite of enforcement.
  if (record.lane === undefined) record.lane = null;
  if (record.sovereignty === undefined) record.sovereignty = null;
  if (record.sovereignty_floor === undefined) record.sovereignty_floor = null;
  const mustStay = taskClass !== undefined && MUST_STAY_PRIMARY_CLASSES.includes(taskClass);
  const nullProvider = CONTEXT_REF_NULL_PROVIDERS.includes(record.chosen_plugin_id);
  if (mustStay || nullProvider) {
    record.context_ref = null;
  }
  // MUST-stay immunity is enforced at the EMITTER, not merely upstream (same posture as
  // context_ref): a protected class has no adjustable routing surface, so any feedback provenance
  // on it is stripped here even if some future caller manages to attach one.
  if (mustStay) {
    record.routing_feedback = null;
  }
  return validateRoutingRecord(record);
}

/**
 * Creates an empty/default RoutingRecord structure.
 * Useful as a base for the resolver to fill in.
 *
 * @returns {RoutingRecord}
 */
function createEmptyRecord() {
  return {
    chosen_plugin_id: 'claude',
    model: 'sonnet',
    effort: 'standard',
    agent_type_id: AGENT_TYPE_ID_MAP['claude'],
    invocation_template: '',
    scope_flags: [],
    stage: 'A',
    validation_contract: 'none',
    continuity_mode: 'resumable',
    fallback_chain: [],
    reason: '',
    context_ref: null,
    context_class: null,
    routing_feedback: null,
    lane: null,
    sovereignty: null,
    sovereignty_floor: null,
  };
}

module.exports = {
  MUST_STAY_PRIMARY_CLASSES,
  WRITE_INCAPABLE_AGENT_TYPES,
  WRITE_INCAPABLE_PROVIDERS,
  CONTEXT_REF_NULL_PROVIDERS,
  CONTEXT_CLASSES,
  MAX_RANK_DISPLACEMENT,
  SOVEREIGNTY_RUNGS,
  SOVEREIGNTY_CLASSES,
  SOVEREIGNTY_UNKNOWN,
  SOVEREIGNTY_UNKNOWN_RUNG,
  SOVEREIGNTY_MINIMUM_REASONS,
  sovereigntyRung,
  AGENT_TYPE_ID_MAP,
  validateRoutingRecord,
  finalizeRoutingRecord,
  createEmptyRecord,
};
