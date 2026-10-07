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

# Policy update 2026-09-28 (evening), Nick: Sonnet 5.5's broadened role is by TASK CLASS, not one
# global default. `design_judgment` (architecture/UX-visual-design/hard-judgment/ambiguous-
# synthesis) must start on Opus 5.5, and `raw_strength` (hard-algorithmic/debugging/reasoning-
# heavy) must start on gpt-6.1-sol (gpt-6-sol fallback, superseded 2026-09-30) — neither may resolve through `implementation`/`code_review`
# defaulting to Sonnet 5.5. This is the negative control that would have caught a blanket
# "Sonnet 5.5 everywhere" widening.
assert registry["routing_policy"]["design_judgment"]["chain"][0] == "claude/claude-opus-5-5"
assert registry["routing_policy"]["raw_strength"]["chain"][:2] == ["codex/gpt-6.1-sol", "codex/gpt-6-sol"]
for task_class in ("implementation", "code_review"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert "claude/claude-opus-5-5" not in chain, \
        f"{task_class} must not pin the design_judgment model directly, got {chain}"
    assert "codex/gpt-6.1-sol" not in chain and "codex/gpt-6-sol" not in chain, \
        f"{task_class} must not pin the raw_strength model directly, got {chain}"

# Sonnet 5.5's scorecard Intelligence was raised 8->9 (2026-09-28 evening) on vendor-benchmark +
# community-report evidence, explicitly NOT independently measured by us — this is the negative
# control that would have caught the score drifting back down, or up past what the sourced
# evidence supports (Opus 5.5 is also 9; Sonnet 5.5 must not exceed its own declared spine).
opus55_scores = registry["models"]["claude-opus-5-5"]["scores"]
sonnet55_scores = registry["models"]["claude-sonnet-5-5"]["scores"]
assert sonnet55_scores["intelligence"] == 9, sonnet55_scores
assert sonnet55_scores["intelligence"] <= opus55_scores["intelligence"], \
    (sonnet55_scores, opus55_scores)

# ICA lane preference (2026-09-28 evening), Nick: since Opus 5.5 is already servable on ICA, there
# is no reason to keep defaulting to Sonnet 5 there. The claude-opus-5-5 ICA provider row must
# stay enabled and remain a shared_token_pool row (never described as literally free — it draws
# more credits per call than Sonnet 5).
opus55_ica = next(
    p for p in registry["models"]["claude-opus-5-5"]["providers"] if p["provider"] == "ica"
)
assert opus55_ica["enabled"] is True, opus55_ica
assert opus55_ica["allowance"] == "shared_token_pool", opus55_ica

# Haiku 5.5 (2026-10-07, Nick): default native cheap tier. Negative controls that would have caught
# (a) a native leg still pinned to the superseded Haiku 4.5, (b) an ICA row invented for a model the
# gateway 403s, (c) the 4.5 ICA free row being dropped on an unconfirmed "now paid" report, and
# (d) the cheap tier's Intelligence score drifting up past what the bench supports.
h55 = registry["models"]["claude-haiku-5-5"]
assert h55["max_context"] == 1000000 and h55["status"] == "active", h55
assert [p["provider"] for p in h55["providers"]] == ["claude"], h55["providers"]
for task_class in ("exploration", "documentation", "mechanical"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert "claude/claude-haiku-5-5" in chain, (task_class, chain)
    assert "claude/claude-haiku-4-5" not in chain, (task_class, chain)
    assert "ica/claude-haiku-4-5" not in chain, f"ICA Haiku 4.5 counts as PAID (Nick 2026-10-07); {task_class} must not lead with it: {chain}"
    # Positioning by role (node_01M4C58QYW0KP7987JWADP8YKV, Nick 2026-10-07: do not relegate Haiku 5.5 to a price
    # fallback; compare it with GPT-6 Luna as paid peers). Both paid peers are named in every cheap chain, and the free
    # ICA leg keeps a slot so public bulk work still has a $0 lane.
    assert "codex/gpt-6-luna" in chain, (task_class, chain)
    assert "ica/gpt-5.6-luna" in chain, (task_class, chain)
# exploration is OWNED by Haiku 5.5 (Claude-Code-native Explore path; unknown disclosure fails closed for ICA);
# documentation / mechanical are OWNED by free ICA GPT-5.6 Luna for public bulk work.
assert registry["routing_policy"]["exploration"]["chain"][0] == "claude/claude-haiku-5-5", registry["routing_policy"]["exploration"]
for task_class in ("documentation", "mechanical"):
    assert registry["routing_policy"][task_class]["chain"][0] == "ica/gpt-5.6-luna", (task_class, registry["routing_policy"][task_class])
assert "ica/claude-haiku-4-5" not in registry["routing_policy"]["second_opinion"]["chain"]
h45_ica = next(p for p in registry["models"]["claude-haiku-4-5"]["providers"] if p["provider"] == "ica")
assert h45_ica["enabled"] is True and h45_ica["allowance"] == "shared_token_pool" and h45_ica["cost_tier"] == "standard", h45_ica  # paid per Nick 2026-10-07
assert registry["models"]["claude-haiku-4-5"]["scores"]["cost"] == 7, registry["models"]["claude-haiku-4-5"]["scores"]
assert h55["scores"]["intelligence"] <= registry["models"]["claude-sonnet-5-5"]["scores"]["intelligence"] - 2, h55["scores"]

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

# GPT-6.1 Sol supersedes GPT-6 Sol (Nick, 2026-09-30): active + enabled, sol demoted to legacy fallback.
sol61 = registry["models"]["gpt-6.1-sol"]
assert sol61["status"] == "active", sol61["status"]
assert sol61["providers"][0]["enabled"] is True and sol61["providers"][0]["model_id"] == "gpt-6.1-sol"
assert sol61["providers"][0]["account_relationship"] == "personal"
assert "LEGACY" in registry["models"]["gpt-6-sol"]["descriptor"]
