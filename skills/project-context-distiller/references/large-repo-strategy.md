# Large Repo Strategy

Read before Phase 1 when the target project has >500 files, >5 services, or a monorepo layout.

## Triage first, read last

1. **Never load the repo into orchestrator context**. Use Glob and Grep to build a structural map from paths and filenames alone before opening any file.
2. **Delegate deep exploration** to the `Explore` or `codebase-explorer` agent with scoped queries. Example: "Map all FastAPI routers under `services/api/app/routers/` and return a list of router modules with their prefix and tag."
3. **Prefer ai/* artifacts** when the project already publishes them (`ai/symbols-*.json`, `ai/repo.map.json`). These compress weeks of exploration into structured JSON.

## Monorepo decomposition

Apply Phases 1–5 **per package/service**, not globally, then synthesize cross-cutting findings in Phase 7.

1. Identify top-level units: `apps/*`, `packages/*`, `services/*`, or workspace members in `pnpm-workspace.yaml` / `pyproject.toml` workspaces.
2. For each unit, produce a mini-inventory (structure, entrypoints, runtime boundary, top deps).
3. Group units by runtime role: frontends, APIs, workers, libraries, infra.
4. Cross-cutting layer: shared packages, contracts, schemas, design systems, infra modules.

## Sampling over exhaustiveness

For feature cataloging in large repos:
- Enumerate features from route tables, CLI command registries, or menu configurations first — these surfaces are compressed signal.
- Sample deeply only in areas marked `partial` or `experimental`, where confidence matters most.
- Do NOT read every implementation file. Read one representative per pattern.

## Budget discipline

- Target: orchestrator context footprint < 40K tokens before Phase 7.
- Use scratch notes (write to `output_dir/.scratch-phase-N.md`) to offload accumulated findings between phases so the orchestrator can drop them from context.
- Each `Explore` agent call should return summary findings (< 500 tokens), not full file contents.

## Stopping rules

Phase 4 (feature catalog) is complete when:
- Every top-level CLI command / API route group / UI page route has been cataloged.
- Every `packages/*` or `services/*` has at least one feature entry or an explicit note that it is pure infrastructure.
- Further sampling is producing no new feature categories.

Do not attempt to catalog every internal helper function — that is not a feature.

## Handling ambiguous units

Some packages are clearly infra or glue (e.g., `@org/tsconfig`, `packages/eslint-config`). Catalog them with `dependencies / dev tooling` tag in a single line, no per-feature breakdown.

## When to ask the user

Ask once, early, if:
- The repo contains multiple unrelated projects in one tree.
- A service appears abandoned but has no explicit deprecation marker.
- Supplemental materials significantly contradict the code and it's unclear which to trust.

One targeted question is worth 30 minutes of speculative inference.
