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
import subprocess
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: PyYAML is required to run build-model-registry.py "
        "(pip install pyyaml).\n"
    )
    sys.exit(2)


def validate_registry(data: dict, source: str) -> list[str]:
    """Return deterministic, human-readable registry integrity errors."""
    errors: list[str] = []
    models = data.get("models") or {}
    seen_instances: dict[tuple[str, str, str], int] = {}
    write_profiles = (
        ((data.get("routing_attributes") or {}).get("write_capability") or {})
    )

    allowed_minimum_reasons = {"cost_policy", "quality_bar", "disclosure_absolute", "authority_absolute"}
    required_lane_attributes = {"compute_custody", "retention", "jurisdiction", "account_relationship", "metering", "payer"}
    lane_order = data.get("lane_order") or []
    if len(lane_order) != len(set(lane_order)):
        errors.append("lane_order must not contain duplicate lane ids")
    for lane_id, lane in (data.get("lanes") or {}).items():
        missing = sorted(required_lane_attributes - set((lane or {}).get("attributes") or {}))
        if missing:
            errors.append(f"lanes.{lane_id} missing attributes: {', '.join(missing)}")
        if not isinstance((lane or {}).get("harness_capabilities"), list):
            errors.append(f"lanes.{lane_id}.harness_capabilities must be a list")

    defaults = data.get("task_class_defaults") or {}
    for task_class, spec in defaults.items():
        for holder in spec.get("holders", []) or []:
            if "/" in str(holder): errors.append(f"task_class_defaults.{task_class}.holders contains provider/model value '{holder}'")
        for key in ("frontier",):
            value = spec.get(key)
            if isinstance(value, str) and "/" in value: errors.append(f"task_class_defaults.{task_class}.{key} must be a bare model id")
        for candidate in spec.get("cross_family", []) or []:
            value = candidate.get("model") if isinstance(candidate, dict) else candidate
            if "/" in str(value): errors.append(f"task_class_defaults.{task_class}.cross_family contains provider/model value '{value}'")
        floor_model = (spec.get("fallback") or {}).get("floor_model")
        if floor_model is not None and "/" in str(floor_model):
            errors.append(f"task_class_defaults.{task_class}.fallback.floor_model must be a bare model id")
        minimum = spec.get("minimum") or {}
        if "min_rung" in minimum: errors.append(f"task_class_defaults.{task_class}.minimum may not contain min_rung")
        if minimum and minimum.get("reason") not in allowed_minimum_reasons:
            errors.append(f"task_class_defaults.{task_class}.minimum.reason must be one of {', '.join(sorted(allowed_minimum_reasons))}")
        if task_class in (data.get("must_stay_primary") or []):
            caps = spec.get("requires_capabilities") or []
            if "claude_code_native" not in caps and minimum.get("reason") != "authority_absolute":
                errors.append(f"task_class_defaults.{task_class} must_stay_primary requires claude_code_native or authority_absolute minimum")

    def contains_min_rung(value):
        if isinstance(value, dict):
            return "min_rung" in value or any(contains_min_rung(v) for v in value.values())
        if isinstance(value, list): return any(contains_min_rung(v) for v in value)
        return False
    if contains_min_rung(data): errors.append("registry may not contain any min_rung key")

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
            if "/" in str(chain_entry):
                errors.append(f"routing_policy.{task_class}.chain contains provider/model value '{chain_entry}'")
            if str(chain_entry).startswith("external/"):
                errors.append(
                    f"routing_policy.{task_class} may not reference an external lane before its executor exists"
                )
        expected = (defaults.get(task_class) or {}).get("holders")
        if expected is not None and (policy or {}).get("chain") != expected:
            errors.append(f"routing_policy.{task_class}.chain must equal task_class_defaults.{task_class}.holders")

    for model_key, model in models.items():
        providers = (model or {}).get("providers") or []
        for index, instance in enumerate(providers):
            if not isinstance(instance, dict):
                errors.append(f"models.{model_key}.providers[{index}] must be a mapping")
                continue

            provider = instance.get("provider")
            lane_id = instance.get("lane")
            lane = (data.get("lanes") or {}).get(lane_id)
            if not lane:
                errors.append(f"models.{model_key}.providers[{index}] references undeclared lane '{lane_id}'")
            if lane and lane.get("provider") != provider:
                errors.append(f"models.{model_key}.providers[{index}] provider '{provider}' does not match lane '{lane_id}' provider '{lane.get('provider')}'")
            if instance.get("enabled") is True and lane_id not in lane_order:
                errors.append(f"enabled lane '{lane_id}' is missing from lane_order")
            model_id = instance.get("model_id")
            # Codex subscriptions expose the same model through two explicitly bound identities;
            # those are distinct eligible lanes and therefore distinct provider rows.
            identity = (str(model_key), str(provider), str(model_id), str(instance.get("lane")))
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

    return [f"{source}: {error}" for error in errors]


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

    validation_errors = validate_registry(data, args.src)
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

    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    table_path = os.path.join(os.path.dirname(os.path.abspath(args.dst)), "routing-table.generated.json")
    cli_path = os.path.join(skill_dir, "resolve-cli.js")
    table_proc = subprocess.run(
        ["node", cli_path, "table", "--registry", os.path.abspath(args.dst), "--json"],
        capture_output=True, text=True,
    )
    if table_proc.returncode != 0:
        sys.stderr.write("ERROR: resolve-cli.js table failed:\n" + (table_proc.stderr or ""))
        return 1
    with open(table_path, "w", encoding="utf-8") as fh:
        fh.write(table_proc.stdout)

    model_count = len(data.get("models", {}) or {})
    policy_count = len(data.get("routing_policy", {}) or {})
    sys.stderr.write(
        f"Wrote {args.dst} and {table_path}\n  models: {model_count}  routing_policy classes: {policy_count}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
