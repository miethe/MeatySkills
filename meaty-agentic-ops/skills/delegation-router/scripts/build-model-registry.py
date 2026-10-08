#!/usr/bin/env python3
"""
build-model-registry.py — derive model-registry.generated.json from model-registry.yaml.

WHY THIS EXISTS
  resolver.js must stay PURE (no child_process / exec / spawn / shell) and Node has
  no built-in YAML parser. When `js-yaml` is importable (repo node_modules), the resolver
  loads model-registry.yaml directly. When it is NOT (e.g. the engine globalized to
  ~/.claude/skills/ with no node_modules), the resolver falls back to JSON.parse on the
  generated JSON this script emits.

  This script is the ONLY place YAML→JSON conversion happens, and it runs OUTSIDE the
  resolver (a build step), so the resolver itself never shells out or imports a YAML lib
  it cannot guarantee.

REGISTRY DATA IS GLOBAL-CANONICAL
  The model-registry.yaml and its generated JSON live in ~/.claude/config/ — the global
  canonical location. This script defaults to that path. Pass --in/--out explicitly only
  when targeting a non-default location (e.g. a per-project override or CI).

REGEN COMMAND (run after editing ~/.claude/config/model-registry.yaml):
  python3 .claude/skills/delegation-router/scripts/build-model-registry.py

  Explicit paths (e.g. for a per-project override or CI):
  python3 .claude/skills/delegation-router/scripts/build-model-registry.py \
      --in  ~/.claude/config/model-registry.yaml \
      --out ~/.claude/config/model-registry.generated.json

The generated JSON is written to the same directory as the source YAML.
Keep it in sync: regenerate whenever model-registry.yaml changes.
"""

import argparse
import hashlib
import json
import os
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: PyYAML is required to run build-model-registry.py "
        "(pip install pyyaml).\n"
    )
    sys.exit(2)


def validate_registry(data: dict, source: str, evidence_root: str | None = None,
                      vocabulary: list[str] | None = None) -> list[str]:
    """Return deterministic, human-readable registry integrity errors.

    `evidence_root` / `vocabulary` default to this script's own skill directory, so the source
    build (and sync-to-global.sh, which runs the SOURCE script over the deployed copy) resolves
    `set_by.evidence` against the tracked evidence/ directory.
    """
    errors: list[str] = []
    models = data.get("models") or {}
    seen_instances: dict[tuple[str, str, str], int] = {}
    write_profiles = (
        ((data.get("routing_attributes") or {}).get("write_capability") or {})
    )

    for index, row in enumerate(data.get("ica_catalog") or []):
        prefix = f"ica_catalog[{index}]"
        if not isinstance(row, dict):
            errors.append(f"{prefix} must be a mapping")
            continue
        if not row.get("model_id"):
            errors.append(f"{prefix}.model_id is required")
        if not isinstance(row.get("lanes"), list) or not row["lanes"] or any(lane not in {"ccx", "beta"} for lane in row["lanes"]):
            errors.append(f"{prefix}.lanes must be a non-empty list of ccx/beta")
        if row.get("economics") not in {"unlimited", "shared_token_pool", "unknown"}:
            errors.append(f"{prefix}.economics must be unlimited, shared_token_pool, or unknown")
        health = row.get("health")
        if not isinstance(health, dict) or health.get("status") not in {"available", "degraded", "unavailable", "unknown"}:
            errors.append(f"{prefix}.health.status is required and must be declared")

    for task_class, policy in (data.get("routing_policy") or {}).items():
        for chain_entry in (policy or {}).get("chain", []):
            if str(chain_entry).startswith("external/"):
                errors.append(
                    f"routing_policy.{task_class} may not reference an external lane before its executor exists"
                )

    for model_key, model in models.items():
        providers = (model or {}).get("providers") or []
        for index, instance in enumerate(providers):
            if not isinstance(instance, dict):
                errors.append(f"models.{model_key}.providers[{index}] must be a mapping")
                continue

            provider = instance.get("provider")
            model_id = instance.get("model_id")
            identity = (str(model_key), str(provider), str(model_id))
            if identity in seen_instances:
                first = seen_instances[identity]
                errors.append(
                    "duplicate provider/model_id within model entry: "
                    f"models.{model_key}.providers[{first}] and [{index}] both declare "
                    f"{provider}/{model_id}"
                )
            else:
                seen_instances[identity] = index

            health = instance.get("health") or {}
            if health and not isinstance(health, dict):
                errors.append(f"models.{model_key}.providers[{index}].health must be a mapping")
            elif health:
                unavailable = health.get("status") == "unavailable"
                zero_limit = health.get("quota_limit") == 0
                if (unavailable or zero_limit) and instance.get("enabled") is not False:
                    errors.append(
                        f"models.{model_key}.providers[{index}] is unavailable/limit:0 "
                        "and must set enabled: false before it can be built"
                    )

            write_capability = instance.get("write_capability")
            if provider == "codex" and not write_capability:
                errors.append(
                    f"models.{model_key}.providers[{index}] is a Codex lane and must declare "
                    "write_capability (read-class is read-only)"
                )
            elif write_capability and write_capability not in write_profiles:
                errors.append(
                    f"models.{model_key}.providers[{index}].write_capability references "
                    f"unknown profile '{write_capability}'"
                )

            if provider == "external":
                required = (data.get("routing_attributes", {}).get("lane_eligibility", {}).get("required", []))
                eligibility = instance.get("eligibility")
                if not isinstance(eligibility, dict) or any(field not in eligibility for field in required):
                    errors.append(f"models.{model_key}.providers[{index}] external lane must declare all four eligibility attributes")
                if instance.get("enabled") is not False or model.get("status") != "candidate":
                    errors.append(f"models.{model_key}.providers[{index}] external lane must be status:candidate and enabled:false")

    if _registry_version(data) >= 2:
        errors.extend(validate_v2(data, evidence_root or SKILL_DIR,
                                  vocabulary if vocabulary is not None else load_vocabulary()))

    return [f"{source}: {error}" for error in errors]


# ──────────────────────────────────────────────────────────────────────────────
# Registry v2 (routing M1, node_01M4C696HR9WVV6BVZ2FXQZH0Y): model facts + task-class defaults.
# Applied only when `version >= 2`, so older/foreign registries and test fixtures keep validating.
# ──────────────────────────────────────────────────────────────────────────────
SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICE_KEYS = ("input_per_mtok_usd", "output_per_mtok_usd", "cache_read_per_mtok_usd", "cache_write_5m_per_mtok_usd")
SCORE_KEYS = ("cost", "intelligence", "taste", "speed")
CAPABILITY_KEYS = ("context_window", "max_output", "tool_use", "forced_tool_choice",
                   "reasoning_effort_control", "image_output", "video_output")
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
QUALITY_KEYS = ("w_intelligence", "w_taste", "w_speed")
NON_ROUTABLE_STATUSES = {"scaffolded", "candidate", "deprecated"}


def _registry_version(data: dict) -> int:
    try:
        return int(data.get("version") or 1)
    except (TypeError, ValueError):
        return 1


def load_vocabulary(path: str | None = None) -> list[str]:
    path = path or os.path.join(SKILL_DIR, "task-class-vocabulary.v1.json")
    with open(path, encoding="utf-8") as fh:
        return [c["id"] for c in json.load(fh)["classes"]]


def is_routable(model: dict) -> bool:
    """A model row the resolver can actually pick: not scaffolded/candidate/deprecated and at
    least one provider instance not explicitly disabled."""
    if (model or {}).get("status") in NON_ROUTABLE_STATUSES:
        return False
    return any(isinstance(p, dict) and p.get("enabled") is not False for p in (model.get("providers") or []))


def defaults_fingerprint(entry: dict) -> str:
    """sha256 (first 16 hex) of a task_class_defaults entry WITHOUT its set_by block. resolver.js
    never reads it; it exists so a changed default cannot keep an old evidence stamp."""
    body = {k: v for k, v in (entry or {}).items() if k != "set_by"}
    raw = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def holder_model(data: dict, holder: str):
    """Resolve a holder "provider/model_id" to (model_key, model_row) over every declared provider
    instance, enabled or not (a disabled instance is a legal holder; the resolver skips it)."""
    provider, _, model_id = str(holder).partition("/")
    for key, model in (data.get("models") or {}).items():
        for inst in (model or {}).get("providers") or []:
            if isinstance(inst, dict) and inst.get("provider") == provider and inst.get("model_id") == model_id:
                return key, model
    return None, None


def class_quality(model: dict, weights: dict):
    """q on the 1-10 class quality scale, or None when a weighted score is unmeasured. Mirrors
    resolver.js classQuality() exactly."""
    scores = (model or {}).get("scores") or {}
    total = 0.0
    for wkey in QUALITY_KEYS:
        weight = weights.get(wkey) or 0
        if weight == 0:
            continue
        score = scores.get(wkey[2:])
        if not _number(score):
            return None
        total += weight * score
    return round(total, 6)


def validate_v2(data: dict, evidence_root: str, vocabulary: list[str]) -> list[str]:
    errors: list[str] = []
    models = data.get("models") or {}

    # Layer 1 — every routable row carries complete pricing, scores and capabilities.
    for key, model in models.items():
        if not isinstance(model, dict) or not is_routable(model):
            continue
        pricing = model.get("pricing")
        if not isinstance(pricing, dict):
            errors.append(f"models.{key}: routable row must declare pricing (v2)")
        else:
            missing = [k for k in PRICE_KEYS if k not in pricing]
            if missing:
                errors.append(f"models.{key}.pricing missing {missing} (null is legal, absence is not)")
            bad = [k for k in PRICE_KEYS if k in pricing and pricing[k] is not None
                   and not (_number(pricing[k]) and pricing[k] >= 0)]
            if bad:
                errors.append(f"models.{key}.pricing {bad} must be a non-negative number or null")
            if any(pricing.get(k) is None for k in PRICE_KEYS) and not pricing.get("basis"):
                errors.append(f"models.{key}.pricing has an unpriced (null) field and must state its basis")
            for k in ("as_of", "source"):
                if not pricing.get(k):
                    errors.append(f"models.{key}.pricing.{k} is required (v2)")
        scores = model.get("scores")
        if not isinstance(scores, dict) or any(k not in scores for k in SCORE_KEYS):
            errors.append(f"models.{key}: routable row must declare scores {list(SCORE_KEYS)}")
        else:
            for k in SCORE_KEYS:
                v = scores[k]
                if not ((_number(v) and 1 <= v <= 10) or v == "UNMEASURED"):
                    errors.append(f"models.{key}.scores.{k} must be 1-10 or UNMEASURED, got {v!r}")
        caps = model.get("capabilities")
        if not isinstance(caps, dict) or any(k not in caps for k in CAPABILITY_KEYS):
            errors.append(f"models.{key}: routable row must declare capabilities {list(CAPABILITY_KEYS)}")
        elif caps.get("context_window") != model.get("max_context"):
            errors.append(
                f"models.{key}.capabilities.context_window ({caps.get('context_window')}) disagrees with "
                f"max_context ({model.get('max_context')}); one fact, one value"
            )

    # Layer 2 — task_class_defaults: full vocabulary coverage, evidence, derived-copy agreement.
    margin_policy = data.get("margin_policy")
    if not isinstance(margin_policy, dict) or not _number(margin_policy.get("lambda_default")):
        errors.append("margin_policy.lambda_default is required (v2)")
    tcd = data.get("task_class_defaults")
    if not isinstance(tcd, dict):
        return errors + ["task_class_defaults is required (v2)"]
    vocab = set(vocabulary)
    for missing in sorted(vocab - set(tcd)):
        errors.append(f"task_class_defaults is missing vocabulary class '{missing}'")
    for extra in sorted(set(tcd) - vocab):
        errors.append(f"task_class_defaults.{extra} is not a canonical vocabulary class")
    policy = data.get("routing_policy") or {}
    for cls, entry in tcd.items():
        where = f"task_class_defaults.{cls}"
        if not isinstance(entry, dict):
            errors.append(f"{where} must be a mapping")
            continue
        holders = entry.get("holders")
        if not isinstance(holders, list) or not holders or not all(isinstance(h, str) and "/" in h for h in holders):
            errors.append(f"{where}.holders must be a non-empty list of provider/model_id entries")
            holders = []
        if entry.get("effort") not in EFFORTS:
            errors.append(f"{where}.effort must be one of {sorted(EFFORTS)}")
        bar = entry.get("bar")
        if not (_number(bar) and 1 <= bar <= 10):
            errors.append(f"{where}.bar must be a number on the 1-10 scale")
            bar = None
        quality = entry.get("quality")
        if not isinstance(quality, dict) or any(not _number(quality.get(k)) or quality.get(k) < 0 for k in QUALITY_KEYS):
            errors.append(f"{where}.quality must declare non-negative {list(QUALITY_KEYS)}")
            quality = None
        elif abs(sum(quality[k] for k in QUALITY_KEYS) - 1.0) > 1e-6:
            errors.append(f"{where}.quality weights must sum to 1")
        margin = entry.get("margin")
        if not isinstance(margin, dict) or not _number(margin.get("lambda")) or margin.get("lambda") < 0:
            errors.append(f"{where}.margin.lambda must be a non-negative number")
        frontier = entry.get("frontier")
        if not isinstance(frontier, dict) or not isinstance(frontier.get("required"), bool) \
                or not (frontier.get("holder") is None or isinstance(frontier.get("holder"), str)):
            errors.append(f"{where}.frontier must be {{required: bool, holder: provider/model_id|null}}")
        elif frontier.get("required") and margin and _number(margin.get("lambda")) and margin["lambda"] != 0:
            errors.append(f"{where}: frontier.required forces margin.lambda to 0")
        if not isinstance(entry.get("requires_capabilities"), list) or \
                not all(isinstance(c, str) and c for c in entry["requires_capabilities"]):
            errors.append(f"{where}.requires_capabilities must be a list of capability ids")
        for holder in holders + ([frontier["holder"]] if isinstance(frontier, dict) and frontier.get("holder") else []):
            key, model = holder_model(data, holder)
            if model is None:
                errors.append(f"{where}: holder '{holder}' is not a declared provider instance")
                continue
            if bar is not None and quality and holder in holders:
                q = class_quality(model, quality)
                if q is not None and q < bar:
                    errors.append(f"{where}: holder '{holder}' measures q={q} below the class bar {bar}")
        chain = (policy.get(cls) or {}).get("chain") if isinstance(policy.get(cls), dict) else None
        if chain is not None and list(chain) != list(holders):
            errors.append(
                f"routing_policy.{cls}.chain is a DERIVED copy of {where}.holders and disagrees "
                f"({chain} != {holders}); edit task_class_defaults and copy the holders"
            )
        # set_by: an existing evidence file must record THIS entry's fingerprint on the class's row.
        set_by = entry.get("set_by")
        if not isinstance(set_by, dict):
            errors.append(f"{where}.set_by is required (evidence, node, date, approved_by, fingerprint)")
            continue
        for k in ("evidence", "date", "approved_by", "fingerprint"):
            if not set_by.get(k):
                errors.append(f"{where}.set_by.{k} is required")
        actual = defaults_fingerprint(entry)
        if set_by.get("fingerprint") and set_by["fingerprint"] != actual:
            errors.append(
                f"{where} changed without re-stamping: set_by.fingerprint {set_by['fingerprint']} != {actual}. "
                "A defaults change needs evidence: record the new fingerprint and the class in an evidence file, "
                "then update set_by (see the task_class_defaults header)."
            )
        evidence = set_by.get("evidence")
        if evidence:
            path = os.path.normpath(os.path.join(evidence_root, evidence))
            if not path.startswith(os.path.normpath(evidence_root) + os.sep) or not os.path.isfile(path):
                errors.append(f"{where}.set_by.evidence '{evidence}' does not exist under {evidence_root}")
            else:
                with open(path, encoding="utf-8") as fh:
                    rows = fh.read().splitlines()
                if not any(f"`{cls}`" in r and actual in r for r in rows):
                    errors.append(
                        f"{where}: evidence '{evidence}' has no row naming `{cls}` with fingerprint {actual}; "
                        "a defaults change without recorded evidence is refused"
                    )
    return errors


def main() -> int:
    # Default: global canonical location at ~/.claude/config/.
    global_config_dir = os.path.join(os.path.expanduser("~"), ".claude", "config")
    default_in = os.path.join(global_config_dir, "model-registry.yaml")
    default_out = os.path.join(global_config_dir, "model-registry.generated.json")

    ap = argparse.ArgumentParser(description="Build model-registry.generated.json from model-registry.yaml")
    ap.add_argument("--in", dest="src", default=default_in,
                    help=f"Path to model-registry.yaml (default: {default_in})")
    ap.add_argument("--out", dest="dst", default=None,
                    help="Path to output model-registry.generated.json "
                         "(default: same directory as --in, named model-registry.generated.json)")
    ap.add_argument("--evidence-root", default=None,
                    help="Directory set_by.evidence paths resolve against (default: this skill directory)")
    ap.add_argument("--stamp", action="store_true",
                    help="Print each task_class_defaults entry's current fingerprint and exit (authoring aid)")
    args = ap.parse_args()

    # If --out not given, place the generated JSON next to the source YAML.
    if args.dst is None:
        args.dst = os.path.join(os.path.dirname(os.path.abspath(args.src)),
                                "model-registry.generated.json")

    with open(args.src, "rb") as fh:
        raw_yaml_bytes = fh.read()

    data = yaml.safe_load(raw_yaml_bytes)

    if not isinstance(data, dict):
        sys.stderr.write(f"ERROR: {args.src} did not parse to a mapping.\n")
        return 1

    if args.stamp:
        for cls, entry in (data.get("task_class_defaults") or {}).items():
            print(f"{cls}\t{defaults_fingerprint(entry)}")
        return 0

    validation_errors = validate_registry(data, args.src, evidence_root=args.evidence_root)
    if validation_errors:
        sys.stderr.write("ERROR: model registry validation failed:\n")
        for error in validation_errors:
            sys.stderr.write(f"  - {error}\n")
        return 1

    # SHA256 of the raw YAML bytes. resolver.js recomputes this over the live YAML
    # (when js-yaml is present) and warns if it disagrees — i.e. this generated JSON
    # is stale relative to the authoritative YAML.
    yaml_sha256 = hashlib.sha256(raw_yaml_bytes).hexdigest()

    # Stamp provenance so consumers can detect a stale generated file.
    # Record the SOURCE BASENAME only, never an absolute path: this file is
    # committed to git AND deployed to ~/.claude/config/, and an absolute path
    # embeds the generating machine's checkout/worktree location. That made the
    # committed artifact machine-specific — the global copy and every worktree's
    # copy carried a different `_generated_from` and so could never be
    # byte-identical, which is exactly what defeated a naive drift check and let
    # real staleness hide behind an expected-looking diff. The basename is
    # deterministic and reproducible everywhere; the machine-independent
    # staleness signal is `_yaml_sha256` below, which resolver.js already
    # recomputes over the live YAML.
    out = {
        "_generated_from": os.path.basename(args.src),
        "_generator": "scripts/build-model-registry.py",
        "_yaml_sha256": yaml_sha256,
        **data,
    }

    # YAML may parse bare dates (e.g. `updated: 2026-06-09`) into date objects,
    # which JSON cannot serialize — stringify any such non-JSON-native scalars.
    def _json_default(obj):
        return str(obj)

    with open(args.dst, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False, default=_json_default)
        fh.write("\n")

    model_count = len(data.get("models", {}) or {})
    policy_count = len(data.get("routing_policy", {}) or {})
    defaults_count = len(data.get("task_class_defaults", {}) or {})
    sys.stderr.write(
        f"Wrote {args.dst}\n  models: {model_count}  routing_policy classes: {policy_count}"
        f"  task_class_defaults classes: {defaults_count}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
