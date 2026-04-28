---
name: claude-agent-sdk
description: Integrate Claude Agent SDK into Python apps with subscription OAuth, structured output, MCP tools, and provider abstraction. Captures production-validated patterns and bug workarounds. Use when adding Claude Agent SDK to a Python application, enabling Claude subscription auth (OAuth) alongside API key auth, building multi-turn agent workflows with tool use, integrating MCP tools, or setting up provider abstraction.
version: 1.0.0
created: 2026-04-24
updated: 2026-04-24
tags: [claude, agent-sdk, anthropic, oauth, subscription, llm, mcp]
spec_ref: .claude/skills/claude-agent-sdk/SPEC.md
---

# Claude Agent SDK Integration

Production-validated patterns from MeatyWiki (90+ SP across three feature tracks: LLM Flexibility, Agent SDK MVP, Subscription Auth). Full architecture contract in `SPEC.md`.

## When to Use

- Adding Claude Agent SDK (`anthropic` package) to a Python application
- Enabling subscription OAuth auth alongside API key auth
- Building multi-turn agent workflows with tool use
- Integrating MCP tools for read-only data access
- Setting up provider abstraction (agent mode + local LLMs + API providers)
- Debugging `structured_output: None` or 404 errors under subscription auth

## Architecture Overview

```
Application Stage
    ├── Tool-free / simple     → LLMClient.chat()      (sync, LiteLLM)
    └── Tool-using / multi-turn → AgentRuntime.run()   (async, Agent SDK)
                                    ├→ AgentBridge      (sync/async wrapper)
                                    └→ MCP Server       (read-only tools, subprocess)
```

Opt-in per-purpose. Configs without an `agent:` key load unchanged (backward compat).

---

## Quick Start: Minimal Integration

```python
# 1. Define per-purpose agent config
class AgentConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    system_prompt: str
    tools: list[str] = Field(default_factory=list)
    max_turns: int = Field(default=6, ge=1, le=10)
    output_schema: dict | None = None

# 2. Route at call time
def process(purpose: str, messages: list[dict]) -> str:
    model_cfg = get_model_config(purpose)
    if model_cfg.agent is not None:
        return agent_run(purpose, messages)   # async Agent SDK path
    else:
        return chat(purpose, messages)        # sync LiteLLM path
```

---

## Core Pattern: Sync/Async Bridge

The Agent SDK is async. Wrap it for sync callers. Overhead: 40–90 µs per call.

```python
import anyio

class AgentBridge:
    """Wraps async Agent SDK in sync context."""

    def __init__(self):
        self._portal = None

    def _ensure_portal(self):
        if self._portal is None:
            self._portal = anyio.from_thread.start_blocking_portal()

    def run_sync(self, coro):
        self._ensure_portal()
        return self._portal.call(coro)

    def close(self):
        if self._portal is not None:
            self._portal.call(self._portal.stop)
            self._portal = None


class FakeAgentBridge:
    """Test double — runs on fresh asyncio loop. No pytest-asyncio needed."""

    def run_sync(self, coro):
        import asyncio
        return asyncio.run(coro)

    def close(self):
        pass
```

Key facts:
- `anyio.from_thread.start_blocking_portal()` creates a thread-pinned event loop
- Works in plain sync, pytest, and arq worker contexts
- Register `atexit` handler calling `bridge.close()` to avoid dangling threads
- `close()` must be idempotent

---

## Core Pattern: Agent Runtime

```python
class AgentRuntime:
    def __init__(
        self,
        config: AgentConfig,
        provider: str,
        model: str,
        db_path: Path | None = None,
        purpose: str | None = None,
    ):
        self._purpose = purpose or "unknown"   # MUST store — used in turn events
        self._config = config
        self._model = model
        self._provider = provider

        # Auto-populate output_schema from registry if not provided
        if config.output_schema is None and purpose:
            schema = SCHEMA_REGISTRY.get(purpose)
            if schema is not None:
                self._config = config.model_copy(update={"output_schema": schema})

        # Validate: output_schema requires max_turns >= 2
        if self._config.output_schema and self._config.max_turns < 2:
            raise ValueError(
                f"max_turns >= 2 required when output_schema is set "
                f"(purpose={self._purpose}, got max_turns={self._config.max_turns})"
            )

    @property
    def has_schema(self) -> bool:
        return self._config.output_schema is not None

    async def run(self, messages: list[dict]) -> dict:
        run_id = ulid.new().str
        options = {
            "model": self._model,
            "max_turns": self._config.max_turns,
            "system_prompt": self._config.system_prompt,
        }
        if self._config.output_schema:
            options["output_format"] = {
                "type": "json_schema",
                "schema": self._config.output_schema,
            }
        if self._config.tools:
            options["mcp_servers"] = [self._build_mcp_server()]

        # Drive the SDK turn loop, emit llm.agent.turn per turn
        # Return: {text, structured_output, cost_estimate, turns, tokens_in, tokens_out}
        ...
```

---

## Core Pattern: Result Adaptation + Fallback

```python
def agent_run(self, purpose: str, messages: list[dict]) -> LLMCallResult:
    try:
        runtime = self.router.get_agent_runtime(purpose)
        sdk_result = self.bridge.run_sync(runtime.run(messages))

        # CRITICAL: sdk_result may be dict or object depending on SDK version
        raw_output = _field(sdk_result, "structured_output", None)

        # Text-parse fallback for subscription auth (JSON returned as plain text)
        if raw_output is None and runtime.has_schema:
            text = _field(sdk_result, "text", "")
            raw_output = _try_parse_json_payload(text)
            source = "text_parse"
        else:
            source = "sdk"

        return LLMCallResult(
            content=raw_output or _field(sdk_result, "text", ""),
            cost_estimate=_field(sdk_result, "cost_estimate", 0.0),
            structured_output_source=source,
        )
    except AgentRuntimeError as e:
        log_event("llm.agent.run_failed", error=str(e))
        # Fallback to sync — system prompt EXCLUDED (it may reference unavailable tools)
        result = self.chat(purpose, [m for m in messages if m["role"] == "user"])
        result.degraded = True
        return result


def _field(obj: Any, key: str, default: Any = None) -> Any:
    """Read from dict or object — handles both SDK result shapes."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _try_parse_json_payload(text: str) -> dict | None:
    """Three recovery strategies for subscription auth structured output."""
    import json, re

    # Strategy 1: Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strategy 2: Markdown code-fence extraction
    match = re.search(r"```(?:json)?\s*\n(.*?)\n```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Strategy 3: Brace/bracket balancing for embedded JSON
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        idx = text.find(start_char)
        if idx >= 0:
            depth, end = 0, idx
            for i, c in enumerate(text[idx:], idx):
                if c == start_char:
                    depth += 1
                elif c == end_char:
                    depth -= 1
                if depth == 0:
                    end = i + 1
                    break
            try:
                return json.loads(text[idx:end])
            except json.JSONDecodeError:
                pass

    return None
```

---

## Auth Setup

**Interactive / development:**
```bash
claude /login
# Stores in macOS Keychain. Auto-refreshes on 401. ~6–8 hr lifetime.
```

**Daemon / headless / workers (production):**
```bash
claude setup-token
# One-time interactive step → one-year token
export CLAUDE_CODE_OAUTH_TOKEN="<token>"
# arq/cron workers inherit this at job dispatch time
```

**API key fallback:**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Resolution order:** Keychain → `CLAUDE_CODE_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`

**Critical:** Agent SDK subprocess is the sanctioned path for subscription usage. Routing subscription OAuth tokens through LiteLLM directly is a ToS grey area for non-interactive API calls. Always use the Agent SDK path for subscription auth.

**Linux headless:** Keychain unavailable. `CLAUDE_CODE_OAUTH_TOKEN` is the only viable path.

---

## Provider Abstraction

```python
class ProviderCapabilities(BaseModel):
    agent_mode: Literal["native", "proxy", "none"] = "none"

class ProviderDescriptor(BaseModel):
    adapter: str = "openai_compat"
    base_url: str | None = None
    api_key_env: str | None = None
    extra_headers: dict[str, str] = Field(default_factory=dict)
    cost_per_1m_tokens: dict[str, float] = Field(default_factory=dict)
    capabilities: ProviderCapabilities = Field(default_factory=ProviderCapabilities)
```

Validate at router init — reject `agent:` config when provider `agent_mode != "native"`:

```python
if stage_cfg.agent is not None and provider.capabilities.agent_mode != "native":
    raise ConfigError(
        f"Stage '{purpose}' has agent: config but provider '{provider_id}' "
        f"has agent_mode={provider.capabilities.agent_mode!r} (need 'native')"
    )
```

Example YAML:
```yaml
llm:
  providers:
    anthropic:
      adapter: openai_compat
      api_key_env: CLAUDE_CODE_OAUTH_TOKEN
      capabilities:
        agent_mode: native
    ollama:
      adapter: openai_compat
      base_url: http://localhost:11434/v1
      capabilities:
        agent_mode: none   # agent: config rejected at init

models:
  classify:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    agent:
      system_prompt: "You are a document classifier."
      tools: []
      max_turns: 2      # minimum when output_schema is set

  query:
    provider: anthropic
    model: claude-opus-4-6
    agent:
      system_prompt: "You are a vault query assistant."
      tools: [vault_search, vault_read]
      max_turns: 6
```

---

## Schema Registry

```python
# Static dict: purpose → JSON Schema derived from Pydantic models
SCHEMA_REGISTRY: dict[str, dict | None] = {
    "classify": Classification.model_json_schema(),
    "extract":  ExtractedPayload.model_json_schema(),
    "compile":  SummaryContent.model_json_schema(),
    "lint":     ContradictionFinding.schema,   # dataclass: hand-crafted schema
    "query":    None,                          # plain text, no schema
}
```

Auto-populate `AgentConfig.output_schema` from this registry at router init. Snapshot tests catch Pydantic model drift silently breaking schemas.

**Turn count rule:** `max_turns >= 2` is required when `output_schema` is set. The SDK's StructuredOutput tool needs a second turn to return validated output. `max_turns=1` with schema → `error_max_turns`.

---

## MCP Tool Integration

```python
# Subprocess-executable MCP server for read-only data access
# Safety guarantees:
#   1. Read-only connection (SQLite: ?mode=ro, or equivalent)
#   2. Per-tool timeout (2 seconds default)
#   3. Payload cap (100 KB, truncate with sentinel)
#   4. Subprocess isolation — no import guards needed

def _build_mcp_server(self) -> dict:
    return {
        "name": "vault",
        "command": sys.executable,
        "args": ["-m", "meatywiki.llm.agent.mcp_server"],
        "env": {
            "VAULT_DB_PATH": str(self._db_path),
            "MCP_READ_ONLY": "1",
        },
    }
```

---

## Observability

Emit per-turn events with ULID correlation. Never log tool content — names only.

```python
log_event("llm.agent.turn", {
    "run_id": run_id,          # ULID, correlates all turns in a run
    "purpose": self._purpose,  # store in __init__ or shows "unknown"
    "provider": self._provider,
    "model": self._model,
    "turn_index": i,
    "tokens_in": tokens_in,
    "tokens_out": tokens_out,
    "cost": cost,
    "latency_ms": latency,
    "stop_reason": stop,
    "tools_invoked": tool_names,   # names ONLY — never content
})
```

Cost tracking:
- Agent path: `ResultMessage.total_cost_usd` — SDK-reported, actual billing, most accurate
- Sync fallback: LiteLLM pricing table + per-provider YAML `cost_per_1m_tokens` overrides
- Both surface through the same `cost_estimate` field for aggregation

---

## Known Bugs and Workarounds

### Bug 1 — LiteLLM double `/v1/` path (404s)

Affects LiteLLM 1.83+. LiteLLM auto-appends `/v1/messages` to `api_base`. If `base_url` ends with `/v1/`, result is `.../v1//v1/messages`.

```python
import re

# Strip trailing /v1/ before passing to LiteLLM
if provider_id == "anthropic" and base_url:
    base_url = re.sub(r"/v1/?$", "", base_url)
```

### Bug 2 — `structured_output` always `None`

Two causes:

**Cause A:** `AgentRuntime.run()` returns `dict`, not an object. `getattr(dict, "key")` returns `None` silently.

Fix: always use `_field(obj, key, default)` (shown above).

**Cause B:** Claude CLI under subscription auth emits JSON as plain text, not in the `structured_output` field.

Fix: `_try_parse_json_payload()` three-stage fallback (shown above).

### Bug 3 — Purpose shows `"unknown"` in turn events

Cause: `_purpose` attribute never stored on the runtime instance.

```python
# In AgentRuntime.__init__:
self._purpose = purpose.value if hasattr(purpose, "value") else (purpose or "unknown")
```

---

## Testing Strategy

```python
class FakeAgentBridge:
    """Sync test double. No pytest-asyncio required."""

    def __init__(self, response: str, structured: dict | None = None):
        self._response = response
        self._structured = structured

    def run_sync(self, coro):
        import asyncio
        # Run real coroutine if needed, or return pre-baked result
        return {
            "text": self._response,
            "structured_output": self._structured,
            "cost_estimate": 0.0,
            "turns": 1,
            "tokens_in": 10,
            "tokens_out": 20,
        }

    def close(self):
        pass
```

Test coverage checklist:
- Config backward compat — configs without `agent:` key load unchanged
- Schema registry snapshots — catch Pydantic model drift at CI time
- Both paths per purpose — agent dispatch AND sync fallback for every stage
- Integration tests — patched bridge + real app code paths (no live API call)
- Manual smoke tests — real data for agent mode validation before merging

---

## Implementation Checklist

- [ ] Add `anthropic` as optional dependency (e.g., `[agent]` extra in `pyproject.toml`)
- [ ] Create `AgentConfig` with per-purpose `agent:` opt-in key
- [ ] Add `ProviderCapabilities.agent_mode` flag to `ProviderDescriptor`
- [ ] Validate at router init: reject `agent:` config when `agent_mode != "native"`
- [ ] Implement `AgentBridge` with `anyio.from_thread.start_blocking_portal()`; register `atexit`
- [ ] Implement `AgentRuntime`; store `self._purpose` in `__init__`
- [ ] Build schema registry; auto-populate `output_schema` at router init
- [ ] Add `_field(obj, key, default)` helper for dict/object result access
- [ ] Add `_try_parse_json_payload()` three-stage fallback
- [ ] Fallback-to-sync on `AgentRuntimeError`; set `degraded=True`; exclude system prompt
- [ ] Strip trailing `/v1/` from Anthropic `base_url` before LiteLLM init
- [ ] Enforce `max_turns >= 2` when `output_schema` is set
- [ ] Emit per-turn events with ULID `run_id`
- [ ] Document daemon auth setup (`claude setup-token`)
- [ ] Add `FakeAgentBridge` test double
- [ ] Snapshot tests: config compat + schema registry drift
- [ ] MCP tools (if needed): subprocess, read-only FS, per-tool timeout, payload cap

---

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| `max_turns=1` with `output_schema` | StructuredOutput tool needs a second turn | Set `max_turns >= 2` |
| `getattr(dict_result, "key")` | Dict doesn't support `getattr` | Use `_field()` helper |
| System prompt in fallback | May reference tools unavailable in sync path | Exclude system prompt from fallback call |
| LiteLLM with subscription OAuth | ToS grey area for non-interactive calls | Use Agent SDK subprocess path |
| Not storing `_purpose` on runtime | Turn events all show `purpose: "unknown"` | `self._purpose = purpose or "unknown"` in `__init__` |
| Keychain token for daemon/cron | 6–8 hr expiry; no refresh in background | Use `CLAUDE_CODE_OAUTH_TOKEN` |
| `api_base` ending with `/v1/` | LiteLLM appends `/v1/messages` → double path | Strip trailing `/v1/?` before LiteLLM init |

---

## Version History

- **2026-04-24**: v1.0.0 — Initial skill from MeatyWiki production learnings (90+ SP across LLM Flexibility, Agent SDK MVP, Subscription Auth feature tracks)
