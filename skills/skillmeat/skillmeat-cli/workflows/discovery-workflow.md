---
skill: skillmeat-cli
workflow_id: discovery
canonical_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
version: 1.1
updated: 2026-04-14
---

# Discovery Workflow

**Canonical docs for command syntax**: `docs/user/guides/cli/commands.md § "Core Commands"`, `§ "Phase 2: Search Commands"`, `§ "Scoring and Matching"`.

This workflow covers agent-specific patterns for discovery only. Do not duplicate flag syntax here — consult the canonical docs for all `--option` details.

---

## Supported Commands (Live CLI Surface)

| Command | Intent |
|---------|--------|
| `skillmeat list` | List artifacts in collection, optionally filtered by type |
| `skillmeat show NAME` | Show details for a named artifact |
| `skillmeat search QUERY` | Keyword search across collection and marketplace |
| `skillmeat match QUERY` | Confidence-scored search (when match API available) |

> `skillmeat match` is present in the CLI surface but confidence scores are API-internal. Do not guide users toward confidence thresholds as an agent-facing workflow — see SPEC.md BL-3 / BL-8.

---

## Intent → Command Routing

| User Says | Command | Notes |
|-----------|---------|-------|
| "What do I have?", "list my artifacts" | `skillmeat list` | Add `--type skill\|command\|agent` to narrow |
| "Tell me about X" | `skillmeat show <name>` | Add `--type` if name is ambiguous |
| "Find tools for Y", "search for Z" | `skillmeat search "<query>"` | Keyword match |
| "Any duplicates?" | `skillmeat find-duplicates` | See `commands.md § "find-duplicates"` |

---

## Agent Patterns

### Pattern 1: List → Inspect loop

When user wants to browse:

```bash
# Step 1: get overview
skillmeat list --type skill

# Step 2: drill into interesting artifact
skillmeat show <name>
```

Present top 3–5 entries; offer to show more or inspect one by name.

### Pattern 2: Search → Confirm → Add

```bash
# Find candidates
skillmeat search "pdf processing"

# User picks one; confirm before adding
skillmeat show <chosen-name>
# → present details, ask "Add this to your collection?"
skillmeat add skill <source-spec>
```

Never add without explicit user confirmation.

### Pattern 3: Disambiguate by type

When `show <name>` returns ambiguity (multiple types match):

```bash
skillmeat show review --type command
skillmeat show review --type skill
```

Ask user which type they meant before proceeding.

---

## Examples

### Example 1: "What skills do I have?"

```bash
skillmeat list --type skill
```

Present the table; offer to `show` any by name.

### Example 2: "Find something for working with PDFs"

```bash
skillmeat search "pdf"
```

Show top results. If user picks one:

```bash
skillmeat show pdf-processor
# → Ask: "Add pdf-processor to your collection? (yes/no)"
skillmeat add skill anthropics/skills/pdf-processor
```

### Example 3: "Tell me about the canvas skill"

```bash
skillmeat show canvas
```

Relay description, version, deployment locations. Offer to deploy if not yet deployed.

---

## Empty Results Handling

If `skillmeat search` returns nothing:
1. Try broader terms (e.g., "document" instead of "PDF extraction").
2. Suggest `skillmeat list` to browse all.
3. Offer to help the user add a custom skill via `add skill ./local-path`.

Do not suggest `skillmeat match` with confidence thresholds as a fallback — that is an internal API concern, not an agent workflow.

---

## Boundaries

- No confidence scoring guidance — see SPEC.md BL-3.
- No context-boosting — see SPEC.md BL-4.
- No `skillmeat recommend` or `skillmeat discover` — those commands do not exist.
- After discovery, hand off to `deployment-workflow.md` for any add/deploy steps.
