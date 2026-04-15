---
skill: skillmeat-cli
workflow_id: error-handling
canonical_docs:
  - docs/user/guides/cli/reference.md
version: 1.1
updated: 2026-04-14
---

# Error Handling Workflow

**Canonical docs for exit codes**: `docs/user/guides/cli/reference.md § "Exit Codes"`. Cross-cutting — applies to all other workflow files.

This workflow covers detection and recovery patterns for agents. Do not duplicate flag syntax from canonical docs.

---

## Exit Code Reference

From `skillmeat/exit_codes.py` (authoritative source):

| Code | Name | When |
|------|------|------|
| `0` | `SUCCESS` | Operation completed |
| `1` | `GENERAL_ERROR` | Unspecified failure |
| `2` | `INVALID_USAGE` | Bad arguments or flags |
| `3` | `NOT_FOUND` | Artifact, collection, or project not found |
| `4` | `CONFLICT` | Already exists, version conflict |
| `5` | `PERMISSION_DENIED` | Permission denied, auth required |

**Usage in bash**:

```bash
skillmeat add skill anthropics/skills/canvas || {
  case $? in
    3) echo "Not found — check source path" ;;
    4) echo "Already in collection — use --force to overwrite" ;;
    5) echo "Permission denied — check github-token" ;;
    *) echo "Error $? — check logs" ;;
  esac
}
```

---

## Error Categories and Recovery

### Network Errors

**Rate limit** (`403` with `X-RateLimit-Remaining: 0`):

```bash
skillmeat config set github-token <token>
```

Unauthenticated limit: 60 req/hr. With token: 5,000 req/hr. Token format: `ghp_...` (fine-grained) or 40-char hex (classic). Create at <https://github.com/settings/tokens>.

**Timeout / connection refused**:
- Retry the command (up to 3 attempts, wait 2–5 s between)
- Check `https://www.githubstatus.com`

---

### Authentication Errors (`exit 5`)

**Invalid token** (`401`):

```bash
skillmeat config set github-token <new-token>
```

Confirm token has `repo` scope for private repos.

**Private repo returns 404**: GitHub returns 404 (not 403) for inaccessible repos. Treat 404 from `add` as a potential auth issue when the path looks correct.

---

### Artifact Errors

| Situation | Detection | Recovery |
|-----------|-----------|----------|
| Not found | `exit 3` | Verify source path; try `skillmeat search <name>` |
| Ambiguous name | Multiple matches in output | Add `--type skill\|command\|agent` to disambiguate |
| Already exists | `exit 4` | Use `--force` to overwrite or `skillmeat update <name>` |
| Invalid format | YAML parse error in output | Contact artifact author; check frontmatter with `yamllint` |
| Version not found | Error message lists available versions | Use `@latest` or a valid tag from the list |

---

### File System Errors

**Permission denied** writing to `.claude/`:

```bash
ls -la .claude/          # check ownership
mkdir -p .claude/skills/ # ensure dir exists
```

Do not use `sudo` for SkillMeat operations. Use `--dangerously-skip-permissions` only when explicitly requested.

**Disk full**:

```bash
skillmeat cache clear    # free cache space
```

Check `df -h ~/.skillmeat`. Remove old snapshots via `skillmeat snapshot list` then delete as needed (see `versioning-workflow.md`).

---

### Parse Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `TOMLDecodeError` on manifest | Corrupt `manifest.toml` | Open in editor; validate with `python -c "import tomllib; tomllib.load(open('manifest.toml','rb'))"` |
| `JSONDecodeError` on `--json` output | Command returned error message before JSON | Read the error text; re-run without `--json` to see formatted output |
| YAML frontmatter error | Artifact has malformed frontmatter | Report to artifact author; `yamllint SKILL.md` to confirm |

---

### Database Errors (Web UI / API server)

**SQLite locked** (`database is locked`):

```bash
pkill -f "skillmeat web"
skillmeat web dev        # restart
```

Only one process should write to the SQLite DB at a time.

**Alembic migration failed**: See `deploy/CLAUDE.md` for migration rollback procedure.

---

## General Recovery Procedure

1. Capture full error output including exit code.
2. Identify category from the tables above.
3. Apply category-specific recovery.
4. If unresolved: run `skillmeat --version` and check `~/.skillmeat/logs/skillmeat.log`.

**Debug logging**:

```bash
SKILLMEAT_LOG_LEVEL=DEBUG skillmeat <command>
```

**Backup before destructive operations**:

```bash
cp -r ~/.skillmeat ~/.skillmeat.backup
```

Restore from snapshot when available — see `./versioning-workflow.md`.

---

## Quick Reference

| Pattern | Error Signal | Fix Command |
|---------|-------------|-------------|
| Rate limited | `exit 1`, `403`, `RateLimit` | `skillmeat config set github-token <t>` |
| Token invalid | `exit 5`, `401` | `skillmeat config set github-token <new>` |
| Not found | `exit 3` | `skillmeat search <name>` |
| Already exists | `exit 4` | `skillmeat add ... --force` |
| Permission denied | `exit 5` | Check `.claude/` permissions |
| Network timeout | `exit 1`, `Timeout` | Retry; check `githubstatus.com` |
| DB locked | `database is locked` | Restart web server |
