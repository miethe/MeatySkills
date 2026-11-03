'use strict';

// Abstract node needs are selection constraints, never grants of lane eligibility.
const SIZES = ['xs', 's', 'm', 'l', 'xl'];
const MODIFIERS = ['taste_high', 'cross_family_review', 'cost_tail_ok'];

function stringList(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v)) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  return [...new Set(value)];
}

function prepareNeeds(registry, input, canonicalize) {
  const contract = input.execution_contract || (input.node_contract || {}).execution_contract || {};
  const size = input.size ?? input.effort_size ?? (input.node_contract || {}).effort_size;
  if (size != null && !SIZES.includes(size)) throw new Error(`Unknown size '${size}'`);
  const capabilities = stringList(input.capabilities ?? contract.capabilities, 'capabilities');
  const modifiers = stringList(input.modifiers ?? contract.modifiers, 'modifiers');
  for (const modifier of modifiers) {
    if (!MODIFIERS.includes(modifier)) throw new Error(`Unknown modifier '${modifier}'`);
  }
  // A router never creates one-shot authority. l/xl stay on the decomposition path.
  if (size === 'l' || size === 'xl') throw new Error('needs_decomposition: l/xl requires an explicit one-shot decision outside the router');
  const now = input.now ? Date.parse(input.now) : Date.now();
  if (!Number.isFinite(now)) throw new Error('Invalid routing timestamp');
  const defaults = registry.task_class_defaults || {};
  const originalClass = canonicalize(defaults, input.task_class || contract.task_class);
  if (!defaults[originalClass]) throw new Error(`Unknown task class '${originalClass}'`);
  let taskClass = modifiers.includes('taste_high') ? 'design_judgment' : originalClass;
  const bindings = [];
  for (const capability of capabilities) {
    const binding = (registry.capability_providers || {})[capability];
    if (!binding) throw new Error(`Unknown capability '${capability}'`);
    if (binding.task_class) {
      if (taskClass !== originalClass && taskClass !== binding.task_class) {
        throw new Error('Conflicting capability/modifier task classes');
      }
      taskClass = binding.task_class;
    }
    bindings.push({ capability, ...binding });
  }
  if (!defaults[taskClass]) throw new Error(`Unknown capability task class '${taskClass}'`);
  let spec = { ...defaults[taskClass] };
  const originalSpec = defaults[originalClass];
  // Retain BOTH minimum predicates when taste or a capability chooses another holder.
  spec._originalSpec = originalSpec;
  spec.requires_capabilities = [...new Set([...(originalSpec.requires_capabilities || []), ...(spec.requires_capabilities || [])])];
  const sizing = input.sizing || contract.sizing || {};
  const estimate = input.human_minutes_est ?? sizing.human_minutes_est;
  if (estimate != null && (!Number.isFinite(estimate) || estimate <= 0)) throw new Error('human_minutes_est must be positive');
  if (estimate != null && !size) throw new Error('size is required with human_minutes_est');
  if (size && sizing.shaping && sizing.shaping !== 'direct') throw new Error('Node needs shaping before envelope routing');
  const envelope = registry.envelope;
  if (size && (!envelope || !Array.isArray(envelope.cells))) throw new Error('Missing envelope table');
  if (size) {
    const ladder = (envelope.escalation_ladders || {})[taskClass];
    if (ladder) {
      spec.holders = [...ladder];
      spec.fallback = { ...spec.fallback, floor_model: ladder[ladder.length - 1] };
    }
  }
  let model = contract.model ?? input.model;
  const findings = [];
  let pin = null;
  if (model) {
    const ref = input.preapproval_ref ?? contract.preapproval_ref;
    const gates = ((contract.autonomy || {}).gates_to_achieve || []);
    const approvalRef = ref || (gates.find(g => g.kind === 'approval' && typeof g.ref === 'string') || {}).ref;
    const reason = input.pin_reason ?? contract.pin_reason;
    const expires = Date.parse(input.pin_expires ?? contract.pin_expires);
    if (typeof approvalRef !== 'string' || !approvalRef.trim() || typeof reason !== 'string' || !reason.trim() || !Number.isFinite(expires) || expires <= now) {
      throw new Error('Unapproved model pin: requires preapproval ref, pin_reason and future pin_expires');
    }
    pin = { model, preapproval_ref: approvalRef, pin_reason: reason, pin_expires: input.pin_expires ?? contract.pin_expires };
    const entry = (registry.models || {})[model];
    if (!entry) throw new Error(`Unknown model pin '${model}'`);
    if (entry.superseded_by || ['legacy', 'retired', 'deprecated'].includes(entry.status)) {
      findings.push({ kind: 'retired_model_pin', model, preapproval_ref: approvalRef, action: 'resolve_task_class' });
      model = undefined;
    }
  }
  const effort = input.effort || contract.effort || (size ? 'medium' : spec.effort) || 'standard';
  spec._needs = { size, capabilities, modifiers, bindings, estimate, now, envelope, input: { ...input, effort }, taskClass, originalClass };
  return { input: { ...input, task_class: taskClass, model, effort }, spec, findings, pin };
}

function candidateNeeds(registry, modelId, row, lane, spec) {
  const needs = spec._needs;
  if (!needs) return { eligible: true, reason: 'no abstract needs' };
  const { input, size, bindings, envelope, estimate, now, taskClass } = needs;
  const failures = [];
  if (row.health && (row.health.status === 'unavailable' || row.health.quota_limit === 0)) failures.push('provider health unavailable');
  if (input.requires_write && input.profile && input.profile.includes('sandbox=read-only')) failures.push('explicit read-only sandbox conflicts with requires_write');
  if (input.requires_write && !(lane.harness_capabilities || []).includes('execution.file_edit')) failures.push('write capability absent');
  if ((input.requires_write || (spec.requires_capabilities || []).includes('execution.file_edit')) && row.tool_mode === 'none') failures.push('provider forbids tools');
  for (const binding of bindings) {
    if (binding.lanes && !binding.lanes.includes(row.lane)) failures.push(`${binding.capability}: lane not a provider`);
    if (binding.harness_capability && !(lane.harness_capabilities || []).includes(binding.harness_capability)) failures.push(`${binding.capability}: harness absent`);
    if (binding.min_context && ((row.max_context || (registry.models[modelId] || {}).max_context || 0) < binding.min_context)) failures.push(`${binding.capability}: context too small`);
  }
  if (size) {
    const cell = (envelope.cells || []).find(c => c.model === modelId && c.lane === row.lane && c.effort === input.effort);
    if (!cell) failures.push('envelope cell absent for model/lane/effort');
    else {
      const admitted = (cell.class_sizes || {})[taskClass] || cell.sizes || [];
      if (!admitted.includes(size)) failures.push(`envelope excludes size ${size}`);
      if (estimate != null && estimate > cell.p80_horizon_minutes / envelope.messiness_divisor) failures.push('estimate exceeds discounted p80 horizon');
      const checkedAt = Date.parse(cell.health_checked_at);
      const maxAge = envelope.health_max_age_hours * 3600000;
      if (cell.health_status !== 'available' || !Number.isFinite(checkedAt) || !Number.isFinite(maxAge) || now < checkedAt || now - checkedAt > maxAge) failures.push('envelope health stale or unavailable');
      if (!Number.isFinite(cell.p80_horizon_minutes) || cell.p80_horizon_minutes <= 0 || !(envelope.messiness_divisor > 0)) failures.push('invalid envelope horizon');
    }
  }
  return { eligible: failures.length === 0, reason: failures.join('; ') || 'needs and envelope satisfied' };
}

function hasAbstractNeeds(input) {
  const contract = input.execution_contract || (input.node_contract || {}).execution_contract || {};
  return input.size != null || input.effort_size != null || (input.node_contract || {}).effort_size != null ||
    input.capabilities != null || input.modifiers != null || contract.capabilities != null ||
    contract.modifiers != null || contract.model != null || contract.sizing != null;
}
module.exports = { prepareNeeds, candidateNeeds, hasAbstractNeeds };
