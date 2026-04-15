---
description: Execute phase development with YAML-driven orchestration
argument-hint: "<phase-number> [--plan=path] [--dry-run] [--plan-structure=unified|independent] [--skip-progress-init] [--resume-from=batch_N] [--execution-model=batch-parallel|sequential|agent-team]"
allowed-tools: Read, Grep, Glob, Edit, MultiEdit, Write, Skill,
  Bash(git:*), Bash(gh:*), Bash(pnpm:*), Bash(pytest:*),
  Bash(uv:*), Bash(pre-commit:*)
---

# Execute Phase

Execute phase `$ARGUMENTS` using YAML-driven orchestration.

## CLI Flags

| Flag | Overrides | Purpose |
|------|-----------|---------|
| `--plan=<path>` | (default: auto-resolved) | Explicit path to implementation plan |
| `--dry-run` | (runtime only) | Show execution plan without delegating |
| `--plan-structure=<value>` | `plan_structure` in plan frontmatter | Override plan structure detection (`unified` or `independent`) |
| `--skip-progress-init` | Sets `progress_init=pre-created` | Assume progress file already exists; skip creation |
| `--resume-from=batch_N` | (runtime only) | Skip completed batches and start from the specified batch |
| `--execution-model=<value>` | `execution_model` in progress frontmatter | Override delegation pattern (`batch-parallel`, `sequential`, `agent-team`) |

## Step 0: Load Required Skills (MANDATORY)

**Execute these Skill tool calls NOW before any other action:**

```text
Skill("dev-execution")
Skill("artifact-tracking")
```

⚠️ **DO NOT PROCEED** until both skills are loaded. The guidance below depends on skill content.

---

## Execution Mode

Reference: [.claude/skills/dev-execution/modes/phase-execution.md]

## Actions

### 1. Initialize Context

Extract `{PRD_NAME}` and `{PHASE_NUM}` from `$ARGUMENTS`.

**Resolve progress directory (discovery-first):**

The progress directory may or may not include a version suffix (e.g., `-v1`). Always search for existing directories before constructing a path:

1. Derive `{BASE_SLUG}` by stripping any version suffix (`-v1`, `-v2`, etc.) from `{PRD_NAME}`
2. Search for existing progress directories matching either variant:
   ```bash
   ls -d .claude/progress/${BASE_SLUG}*/ 2>/dev/null
   ```
3. **If exactly one match**: Use that directory as `{PROGRESS_DIR}`
4. **If multiple matches** (e.g., both `foo/` and `foo-v1/`): Filter to the one matching the version in `{PRD_NAME}`. If `{PRD_NAME}` has no version, prefer the versionless directory.
5. **If no match**: Create new directory using `{PRD_NAME}` as-is

Set `progress_file="${PROGRESS_DIR}/phase-${PHASE_NUM}-progress.md"`

If progress file is missing: `Task("artifact-tracker", "Create Phase ${PHASE_NUM} progress for ${PRD_NAME}")`

### 2. Read Progress YAML (Token-Efficient)

```bash
head -100 ${progress_file} | sed -n '/^---$/,/^---$/p'
```

Identify current batch from `parallelization` field.

Extract typed refs and execution metadata from YAML frontmatter:
- **Typed refs**: `spike_ref`, `adr_refs`, `charter_ref`, `test_plan_ref`
- **Execution metadata**: `execution_model`, `plan_structure`

If `--execution-model` or `--plan-structure` flags were provided, they override the frontmatter values.

If `spike_ref` is set and the file exists, include SPIKE findings as brief context lines in subagent prompts. If `adr_refs` has entries, note relevant ADRs for architectural alignment. If `plan_structure` is `independent`, look for the phase plan at `{plan_dir}/phase-${PHASE_NUM}-plan.md` instead of the unified plan file.

See full guidance: [.claude/skills/dev-execution/modes/phase-execution.md] → "Typed Reference Auto-Loading", "Execution Model Routing", "Plan Structure Handling"

### 2.5. Symbol Context Loading

Before executing tasks, load relevant symbols for the phase domain:

**Backend tasks**:
```bash
jq '.symbols[] | select(.layer == "service" or .layer == "repository")' /Users/miethe/dev/homelab/development/skillmeat/ai/symbols-api.json
```

**Frontend tasks**:
```bash
jq '.symbols[] | select(.type == "component" or .type == "hook")' /Users/miethe/dev/homelab/development/skillmeat/ai/symbols-web.json
```

**Targeted by feature**:
```bash
jq '.symbols[] | select(.name | contains("[FeatureDomain]"))' /Users/miethe/dev/homelab/development/skillmeat/ai/symbols-*.json
```

This provides pattern context with 96% token savings vs reading full files.

### 3. Batch Delegation

Load patterns: [.claude/skills/dev-execution/orchestration/batch-delegation.md]

Execute batch tasks in parallel (single message with multiple Task() calls).

### 4. Continuous Testing

```bash
pnpm test && pnpm typecheck && pnpm lint
```

### 5. Update Tracking

After each task: `Task("artifact-tracker", "Update ${PRD_NAME} phase ${PHASE_NUM}: Mark TASK-X.Y complete")`

Update request-log if applicable: `meatycapture log item update DOC ITEM --status done`

### 6. Milestone Validation

Load criteria: [.claude/skills/dev-execution/validation/milestone-checks.md]

### 7. Post-Phase Findings Triage

After all tasks complete, run the Route 7 findings triage to surface any agent-generated findings
that are missing required frontmatter:

```bash
python .claude/skills/plan-status/scripts/plan-status-report.py --route7 --include-reports
```

Warn the user if findings under `.claude/findings/` lack the required frontmatter stub (see
[.claude/skills/dev-execution/modes/phase-execution.md] → "Agent Findings Frontmatter").

## Quality Gates

- [ ] All batch tasks complete
- [ ] Tests pass
- [ ] No TypeScript errors
- [ ] Progress artifact updated
- [ ] Route 7 findings triage clean (no missing-frontmatter warnings)

## Skill References

- Phase execution: [.claude/skills/dev-execution/modes/phase-execution.md]
- Orchestration: [.claude/skills/dev-execution/orchestration/]
- Validation: [.claude/skills/dev-execution/validation/]
- Artifact integration: [.claude/skills/dev-execution/integrations/artifact-tracking.md]
- Request-log: [.claude/skills/dev-execution/integrations/request-log-workflow.md]
