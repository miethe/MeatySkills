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
    sys.stderr.write(
        f"Wrote {args.dst}\n  models: {model_count}  routing_policy classes: {policy_count}\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
