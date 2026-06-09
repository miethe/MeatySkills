---
name: ica-delegate
description: >-
  Delegate bounded agentic work to IBM ICA-provisioned Claude instances via ~/ica-claude.sh.
  Use when offloading parallel subtasks, accessing free-tier models for mechanical work,
  or cost-shifting bounded tasks to a secondary subscription.
version: 2.2
app_version: "2026-06-08"
updated: 2026-06-08
spec: ./SPEC.md
---

# ICA Delegate

Delegate bounded work to a secondary Claude subscription accessed through the IBM ICA gateway. The transport is `~/ica-claude.sh -p "prompt"` with model, turn, and output flags. Each invocation is independent by default — no shared state with the calling session.

## When To Use

| Scenario | Why Delegate |
|----------|--------------|
| Parallel grunt work that doesn't need the current session's context | Offload without blocking the primary session |
| Mechanical tasks (extraction, scaffolding, boilerplate) | Cost-shift to free-tier models |
| Fan-out: multiple independent bounded subtasks | Run concurrently, aggregate results |
| Second-opinion generation or review on isolated code/docs | Fresh context, unbiased assessment |
| Bounded subtasks with clear deliverables fitting <50k token prompts | Clean separation of concerns |
| Large-context analysis requiring >100k–800k tokens of input (use `[1m]` model) | Offload massive context work while preserving the primary session's context budget |

## When NOT To Use

| Anti-Pattern | Reason |
|--------------|--------|
| Tasks requiring the current session's MCP tools, memory, or project context | Delegates cannot access the calling session's MCP servers |
| Tasks requiring more than 200k context (standard models only) | Standard models hard-capped at 200k; use `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) for tasks up to ~800k tokens |
| Interactive or multi-turn conversation with the user | Each invocation is a single Bash call; not interactive |
| Tasks requiring models unavailable on the gateway | Check model inventory first |
| Work that needs the primary session's file-edit capabilities | Delegate reads file paths, not edits in the calling workspace |

## Confidence Anchor

| Check | Expected |
|-------|----------|
| `~/ica-claude.sh` exists and is executable | `test -x ~/ica-claude.sh` passes |
| API key file present | `~/.dotfiles/ICA_CLAUDE` contains `ICA_CLAUDE_CODE_API_KEY=...` |
| Gateway endpoint | `https://api.nextgen-beta.ica.ibm.com/ica` |
| Default model in script | `claude-opus-4-8[1m]` (always override with `--model`) |
| Free-tier models | `claude-haiku-4-5`, `gemma-4-26b-a4b-it`, `meta-llama/llama-4-maverick-17b-128e-instruct-fp8`, `ibm/granite-4-h-small` |
| Context cap | 200k (standard models); ~1M for `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) — confirmed 2026-06-08 |

## ICA Gateway Model Routing (Agent Tool)

When the calling agent is itself running on the ICA profile, the built-in **Agent tool** (subagents) has a model routing constraint:

| Model specifier | Resolves to | Gateway accepts? |
|----------------|-------------|-----------------|
| `model: "sonnet"` | Gateway-compatible ID | **Yes** |
| `model: "opus"` | Gateway-compatible ID | **Yes** |
| `model: "haiku"` (default) | `claude-haiku-4-5-20251001` (dated ID) | **No** — 401 error |
| Omitted (default) | Haiku dated ID | **No** — 401 error |

The ICA gateway only accepts models in the `global-models` group. Dated model IDs (e.g., `claude-haiku-4-5-20251001`) are NOT in that group. **Always specify `model: "sonnet"` or `model: "opus"` when using the Agent tool on the ICA profile.** Alternatively, delegate via `~/ica-claude.sh` (Bash tool) which handles model routing through its own `--model` flag.

## Routing Posture

CLI (`~/ica-claude.sh -p`) is the only supported transport. Each call is stateless by default; use `--continue`/`--resume` for opt-in session continuity across calls. In `-p` mode the agent runs to completion unless constrained by `--max-turns` or `--max-budget-usd`. Future: LiteLLM gateway endpoint.

### Cost: the ICA gateway is free-to-us

Delegating to ICA is **cost-shifted** — these calls do not bill our primary budget. Dollars are therefore **not** the constraint, and `--max-budget-usd` is **generally unnecessary** (and actively harmful for live/stateful work — see below). Default to **omitting it**. Prefer allowing the delegate to do **more / deeper work**, especially for opus-driven reasoning, rather than throttling it. The only real discipline that still applies is **don't waste tokens on pointless loops** — bound that with a generous `--max-turns` (a backstop against runaways, not a cost lever), never with a dollar cap. Treat any `--max-budget-usd` figure in the recipes below as legacy/optional, not recommended.

## Invocation Flags

Always include `--dangerously-skip-permissions` unless a plan explicitly instructs otherwise for a specific delegation.

| Flag | Purpose | When to Use |
|------|---------|-------------|
| `--dangerously-skip-permissions` | Bypass all permission prompts | **Always** — delegates run sandboxed, cannot prompt |
| `--model <id>` | Select model | **Always** — never rely on script default |
| `--max-turns <N>` | Limit agentic iterations (print mode only). Exits with error when reached. | Bounded tasks — use 15-50 depending on complexity |
| `--allowedTools <tools...>` | Auto-approve specific tools without prompting (all tools still exist) | Agentic calls — scope to minimum needed |
| `--tools <list>` | Restrict which tools EXIST (agent cannot see others) | Strict sandboxing — e.g., `--tools "Bash,Edit,Read"` |
| `--disallowedTools <tools...>` | Block specific tools | When easier to deny a few than whitelist many |
| `--add-dir <paths...>` | Grant filesystem access beyond CWD | When delegate needs to read/write outside launch directory |
| `--output-format json` | Structured JSON output | Programmatic consumption without a schema |
| `--json-schema <schema>` | Validated structured output conforming to a JSON Schema | Typed extraction — stricter than `--output-format json` |
| `--effort <level>` | Set effort level: `low`/`medium`/`high`/`xhigh`/`max` | Trade speed vs. thoroughness |
| `--max-budget-usd <amount>` | Cap spend per invocation | Premium-tier calls where runaway token use is a risk |
| `--append-system-prompt <text>` | Inject behavioral constraints | Scoping delegate behavior |
| `--continue` | Resume most recent session | Multi-call workflows where prior context matters |
| `--resume <id>` | Resume a specific session by ID | Targeted session continuity |
| `--no-session-persistence` | Don't save session to disk | Ephemeral/fan-out delegations |
| `--bare` | Skip hooks, skills, plugins, MCP, auto memory, CLAUDE.md | Faster for scripted/mechanical calls |
| `--fallback-model <models>` | Comma-separated fallback models on overload | Resilience for premium model calls |
| `--bg` | Start as background agent, returns immediately | Fire-and-forget tasks |
| `--exclude-dynamic-system-prompt-sections` | Improve prompt-cache reuse | Multi-user or cross-machine fan-out |

### Scope Control

`--max-turns <N>` limits agentic iterations (print mode only). When the limit is reached, the process exits with an error. Use in combination with other scope mechanisms:
- `--max-turns` (hard iteration cap — use 15-50 depending on task complexity)
- `--allowedTools` / `--tools` (capability restriction)
- `--max-budget-usd` (hard cost ceiling)
- `--append-system-prompt` (behavioral guardrails)
- Tight prompt instructions ("complete in a single pass")

### Tool Scoping Patterns

| Delegation Type | Tool Flags | Effect |
|----------------|-----------|--------|
| Pure generation (no tools) | omit entirely | Single-shot: model generates text and exits |
| Read-only review | `--allowedTools "Read Bash(grep:*) Bash(find:*) Bash(git:*)"` | Can explore, cannot modify; all other tools still exist |
| Strict read-only sandbox | `--tools "Read,Bash"` + `--allowedTools "Read Bash(grep:*)"` | Only Read/Bash exist; Bash auto-approved for grep |
| Bounded implementation | `--allowedTools "Read Write Edit Bash"` | Full agentic; scope via prompt and `--append-system-prompt` |
| Structured extraction | `--json-schema '{...}'` or `--output-format json` | Single-shot typed response |

Note: `--tools "X,Y,Z"` restricts which tools EXIST (agent cannot see others). `--allowedTools "X,Y,Z"` auto-approves without prompting but all tools remain available. `--disallowedTools "X,Y"` blocks specific tools.

## Live/Stateful Delegations — Caps Can Be Destructive

A delegate that hits `--max-budget-usd` or `--max-turns` is **hard-killed mid-action**, not gracefully wound down. For read-only or idempotent work that is harmless: a kill only discards analysis. For **live, stateful, mutating** work it is dangerous — the delegate can die *between* destructive steps and leave the target system broken.

| Delegation kind | Caps (`--max-budget-usd` / tight `--max-turns`) | Rationale |
|---|---|---|
| Read-only review / research / extraction | **Safe** — use them to bound cost | A mid-run kill loses only the in-progress reasoning; no state changes |
| Idempotent / discardable codegen (fresh worktree, re-runnable) | Safe-ish — re-run on kill | The partial output is thrown away and regenerated |
| **Live infra / DB / migration / cutover / deploy** | **DO NOT cap** (or set far above expected cost) | A kill mid-mutation leaves the system PARTIAL — e.g. a stopped stack, half-applied migration, crash-looping service |

**Incident (2026-06-08):** A live enterprise EC2 redeploy was delegated with `--max-budget-usd 12`. opus-4.7 spent the $12 *during* the cutover and was killed after `compose down` + image rebuild but **before** the stack came back up — the demo box was left **DOWN** (API crash-looping on a migration error, web stuck waiting on API). The cap turned a recoverable migration bug into an outage. Recovery required a separate read-only state-verification delegate followed by a no-cap repair pass.

**Rules for live/stateful delegations:**

1. **Omit `--max-budget-usd` and tight `--max-turns`.** If you must bound, set the turn cap generously above the worst-case step count and treat the dollar figure as telemetry, not a kill switch. A mutating delegate must be allowed to *finish or roll back*, never to stop halfway.
2. **Make the prompt's safety rails self-restoring.** Bake in: take a backup first, never destroy data (`no -v`), and an explicit "if anything fails, roll back and restore service before reporting" clause — so even an unexpected death lands closer to a recoverable state.
3. **Always pass `--bare` when launching from inside a repo that has a large `CLAUDE.md`/rules/memory** (e.g. this project). Without it the delegate auto-loads the entire project context on startup and fails with **`Prompt is too long`** before your task even runs. `--bare` skips hooks/skills/MCP/auto-memory/CLAUDE.md; the delegate still reads task-specific docs via `--add-dir`.
4. **Transient gateway drops happen** (`API Error: socket connection closed unexpectedly`). Add `--fallback-model` for resilience and simply retry — a single drop is not a reason to abandon bash delegation.
5. **Sequence live ops as: read-only verify → mutate → read-only verify.** Before a mutating retry, run a cheap read-only state-check delegate so you never mutate a system whose current state you cannot confirm.

## Routing Table

| Intent | Pattern | Model | Tool Scope | Turn Cap |
|--------|---------|-------|------------|----------|
| Quick answer / extraction | Single-shot, no tools | `claude-haiku-4-5` (free) | None | — |
| Bounded code task (generate, refactor) | Agentic | `claude-sonnet-4-6` | `"Read Write Edit Bash"` | `--max-turns 20` |
| Large parallel fan-out (many small tasks) | Multiple single-shot calls | `claude-haiku-4-5` (free) | None | — |
| Complex reasoning subtask | Agentic | `claude-opus-4-8` | `"Read Write Edit Bash"` | `--max-turns 50` (no cost cap — ICA is free-to-us) |
| Structured data extraction | Single-shot + `--json-schema` | `claude-haiku-4-5` (free) | None | — |
| Second opinion (read-only review) | Agentic, read-only | `gpt-4o` or `gemini-3.1-pro-preview` | `"Read Bash(grep:*) Bash(find:*)"` | `--max-turns 15` |
| **Large-context task (>100k–800k tokens input)** | Single-shot or agentic | `claude-opus-4-8[1m]` or `opus[1m]` | As needed | — |
| **Live infra / DB / deploy (mutating)** | Agentic, `--bare`, self-restoring prompt | `claude-opus-4-7`/`-4-8` + `--fallback-model` | `"Read Bash"` | **No cost cap; generous `--max-turns` only** — see "Live/Stateful Delegations" |

## Context Budget Discipline

| Rule | Rationale |
|------|-----------|
| Send file paths, not file contents, when the delegate has filesystem access | Avoids bloating the prompt with content the delegate can read itself |
| Keep prompt text under ~50k tokens (standard models) | Leaves room for tool-use overhead within the 200k ceiling |
| For `[1m]` variants, prompt can reach ~800k tokens | Confirmed ~1M context; leave ~200k for tool-use overhead and output |
| Prefer multiple small delegations over one large context-heavy delegation | Reduces risk of context exhaustion mid-task |
| Factor in that tool-use rounds consume context faster than expected | Each tool call/response pair adds ~1-3k tokens of framing |
| For agentic calls, budget: ~100k prompt space, rest for tool-use overhead | Conservative split ensures the delegate can complete multi-step work |

## Output Guidance

| Mode | Flag | Use Case |
|------|------|----------|
| Raw text (default) | none | General prose, code generation, reviews |
| Structured JSON | `--output-format json` | Programmatic consumption without a schema |
| Schema-validated JSON | `--json-schema '{...}'` | Typed extraction with validation |
| File redirect | `> output.txt` | Large outputs that would flood calling agent's context |

Post-delegation discipline:
- Always validate delegate output before integrating into the primary session.
- Treat delegate output with the same skepticism as any external tool result.
- For large outputs, read selectively rather than loading the full file into context.

## Invocation Recipes

### Recipe 1 — Single-Shot (Free Tier)

```bash
~/ica-claude.sh -p "prompt" \
  --model claude-haiku-4-5 \
  --dangerously-skip-permissions
```

### Recipe 2 — Agentic Implementation (Standard Tier)

```bash
~/ica-claude.sh -p "Task: [task description]
Context: [minimal required context -- file paths, not contents]
Deliverable: [expected output format]" \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --max-turns 20 \
  --allowedTools "Read Write Edit Bash" \
  --add-dir /path/to/project \
  --append-system-prompt "Complete the task in a single pass. Do not iterate beyond the initial implementation."
```

### Recipe 3 — Read-Only Review (Standard/Cross-Family)

```bash
~/ica-claude.sh -p "Review [target] for [criteria]. Report findings only." \
  --model gpt-4o \
  --dangerously-skip-permissions \
  --max-turns 15 \
  --allowedTools "Read Bash(grep:*) Bash(find:*) Bash(git:*)" \
  --add-dir /path/to/project
```

### Recipe 4 — Structured Output (Free Tier)

```bash
~/ica-claude.sh -p "Extract [thing] from [source]. Return JSON matching this schema: {...}" \
  --model claude-haiku-4-5 \
  --output-format json \
  --dangerously-skip-permissions
```

### Recipe 5 — Parallel Fan-Out (Free Tier)

```bash
for item in "${items[@]}"; do
  ~/ica-claude.sh -p "Process: $item" \
    --model claude-haiku-4-5 \
    --dangerously-skip-permissions \
    > "/tmp/delegate-output-${item}.txt" &
done
wait
```

### Recipe 6 — Deep Opus Reasoning (no cost cap)

ICA is free-to-us, so do **not** dollar-cap opus reasoning — let it do the work. Bound only with a generous `--max-turns` as a runaway backstop. (Omit `--max-budget-usd` entirely; the old "budget-capped" framing is deprecated.)

```bash
~/ica-claude.sh -p "Task: [complex architecture/design task]
Context: [paths to relevant files]
Deliverable: [structured recommendation]" \
  --model claude-opus-4-8 \
  --bare \
  --dangerously-skip-permissions \
  --max-turns 60 \
  --effort high \
  --fallback-model claude-opus-4-7,claude-opus-4-6 \
  --allowedTools "Read Bash(grep:*) Bash(find:*)" \
  --add-dir /path/to/project
```

### Recipe 7 — Session-Continuity Workflow

```bash
# First call — starts a session
~/ica-claude.sh -p "Analyze /path/to/codebase for security issues. Write findings to /tmp/security-report.md" \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --allowedTools "Read Write Bash(grep:*) Bash(find:*)" \
  --add-dir /path/to/codebase

# Follow-up call — continues the same session
~/ica-claude.sh -p "Now prioritize the findings by severity and add remediation suggestions" \
  --continue \
  --dangerously-skip-permissions
```

### Recipe 8 — Bare Mode Fan-Out (Optimized)

```bash
for file in "${files[@]}"; do
  ~/ica-claude.sh -p "Summarize: $file" \
    --model claude-haiku-4-5 \
    --bare \
    --no-session-persistence \
    --dangerously-skip-permissions \
    > "/tmp/summary-$(basename "$file").txt" &
done
wait
```

### Recipe 9 — Schema-Validated Structured Output

```bash
~/ica-claude.sh -p "Extract all function signatures from /path/to/module.ts" \
  --model claude-haiku-4-5 \
  --dangerously-skip-permissions \
  --json-schema '{"type":"object","properties":{"functions":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"params":{"type":"array","items":{"type":"string"}},"returnType":{"type":"string"}},"required":["name","params","returnType"]}}},"required":["functions"]}'
```

### Recipe 10 — Large-Context Delegation (`[1m]` model)

For tasks requiring >100k tokens of inline context — whole-repo analysis, large document processing, multi-file synthesis.

```bash
~/ica-claude.sh -p "$(cat <<'PROMPT'
Task: [describe task requiring large context]

[inline content up to ~800k tokens — or pass file paths if delegate has fs access]

Deliverable: [expected output]
PROMPT
)" \
  --model claude-opus-4-8[1m] \
  --bare \
  --dangerously-skip-permissions \
  --max-turns 30 \
  --fallback-model claude-opus-4-8,claude-opus-4-7[1m],claude-opus-4-7
```

> **Note**: `[1m]` variants self-report 200k context — ignore this. Confirmed ~1M actual context (tested 2026-06-08). Practical ceiling ~800k tokens to leave room for output and tool-use overhead.

---

## Do Not Say

| Prohibited Claim | Truth |
|-----------------|-------|
| "The ICA gateway supports unlimited context" | False. Standard models have a hard 200k cap; `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) are confirmed to ~1M but are NOT unlimited. |
| "All models on the gateway are free" | Only specific small models (Haiku, Gemma) are free tier. |
| "Use this for tasks requiring the current session's MCP tools" | Delegates cannot access the calling session's MCP servers. |
| "The delegate can continue a previous conversation" | Each invocation is stateless by default. Use `--continue`/`--resume` for opt-in continuity. |
| "Omit `--dangerously-skip-permissions` for safety" | Always include it — delegates cannot prompt for permissions in `-p` mode; omitting causes hangs or failures. |
| "Use `--continue` for multi-turn conversations with users" | False. `--continue` resumes a prior session; it does NOT create an interactive multi-turn experience. Each `~/ica-claude.sh` call is still a single Bash invocation. |
| "Use `--bare` for all delegations" | Not always. `--bare` skips skills/plugins which may be needed for some tasks. Use for mechanical/fan-out work. |
| "Use the Agent tool with default model on ICA profile" | Default model (Haiku) uses a dated ID that the gateway rejects. Always specify `model: "sonnet"` or `model: "opus"` for Agent tool subagents. |

## Key References

| Resource | Path |
|----------|------|
| Gateway wrapper script | `/Users/miethe/ica-claude.sh` |
| API key env file | `/Users/miethe/.dotfiles/ICA_CLAUDE` |
| Capability contract | `/Users/miethe/.claude/skills/ica-delegate/SPEC.md` |
| Model inventory and selection heuristics | `/Users/miethe/.claude/skills/ica-delegate/references/ica-models.md` |
