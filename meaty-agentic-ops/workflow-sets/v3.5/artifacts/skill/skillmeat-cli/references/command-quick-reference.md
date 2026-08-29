# SkillMeat CLI Quick Reference

Condensed command reference for artifact and memory workflows.

## Command Groups Overview

| Group | Purpose | Key Commands |
|---|---|---|
| (root) | Core operations | `add`, `deploy`, `list`, `show`, `search` |
| `collection` | Multi-collection | `create`, `list`, `use` |
| `sync` | Updates and drift | `check`, `pull`, `preview` |
| `bundle` | Sharing | `create`, `import`, `inspect` |
| `mcp` | MCP servers | `add`, `list`, `deploy`, `health` |
| `context` | Context entities | `add`, `list`, `show`, `deploy` |
| `memory` | Memory lifecycle + packs | `item`, `module`, `pack`, `extract`, `search` |

---

## Artifact Operations

```bash
skillmeat search "<query>" --type skill
skillmeat add skill <source>
skillmeat deploy <artifact-name>
skillmeat list
skillmeat show <artifact-name>
skillmeat remove <artifact-name>
```

---

## Memory Operations

## `memory item`

**Valid memory types**: `decision` | `constraint` | `gotcha` | `style_rule` | `learning`

```bash
skillmeat memory item create --project <project> --type learning --content "..." --confidence 0.85 --status candidate --anchor "path:type:start-end"
skillmeat memory item list --project <project> --status candidate --type gotcha
skillmeat memory item show <item-id>
skillmeat memory item update <item-id> --content "..." --confidence 0.9
skillmeat memory item delete <item-id>
skillmeat memory item promote <item-id> --reason "validated"
skillmeat memory item deprecate <item-id> --reason "obsolete"
skillmeat memory item merge --source <id> --target <id> --strategy combine --merged-content "..."
skillmeat memory item bulk-promote --ids <id1,id2,id3>
skillmeat memory item bulk-deprecate --ids <id1,id2,id3>
```

Anchor and provenance examples:

```bash
skillmeat memory item create --project <project> \
  --type learning \
  --content "..." \
  --confidence 0.85 \
  --status candidate \
  --anchor "skillmeat/core/services/memory_service.py:code:120-220" \
  --anchor "docs/project_plans/implementation_plans/features/memory-anchors-provenance-v1.md:doc" \
  --provenance-branch "<branch>" \
  --provenance-commit "<sha>" \
  --provenance-agent-type "<agent>" \
  --provenance-model "<model>"
```

`--anchor` format: `path:type` or `path:type:start-end`; types are `code|test|doc|config|plan`.

### API Fallback (when CLI `memory item create` returns 422/400)

The CLI `--project` flag may fail to resolve project names for write operations. Use the API directly with the base64-encoded project ID.

```bash
# SkillMeat project ID (stable):
PROJECT_ID="L1VzZXJzL21pZXRoZS9kZXYvaG9tZWxhYi9kZXZlbG9wbWVudC9za2lsbG1lYXQ="

curl -s "http://localhost:8080/api/v1/memory-items?project_id=$PROJECT_ID" \
  -X POST -H "Content-Type: application/json" -d '{
  "type": "learning",
  "content": "Your learning here",
  "confidence": 0.85,
  "status": "candidate",
  "anchors": ["skillmeat/path/to/file.py:code", "skillmeat/other/file.ts:code:100-150"]
}'

# Verify:
curl -s "http://localhost:8080/api/v1/memory-items?project_id=$PROJECT_ID&status=candidate"
```

**API gotchas**: Anchors must be **strings** (`"path:type"`), not objects. The `type` field is required and must be one of the 5 valid types above.

## `memory module`

```bash
skillmeat memory module create --project <project> --name "API Debug" --types decision,constraint,gotcha --min-confidence 0.7
skillmeat memory module list --project <project>
skillmeat memory module show <module-id>
skillmeat memory module update <module-id> --priority 80
skillmeat memory module add-item <module-id> --item <item-id> --ordering 10
skillmeat memory module remove-item <module-id> --item <item-id>
skillmeat memory module list-items <module-id>
skillmeat memory module duplicate <module-id> --name "API Debug v2"
skillmeat memory module delete <module-id>
```

## `memory pack`

```bash
skillmeat memory pack preview --project <project> --module <module-id> --budget 4000 --json
skillmeat memory pack generate --project <project> --module <module-id> --budget 4000 --output ./context-pack.md
```

## `memory extract`

```bash
skillmeat memory extract preview --project <project> --run-log ./run.log --profile balanced
skillmeat memory extract apply --project <project> --run-log ./run.log --min-confidence 0.65
```

## `memory search`

```bash
skillmeat memory search "oauth timeout" --project <project>
skillmeat memory search "postgres migration lock" --all-projects
```

---

## JSON Output Guidance

Use `--json` whenever output must be consumed by agents/scripts.

Recommended commands:

```bash
skillmeat list --json
skillmeat search "<query>" --json
skillmeat memory item list --project <project> --json
skillmeat memory pack preview --project <project> --json
```

---

## Validation Commands

```bash
skillmeat --help
skillmeat memory --help
skillmeat memory item --help
```
