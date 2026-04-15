# Project Mode: `/scaffold:project`

Full project scaffold — analyzes context and assembles a whole-project Bundle of artifacts covering all identified capabilities.

## Input Types Accepted

| Input Type | Example | Notes |
|------------|---------|-------|
| PRD file path | `/path/to/prd.md` | Most reliable; structured context |
| Implementation plan path | `/path/to/impl-plan.md` | Alternative; rich with tech choices |
| Project directory path | `/path/to/my-project/` | Analyzer reads key files (README, CLAUDE.md, pyproject.toml, package.json, etc.) |
| Free-text description | `"FastAPI + React SaaS with Postgres, Redis, and GitHub Actions"` | Lowest confidence; triggers interview most often |

The analyzer auto-detects input type from the argument. Paths are resolved relative to cwd if not absolute.

## Pipeline Steps

### Step 1: Invocation

```
/scaffold:project [input] [--types <artifact-types>] [--deploy <path>] [--dry-run]
```

| Flag | Default | Description |
|------|---------|-------------|
| `input` | (prompted) | PRD path, dir path, or free-text string |
| `--types` | all | Comma-separated artifact type filter (e.g., `skills,agents,mcps`) |
| `--deploy <path>` | (none) | Target directory for `skillmeat scaffold` deploy step |
| `--dry-run` | false | Preview only; no Bundle creation or file writes |

### Step 2: Analysis (project-analyzer)

The `project-analyzer` subagent reads the input and extracts an Intent Set YAML.

**Analyzer processing by input type:**

1. **PRD / plan file**: Reads full file (up to 10K tokens; logs warning + truncates if larger). Scans for: tech stack mentions, framework names, architecture patterns, data model keywords, CI/CD indicators, domain terminology.

2. **Project directory**: Reads up to 10 key indicator files in priority order:
   - `CLAUDE.md` / `claude.md`
   - `README.md`
   - `pyproject.toml` / `setup.cfg` / `requirements.txt`
   - `package.json` / `pnpm-lock.yaml`
   - `docker-compose.yml` / `Dockerfile`
   - `docs/` top-level markdown files (first 2)
   - Total token budget: 10K across all files; skip + warn if budget exceeded.

3. **Free text**: Used directly as context. Lower average confidence expected (0.4–0.7 typical).

**Confidence scoring guidelines:**

| Evidence Quality | Confidence Range |
|-----------------|-----------------|
| Explicit tech name in tech stack section | 0.85–0.99 |
| Mentioned multiple times across doc | 0.70–0.85 |
| Single non-prominent mention | 0.50–0.70 |
| Inferred from domain or patterns | 0.30–0.50 |
| Guessed from free text | 0.20–0.45 |

### Step 3: Interview (conditional)

Triggered when:
- `aggregate_confidence < 0.65`, OR
- ≥2 high-priority intents have `confidence < 0.5`

The skill generates ≤3 targeted questions, one per lowest-confidence high-priority intent. Example questions:

- "Your PRD mentions async workers. Are you using Celery, ARQ, or another task queue?"
- "I detected PostgreSQL but also some NoSQL patterns. Will you use both, or only a relational DB?"
- "What CI/CD platform will you use: GitHub Actions, GitLab CI, CircleCI, or another?"

User answers are fed back to the analyzer for a refined Intent Set. Interview runs at most once per scaffold invocation (avoids infinite loops).

### Step 4: Curation (artifact-curator) [Phase 2]

For each intent, the curator:

1. Generates query: `f"{intent.capability} {intent.stack}"`
2. Calls three search legs in parallel (10s timeout each):
   - `GET /api/v1/match?q=<query>&limit=10`
   - `GET /api/v1/artifacts?tags=<capability>&limit=50`
   - `GET /api/v1/marketplace/listings?q=<query>&limit=10` (if enabled)
3. Merges results by `artifact_uuid` (or `source_path` for marketplace)
4. Scores: `0.5×semantic + 0.3×metadata + 0.2×marketplace`
5. Sorts descending; caps at 5 per intent; removes score < 0.3

**Marketplace fallback**: If marketplace returns error or timeout, logs warning and continues with local legs only. `SCAFFOLD_MARKETPLACE_ENABLED=false` disables the leg entirely.

### Step 5: Preview

Displayed before any writes occur:

```
Scaffold Preview — whole-project
─────────────────────────────────────────────────────────────
  #  Type     Name                    Source      Score  Intent
  1  skill    dev-execution           local       0.91   python-backend / fastapi
  2  agent    python-backend-eng      local       0.87   python-backend / fastapi
  3  skill    analyzing-csv           local       0.82   relational-database / postgresql
  4  mcp      postgres-mcp            marketplace 0.76   relational-database / postgresql
  5  agent    ui-engineer-enhanced    local       0.83   react-frontend / nextjs
  ...
─────────────────────────────────────────────────────────────
  12 artifacts selected | Bundle: "scaffold-20260407-abc123"

Actions: [C]onfirm all  [R]emove item  [A]bort
```

The user can remove individual items by number before confirming. Abort exits without writes.

### Step 6: Bundle Assembly (on confirm)

1. `POST /api/v1/bundles` with payload:
   ```json
   {
     "name": "scaffold-20260407-abc123",
     "description": "Generated by project-scaffolder from: <source_summary>",
     "tags": ["scaffolder", "whole-project"],
     "metadata": {"scaffold_run_id": "<id>", "scope_variant": "whole-project"}
   }
   ```
2. `POST /api/v1/bundles/{id}/members` for each artifact, in alphabetical order (type asc, name asc)
3. Intent Set YAML written to `scaffold-intents.yaml` alongside Bundle manifest

### Step 7: Deploy (optional)

If `--deploy <path>` was specified:

```bash
skillmeat scaffold --bundle <bundle_id> --project <path>
```

Uses the existing scaffold CLI path unchanged. Skipped in dry-run mode.

## Dry-Run Mode

`--dry-run` suppresses all write operations:
- No Bundle created via API
- No files written to disk
- Intent Set YAML printed to stdout (not saved)
- Preview displayed normally; user prompted for acknowledgment (not confirmation)

Useful for evaluating recommendations before committing.

## Output

On successful completion:
```
Bundle created: scaffold-20260407-abc123 (12 artifacts)
Intent Set: ~/.skillmeat/collection/bundles/scaffold-20260407-abc123/scaffold-intents.yaml
Deployed to: ./my-project/.claude/  [if --deploy specified]
```

## Error Handling

| Error | Behavior |
|-------|----------|
| API unreachable | Offer dry-run preview with local filesystem search only |
| Input > 10K tokens | Truncate to 10K, log warning, continue |
| Analyzer returns 0 intents | Trigger interview unconditionally |
| All search legs fail | Error with message; suggest checking API is running |
| User aborts at preview | Clean exit; no writes; no Bundle created |
