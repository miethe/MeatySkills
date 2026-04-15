# Feature Mode: `/scaffold:feature`

Feature-scoped scaffold — adds only the artifacts needed for a new feature, without re-adding artifacts already deployed in the project's `.claude/` directory.

## Key Difference from Project Mode

Feature mode reads the existing `.claude/` inventory before curating. Any artifact already present in the project is excluded from the curator's candidate list. This prevents overwriting or duplicating existing skills, agents, MCPs, and other artifacts.

## Invocation

```
/scaffold:feature [input] [--project <path>] [--types <artifact-types>] [--deploy <path>] [--dry-run]
```

| Flag | Default | Description |
|------|---------|-------------|
| `input` | (prompted) | Feature context: plan path, PRD path, or free-text |
| `--project <path>` | cwd | Path to the existing project (reads `.claude/` inventory from here) |
| `--types` | all | Comma-separated artifact type filter |
| `--deploy <path>` | same as `--project` | Deploy target (defaults to the project path) |
| `--dry-run` | false | Preview only; no Bundle creation or file writes |

## Scope Filtering

### Reading the Existing Inventory

Before curation, the skill reads the deployed artifact inventory from one of two sources (in priority order):

1. **Via API**: `GET /api/v1/artifacts?deployed_to=<project_path>` — returns artifacts tracked in the DB cache for the project.
2. **Manifest scan fallback**: If API is unavailable, reads `<project>/.claude/manifest.toml` directly and lists deployed artifacts by name + type.

### Exclusion Logic

Any candidate artifact from the curator is excluded if it matches an existing artifact by:
- `artifact_uuid` (exact match, preferred), OR
- `name + type` (fuzzy match when UUID not available)

Excluded artifacts are shown in the preview as strikethrough/grayed with reason "already deployed".

### Scope Variant Tag

The Intent Set for feature-mode runs carries `scope_variant: "feature"`. The curator receives this tag and applies the exclusion filter internally.

## Pipeline Steps

### Step 1: Read Existing Inventory

Queries the project's deployed artifact list. Logs count: "Found 7 existing artifacts in .claude/ — these will be excluded."

### Step 2: Analysis (project-analyzer)

Same as project mode, but the analyzer receives additional context:

```yaml
existing_capabilities:
  - "dev-execution"       # existing skill name
  - "python-backend-eng"  # existing agent name
```

This context guides confidence scoring — if a capability is clearly covered by an existing artifact, intents for that capability are assigned lower priority.

### Step 3: Interview (conditional)

Same trigger heuristic as project mode:
- `aggregate_confidence < 0.65`, OR
- ≥2 high-priority intents with `confidence < 0.5`

Feature mode questions are scoped to the new capability being added (not the overall project stack).

### Step 4: Curation (artifact-curator) [Phase 2]

Same three-leg search as project mode. After ranking, applies exclusion filter:

```
filtered_candidates = [c for c in ranked_candidates if c not in existing_inventory]
```

If filtering removes all candidates for an intent, logs: "Intent int_003 (caching/redis): all candidates already deployed — skipping."

### Step 5: Preview

Feature-mode preview labels the context clearly:

```
Scaffold Preview — feature scope
Project: ./my-project/.claude/  (7 existing artifacts excluded)
─────────────────────────────────────────────────────────────
  #  Type     Name              Source      Score  Intent
  1  skill    similarity-search local       0.89   vector-search / pinecone
  2  mcp      pinecone-mcp      marketplace 0.77   vector-search / pinecone
  3  agent    data-layer-expert local       0.72   vector-search / pinecone
  4  context  vector-arch-ctx   local       0.65   vector-search / pinecone

  Excluded (already deployed):
  ✗  skill    dev-execution     local       —      python-backend / fastapi
─────────────────────────────────────────────────────────────
  4 new artifacts | 1 excluded | Bundle: "feature-vector-search-20260407"

Actions: [C]onfirm all  [R]emove item  [A]bort
```

### Step 6: Bundle Assembly and Deploy

Same as project mode. Bundle tags include `["scaffolder", "feature"]` plus the feature context (e.g., `"vector-search"`).

If `--deploy` is set (defaulting to `--project` path), the new artifacts are added to the existing `.claude/` without overwriting existing ones.

## Example Usage

```
# Add vector search to an existing FastAPI project
/scaffold:feature "Add Pinecone vector search with semantic retrieval" \
  --project ./my-project \
  --types skills,agents,mcps \
  --deploy ./my-project

# Scaffold from a feature implementation plan
/scaffold:feature docs/project_plans/implementation_plans/features/vector-search-v1.md \
  --project ./my-project \
  --dry-run
```

## Error Handling

| Error | Behavior |
|-------|----------|
| `.claude/` not found at `--project` path | Warn + proceed with empty exclusion list (treat as new project) |
| API inventory query fails | Fall back to manifest scan; if also fails, proceed with empty exclusion list + warning |
| All candidates excluded | Surface empty preview with explanation; suggest using `/scaffold:project` or `--types` filter |
