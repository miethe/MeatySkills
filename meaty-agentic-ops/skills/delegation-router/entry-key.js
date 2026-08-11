/**
 * entry-key.js — canonical (provider, model) → "provider/alias" join key (DI-1).
 *
 * THE BUG THIS CLOSES: routing-feedback.js's chain join compared raw, case-sensitive
 * "provider/model" strings. CCDash (the producer) reports `provider: "Claude"` and dated
 * model slugs (e.g. `claude-haiku-4-5-20251001`); the registry's routing_policy chains hold
 * lowercase providers and alias model ids (e.g. `claude/claude-haiku-4-5`). Two independent
 * mismatches — provider case, dated-vs-alias model — made every demotion join fail with
 * `entry_not_in_chain`, silently. This module is the single place that resolves both, and it
 * FAILS CLOSED rather than guessing: an out-of-vocabulary provider or an unresolvable model
 * id is a distinct, reported failure, never a silent non-match and never a coerced guess
 * (`OpenAI` must never become `codex`).
 *
 * NO MODEL CALL, NO NETWORK, NO SHELL. `fs.readFileSync` only, and only for the default
 * registry load — every function here also accepts an injected registry so callers (and
 * tests) can stay fully offline and deterministic.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mirrors resolver.js's tier-3 "global canonical" location, then falls back to this skill's
// own co-located copy (useful in a worktree / before a deploy sync). Deliberately NOT the full
// tiered resolution resolver.js implements (env override, project-local override, js-yaml vs
// generated-JSON) — that machinery belongs to resolver.js, which stays untouched by this
// module. Callers that already have a loaded registry (e.g. a future resolver.js integration)
// should pass it explicitly rather than relying on this default.
function defaultRegistryCandidates() {
  return [
    path.join(os.homedir(), '.claude', 'config', 'model-registry.generated.json'),
    path.join(__dirname, 'model-registry.generated.json'),
  ];
}

let _cachedDefaultRegistry = null;

/**
 * Load the fallback registry used when no registry is injected. Cached per-process; call
 * sites that need a fresh read (e.g. after editing the registry mid-test-run) should pass an
 * explicit registry instead of relying on this cache.
 */
function loadDefaultRegistry() {
  if (_cachedDefaultRegistry) return _cachedDefaultRegistry;
  for (const candidate of defaultRegistryCandidates()) {
    try {
      if (fs.existsSync(candidate)) {
        _cachedDefaultRegistry = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        return _cachedDefaultRegistry;
      }
    } catch (e) {
      // Malformed or unreadable — try the next candidate rather than throwing. A canonicalizer
      // that can crash the resolver is worse than one that fails closed on individual entries.
    }
  }
  _cachedDefaultRegistry = { models: {} };
  return _cachedDefaultRegistry;
}

/**
 * Provider vocabulary: the union of `models[*].providers[*].provider`, lower-cased. Membership
 * is the ONLY thing that legitimizes case-folding a producer-reported provider token — a token
 * outside this set fails closed with `unknown_provider` rather than being silently lowercased
 * into a coincidental non-match (or worse, a coincidental match).
 */
function providerVocabulary(registry) {
  const vocab = new Set();
  const models = (registry && registry.models) || {};
  for (const model of Object.values(models)) {
    for (const p of (model && model.providers) || []) {
      if (p && typeof p.provider === 'string' && p.provider) {
        vocab.add(p.provider.toLowerCase());
      }
    }
  }
  return vocab;
}

/**
 * Build the reverse model index used to resolve a reported model id to its registry alias:
 *   - `byAlias`   — the model IS already an alias (a `models` key).
 *   - `idToAlias` — reverse lookup over every `providers[*].model_id` (covers `[1m]` suffixes
 *                   and vendor-prefixed ids for free) AND every `observed_ids` entry (the
 *                   registry-declared dated→alias mapping, §2 of the DI-1 contract).
 *
 * COLLISION DISCIPLINE (adversarial-review DEFECT 2 fix). Every id is claimed by whichever
 * alias(es) list it — via `model_id` OR `observed_ids`, uniformly. If exactly one alias claims
 * an id, that id resolves. If TWO OR MORE DIFFERENT aliases claim the same id — whether the
 * clash is model_id-vs-model_id, observed_id-vs-observed_id, or one of each — that is a
 * registry-data contradiction and the id is deliberately left OUT of `idToAlias`, so
 * canonicalizeEntry fails closed with `unknown_model` rather than silently picking a winner by
 * declaration order. An observed_id that merely duplicates the SAME alias's own model_id is not
 * a collision (it is exactly one alias claiming its own id twice) and still resolves normally.
 */
function buildModelIndex(registry) {
  const models = (registry && registry.models) || {};
  const byAlias = new Set(Object.keys(models));

  const claims = new Map(); // raw id -> Set<alias> that claim it
  const addClaim = (id, alias) => {
    if (typeof id !== 'string' || !id) return;
    if (!claims.has(id)) claims.set(id, new Set());
    claims.get(id).add(alias);
  };

  // Pass 1: providers[*].model_id — the primary, always-present source.
  for (const [alias, model] of Object.entries(models)) {
    for (const p of (model && model.providers) || []) {
      if (p && typeof p.model_id === 'string') addClaim(p.model_id, alias);
    }
  }
  // Pass 2: observed_ids — the registry-declared telemetry-slug mapping (§2). Collision rules
  // are identical to pass 1; this is not a lower-precedence source, it is a same-precedence
  // ADDITIONAL claimant, and two different aliases claiming one id is ambiguous either way.
  for (const [alias, model] of Object.entries(models)) {
    const observed = Array.isArray(model && model.observed_ids) ? model.observed_ids : [];
    for (const oid of observed) addClaim(oid, alias);
  }

  const idToAlias = new Map();
  for (const [id, aliasSet] of claims) {
    if (aliasSet.size === 1) idToAlias.set(id, [...aliasSet][0]);
    // aliasSet.size > 1 → genuine cross-alias collision → deliberately absent from idToAlias,
    // which fails closed to `unknown_model` at the canonicalizeEntry call site.
  }

  return { byAlias, idToAlias };
}

/**
 * Split a "provider/model" joined entry string into its two halves. Returns null for anything
 * that is not a string or has no '/' separator (or an empty provider segment) — malformed
 * input fails closed as `unknown_provider` at the call site, never as a crash.
 */
function splitEntry(entryString) {
  if (typeof entryString !== 'string') return null;
  const idx = entryString.indexOf('/');
  if (idx <= 0) return null;
  return { provider: entryString.slice(0, idx), model: entryString.slice(idx + 1) };
}

/**
 * Canonicalize a (provider, model) pair to a `provider/alias` key.
 *
 * @param {string} provider
 * @param {string} model
 * @param {Object} [registry]  defaults to loadDefaultRegistry() — inject for offline tests.
 * @returns {{ok: true, key: string} | {ok: false, reason: 'unknown_provider'|'unknown_model'}}
 */
function canonicalizeEntry(provider, model, registry) {
  const reg = registry || loadDefaultRegistry();

  if (typeof provider !== 'string' || !provider) {
    return { ok: false, reason: 'unknown_provider' };
  }
  const folded = provider.toLowerCase();
  if (!providerVocabulary(reg).has(folded)) {
    // Fail closed. Never guess — an out-of-vocabulary token (e.g. "OpenAI") must NOT be
    // coerced into a same-family provider (e.g. "codex") just because that would "make sense".
    return { ok: false, reason: 'unknown_provider' };
  }

  if (typeof model !== 'string' || !model) {
    return { ok: false, reason: 'unknown_model' };
  }
  const { byAlias, idToAlias } = buildModelIndex(reg);
  let alias = null;
  if (byAlias.has(model)) {
    alias = model;
  } else if (idToAlias.has(model)) {
    alias = idToAlias.get(model);
  }
  if (!alias) {
    // No prefix match, no regex date-stripping. A dated slug with no `observed_ids` entry (or
    // any other unrecognized id) fails closed rather than being truncated to a plausible alias.
    return { ok: false, reason: 'unknown_model' };
  }

  return { ok: true, key: `${folded}/${alias}` };
}

/**
 * Canonicalize a joined "provider/model" entry string (a chain entry or a demotion entry).
 * @param {string} entryString
 * @param {Object} [registry]
 * @returns {{ok: true, key: string} | {ok: false, reason: 'unknown_provider'|'unknown_model'}}
 */
function canonicalizeEntryString(entryString, registry) {
  const parsed = splitEntry(entryString);
  if (!parsed) return { ok: false, reason: 'unknown_provider' };
  return canonicalizeEntry(parsed.provider, parsed.model, registry);
}

module.exports = {
  loadDefaultRegistry,
  providerVocabulary,
  buildModelIndex,
  splitEntry,
  canonicalizeEntry,
  canonicalizeEntryString,
};
