---
description: Quick MeatyCapture CLI - list/view/search/capture/note/update logs
allowed-tools: [Bash]
---

# MeatyCapture Quick Commands

Default project: skillmeat

## Commands

- List: `meatycapture log list $ARGUMENTS --json`
- View: `meatycapture log view $ARGUMENTS --json`
- Search: `meatycapture log search "$ARGUMENTS" --json`
- Note: `meatycapture log note add $ARGUMENTS`
- Update: `meatycapture log item update $ARGUMENTS`

## Quick Capture (Preferred)

Use `mc-quick.sh` for single-item captures (~50 tokens vs ~200+ for JSON):

```bash
mc-quick.sh TYPE DOMAIN SUBDOMAIN "Title" "Problem" "Goal" [notes...]

# Examples:
mc-quick.sh bug api validation "Fix timeout error" "Sessions expire early" "Extend TTL to 24h"
mc-quick.sh enhancement web ui "Add loading states" "No feedback during load" "Show spinners"
mc-quick.sh idea dx tooling "Auto-generate schemas" "Manual schema writing error-prone" "Generate from types"

# With environment overrides:
MC_PROJECT=other-project MC_PRIORITY=high mc-quick.sh bug cli commands "Title" "Problem" "Goal"
```

**Script location**: `.claude/skills/meatycapture-capture/scripts/mc-quick.sh`

**Environment Variables**: `MC_PROJECT` (default: skillmeat), `MC_PRIORITY` (default: medium), `MC_STATUS` (default: triage)

## Legacy Capture (for complex/batch scenarios)

For advanced fields (context) or batch capture (3+ items), use direct CLI:

```bash
echo '$ARGUMENTS' | meatycapture log create --json
```

## Note Add Usage

```bash
# Add a note to an item
meatycapture log note add <doc-path> <item-id> --content "Note text" [--type TYPE]

# Types: General (default), "Bug Fix Attempt", Validation, Other
meatycapture log note add REQ-20260105-project.md ITEM-01 -c "Fixed by PR #123" -t "Bug Fix Attempt"
```

## Item Update Usage

```bash
# Update item status
meatycapture log item update <doc-path> <item-id> --status done

# Update multiple fields
meatycapture log item update REQ-20260105-project.md ITEM-01 --status in-progress --priority high

# Tag operations
meatycapture log item update doc.md ITEM-01 --tags "tag1,tag2"     # Replace tags
meatycapture log item update doc.md ITEM-01 --add-tags "newtag"   # Add tags
meatycapture log item update doc.md ITEM-01 --remove-tags "oldtag" # Remove tags

# Other fields: --type, --title, --domain, --context
```

## Post-Fix Documentation

After committing a fix, update bug-fixes doc + request-log together:

```bash
.claude/scripts/update-bug-docs.py --commits <sha> --req-log REQ-YYYYMMDD-skillmeat
```

## Batch Filing

For 3+ bugs from JSON/CSV:

```bash
.claude/scripts/batch-file-bugs.sh --input /tmp/bugs.json --project skillmeat
```

**Full spec**: `.claude/specs/script-usage/bug-automation-scripts.md`

Run the appropriate command based on user request.
