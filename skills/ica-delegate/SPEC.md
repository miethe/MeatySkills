---
schema_version: 2
doc_type: skill_spec
skill_name: "ica-delegate"
skill_version: "2.0.0"
status: draft
created: "2026-06-07"
updated: "2026-06-08"
owner: "miethe"
source_docs:
  - "/Users/miethe/ica-claude.sh"
  - "/Users/miethe/.dotfiles/ICA_CLAUDE"
related_skills:
  - "bob-shell-delegate"
affects_commands: []
---

# ica-delegate SPEC

## 1. Purpose & Scope

**Mission**: Enable agents to delegate bounded agentic work to a secondary Claude subscription via the IBM ICA gateway, with model-appropriate routing and context budget discipline.

**In scope**:
- Single-shot delegation to free-tier models for mechanical/extraction tasks
- Agentic delegation to standard-tier models for bounded implementation work
- Parallel fan-out of independent subtasks
- Structured output extraction via `--output-format json`
- Model selection guidance based on task complexity and cost tier
- Turn-limited agentic delegation via `--max-turns`
- Session-continuity workflows via `--continue`/`--resume`
- Schema-validated structured output via `--json-schema`
- Bare-mode optimized fan-out for scripted mechanical work
- 1M context delegation via `[1m]` model variants (`opus[1m]` → `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) — confirmed 2026-06-08 via `modelUsage`

**Out of scope**:
- Multi-turn interactive sessions requiring real-time user input (use `~/ica-claude.sh` directly for those)
- Tasks requiring the calling session's MCP tools or project memory (keep those local)
- Gateway administration or API key rotation (manual ops)
- LiteLLM gateway routing (future — see BL-1)

## 2. Capability Coverage

| Intent | Workflow / Section | Canonical Doc |
|---|---|---|
| Delegate quick extraction or answer | SKILL.md § Routing Table (Single-shot) | `/Users/miethe/ica-claude.sh` |
| Delegate bounded code task | SKILL.md § Routing Table (Agentic) | `/Users/miethe/ica-claude.sh` |
| Fan out multiple independent tasks | SKILL.md § Routing Table (Fan-out) | `/Users/miethe/ica-claude.sh` |
| Extract structured data as JSON | SKILL.md § Routing Table (Structured) | `/Users/miethe/ica-claude.sh` |
| Get second opinion on code/docs | SKILL.md § Routing Table (Review) | `/Users/miethe/ica-claude.sh` |
| Select appropriate model for task | `references/ica-models.md` | — |
| Delegate with turn limit | SKILL.md § Routing Table (with `--max-turns`) | `/Users/miethe/ica-claude.sh` |
| Session-continuity workflow | SKILL.md § Recipes (Recipe 7) | `/Users/miethe/ica-claude.sh` |
| Schema-validated extraction | SKILL.md § Recipes (Recipe 9) | `/Users/miethe/ica-claude.sh` |
| Optimized bare-mode fan-out | SKILL.md § Recipes (Recipe 8) | `/Users/miethe/ica-claude.sh` |
| Large-context task (>100k–800k tokens) via `[1m]` model | SKILL.md § Routing Table + Recipe 10 | `/Users/miethe/ica-claude.sh` |

## 3. Invariants & Constraints

1. **Context ceiling**: Standard models have a 200k hard limit — keep prompt text under ~50k to leave headroom for tool-use overhead. Exception: `[1m]` variants (`opus[1m]` → `claude-opus-4-8[1m]`, `sonnet-4-6[1m]`) provide ~1M context (confirmed 2026-06-08 via `modelUsage`, NOT model self-report); prompt text can reach ~800k, leaving ~200k for overhead.

2. **Paths not contents**: When the delegate has filesystem access, agents must pass file paths in prompts, never file contents. This preserves context budget.

3. **Model always explicit**: Every invocation must include `--model <name>`. Never rely on the script's default model for delegated work — be intentional about tier selection.

4. **Permissions flag required**: All invocations must include `--dangerously-skip-permissions` unless a plan explicitly instructs otherwise. Delegates run in `-p` mode and cannot prompt for permissions — omitting the flag causes the invocation to hang or fail.

5. **Stateless by default, continuity opt-in**: Each `~/ica-claude.sh -p` call is independent by default. For multi-step workflows requiring state persistence, use `--continue` (most recent session) or `--resume <id>` (specific session). Even with continuity, each invocation is still a single Bash call from the orchestrator's perspective.

6. **Output validation required**: Delegate output must be validated before integration, same as bob-shell-delegate convention. Delegation does not equal trust.

7. **Tool scoping for agentic calls**: Agentic delegations must scope capabilities to the minimum required. Three mechanisms exist:
   - `--tools "X,Y,Z"` — restricts which tools EXIST (agent cannot see others). Strongest isolation.
   - `--allowedTools "X,Y,Z"` — auto-approves tools without prompting but all tools remain available.
   - `--disallowedTools "X,Y"` — blocks specific tools.
   Prefer `--tools` for strict sandboxing; use `--allowedTools` when the delegate may need fallback tools. Never grant full tool access without explicit justification.

8. **Turn limiting via `--max-turns`**: In `-p` mode, `--max-turns <N>` caps agentic iterations. When the limit is reached, the process exits with an error. Combine with `--max-budget-usd`, `--allowedTools`, and prompt instructions for layered scope control. Default: no limit (runs to completion).

## 4. Enhancement Backlog

- **[BL-1] LiteLLM gateway support**: Add routing option for local LiteLLM gateway endpoint as alternative transport. Skill's decision logic persists; only transport changes.
  _Status_: planned
  _Rationale_: Blocked on LiteLLM deployment. When ready, add `references/litellm-models.md` and update SKILL.md routing posture.

- **[BL-2] Token usage tracking**: Report token consumption per delegation call for cost awareness and context budget monitoring.
  _Status_: candidate
  _Rationale_: Requires parsing `--output-format json` metadata fields; not yet verified whether gateway exposes usage stats.

- **[BL-3] Auto-model-selection based on prompt size**: Automatically recommend or select model tier based on estimated prompt token count.
  _Status_: deferred
  _Rationale_: Token estimation is unreliable without a tokenizer; manual tier selection is acceptable for v1.

- **[BL-4] Parallel orchestration patterns**: Document workflow-level fan-out patterns (e.g., map-reduce over file list using multiple delegations).
  _Status_: candidate
  _Rationale_: Waiting for real-world usage patterns to emerge before documenting.

- **[BL-5] Effort-level routing**: Auto-select `--effort` level based on task complexity tier. Low for extraction, high for reasoning.
  _Status_: candidate
  _Rationale_: Requires benchmarking effort levels against ICA gateway response quality.

- **[BL-6] Background agent orchestration**: Document patterns for `--bg` (background agent) delegation and result collection.
  _Status_: candidate
  _Rationale_: Requires understanding of how background agents report completion through the gateway.

## 5. Changelog

### v2.1.0 — 2026-06-08
- ADDED: 1M context delegation via `[1m]` model variants to in-scope list
- UPDATED: Invariant #1 — 200k ceiling now has `[1m]` exception (~800k prompt for `opus[1m]`, `claude-opus-4-7[1m]`, `sonnet-4-6[1m]`)
- ADDED: Large-context capability coverage row
- CONFIRMED: `[1m]` suffix works with standard binary (no patched binary required)

### v2.0.0 — 2026-06-07
- FIXED: `--max-turns` exists and works in print mode (corrects v1.0 error)
- Added: `--max-turns` to scope control mechanisms (Invariant #8 rewritten)
- Added: Session continuity via `--continue`/`--resume` (Invariant #5 updated)
- Added: Tool scoping clarification (`--tools` vs `--allowedTools` vs `--disallowedTools`) (Invariant #7 updated)
- Added: 4 new capability coverage entries
- Added: `--bare`, `--json-schema`, `--effort`, `--no-session-persistence`, `--fallback-model` to scope

### v1.0.0 — 2026-06-07
- Initial SPEC.md drafted
- Capability coverage matrix: 6 intents across SKILL.md routing table + references
- Invariants: 6 rules covering context budget, model selection, statelessness
- Status: draft

## 6. Integration Points

| Agent / Command | Invocation Pattern | Notes |
|---|---|---|
| Any Claude Code agent | `Skill("ica-delegate")` | Global skill; available in all projects |
| Workflow orchestrators | Bash tool calling `~/ica-claude.sh` | Fan-out pattern: multiple parallel Bash calls |
| Subagents (via Agent tool) | Read SKILL.md then invoke via Bash | Subagents can delegate further to ICA gateway |

**Co-loaded with**: None required. Standalone skill.

## 7. Success Signals

- Agents select the appropriate model tier (free vs standard) on first attempt without re-reading SKILL.md
- No context overflow errors from the ICA gateway during delegated work
- Free-tier models used for mechanical/extraction tasks; standard tier reserved for reasoning
- Delegate prompts stay under 50k tokens consistently
- Agents validate delegate output before integrating (no blind trust)
- Parallel fan-out tasks complete independently without cross-contamination
- Skill's routing logic survives future transport changes (LiteLLM) without rewrites
