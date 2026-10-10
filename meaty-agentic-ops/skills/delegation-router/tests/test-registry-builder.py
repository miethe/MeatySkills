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
# 2026-10-08, Nick (cross-provider defaults): the first fallback is the OTHER family's frontier model,
# ahead of the same-family legacy entry, in both priority classes.
assert registry["routing_policy"]["raw_strength"]["chain"][:3] == ["codex/gpt-6.1-sol", "claude/claude-opus-5-5", "codex/gpt-6-sol"]
assert registry["routing_policy"]["design_judgment"]["chain"][:2] == ["claude/claude-opus-5-5", "codex/gpt-6.1-sol"]
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

# ──────────────────────────────────────────────────────────────────────────────
# Registry v2 (routing M1, node_01M4C696HR9WVV6BVZ2FXQZH0Y): model facts + task_class_defaults.
# Negative control first (the committed registry is valid, asserted above), then one planted
# positive per rule, each proving the builder REFUSES rather than renders.
# ──────────────────────────────────────────────────────────────────────────────
import tempfile  # noqa: E402

assert registry["version"] == 2
vocabulary = builder.load_vocabulary()
tcd = registry["task_class_defaults"]
assert sorted(tcd) == sorted(vocabulary), sorted(set(tcd) ^ set(vocabulary))

# Every routable row: four price keys (incl. cache_write_5m), scores, capabilities.
for key, model in registry["models"].items():
    if not builder.is_routable(model):
        continue
    assert set(builder.PRICE_KEYS) <= set(model["pricing"]), key
    assert set(builder.SCORE_KEYS) <= set(model["scores"]), key
    assert set(builder.CAPABILITY_KEYS) <= set(model["capabilities"]), key
assert registry["models"]["claude-fable-5-1"]["capabilities"]["forced_tool_choice"] == "broken"
assert registry["models"]["claude-opus-5-5"]["pricing"]["cache_write_5m_per_mtok_usd"] == 5

# Positioning-study role map is applied THROUGH task_class_defaults (Haiku 5.5 as a role holder).
assert tcd["exploration"]["holders"][0] == "claude/claude-haiku-5-5"
assert tcd["exploration"]["set_by"]["evidence"] == "evidence/cross-provider-2026-10-08.md"
assert tcd["exploration"]["cross_family"]["equivalence"] == "equivalent"

# Cross-provider defaults (Nick 2026-10-08, req_01M4EFJ6ZBKFXWPHSWEPT9MDVE). Every class evaluates
# Opus 5.5 AND GPT-6.1 Sol; svg_generation is Opus 5.5 and Fable holds nothing it was not
# contracted for; unmeasured judgment classes default to the cheaper Sol with Opus first fallback.
for cls, entry in tcd.items():
    xf = entry["cross_family"]
    evaluated = set(xf["candidates"]) | {x["holder"] for x in xf.get("excluded", [])}
    assert {"claude/claude-opus-5-5", "codex/gpt-6.1-sol"} <= evaluated, cls
    if "claude/claude-fable-5-1" in entry["holders"]:
        assert cls == "advanced_sol", cls
assert tcd["svg_generation"]["holders"][0] == "claude/claude-opus-5-5"
assert tcd["svg_generation"]["cross_family"]["priority"] == "claude/claude-opus-5-5"
for cls in ("verdict", "council_review", "synthesis", "schema_recovery", "cross_wave_merge"):
    assert tcd[cls]["cross_family"]["equivalence"] == "unmeasured", cls
    assert tcd[cls]["holders"][:2] == ["codex/gpt-6.1-sol", "claude/claude-opus-5-5"], cls
# Single-family only on a capability or authority exclusion of the other family's frontier model.
for cls in ("orchestration", "mode_d"):
    axes = {x["holder"]: x["axis"] for x in tcd[cls]["cross_family"]["excluded"]}
    assert axes["codex/gpt-6.1-sol"] in ("capability", "authority"), (cls, axes)
kinds = {}
for cls, entry in tcd.items():
    kinds.setdefault(entry["cross_family"]["equivalence"], []).append(cls)
assert len(kinds["unmeasured"]) == 9 and len(kinds["equivalent"]) == 1, kinds
# routing_policy is the derived copy and agrees with the holders it was derived from.
for cls, policy in registry["routing_policy"].items():
    assert policy["chain"] == tcd[cls]["holders"], cls


def refused(mutate, needle):
    broken = copy.deepcopy(registry)
    mutate(broken)
    errors = validate_registry(broken, "planted-positive")
    assert any(needle in e for e in errors), (needle, errors)


# A defaults change without re-stamping is refused.
refused(lambda r: r["task_class_defaults"]["exploration"].__setitem__("bar", 5.0), "changed without re-stamping")
# Re-stamping without recorded evidence is refused too: the new fingerprint is on no evidence row.
def restamp_without_evidence(r):
    entry = r["task_class_defaults"]["exploration"]
    entry["bar"] = 5.0
    entry["set_by"]["fingerprint"] = builder.defaults_fingerprint(entry)
refused(restamp_without_evidence, "a defaults change without recorded evidence is refused")
# A missing evidence path is refused.
refused(lambda r: r["task_class_defaults"]["mechanical"]["set_by"].__setitem__("evidence", "evidence/nope.md"), "does not exist")
# An evidence path that escapes the evidence root is refused.
refused(lambda r: r["task_class_defaults"]["mechanical"]["set_by"].__setitem__("evidence", "../../../../etc/hosts"), "does not exist")
# Vocabulary coverage.
refused(lambda r: r["task_class_defaults"].pop("verdict"), "missing vocabulary class 'verdict'")
# The derived routing_policy copy may not drift from the holders.
refused(lambda r: r["routing_policy"]["exploration"].__setitem__("chain", ["ica/gpt-5.6-luna"]), "DERIVED copy")
# A holder below its class bar (scores are facts the builder reads) is refused.
refused(lambda r: r["models"]["claude-haiku-5-5"].__setitem__("scores", {"cost": 10, "intelligence": 1, "taste": 1, "speed": 1}), "below the class bar")
# frontier.required forces lambda 0.
refused(lambda r: r["task_class_defaults"]["design_judgment"]["margin"].__setitem__("lambda", 0.5), "forces margin.lambda to 0")
# Layer 1: cache_write_5m absent, a null price without basis, a context_window that disagrees.
refused(lambda r: r["models"]["claude-opus-5-5"]["pricing"].pop("cache_write_5m_per_mtok_usd"), "pricing missing")
def null_without_basis(r):
    r["models"]["gpt-6-luna"]["pricing"].pop("basis")
refused(null_without_basis, "must state its basis")
refused(lambda r: r["models"]["claude-sonnet-5-5"]["capabilities"].__setitem__("context_window", 200000), "one fact, one value")
refused(lambda r: r["models"]["claude-sonnet-5-5"].pop("capabilities"), "must declare capabilities")

# Cross-family rules (2026-10-08).
def drop_sol_from_review(r):
    r["task_class_defaults"]["review"]["cross_family"]["candidates"].remove("codex/gpt-6.1-sol")
refused(drop_sol_from_review, "'codex/gpt-6.1-sol' must be evaluated")
def fable_svg(r):
    e = r["task_class_defaults"]["svg_generation"]
    e["holders"][0] = "claude/claude-fable-5-1"
    e["cross_family"]["candidates"].append("claude/claude-fable-5-1")
refused(fable_svg, "explicit opt-in only")
def opus_first_unmeasured(r):
    e = r["task_class_defaults"]["verdict"]
    e["holders"][:2] = ["claude/claude-opus-5-5", "codex/gpt-6.1-sol"]
refused(opus_first_unmeasured, "defaults to the cheapest candidate")
def same_family_fallback(r):
    e = r["task_class_defaults"]["verdict"]
    e["holders"][:3] = ["codex/gpt-6.1-sol", "codex/gpt-6-sol", "claude/claude-opus-5-5"]
refused(same_family_fallback, "first fallback must come from another family")
refused(lambda r: r["task_class_defaults"]["raw_strength"]["cross_family"].__setitem__("priority", "claude/claude-opus-5-5"), "must name holders[0]")
def fake_bar_exclusion(r):
    r["task_class_defaults"]["verdict"]["cross_family"]["excluded"].append(
        {"holder": "claude/claude-opus-5-5", "axis": "bar", "evidence": "planted"})
refused(fake_bar_exclusion, "excluded on the bar axis")
refused(lambda r: r["task_class_defaults"]["mode_d"].pop("cross_family"), "cross_family is required")

# A v1 registry (no task_class_defaults) is still valid: the v2 rules are version-gated.
v1 = copy.deepcopy(registry)
v1["version"] = 1
del v1["task_class_defaults"]
assert validate_registry(v1, "v1-compat") == [], validate_registry(v1, "v1-compat")

# --stamp prints the fingerprints the evidence files record (authoring aid round-trip).
for cls, entry in tcd.items():
    assert entry["set_by"]["fingerprint"] == builder.defaults_fingerprint(entry), cls

# Evidence resolution is rooted at --evidence-root: an empty root refuses every class.
with tempfile.TemporaryDirectory() as empty_root:
    errors = validate_registry(copy.deepcopy(registry), "evidence-root", evidence_root=empty_root)
    assert sum("does not exist under" in e for e in errors) == len(tcd), errors

print("test-registry-builder.py: v2 assertions passed")
