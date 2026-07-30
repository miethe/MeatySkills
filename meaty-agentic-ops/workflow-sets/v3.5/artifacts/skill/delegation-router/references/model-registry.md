# Reading & Extending the Model Registry

How to read `model-registry.yaml` and how to register a new model on release. This is the
agent-facing companion to the registry.

**Tracked source (edit here)**: `meaty-agentic-ops/skills/delegation-router/model-registry.yaml`
in the **MeatySkills** repo — co-located with the router it drives, version-controlled and
PR-reviewed (same "edit the upstream, never the deployed copy" rule as every other artifact).

**Deployed runtime copy (do NOT hand-edit)**: `~/.claude/config/model-registry.{yaml,generated.json}`.
The resolver READS this global path at runtime (3-tier lookup, unchanged). It is produced by
`scripts/sync-to-global.sh`, which copies the tracked YAML to `~/.claude/config/` and regenerates
the JSON there. Edit the tracked source, commit, then run `sync-to-global.sh` (or `/redeploy`) to
propagate to global + the node.

> **History:** the registry originally lived in the skill dir (globalization-v1 spec §5), was briefly
> relocated to an untracked `~/.claude/config/` "global-canonical, edit-in-place" model, and as of
> 2026-07-09 is back to a **tracked co-located source deployed to the config path** — the config copy
> is now a deployed artifact, not the edit surface. (The skillmeat repo previously carried a stale
> duplicate; it has been removed — MeatySkills is the sole upstream.)

Per-project overrides still work: the resolver's Tier-2 lookup reads `<cwd>/.claude/config/model-registry.*`
when a repo opts into a local override.

Design reference: `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 3`.

> Do not duplicate the registry contents here. This file explains the **structure and field
> semantics**; the data lives in the YAML.

---

## Why model-first

The registry is keyed by **model**, with each model carrying a list of **provider sub-instances**.
This is deliberate: the same model class (e.g. `claude-haiku-4-5`) may be reachable through more
than one gateway (ICA free-tier vs Claude billed), and the registry must capture *one model, many
providers* without duplicating model-level descriptors. It is the single authoritative source —
`provider-plugins.toml` and `multi-model.toml` routing tables are folded in / derived, and the ICA
prose inventory is migrated in.

## Top-level structure

```yaml
version: 1
updated: YYYY-MM-DD

routing_policy:        # task-class → ordered preference chain (the chain IS priority/free-first)
  <task_class>: { chain: ["<provider>/<model_id>", ...], enabled: <bool> }

must_stay_primary: [orchestration, verdict, mode_d, council_review, synthesis]

models:                # model-keyed descriptors, each with provider sub-instances
  <model-key>:
    family: ...
    class: ...
    descriptor: ...
    when_to_use: [...]
    tools: [...]
    related_skills: [...]
    status: active | scaffolded | deprecated
    scores: { cost: ..., intelligence: ..., taste: ..., speed: ... }   # advisory; see § Scores block
    providers:
      - { provider: ..., model_id: ..., cost_tier: ..., allowance: ..., enabled: ..., priority: ..., cost_score: ... }
```

### `routing_policy` — chains are priority + free-first

Each task class maps to an **ordered chain** of `provider/model_id` candidates. The order is the
priority: the resolver walks the chain top-down and takes the first available, enabled instance.
Free-eligible classes (exploration, mechanical, documentation, second_opinion) put a free ICA
instance first and the primary `claude/*` instance in the chain tail — so the happy path is free
and primary is only reached on fallback. `enabled: false` on a class disables routing for it
entirely (the resolver treats it as no-route → primary default).

### `must_stay_primary` — the invariant list

The five MUST-stay concepts. Any task class in this set resolves to `claude` unconditionally,
regardless of what the chain or the requested `provider` says. This list is an invariant; changing
it is a MAJOR change to the skill contract (SPEC §3 invariant 1).

## Field semantics — model level

| Field | Meaning |
|---|---|
| `family` / `class` | Grouping (`claude`/`open`/`openai`/`google`); class = `opus`/`sonnet`/`haiku`/`fable`/… |
| `descriptor` | One-line "what is this." |
| `when_to_use` | Task characteristics this model is good for — drives capability match in scoring. |
| `tools` | Special tool access (`agent_tool` for Opus, `one_million_context` for `[1m]` variants, `web_search`, `vision`, `imagegen`). |
| `related_skills` | Global skills/tools to load to drive this combo (`gemini-cli`, `nano-banana`, `ica-delegate`, `codex`). |
| `status` | `active` (default) \| `scaffolded` (known, not auto-routed) \| `deprecated`. |

## Field semantics — provider instance level

| Field | Meaning |
|---|---|
| `provider` | Which gateway serves this model (`claude`/`ica`/`gemini`/`codex`/`bob`). |
| `model_id` | Exact versioned invocation string for that provider, including `[1m]` context variants. |
| `cost_tier` | `free` \| `standard` \| `premium` \| `billed`. |
| `allowance` | `unlimited` \| `shared_token_pool` \| `billed` — see below. |
| `enabled` | Per-instance on/off (a provider-level master toggle may also apply). |
| `priority` | Lower = tried first when the `routing_policy` chain doesn't already pin order. |

### `cost_tier` vs `allowance` — the load-bearing distinction

`cost_tier` is a coarse price band. `allowance` is the real budget semantics and **must be encoded,
never assumed**:

| `allowance` | Meaning | Examples |
|---|---|---|
| `unlimited` | Genuinely free, cost-shifted off the primary budget ($0 to primary) | ICA Haiku 4.5, Gemma 4, Llama 4 Maverick, Granite 4 Small |
| `shared_token_pool` | Token-limited on ICA's shared pool — **NOT free**; opt-in cost-shift only | ICA Sonnet, ICA Opus (`[1m]` variants), ICA Gemini 3.5 Flash |
| `billed` | Primary subscription tokens | `claude/*` instances |

Free-first routing applies **only** to `allowance: unlimited` instances. ICA Sonnet/Opus
(`shared_token_pool`) stay opt-in — never an always-on free route. A model can be free on one
provider and billed on another (e.g. `claude-haiku-4-5` is `unlimited` on ICA, `billed` on Claude).

## Scores block — advisory scorecard metadata

Each model entry in the global registry may carry a `scores:` block at the model level.
Individual provider instances may carry a `cost_score:` override for lanes that differ materially
in actual spend:

```yaml
claude-sonnet-4-6:
  # … family/class/descriptor/when_to_use/tools/related_skills/status …
  scores:
    cost: 8          # 1–10; HIGHER = BETTER (cheaper to us) — preferred lane here is the ICA pool
    intelligence: 7
    taste: 7
    speed: 6
  providers:
    - { provider: claude, model_id: "claude-sonnet-4-6", cost_tier: standard,
        allowance: billed, cost_score: 5, ... }
      # ↑ subscription lane spends real budget → cost_score overrides the model-level cost
    - { provider: ica, model_id: "claude-sonnet-4-6[1m]", cost_tier: standard,
        allowance: shared_token_pool, ... }
```

### Score field meanings

| Field | Meaning |
|---|---|
| `cost` | What you *actually* pay on the preferred lane (1–10; **higher = better, i.e. cheaper to us** — same polarity as every other score). ICA lanes score 8–10 because they are cost-shifted off the primary budget. |
| `intelligence` | Reasoning / coding capability ceiling (higher = more capable). |
| `taste` | Prose quality, instruction-following, formatting adherence (higher = better). |
| `speed` | Tokens-per-second / latency (higher = faster). |

`cost_score` on a provider instance overrides the model-level `cost` value for that lane only
(e.g. the ICA path of a subscription model that is cheaper on the ICA pool).

### Mirror rule — keep doc and registry in sync

The `scores:` values mirror the human-readable scorecard table in
`agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md § 1.5`. **When you update one, update
both.** The authoritative editorial decision lives in MODEL-ROUTING §1.5; the registry carries the
machine-readable twin. The operative selection heuristic: pick the highest-`cost` model that clears
the task's `intelligence`/`taste` bar.

### Resolver caveat — v3 does not read `scores:` yet

The **v3 resolver does NOT read `scores:`**. Chain order, `priority`, availability, and
capability-match (`when_to_use`) drive v3 resolution; `scores:` is advisory metadata for agents
making their own delegation decisions and a reserved input for a future resolver upgrade. Do not
rely on `scores:` influencing routing outcomes until a CHANGELOG entry confirms the upgrade.

## Adding a new model on release

Worked example: **Claude Fable 5** ships. Register it before routing real work to it.

Edit the **tracked source** `meaty-agentic-ops/skills/delegation-router/model-registry.yaml` (in
MeatySkills), commit it, then deploy:
```bash
bash meaty-agentic-ops/skills/delegation-router/scripts/sync-to-global.sh
```
which copies the YAML to `~/.claude/config/` and regenerates `model-registry.generated.json` there
(then propagate to the node via `/redeploy` or rsync). Do **not** hand-edit the deployed
`~/.claude/config/` copy.

1. **Add the model entry** under `models:`, keyed by the model class name:

   ```yaml
   claude-fable-5:
     family: claude
     class: fable
     descriptor: "Claude Fable 5 (newly released). Capabilities TBD — confirm before routing real work."
     when_to_use: []          # fill in after confirming capabilities
     tools: []
     related_skills: []
     status: scaffolded       # known-to-exist, NOT yet auto-routed
     providers:
       - { provider: claude, model_id: "claude-fable-5", cost_tier: premium, allowance: billed, enabled: false, priority: 1 }
   ```

2. **Land it as `status: scaffolded`, `enabled: false`.** This registers existence so agents know
   the model exists, while keeping it out of any auto-routing chain until trusted.

3. **Confirm capabilities** — fill `when_to_use`, `tools`, and any additional provider instances
   (e.g. an ICA `[1m]` variant with `allowance: shared_token_pool`). Verify the `model_id` strings
   against the provider's real invocation surface (for ICA, cross-check
   `~/.claude/skills/ica-delegate/references/ica-models.md`).

4. **Enable it** — flip `status: active` and the relevant provider instance to `enabled: true`,
   then add it to the appropriate `routing_policy` chain(s). For free-eligible work, place the
   free instance ahead of the primary tail.

5. **Bump `version` / `updated`** at the top of the registry, run
   `python3 ~/.claude/skills/delegation-router/scripts/build-model-registry.py` to regenerate
   the JSON, then verify the resolver unit tests stay green.

> New models always land scaffolded + disabled first (design §8). Registering ≠ routing.
