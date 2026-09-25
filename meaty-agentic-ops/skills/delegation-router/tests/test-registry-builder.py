#!/usr/bin/env python3
"""Builder gate: an invalid catalog or external row must not render."""
import copy
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("registry_builder", ROOT / "scripts" / "build-model-registry.py")
builder = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(builder)
validate_registry = builder.validate_registry

import yaml  # noqa: E402

registry = yaml.safe_load((ROOT / "model-registry.yaml").read_text())

# Nick decision 2026-09-25: Codex subscription chains use GPT-6 Luna;
# the separate ICA GPT-5.6 image fallback remains available.
for task_class in ("second_opinion", "code_review", "image_generation"):
    assert registry["routing_policy"][task_class]["chain"][0] == "codex/gpt-6-luna"
assert "ica/gpt-5.6-terra" in registry["routing_policy"]["image_generation"]["chain"]

# Negative control: the committed registry declares every required fact.
assert validate_registry(registry, "negative-control") == []

# Planted positive: an external row with an undeclared retention fact must fail.
broken = copy.deepcopy(registry)
del broken["models"]["deepseek-v4-flash"]["providers"][0]["eligibility"]["retention"]
errors = validate_registry(broken, "planted-positive")
assert any("all four eligibility attributes" in error for error in errors), errors

# A bad lane spelling must also fail instead of quietly becoming a usable catalog row.
broken = copy.deepcopy(registry)
broken["ica_catalog"][0]["lanes"] = ["ccxx"]
errors = validate_registry(broken, "planted-positive")
assert any("non-empty list of ccx/beta" in error for error in errors), errors

# Candidate endpoints cannot enter a chain before an executor exists.
broken = copy.deepcopy(registry)
broken["routing_policy"]["exploration"]["chain"].insert(0, "external/deepseek-v4-flash")
errors = validate_registry(broken, "planted-positive")
assert any("may not reference an external lane" in error for error in errors), errors

print("test-registry-builder.py: all assertions passed")
