---
name: bob-shell-delegate
description: Delegate bounded subtasks to IBM Bob Shell CLI. Use when the user wants to use Bob, delegate to Bob, run Bob for drafting/scaffolding/exploration, or compare Claude Code work with Bob output. Do NOT use for architecture-heavy integration work or cross-layer backend changes.
---

# Bob Shell Delegate

Disciplined workflow for invoking IBM Bob through Bob Shell CLI for bounded subtasks. Bob is a fast secondary engineer, not an autonomous senior engineer. Use Bob for speed where correctness can be cheaply verified.

## Bob Selection Policy

### Good fit — delegate to Bob

- Drafting documentation, migration notes, reports, summaries
- Generating boilerplate, scaffolding, DTOs, serializers
- First-pass tests where the real contract is already known
- Exploring multiple wording or implementation variants
- Bounded refactors in isolated files
- Non-critical research or inventory tasks Claude Code will validate

### Bad fit — keep in Claude Code

- Defining new storage or repository boundaries
- Cross-layer backend integration (ports, repositories, routers, services)
- End-to-end phase work without strict scope
- Tasks where passing tests can be achieved by mocking the wrong seam
- High-trust tasks requiring deep conformity with existing architecture

If the user asks to delegate a bad-fit task, narrow the scope or push back before proceeding.

## Runtime Requirements

Bob Shell requires **Node.js 22+** (uses `--disable-sigusr1` flag unsupported in earlier versions). If the environment defaults to an older Node, use `mise` to run with the correct version:

```bash
# Direct invocation (if Node 22+ is the default)
bob -p "..."

# Via mise (when default Node is < 22)
mise exec node@22 -- bob -p "..."
```

Detection sequence: run `bob --version` first. If it fails with `bad option: --disable-sigusr1`, retry with the `mise exec node@22 --` wrapper.

## Single-Shot Only (from Claude Code)

Bob supports two session modes: interactive REPL (`bob`) and single-shot (`bob -p "..."`). **From Claude Code, only single-shot is viable.** The interactive REPL requires stdin input that Claude Code's Bash tool cannot provide mid-session.

Each `bob -p` invocation is stateless — no memory of prior calls, no way to "continue."

Implications:
- **Single-prompt scope**: Pack all context (file paths, criteria, constraints) into one `bob -p` call. Do not plan multi-turn workflows.
- **Large reviews**: Split into independent self-contained prompts (e.g., one per component) rather than sequential dependent prompts.
- **No follow-ups**: If Bob's output is incomplete, re-invoke with a refined prompt that includes the missing context — don't try to "continue."
- **Interactive Bob is human-only**: If the user wants a multi-turn Bob session, suggest they run `! mise exec node@22 -- bob` directly in the terminal.

## Required Workflow

1. **Confirm task fit** — check selection policy above; if bad fit, explain why and propose a narrowed scope
2. **Detect Bob availability** — run `which bob`; if not found, stop and show the fallback message below. If found, verify it runs (`bob --version`); if Node version error, retry with `mise x node@22 --` wrapper.
3. **Choose execution mode** — non-interactive (`bob -p`) for bounded work (default); interactive (`bob`) only for exploratory tasks that benefit from conversation
4. **Build bounded prompt** — use one of the three templates below; fill every bracketed field
5. **Invoke Bob** — run the assembled command
6. **Capture output** — save to a draft file or diff; do not apply directly to source
7. **Validate** — run through the validation checklist below
8. **Integrate, salvage, or discard** — rejection is a valid and expected outcome

## Prompt Templates

### Template 1: Bounded Drafting

For docs, summaries, boilerplate, isolated file work.

```bash
bob -p "Task: [exact task]
Scope: Only files in [path]
Output format: [format]
Do not modify any files outside the stated scope.
Do not invent new interfaces or abstractions." > draft-output.md
```

### Template 2: Constrained Implementation

For limited code generation where real contracts exist.

```bash
bob --chat-mode=code -p "Task: [task]
You MUST verify every called method against these concrete implementations:
- [file:function signatures to respect]
Stop and report any contract mismatches BEFORE writing code.
Do not invent repository helpers or port abstractions.
Do not create mocked tests that bypass real integration seams.
Required: tests must exercise the real [adapter/service/repo] interface.
Files you may edit: [explicit list]" --yolo
```

### Template 3: Exploratory Sidecar

For low-risk exploration while Claude Code owns integration.

```bash
bob -p "Explore [N] implementation options for [task].
For each option provide: approach summary, pros/cons, rough code sketch.
Do NOT implement a final version.
Do NOT modify any project files.
This is exploratory only - Claude Code will make the final decision."
```

## Validation Checklist

After Bob completes, Claude Code must verify:

- [ ] No contract drift — methods match real signatures in the codebase
- [ ] No invented abstractions — Bob did not create new helpers, ports, or repos
- [ ] Tests exercise real seams — not mock-only bypasses
- [ ] No overclaiming test completeness
- [ ] Output follows repo conventions (file structure, naming, patterns)
- [ ] No files modified outside the stated scope

## Integration Decision

- **Accept** — output passes all validation checks; apply to source
- **Partial salvage** — extract usable parts, discard the rest, finish locally
- **Reject** — validation failures on critical items; restart entirely in Claude Code

Rejection is a valid and expected outcome. Do not force-integrate Bob output that fails validation.

## Anti-Patterns (from CCDash Phase 1 Review)

- Bob passed tests by mocking the wrong layer — always verify test seams before accepting
- Bob created repo helpers that did not match real interfaces — always pin to concrete implementations in the prompt
- Bob generated high volume but missed the real integration boundary — always constrain scope explicitly

## Fallback

If `bob` is not installed:

```
Bob Shell is not available in this environment.
Install: https://bob.ibm.com/docs/shell/getting-started/install-and-setup
Alternatively, Claude Code can handle this task directly.
```

If `bob` is installed but fails with a Node version error:

```
Bob Shell requires Node.js 22+. Current Node does not support --disable-sigusr1.
Try: mise x node@22 -- bash -c 'bob --version'
If mise is not available, upgrade Node to 22+ or install mise: https://mise.jdx.dev
```

## Reference Files

- `references/bob-shell-overview.md` — Bob Shell capabilities and session types
- `references/bob-shell-invocation.md` — CLI usage patterns and commands
- `references/bob-shell-safety.md` — Sandboxing, trusted folders, security
- `references/bob-selection-guidance.md` — Strengths, weaknesses, use case guidance
