# meaty-agentic-ops — internal additions

> **This file and the directories it documents live on the IBM mirror (`ibm-main`) only.**
> They are intentionally absent from the public `origin/main`. Do not cherry-pick upstream.

The public bundle (see `README.md`) ships the provider-agnostic planning/execution methodology.
This mirror adds the environment-specific **executable engine and multi-provider routing layer**:

| Path | Contents |
|------|----------|
| `workflows/*.js` | The executable workflow engine: `auto-feature`, `execute-contract`, `execute-plan`, `explore`, `spike`, `review-council`, plus the authoring `CLAUDE.md`. |
| `skills/delegation-router/` | Model/provider/effort routing skill (RoutingRecord, resolver, model registry). |
| `agents/` | Per-provider executor agents: `codex-executor`, `gemini-executor`, `ica-executor`, `bob-delegate-executor`. |
| `config/` | `multi-model.toml`, `provider-plugins.toml` — provider enablement and plugin wiring. |
| `specs/provider-routing-spec.md`, `specs/multi-model-usage-spec.md` | Routing policy + multi-model usage rules. |
| `packs/meaty-agentic-ops-full.skillmeat-pack` | Portable pack-format v2 archive of the **complete** set (5 skills + 10 commands + 6 workflows + 4 agents) for one-shot import into another SkillMeat instance. |

## Importing the pack into another SkillMeat instance

```bash
# Requires the API running and the portable-bundle v2 flag:
export SKILLMEAT_PORTABLE_BUNDLE_V2_ENABLED=true
skillmeat artifact import packs/meaty-agentic-ops-full.skillmeat-pack
```

The pack was produced with:

```bash
skillmeat artifact export --no-version-lineage \
  --artifact skill:planning --artifact skill:dev-execution --artifact skill:artifact-tracking \
  --artifact skill:workflow-authoring --artifact skill:delegation-router \
  --artifact command:plan-feature --artifact command:explore --artifact command:spike \
  --artifact command:autopilot --artifact command:execute-contract --artifact command:execute-plan \
  --artifact command:execute-phase --artifact command:quick-feature --artifact command:code-review --artifact command:mc \
  --artifact workflow:auto-feature --artifact workflow:execute-contract --artifact workflow:execute-plan \
  --artifact workflow:explore --artifact workflow:spike --artifact workflow:review-council \
  --artifact agent:codex-executor --artifact agent:gemini-executor --artifact agent:ica-executor --artifact agent:bob-delegate-executor \
  --out packs/meaty-agentic-ops-full.skillmeat-pack
```

Re-run that command from a SkillMeat collection to regenerate the pack after updating any artifact.
Add `--sign` to attach an Ed25519 signature (requires `skillbom_enabled`), or
`--no-version-lineage` (used here) for a lighter archive without version history.
