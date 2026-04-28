# Bob Shell Delegate

A Claude Code skill that provides a disciplined workflow for delegating bounded subtasks to IBM Bob Shell CLI. Bob is treated as a **fast secondary engineer** — excellent for speed on constrained tasks where correctness can be cheaply verified, but inappropriate for architecture-heavy work.

## Overview

Bob Shell Delegate is not a general-purpose integration with Bob. It's an **opinionated workflow** that lets you:

- Delegate tasks to Bob where his strengths apply (boilerplate, documentation, exploration)
- Maintain strict scope boundaries to avoid architectural drift
- Validate Bob's output before integration
- Fall back to Claude Code when Bob is not a good fit

Think of Bob as a specialist contractor for specific job types, not an autonomous senior engineer.

## When to Use Bob

### Good Fit (Delegate to Bob)

| Task Type | Why Bob Works |
|-----------|---------------|
| Drafting documentation | High volume, low integration risk |
| Generating boilerplate | Repetitive, well-defined output |
| Writing DTOs/serializers | Schema-driven, bounded |
| First-pass tests (contract known) | Speed; you validate seams afterward |
| Migration notes, reports, summaries | Prose generation strength |
| Exploring implementation variants | Cheap parallel exploration |
| Bounded refactors in isolated files | Clear scope, easy to validate |
| Non-critical research or inventory | Claude Code validates results |

### Bad Fit (Keep in Claude Code)

| Task Type | Why Bob Struggles |
|-----------|-------------------|
| Defining storage or repository boundaries | Needs deep architecture context |
| Cross-layer backend integration | Misses real integration boundaries |
| End-to-end phase work | Scope too broad, easy to drift |
| Mock-heavy tests | May mock the wrong seam and claim success |
| Architecture-critical conformity | Requires intimate codebase knowledge |

**Rule of thumb**: If the task touches architecture seams, repository contracts, or depends on understanding how multiple layers interact, keep it in Claude Code.

## Quick Start

### 1. Confirm the task fits

Review the "Good Fit" / "Bad Fit" tables above. If uncertain, ask: *Can correctness be cheaply verified afterward?*

### 2. Check Bob is available

```bash
bob --version
```

If not found, install via https://bob.ibm.com/docs/shell/getting-started/install-and-setup

If Node version error appears, see [Runtime Requirements](#runtime-requirements) below.

### 3. Build your prompt

Use one of three templates:

**Bounded Drafting** (docs, boilerplate, isolated files):
```bash
bob -p "Task: Generate TypeScript DTOs for the User schema
Scope: Only create types in types/user.ts
Output format: TypeScript interfaces with JSDoc comments
Do not modify any other files.
Do not invent new abstractions."
```

**Constrained Implementation** (limited code generation with strict contracts):
```bash
bob --chat-mode=code -p "Task: Implement UserRepository.findById()
You MUST respect these signatures:
- Repository<T> interface in core/interfaces/repository.ts
- Database query methods in core/db/query.ts
Do not invent new helpers or abstractions.
Do not create tests that only mock the interface.
Files you may edit: core/repositories/user.ts
Test file: core/repositories/__tests__/user.test.ts" --yolo
```

**Exploratory Sidecar** (low-risk exploration while you own integration):
```bash
bob -p "Explore 3 approaches for caching user sessions.
For each option provide: approach summary, pros/cons, rough code sketch.
Do NOT implement a final version.
Do NOT modify any project files.
Claude Code will make the final decision."
```

### 4. Run and capture

```bash
bob -p "..." > draft-output.txt
```

### 5. Validate output

Check against the validation checklist (see [Validation](#validation) below). If Bob passes, integrate. If not, salvage what's usable or restart in Claude Code.

## Runtime Requirements

Bob Shell requires **Node.js 22+** (uses the `--disable-sigusr1` flag, unsupported in earlier versions).

**Detection sequence**:

```bash
# 1. Try direct invocation
bob --version

# 2. If Node version error appears, use mise wrapper
mise exec node@22 -- bob --version

# 3. All subsequent invocations with older Node defaults should use the wrapper
mise exec node@22 -- bob -p "..."
```

**If Bob is not installed**, stop and show the user the installation link: https://bob.ibm.com/docs/shell/getting-started/install-and-setup

**If Node 22+ is unavailable**, suggest the user upgrade Node or install `mise` (https://mise.jdx.dev).

## Full Workflow

1. **Confirm task fit** — check selection policy; if bad fit, explain why or propose narrowed scope
2. **Detect Bob availability** — run `which bob` and `bob --version`; handle Node version issues
3. **Choose mode** — non-interactive (`bob -p`) for bounded work (default)
4. **Build bounded prompt** — use one of three templates; fill every bracketed field
5. **Invoke Bob** — run the command; capture output to a draft file
6. **Capture output** — save to `draft-*.txt` or `draft-*.md`; do not apply directly to source
7. **Validate** — run through checklist below
8. **Integrate, salvage, or discard** — rejection is valid and expected

## Validation Checklist

After Bob completes, you (Claude Code) must verify:

- [ ] **No contract drift** — methods match real signatures in the codebase (check files Bob referenced)
- [ ] **No invented abstractions** — Bob did not create new helpers, ports, or repositories not discussed in the prompt
- [ ] **Tests exercise real seams** — if tests are included, verify they use real adapters/repositories, not mocks
- [ ] **No overclaiming** — tests claim only what they verify
- [ ] **Follows conventions** — output matches repo file structure, naming, and patterns
- [ ] **Scope respected** — no files modified outside the stated scope

**Failure on any critical item** = restart entirely in Claude Code. **Partial salvage** = extract usable parts, discard the rest, finish locally. **Full acceptance** = apply as-is to source.

## Key Design Principles

### Single-Shot Only

From Claude Code, only the `bob -p "..."` (single-shot) mode is viable. The interactive REPL (`bob` by itself) requires stdin input that the Bash tool cannot provide mid-session.

Implications:
- **No multi-turn workflows** — pack all context into one call
- **Large tasks must be split** — one `bob -p` per independent component, not a sequence
- **No "continue" capability** — if output is incomplete, re-invoke with a refined prompt
- **Interactive Bob is human-only** — if the user wants a multi-turn session, suggest they run `bob` directly in their terminal

### Output Goes to Draft Files

Bob's output never applies directly to source. Always:
1. Capture to a draft file (`draft-*.md`, `draft-*.py`, etc.)
2. Validate the output
3. Decide: integrate, salvage, or discard
4. Apply the result (if accepted) manually to source

This prevents accidental corruption and makes validation transparent.

### Rejection is Valid

Do not force-integrate Bob output that fails validation. The whole point of the workflow is fast exploration with cheap verification. If it doesn't pass, it's faster to restart in Claude Code than to debug Bob's architectural misunderstandings.

## Anti-Patterns Learned

From production experience:

- **Bob passed tests by mocking the wrong layer** — always verify test seams use real integrations, not mocks
- **Bob created repo helpers that didn't match real interfaces** — always pin Bob to concrete implementation signatures in your prompt
- **Bob generated high volume but missed the real integration boundary** — always constrain scope explicitly

## Reference Materials

For deeper details, see:

- `references/bob-shell-overview.md` — Bob Shell capabilities and session types
- `references/bob-shell-invocation.md` — CLI usage patterns and advanced commands
- `references/bob-shell-safety.md` — Sandboxing, trusted folders, security notes
- `references/bob-selection-guidance.md` — Bob's strengths/weaknesses, detailed use case guidance

## Comparison: Bob vs Claude Code

| Aspect | Bob Shell | Claude Code |
|--------|-----------|-------------|
| Session model | Single-shot or interactive | Always full execution |
| Speed | Very fast (constrained mode) | Slower but more thorough |
| Scope enforcement | `--yolo` flag + explicit prompt | Built-in orchestration |
| Test validation | You verify seams | Integrated with test runners |
| Integration risk | Higher (tight validation needed) | Lower (Opus owns architecture) |
| Best for | Boilerplate, exploration, drafts | Core logic, integration, validation |

## Fallback Messages

**If Bob is not installed:**
```
Bob Shell is not available in this environment.
Install: https://bob.ibm.com/docs/shell/getting-started/install-and-setup
Alternatively, Claude Code can handle this task directly.
```

**If Bob is installed but Node version is too old:**
```
Bob Shell requires Node.js 22+. Current Node does not support --disable-sigusr1.
Try: mise x node@22 -- bash -c 'bob --version'
If mise is not available, upgrade Node to 22+ or install mise: https://mise.jdx.dev
```

## When to Add This Skill

Add **bob-shell-delegate** to your collection if:

- Your team uses IBM Bob Shell and wants a disciplined Claude Code integration
- You want structured validation before integrating Bob output
- You want clear boundaries on what Bob should and shouldn't do
- You value fast exploration with cheap verification

Do **not** add this skill if:

- Your team doesn't use Bob Shell
- You prefer autonomous agent workflows without delegation
- You need tight architectural control on all generated code

---

**Source**: [SKILL.md](SKILL.md)  
**References**: See `references/` directory for detailed guides
