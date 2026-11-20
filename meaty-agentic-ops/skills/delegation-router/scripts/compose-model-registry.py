#!/usr/bin/env python3
"""Compose disjoint public and operator-owned YAML mappings at packaging time."""
import argparse
import importlib.util
from pathlib import Path

import yaml

_builder_path = Path(__file__).with_name("build-model-registry.py")
_spec = importlib.util.spec_from_file_location("registry_builder", _builder_path)
_builder = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_builder)


def read_mapping(path):
    document = yaml.load(path.read_bytes(), Loader=_builder.UniqueKeyLoader)
    if not isinstance(document, dict):
        raise ValueError(f"{path}: expected a YAML mapping")
    return document


def compose(public, overlay, path=()):
    """Combine disjoint ownership recursively. A sequence is one value."""
    merged = dict(public)
    for key, value in overlay.items():
        if key not in public:
            merged[key] = value
        elif isinstance(public[key], dict) and isinstance(value, dict):
            merged[key] = compose(public[key], value, (*path, key))
        else:
            raise ValueError(f"duplicate ownership at {'.'.join(map(str, (*path, key)))}")
    return merged


def registry_bytes(registry):
    return yaml.safe_dump(registry, sort_keys=True, allow_unicode=True).encode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public", type=Path, required=True)
    parser.add_argument("--overlay", type=Path, required=True)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--out", type=Path)
    output.add_argument("--check", type=Path)
    args = parser.parse_args()
    try:
        result = compose(read_mapping(args.public), read_mapping(args.overlay))
        payload = registry_bytes(result)
        if args.out:
            args.out.write_bytes(payload)
        elif payload != args.check.read_bytes():
            raise ValueError(f"composition differs from {args.check}")
        else:
            print(f"Composition byte match: {args.check} ({len(payload)} bytes)")
    except (OSError, ValueError, yaml.YAMLError) as exc:
        parser.exit(1, f"compose-model-registry: {exc}\n")


if __name__ == "__main__":
    main()
