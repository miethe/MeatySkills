# ica-delegate

Delegate bounded work to IBM ICA-provisioned Claude instances.

## Overview

`ica-delegate` enables any Claude Code agent to offload tasks to remote Claude instances via IBM's ICA gateway. Each invocation is stateless; delegates run in isolation without access to your MCP tools or session context. Use this skill to parallelize work across free-tier models or cost-shift bounded tasks to a secondary subscription.

## Prerequisites

- `~/ica-claude.sh` must exist and be executable
- API key configured in `~/.dotfiles/ICA_CLAUDE` (`ICA_CLAUDE_CODE_API_KEY=...`)
- Gateway reachable: `https://api.nextgen-beta.ica.ibm.com/ica`

## Directory Structure

```
~/.claude/skills/ica-delegate/
├── README.md                 (this file)
├── SKILL.md                  (AI-first routing guide for agents)
├── SPEC.md                   (capability contract)
├── CHANGELOG.md
└── references/
    └── ica-models.md         (full model inventory & selection heuristics)
```

## Quick Start

### Single-shot extraction (free tier)

```bash
~/ica-claude.sh -p "Summarize the key points from /path/to/file.md" \
  --model claude-haiku-4-5 \
  --bare \
  --dangerously-skip-permissions
```

### Agentic code task (standard tier)

```bash
~/ica-claude.sh -p "Task: Refactor /path/to/module.ts to use async/await
Context: See /path/to/module.ts and /path/to/types.ts
Deliverable: Updated file contents" \
  --model claude-sonnet-4-6 \
  --dangerously-skip-permissions \
  --max-turns 20 \
  --allowedTools "Read Write Edit Bash" \
  --add-dir /path/to/project
```

### Read-only review (cross-family second opinion)

```bash
~/ica-claude.sh -p "Review /path/to/module.ts for correctness issues" \
  --model gpt-4o \
  --dangerously-skip-permissions \
  --allowedTools "Read Bash(grep:*) Bash(find:*)" \
  --add-dir /path/to/project
```

## Model Tiers

| Tier | Default Pick | Cost | Best For |
|------|-------------|------|----------|
| **Free** | `claude-haiku-4-5` | Unlimited | Extraction, scaffolding, fan-out |
| **Standard** | `claude-sonnet-4-6` | Token-limited | Code generation, review, bounded reasoning |
| **Premium** | `claude-opus-4-8` | Token-limited | Deep reasoning, architecture decisions |

See [`references/ica-models.md`](references/ica-models.md) for full inventory (13 models across 3 families).

## Key Flags

| Flag | Required | Purpose |
|------|----------|---------|
| `--dangerously-skip-permissions` | Always | Delegates cannot prompt; omitting causes hang |
| `--model <id>` | Always | Never rely on script default |
| `--allowedTools "..."` | For agentic | Scope tools to minimum needed |
| `--add-dir <path>` | For agentic | Grant filesystem access beyond CWD |
| `--output-format json` | For structured | Schema-constrained JSON output |
| `--max-budget-usd <N>` | Rarely | Hard cost cap — generally unnecessary (ICA is free-to-us); **never** on live/stateful ops (kills mid-mutation) |
| `--max-turns <N>` | For agentic | Hard iteration cap (exits with error when reached) |
| `--bare` | For single-shot/fan-out | Skip hooks/skills/plugins for faster startup |
| `--tools <list>` | For strict sandboxing | Restrict which tools EXIST (stronger than `--allowedTools`) |
| `--json-schema <schema>` | For typed extraction | Validated structured output (better than `--output-format json`) |
| `--effort <level>` | Optional | Control reasoning effort (low/medium/high/xhigh/max) |
| `--continue` / `--resume <id>` | For multi-step workflows | Session continuity (opt-in) |
| `--no-session-persistence` | For ephemeral | Don't save session to disk |
| `--fallback-model <models>` | For reliability | Auto-fallback on model overload |

**Scope control:** Use `--max-turns <N>` to limit agentic iterations, `--allowedTools`/`--tools` for capability restriction, and `--append-system-prompt` for behavioral guardrails. **Cost note:** ICA is free-to-us — prefer omitting `--max-budget-usd` and letting opus do more/deeper work; bound runaways with a generous `--max-turns`, not a dollar cap. Never cost-cap a live/stateful op (it hard-kills mid-mutation — see SKILL.md "Live/Stateful Delegations").

**Tool scoping distinction:** `--tools` restricts which tools _exist_ (strongest isolation). `--allowedTools` auto-approves tools without prompting but all tools remain available. `--disallowedTools` blocks specific tools.

## Key Constraints

- **200k context cap** on all models, consumed ~1.2-1.5x faster than direct API
- **Stateless by default**: each invocation is independent unless `--continue`/`--resume` is used for opt-in session continuity
- **No MCP access**: delegates cannot reach the calling session's tools or memory
- **Paths not contents**: send file paths in prompts, not file contents
- **Always specify `--model`**: never rely on the script's default
- **Token budget shared**: heavy Opus use depletes budget available for Sonnet

## Related

- [SKILL.md](SKILL.md) — Full routing guide with decision tables (AI-first audience)
- [SPEC.md](SPEC.md) — Capability contract: 6 intents, 6 invariants, enhancement backlog
- [references/ica-models.md](references/ica-models.md) — Complete model inventory with selection heuristics
