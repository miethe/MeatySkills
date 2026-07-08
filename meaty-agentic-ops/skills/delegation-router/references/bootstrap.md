# Bootstrapping delegation-router into a new project

How the skill self-installs into a project that does not yet have it. The engine and registry are
**global** (project-independent); the only per-project coupling is the Mode-D path patterns, the
audit log location, and any per-project enable/priority overrides.

Design reference: `docs/project_plans/design-specs/model-registry-router-globalization-v1.md § 5`.

> Keep this out of `SKILL.md` — it is install-time guidance, not invocation-time routing.

---

## What is global vs project-local

| Global — `~/.claude/` | Project-local — `<repo>/.claude/` |
|---|---|
| `skills/delegation-router/` — resolver code (resolver.js, routing-record.js, audit-log.js, SKILL.md / SPEC.md / README.md / references/) | `config/routing.local.toml` — this repo's Mode-D paths + selection overrides |
| `config/model-registry.yaml` — registry DATA (single source of truth) | `.claude/logs/routing-decisions.jsonl` — project-scoped audit log |
| `config/model-registry.generated.json` — derived JSON for js-yaml-absent environments | Workflow scripts that call the global resolver (if any) |

**Registry data is global-only.** A repo must NOT keep its own authoritative copy of
`model-registry.yaml`. If a repo has `.claude/config/model-registry.*` files, they are
treated by the resolver as Tier-2 per-project **overrides** (intentional customization),
not as the canonical source. See migration note below for how to clean up old copies.

The `routing.local.toml` is the correct per-project coupling — it layers **selection-only**
overrides (disabled_providers, disabled_models, priority_overrides, routing_policy_overrides)
ON TOP of the global registry WITHOUT editing it.

## The 3-step bootstrap checklist

1. **Global skill present.** Install the engine + registry to user scope once
   (`~/.claude/skills/delegation-router/`). If already installed, skip.
2. **Project-local config written.** Scaffold `<repo>/.claude/config/routing.local.toml` with the
   repo's Mode-D path patterns (auth/migration/secret/deletion directories differ per project) and
   any per-project `enabled`/priority overrides and opted-in workflows.
3. **ICA auth confirmed.** Verify `~/ica-claude.sh` exists and authenticates (it is user-global, so
   usually already present). Create `<repo>/.claude/logs/` for the audit log.

## Path A — skillmeat-assisted (preferred where available)

Use when the target project is a SkillMeat-managed environment.

1. `skillmeat add` the `delegation-router` skill and the executor agents (`ica-executor`,
   `bob-delegate-executor`, `gemini-executor`, `codex-executor`).
2. Deploy them via a deployment-set so the skill + agentTypes land together and stay in sync.
3. Scaffold `routing.local.toml` (step 2 of the checklist) and create `.claude/logs/`.
4. Confirm `~/ica-claude.sh` auth.

## Path B — manual fallback

Use when SkillMeat is not managing the target project.

1. **Install the global skill.** Run `sync-to-global.sh` from skillmeat (or copy the engine
   manually into `~/.claude/skills/delegation-router/` — `resolver.js`, `routing-record.js`,
   `audit-log.js`, SKILL.md / SPEC.md / README.md / references/).
   The registry DATA (`model-registry.yaml`) must be at `~/.claude/config/model-registry.yaml`.
   If it is not there yet, copy it from skillmeat ONCE then treat `~/.claude/config/` as canonical.
2. **Scaffold the project-local config** at `<repo>/.claude/config/routing.local.toml` using the
   template below; fill in this repo's real Mode-D directories.
3. **Confirm ICA auth** — `~/ica-claude.sh` is user-global; verify it authenticates.
4. **Create the audit log dir** — `mkdir -p <repo>/.claude/logs/` (the audit writer creates the
   `.jsonl` file on first append).

## `routing.local.toml` template

```toml
# routing.local.toml — per-project delegation-router coupling.
# The engine + model-registry.yaml are global; this file carries ONLY what differs per repo.

[meta]
project = "my-project"
updated = "2026-06-09"

# ── Mode-D path patterns ──────────────────────────────────────────────────────
# Any task whose files match these patterns is a Mode-D boundary → MUST stay on
# primary Claude. Patterns differ per repo (auth/migration/secret/deletion dirs).
[mode_d]
path_patterns = [
  "**/auth/**",
  "**/migrations/**",
  "**/alembic/**",
  "**/*secret*",
  "**/*credential*",
  "deploy/**",
]

# ── Per-project registry overrides (optional) ────────────────────────────────
# Layer selection-only overrides ON TOP of the GLOBAL model-registry.yaml WITHOUT
# editing it. The resolver reads these at route time (process.cwd()/.claude/config/
# routing.local.toml). Omit any field to inherit the global registry exactly.
#
# These affect model/provider SELECTION only. (Mode-D path globs above are consumed
# by the workflow guard, not by the selection resolver.)
#
# HARD INVARIANT: MUST-stay-primary is ABSOLUTE and CANNOT be weakened here.
# orchestration / verdict / mode_d / council_review / synthesis (and the routing-record
# literals schema-recovery / cross-wave-merge) ALWAYS stay on primary Claude. Any
# routing_policy_override targeting a MUST-stay class is IGNORED (and warned).

# Exclude entire providers' instances from candidacy in THIS repo.
# disabled_providers = ["gemini", "codex"]

# Exclude specific registry model KEYS (not provider model_ids) from candidacy.
# disabled_models = ["claude-opus-4-7"]

# Re-rank a specific "provider/model_id" instance (lower = preferred). Quoted keys.
# [priority_overrides]
# "ica/claude-haiku-4-5" = 0
# "claude/claude-sonnet-5" = 5

# Project-local routing_policy chain overrides, merged OVER the global routing_policy
# per task_class. Only honored for NON-MUST-stay classes (MUST-stay entries dropped).
# [routing_policy_overrides.exploration]
# chain = ["claude/claude-haiku-4-5"]

# (Legacy) Free-form per-repo enable/priority notes. Inert unless consumed by tooling.
[overrides]
# (none — inherits global registry enable/priority)

# ── Opted-in workflows ────────────────────────────────────────────────────────
# Workflows in this repo allowed to route off-primary. Empty = none opted in
# (provider_routing_enabled stays the governing gate).
[workflows]
opted_in = []

# ── Audit log ─────────────────────────────────────────────────────────────────
[audit]
log_path = ".claude/logs/routing-decisions.jsonl"
```

## Verifying the install (smoke test)

A correct install satisfies two checks (the per-project gate in design W5):

1. **Resolver loads** — `require('.../delegation-router/resolver.js')` succeeds and `resolve(...)`
   returns a valid 11-field `RoutingRecord` for a sample tuple.
2. **Audit writes** — `appendEntry(...)` appends a line to `.claude/logs/routing-decisions.jsonl`
   and `skillmeat routing audit` reads it back.

> ccdash is a special case: it shares `.claude` via git-tracked symlinks into skillmeat — top up
> its config only; leave the symlinks intact (design W5).

---

## Migration: removing old per-repo registry copies

When the delegation-router was first bootstrapped into repos (ccdash, citytile_pack, etc.),
each received a local copy of `model-registry.yaml` + `model-registry.generated.json` at
`<repo>/.claude/config/`. These are now deprecated — the resolver's Tier-2 project-local
lookup still reads them as overrides, but they are not the canonical source.

**Migration steps for each bootstrapped repo** (do NOT edit the skillmeat repo — this is already done):

1. Confirm `~/.claude/config/model-registry.yaml` exists and is current (run `sync-to-global.sh`
   from skillmeat, or compare timestamps).
2. Verify the resolver reads the global copy from the repo's root:
   ```bash
   cd <repo>
   node -e "const {resolve}=require('$HOME/.claude/skills/delegation-router/resolver.js'); \
            const r=resolve({model:'haiku',task_class:'exploration'}); \
            console.log(r.chosen_plugin_id, r.model);"
   # Expected: ica  haiku
   ```
3. Remove the per-repo registry files:
   ```bash
   git rm .claude/config/model-registry.yaml .claude/config/model-registry.generated.json
   git commit -m "chore(routing): remove deprecated per-repo registry copies; global canonical at ~/.claude/config/"
   ```
4. The resolver now falls through to Tier-3 (global canonical) automatically. No other changes needed.

**ccdash** shares `.claude` via git-tracked symlinks into skillmeat — the skillmeat registry
removal handles ccdash as well (same files via symlink). Leave the symlinks intact.
