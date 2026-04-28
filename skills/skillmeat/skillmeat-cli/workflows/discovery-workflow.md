---
skill: skillmeat-cli
workflow_id: discovery
canonical_docs:
  - docs/user/guides/cli/commands.md
  - docs/user/guides/cli/reference.md
version: 1.2
updated: 2026-04-27
---

# Discovery Workflow

**Canonical docs for command syntax**: `docs/user/guides/cli/commands.md § "Discovery"`, `§ "Core Commands"`, `§ "Search"`.

This workflow covers agent-specific patterns for artifact discovery only. Do not duplicate flag syntax here — consult the canonical docs for all `--option` details.

---

## Supported Commands (Live CLI Surface)

| Command | Intent |
|---------|--------|
| `skillmeat list` | List artifacts in collection, optionally filtered by type |
| `skillmeat show NAME` | Show details for a named artifact |
| `skillmeat search QUERY` | Keyword search across collection and marketplace |
| `skillmeat discover [INPUT_TEXT]` | AI-powered intent-based discovery across collection, marketplace, and curated web sources |

> `skillmeat discover` calls `/api/v1/discover`. For full flag reference see `commands.md § "Discovery"`.

---

## Intent → Command Routing

| User Says | Command | Notes |
|-----------|---------|-------|
| "What do I have?", "list my artifacts" | `skillmeat list` | Add `--type skill\|command\|agent` to narrow |
| "Tell me about X" | `skillmeat show <name>` | Add `--type` if name is ambiguous |
| "Find tools for Y", "search for Z" | `skillmeat search "<query>"` | Keyword match |
| "Find something that helps me do Y" | `skillmeat discover "<intent>"` | AI-powered; broader than keyword search |
| "Show me agents for code review" | `skillmeat discover "<intent>" --types agent` | Type-filtered AI discovery |
| "What would help with this project?" | `skillmeat discover --file <context-file>` | File-based intent; good for PRD or task descriptions |
| "Any duplicates?" | `skillmeat find-duplicates` | See `commands.md § "find-duplicates"` |

---

## Agent Patterns

### Pattern 1: Keyword search → inspect loop

When the user knows what they want by name or keyword:

```bash
# Step 1: find candidates
skillmeat search "pdf processing"

# Step 2: inspect top result
skillmeat show <name>
```

Present top 3–5 entries; offer to show more or inspect one by name.

### Pattern 2: AI discover → confirm → add

Use `skillmeat discover` when the user describes an intent rather than a keyword.
This reaches across collection, marketplace, and web sources.

```bash
# Discover by natural-language intent
skillmeat discover "help me review Python code for security issues"

# Optionally narrow by type
skillmeat discover "code review" --types agent,skill

# User picks a result; confirm before adding
skillmeat show <chosen-name>
# → present details, ask "Add this to your collection? (yes/no)"
skillmeat add skill <source-spec>
```

Never add or install without explicit user confirmation unless `--yes` was explicitly requested by the user and the source is a verified collection entry.

### Pattern 3: File-based intent discovery

When the user has a PRD, task description, or context file:

```bash
skillmeat discover --file path/to/prd.md --types skill,command
```

Useful when the intent is long or structured. Present results the same way as text-based discovery.

### Pattern 4: Bundle fragment output

When the user wants to capture results as a manifest fragment:

```bash
skillmeat discover "CI/CD automation" --bundle
```

The `--bundle` flag emits a `manifest.toml` fragment to stdout after results. Relay this fragment to the user verbatim; do not modify it. If the user wants to install, proceed to Pattern 5.

### Pattern 5: Interactive install flow

```bash
skillmeat discover "testing utilities" --install
```

`--install` opens an interactive prompt for each result. If the user is in a non-interactive context (CI, background agent), add `--yes` only for verified collection sources. Unverified sources always prompt regardless of `--yes`.

### Pattern 6: Disambiguate by type

When `show <name>` or discover results span multiple types:

```bash
skillmeat show review --type command
skillmeat show review --type skill
```

Ask the user which type they meant before proceeding.

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

### Example 4: "Find agents that could help me with this PRD"

```bash
skillmeat discover --file docs/project_plans/feature-x-prd.md --types agent
```

Present results. If the user picks one, hand off to `deployment-workflow.md`.

### Example 5: "Discover CI tools and give me the manifest fragment"

```bash
skillmeat discover "CI/CD automation tools" --types command,workflow --bundle
```

Relay the manifest fragment verbatim. Ask if the user wants to add any entries to their `manifest.toml`.

---

## Empty Results Handling

If `skillmeat discover` or `skillmeat search` returns nothing:

1. Try broader terms (e.g., "document processing" instead of "PDF extraction with OCR").
2. Remove `--types` filter and try again unrestricted.
3. Suggest `skillmeat list` to browse all locally available artifacts.
4. Offer to help the user add a custom artifact via `add skill ./local-path`.

---

## Boundaries

- No confidence scoring guidance — see SPEC.md BL-3.
- No context-boosting — see SPEC.md BL-4.
- `--max-results` cap is 100; do not suggest values above that.
- After discovery, hand off to `deployment-workflow.md` for any add/deploy steps.
- `skillmeat match` is present in the CLI but confidence scores are API-internal; do not guide users toward confidence thresholds as an agent workflow — see SPEC.md BL-3.
