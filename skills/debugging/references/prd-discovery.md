# PRD Discovery Reference

How to find PRDs, implementation plans, and ADRs related to code affected by a bug.

**When to use**: Comprehensive remediation mode (Complex/Critical bugs), or when investigating design intent.
**When NOT to use**: Simple bugs where the fix is clear and pattern-aligned.

---

## Why Discover PRDs

Complex bugs often reveal gaps between intended design and actual implementation. Finding the relevant PRD tells you:
- What the **intended behavior** was supposed to be
- What **constraints** shaped the original design
- What **architectural decisions** were made and why
- Whether the bug is in the **implementation** or the **design**

The fix should serve the original design intent, not introduce a novel approach.

---

## Discovery Methods

Use in order of efficiency (cheapest first):

### 1. Symbol-Based Discovery (150 tokens)

Map the affected code to its module/layer, then search PRDs:

```bash
# Find module and layer
grep "[affected_function]" ai/symbols-*.json | jq -r '.layer, .file_path'

# Map layer to likely PRD category
# routers → api/ PRDs
# services → core/ PRDs
# repositories → data/ PRDs
# components → web/ PRDs
```

### 2. Path-Based Discovery (200 tokens)

Map file paths to feature areas:

| Affected Path Pattern | Search In |
|----------------------|-----------|
| `skillmeat/api/routers/[name].py` | PRDs mentioning router name or API feature |
| `skillmeat/web/components/[area]/` | PRDs mentioning UI feature area |
| `skillmeat/core/services/[name].py` | PRDs mentioning the service domain |
| `skillmeat/core/repositories/` | PRDs mentioning data/storage features |
| `skillmeat/cache/models/` | PRDs mentioning data model changes |
| `skillmeat/core/workflow/` | PRDs mentioning workflow engine |
| `skillmeat/marketplace/` | PRDs mentioning marketplace features |

```bash
# Search PRDs by component name
grep -rl "[component_name]" docs/project_plans/PRDs/

# Search implementation plans
grep -rl "[component_name]" docs/project_plans/implementation_plans/
```

### 3. Git-Based Discovery (500 tokens)

Trace the file's history to find plan references:

```bash
# Find commits that modified the affected file
git log --oneline -- [affected_file] | head -20

# Look for plan references in commit messages
git log --grep="PRD\|plan\|feat(" -- [affected_file] | head -30

# Find the original implementation commit
git log --diff-filter=A --oneline -- [affected_file]
```

### 4. Direct Search (1-2K tokens)

Search across all planning documents:

```bash
# Search PRDs
grep -rl "[keyword]" docs/project_plans/PRDs/

# Search implementation plans
grep -rl "[keyword]" docs/project_plans/implementation_plans/

# Search ADRs
grep -rl "[keyword]" docs/dev/architecture/

# Search spikes
grep -rl "[keyword]" docs/dev/architecture/spikes/
```

### 5. Artifact Tracking Query

```bash
# Search by keyword across all tracked artifacts
python .claude/skills/artifact-tracking/scripts/query_artifacts.py --type prd --search "[keyword]"

# Query by status
python .claude/skills/artifact-tracking/scripts/query_artifacts.py --type implementation-plan --status in-progress
```

---

## What to Extract

From each discovered document, note:

| Document Type | Extract |
|---------------|---------|
| **PRD** | Intended behavior, user stories, acceptance criteria, constraints |
| **Implementation Plan** | Architecture decisions, layer assignments, phase structure |
| **ADR** | Why specific patterns were chosen, trade-offs considered |
| **Spike** | Technical analysis, alternatives evaluated, recommendations |
| **Progress File** | What was actually implemented vs planned |

---

## Linking in Remediation Plans

When creating a formal remediation plan:

```yaml
# In frontmatter
prd_ref: "docs/project_plans/PRDs/[category]/[name]-v1.md"
related_documents:
  - "docs/project_plans/implementation_plans/[category]/[name]-v1.md"
  - "docs/dev/architecture/adrs/[number]-[name].md"
```

In the plan body, include a **Design Intent** section:

```markdown
## Design Intent

**Related PRD**: [title] ([path])
**Original intent**: [what the PRD specified for this component]
**Current state**: [how the implementation diverges]
**Bug classification**: [implementation error | missing requirement | design gap]
```

---

## Edge Cases

### No PRD Found

Common for older code or infrastructure-level components.

- Document the gap: "No PRD covers this component"
- Fix based on codebase patterns — find similar code and match its approach
- Consider whether a PRD should be created for this area (note in request log)

### Multiple PRDs Found

- Link all in `related_documents`
- Identify the **most authoritative** (usually the most recent, or the one specifically about this feature)
- Use `prd_ref` for the primary, others as `related_documents`

### PRD is Outdated or Superseded

- Check the PRD's `status` field — if `superseded`, find the replacement
- Note the status in your analysis
- Use **current code patterns** as authority over outdated PRD
- The fix should match what the codebase actually does, not what an obsolete plan said

### PRD Conflicts with Implementation

- This likely means the bug is actually a feature gap or design drift
- Document both the PRD intent and actual implementation
- The remediation plan should address whether to fix toward the PRD or update the PRD
- May require escalation to `lead-architect` for architectural decision
