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

# Spine reconciliation (node_01M3F4F5G93P21P1WAH565MAYQ, 2026-09-27): agentic_meta_dev CLAUDE.md
# declares Opus 5.5 as the base spine as of 2026-09-22. The two MUST-stay chains (orchestration,
# mode_d) must pin claude-opus-5-5 FIRST, with claude-opus-5 kept selectable as the in-chain
# legacy/fallback entry. This is the negative control that would have caught the drift where the
# doctrine moved to Opus 5.5 but these chains still routed to claude-opus-5.
for task_class in ("orchestration", "mode_d"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert chain[0] == "claude/claude-opus-5-5", \
        f"{task_class} must pin the Opus 5.5 spine first, got {chain}"
    assert "claude/claude-opus-5" in chain, \
        f"{task_class} must keep Opus 5 selectable as a fallback chain entry, got {chain}"

# Sonnet 5 pricing (node_01M3HW1ECPSXFCREDCKC6R8FE4, 2026-09-27): Anthropic made the $2/$10
# intro price standard — the previously-scheduled 2026-09-01 rise to $3/$15 did not occur
# (verified against the live Claude/Anthropic pricing page, retrieved 2026-09-27). This is the
# negative control that would have caught the registry still declaring the stale $3/$15 price.
sonnet5_pricing = registry["models"]["claude-sonnet-5"]["pricing"]
assert sonnet5_pricing["input_per_mtok_usd"] == 2, sonnet5_pricing
assert sonnet5_pricing["output_per_mtok_usd"] == 10, sonnet5_pricing

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
