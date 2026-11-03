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

# Duplicate keys must be rejected by the exact loader used by the JSON generator;
# otherwise PyYAML silently applies last-wins and can hide a malformed registry.
try:
    builder.yaml.load("task_class_defaults:\n  example:\n    requires_capabilities: [claude_code_native]\n    requires_capabilities: []\n", Loader=builder.UniqueKeyLoader)
except yaml.constructor.ConstructorError as exc:
    assert "duplicate key 'requires_capabilities'" in str(exc), exc
else:
    raise AssertionError("registry generator loader accepted a duplicate requires_capabilities key")

registry = yaml.safe_load((ROOT / "model-registry.yaml").read_text())

# V3 holders are model ids only. Nick decision 2026-09-25: the Codex subscription
# holder remains GPT-6 Luna; the separate ICA GPT-5.6 image fallback remains selectable.
for task_class in ("second_opinion", "code_review", "image_generation"):
    assert registry["routing_policy"][task_class]["chain"][0] == "gpt-6-luna"
    assert registry["routing_policy"][task_class]["chain"] == registry["task_class_defaults"][task_class]["holders"]
    assert all("/" not in item for item in registry["routing_policy"][task_class]["chain"])
assert "gpt-5.6-terra" in registry["routing_policy"]["image_generation"]["chain"]

# Negative control: the live registry passes every v3 builder check (journal_reflect's
# absolute minimum is expressed as a compute_custody predicate since 2026-10-16).
valid = copy.deepcopy(registry)
errors = validate_registry(valid, "negative-control")
assert errors == [], errors
assert "task_class_sovereignty" not in registry
assert registry["task_class_defaults"]["journal_reflect"]["minimum"]["reason"] == "disclosure_absolute"

# Planted positive: a legacy min_rung minimum is refused by name.
broken = copy.deepcopy(valid)
broken["task_class_defaults"]["journal_reflect"]["minimum"] = {"min_rung": "local", "reason": "egress_absolute"}
errors = validate_registry(broken, "legacy-minimum-control")
assert any("min_rung" in error for error in errors), errors
assert any("reason must be one of" in error for error in errors), errors

broken = copy.deepcopy(valid)
broken["task_class_defaults"]["implementation"]["holders"][0] = "codex/gpt-6-luna"
errors = validate_registry(broken, "planted-positive")
assert any("provider/model value" in error for error in errors), errors

broken = copy.deepcopy(valid)
broken["task_class_defaults"]["exploration"]["holders"].append("unroutable-model")
errors = validate_registry(broken, "holder-unroutable-control")
assert any("holder_unroutable" in error and "unroutable-model" in error for error in errors), errors

broken = copy.deepcopy(valid)
broken["lanes"]["claude_subscription"]["attributes"].pop("retention")
errors = validate_registry(broken, "planted-positive")
assert any("lanes.claude_subscription missing attributes" in error for error in errors), errors

broken = copy.deepcopy(valid)
broken["lane_order"].append(broken["lane_order"][0])
errors = validate_registry(broken, "planted-positive")
assert any("lane_order must not contain duplicate" in error for error in errors), errors

broken = copy.deepcopy(valid)
broken["models"]["claude-sonnet-5-5"]["providers"][0]["lane"] = "codex_subscription_primary"
errors = validate_registry(broken, "planted-positive")
assert any("does not match lane" in error for error in errors), errors

# Spine reconciliation (node_01M3F4F5G93P21P1WAH565MAYQ, 2026-09-27): agentic_meta_dev CLAUDE.md
# declares Opus 5.5 as the base spine as of 2026-09-22. The two MUST-stay chains (orchestration,
# mode_d) must pin claude-opus-5-5 FIRST, with claude-opus-5 kept selectable as the in-chain
# legacy/fallback entry. This is the negative control that would have caught the drift where the
# doctrine moved to Opus 5.5 but these chains still routed to claude-opus-5.
for task_class in ("orchestration", "mode_d"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert chain[0] == "claude-opus-5-5", \
        f"{task_class} must pin the Opus 5.5 spine first, got {chain}"
    assert "claude-opus-5" in chain, \
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
assert registry["routing_policy"]["design_judgment"]["chain"][0] == "claude-opus-5-5"
assert registry["routing_policy"]["raw_strength"]["chain"] == ["gpt-6.1-sol", "claude-opus-5-5", "gpt-6-sol"]
for task_class in ("implementation", "code_review"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert "claude-opus-5-5" not in chain, \
        f"{task_class} must not pin the design_judgment model directly, got {chain}"
    assert "gpt-6.1-sol" not in chain and "gpt-6-sol" not in chain, \
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
# (a) a native leg still pinned to the superseded Haiku 4.5, (b) the 4.5 ICA row being silently
# re-labelled free on the 2026-10-16 refresh (it stays PAID per Nick 2026-10-07), and
# (c) the cheap tier's Intelligence score drifting up past what the bench supports.
# 2026-10-16 (Nick): ICA now serves claude-haiku-5-5 (free/unlimited); the earlier "(b) no ICA row
# for a model the gateway 403s" control is retired because the gateway no longer 403s it.
h55 = registry["models"]["claude-haiku-5-5"]
assert h55["max_context"] == 1000000 and h55["status"] == "active", h55
assert [p["lane"] for p in h55["providers"]] == ["claude_subscription", "claude_subscription_1x", "ica_gateway_messages"], h55["providers"]
h55_ica = next(p for p in h55["providers"] if p["provider"] == "ica")
assert h55_ica["enabled"] is True and h55_ica["allowance"] == "unlimited" and h55_ica["cost_tier"] == "free", h55_ica
assert h55_ica["model_id"] == "claude-haiku-5-5[1m]", h55_ica  # ica-claude.sh id; raw-HTTP callers send the bare id
assert h55_ica["priority"] > next(p for p in h55["providers"] if p["provider"] == "claude")["priority"], h55_ica  # subscription stays the unqualified default
for task_class in ("exploration", "documentation", "mechanical"):
    chain = registry["routing_policy"][task_class]["chain"]
    assert "claude-haiku-5-5" in chain, (task_class, chain)
    assert "claude-haiku-4-5" not in chain, (task_class, chain)
    expected = ["claude-haiku-5-5", "gpt-6-luna"] if task_class == "exploration" else ["gpt-6-luna", "claude-haiku-5-5"]
    assert chain == expected, (task_class, chain)  # v2 holder order; refreshed Luna replaces legacy Luna
    assert "claude-haiku-5-5[1m]" not in chain and "gpt-5.6-luna" not in chain, (task_class, chain)
    assert "claude-haiku-4-5" not in chain, f"ICA Haiku 4.5 counts as PAID (Nick 2026-10-07); {task_class} must not lead with it: {chain}"
assert "claude-haiku-4-5" not in registry["routing_policy"]["second_opinion"]["chain"]
h45_ica = next(p for p in registry["models"]["claude-haiku-4-5"]["providers"] if p["provider"] == "ica")
assert h45_ica["enabled"] is True and h45_ica["allowance"] == "shared_token_pool" and h45_ica["cost_tier"] == "standard", h45_ica  # paid per Nick 2026-10-07
assert registry["models"]["claude-haiku-4-5"]["scores"]["cost"] == 7, registry["models"]["claude-haiku-4-5"]["scores"]
assert h55["scores"]["intelligence"] <= registry["models"]["claude-sonnet-5-5"]["scores"]["intelligence"] - 2, h55["scores"]

# ICA refresh (2026-10-16, Nick): claude-sonnet-5-5, gpt-6-luna and gpt-6.1-sol replace their
# predecessors as the ICA defaults; the predecessors stay as still-served legacy fallbacks, and the
# ICA Opus rows the gateway now 403s stay disabled with unavailable health.
s55_ica = next(p for p in registry["models"]["claude-sonnet-5-5"]["providers"] if p["provider"] == "ica")
assert s55_ica["enabled"] is True and s55_ica["allowance"] == "shared_token_pool", s55_ica  # shared ccx pool: NOT free
assert s55_ica["model_id"] == "claude-sonnet-5-5[1m]", s55_ica
s5_ica = next(p for p in registry["models"]["claude-sonnet-5"]["providers"] if p["provider"] == "ica")
assert s5_ica["enabled"] is True, s5_ica  # legacy fallback is still served
luna6_ica = next(p for p in registry["models"]["gpt-6-luna"]["providers"] if p["provider"] == "ica")
assert luna6_ica["enabled"] is True and luna6_ica["allowance"] == "unlimited" and luna6_ica["model_id"] == "gpt-6-luna", luna6_ica
assert "dzus" not in luna6_ica["model_id"], luna6_ica  # dzus ids are retired (403)
sol61_ica = next(p for p in registry["models"]["gpt-6.1-sol"]["providers"] if p["provider"] == "ica")
assert sol61_ica["enabled"] is True and sol61_ica["allowance"] == "shared_token_pool" and sol61_ica["model_id"] == "gpt-6.1-sol", sol61_ica
assert sol61_ica["tool_mode"] == "none", sol61_ica  # tools+reasoning interaction not re-measured for 6.1: stay tool-less
assert registry["routing_policy"]["review"]["chain"] == ["gpt-6.1-sol", "claude-sonnet-5-5", "claude-opus-5-5"]
for task_class in ("adjudication", "critique"):
    assert registry["routing_policy"][task_class]["chain"] == ["gpt-6.1-sol", "claude-opus-5-5"], task_class
for legacy in ("gpt-5.6-luna-ica", "gpt-5.6-terra-ica"):
    legacy_ica = next(p for p in registry["models"][legacy]["providers"] if p["provider"] == "ica")
    assert legacy_ica["enabled"] is True, (legacy, legacy_ica)  # still served 2026-10-16; terra has no GPT-6 replacement
for dead in ("claude-opus-5", "claude-opus-4-8", "claude-opus-4-6"):
    dead_ica = next(p for p in registry["models"][dead]["providers"] if p["provider"] == "ica")
    assert dead_ica["enabled"] is False and dead_ica["health"]["status"] == "unavailable", (dead, dead_ica)
# design_judgment / raw_strength chains are set by evaluation; the refresh must not touch them.
assert registry["routing_policy"]["design_judgment"]["chain"] == ["claude-opus-5-5", "gpt-6.1-sol", "claude-opus-5"]
assert registry["routing_policy"]["raw_strength"]["chain"] == ["gpt-6.1-sol", "claude-opus-5-5", "gpt-6-sol"]

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

# Node sizing controls: malformed or widened automatic envelopes cannot render.
for change, expected in [
    (lambda r: r["capability_providers"]["image_generation"].update(task_class="unknown"), "unknown task class"),
    (lambda r: r["envelope"].update(messiness_divisor=0), "messiness_divisor"),
    (lambda r: r["envelope"]["cells"][0].update(source="measured", n=19), "n >= 20"),
    (lambda r: r["envelope"]["cells"][0].update(sizes=["xl"]), "cannot automatically admit"),
    (lambda r: r["envelope"]["cells"].append(copy.deepcopy(r["envelope"]["cells"][0])), "duplicate envelope cell"),
    (lambda r: r["envelope"]["escalation_ladders"]["implementation"].append("gpt-6-astra"), "cannot infer advanced_sol"),
]:
    broken = copy.deepcopy(registry)
    change(broken)
    errors = validate_registry(broken, "needs-envelope-negative-control")
    assert any(expected in error for error in errors), errors
print("test-registry-builder.py: needs/envelope negative controls passed")
