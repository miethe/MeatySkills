---
name: claude-agent-sdk-spec
description: Skill contract for Claude Agent SDK integration — architecture patterns, auth flows, structured output, provider abstraction, and bug workarounds learned from production implementation.
type: spec
skill_name: claude-agent-sdk
schema_version: 1
created: 2026-04-24
updated: 2026-04-24
status: draft
source_implementations:
  - src/meatywiki/llm/agent/ (AgentRuntime, AgentBridge, MCP server, schema registry)
  - src/meatywiki/llm/client.py (agent_run, result adaptation, fallback)
  - src/meatywiki/llm/router.py (provider registry, agent runtime factory)
  - src/meatywiki/llm/config.py (ProviderDescriptor, capabilities)
  - src/meatywiki/schema/config.py (AgentConfig)
---

# Claude Agent SDK Integration — Skill Contract

## 1. Purpose

Teach agents to integrate the Claude Agent SDK (`anthropic` package agent module) into Python apps. Covers: dual-path architecture (sync LiteLLM + async Agent SDK), subscription OAuth auth, structured output, MCP tool integration, provider abstraction, and fallback degradation. All patterns validated in production (MeatyWiki compilation engine + portal).

---

## 2. Scope

### In Scope
- Claude Agent SDK integration: async runtime, sync bridge, MCP tools
- Three auth paths: macOS Keychain OAuth, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`
- Structured output via `output_schema` + schema registry pattern
- Provider abstraction with capability flags (`agent_mode: native|proxy|none`)
- Fallback-to-sync on `AgentRuntimeError`
- Per-purpose agent configuration (not global toggle)
- Cost tracking: SDK-reported vs LiteLLM pricing table
- Known bugs and workarounds

### Out of Scope
- Non-Python implementations
- Agent SDK internals / SDK development
- MCP server development beyond vault-style read-only tools
- Multi-tenant auth / RBAC / SSO
- Streaming / SSE integration
- Cross-provider agent transport (LiteLLM Transport — deferred)

---

## 3. Architecture Reference

### Dual-Path Model

```
Application Stage
    ├── Tool-free / simple  → LLMClient.chat()     (sync, LiteLLMAdapter)
    └── Tool-using / multi-turn → AgentRuntime.run() (async, Agent SDK)
                                    ├→ AgentBridge  (sync/async wrapper)
                                    └→ MCP Server   (read-only tools, subprocess)
```

### Key Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sync/async bridge | `anyio.from_thread.start_blocking_portal()` | < 5ms overhead; works in pytest, arq workers, plain sync |
| MCP tool isolation | Subprocess with read-only FS access | Structurally safer than import guards; subprocess killable |
| Agent opt-in granularity | Per-purpose `agent:` config block | Backward compatible; configs without `agent:` key load unchanged |
| Provider capability flag | `ProviderDescriptor.capabilities.agent_mode` | Validation at init rejects agent config on non-native providers |
| Output schema loading | Static registry → auto-populate `output_schema` | No operator burden; snapshot tests catch Pydantic drift |
| Fallback behavior | `AgentRuntimeError` → single sync `chat()` | System prompt excluded from fallback (prevents tool-reference answers) |
| Turn cap | `max_turns` default 6, max 10 | No CostGuard in v1; per-turn events enable external alarms |

---

## 4. Auth Patterns

### Resolution Order

| Priority | Source | Use Case |
|---|---|---|
| 1 | macOS Keychain (from `claude /login`) | Interactive dev; auto-refreshes on 401; ~6–8 hr lifetime |
| 2 | `CLAUDE_CODE_OAUTH_TOKEN` env var | Daemon / headless; one-year validity; recommended for workers |
| 3 | `ANTHROPIC_API_KEY` env var | Traditional fallback; no subscription scope |

### Critical Learnings

- **Subscription usage**: Agent SDK subprocess is the sanctioned path. LiteLLM-direct OAuth is a ToS grey area for non-interactive calls.
- **Daemon/worker contexts** (arq, cron, systemd): use `CLAUDE_CODE_OAUTH_TOKEN` — Keychain tokens expire mid-run on long jobs.
- **Worker env var timing**: workers inherit env vars at job dispatch time, not at startup.
- **Setup**: `claude setup-token` is a one-time interactive step producing a long-lived token.
- **Linux headless**: Keychain unavailable — `CLAUDE_CODE_OAUTH_TOKEN` is the only viable path.

---

## 5. Structured Output Patterns

### Schema Registry

```python
# Static dict: purpose → JSON Schema derived from Pydantic
SCHEMA_REGISTRY: dict[str, dict | None] = {
    "classify": Classification.model_json_schema(),
    "extract":  ExtractedPayload.model_json_schema(),
    "compile":  SummaryContent.model_json_schema(),
    "lint":     ContradictionFinding.schema,  # dataclass: hand-crafted schema
    "query":    None,                         # plain text, no schema
}
```

Auto-populate `AgentConfig.output_schema` from this registry at router init. Snapshot tests catch model drift.

### Turn Count Rule

**`max_turns >= 2` is required when `output_schema` is set.** The SDK's StructuredOutput tool uses a second turn to return validated output. `max_turns=1` with schema → `error_max_turns`.

### Text-Parse Fallback

Under subscription auth, the Claude CLI sometimes returns JSON as plain text instead of populating `ResultMessage.structured_output`. Recovery cascade:

1. Direct JSON parse of final assistant text
2. Markdown code-fence extraction (` ```json ... ``` `)
3. Brace/bracket balancing for embedded JSON payloads

Track source via `structured_output_source` field:
- `"sdk"` — SDK populated `structured_output`
- `"text_parse"` — fallback recovered from text

---

## 6. Known Bugs & Workarounds

### Bug 1 — LiteLLM double `/v1/` path (404s)

| Field | Detail |
|---|---|
| Affected | LiteLLM 1.83+ |
| Symptom | 404 on all Anthropic calls |
| Cause | LiteLLM auto-appends `/v1/messages` to `api_base`. If `base_url` ends with `/v1/`, result is `.../v1//v1/messages` |
| Fix | Strip trailing `/v1/?` from `base_url` when provider is `"anthropic"` before passing to LiteLLM |

```python
if provider == "anthropic" and base_url:
    base_url = re.sub(r"/v1/?$", "", base_url)
```

### Bug 2 — `structured_output` always `None`

**Cause A**: `AgentRuntime.run()` returns `dict`, not object. `getattr(dict, "structured_output")` silently returns `None`.

Fix — use a field accessor helper:
```python
def _field(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)
```

**Cause B**: Claude CLI under subscription auth emits JSON as plain text, not in `structured_output` field.

Fix: text-parse fallback (see §5).

### Bug 3 — Purpose `"unknown"` in turn events

| Field | Detail |
|---|---|
| Cause | `_purpose` attribute never stored on runtime instance |
| Symptom | All observability events show `purpose: "unknown"` |
| Fix | `self._purpose = purpose.value if purpose else "unknown"` in `AgentRuntime.__init__` |

---

## 7. Configuration Reference

### AgentConfig (Pydantic v2, frozen)

```python
class AgentConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    system_prompt: str               # non-empty, required
    tools: list[str] = Field(default_factory=list)   # e.g. ["vault_search", "vault_read"]
    max_turns: int = Field(default=6, ge=1, le=10)
    thinking: bool = False           # reserved; must be False in v1
    output_schema: dict | None = None  # auto-populated from schema registry
```

### ProviderDescriptor + Capabilities

```python
class ProviderCapabilities(BaseModel):
    agent_mode: Literal["native", "proxy", "none"] = "none"

class ProviderDescriptor(BaseModel):
    adapter: str = "openai_compat"           # "anthropic_native" reserved
    base_url: str | None = None
    api_key_env: str | None = None
    extra_headers: dict[str, str] = Field(default_factory=dict)
    cost_per_1m_tokens: dict[str, float] = Field(default_factory=dict)
    capabilities: ProviderCapabilities = Field(default_factory=ProviderCapabilities)
```

### Example YAML — All-Stages Subscription

```yaml
llm:
  providers:
    anthropic:
      adapter: openai_compat
      api_key_env: CLAUDE_CODE_OAUTH_TOKEN
      capabilities:
        agent_mode: native

models:
  classify:
    provider: anthropic
    model: claude-haiku-4-5-20251001
    agent:
      system_prompt: "You are a document classifier."
      tools: []
      max_turns: 2          # minimum when output_schema is set

  query:
    provider: anthropic
    model: claude-opus-4-6
    agent:
      system_prompt: "You are a vault query assistant."
      tools: [vault_search, vault_read]
      max_turns: 6
```

---

## 8. Observability Reference

### Events Emitted

| Event | Key Fields |
|---|---|
| `llm.agent.turn` | `run_id` (ULID), `purpose`, `provider`, `model`, `turn_index`, `tokens_in`, `tokens_out`, `cost`, `latency_ms`, `stop_reason`, `tools_invoked` (names only — never content) |
| `llm.agent.run_completed` | `run_id`, `purpose`, `total_turns`, `total_cost_usd` |
| `llm.agent.run_failed` | `run_id`, `purpose`, `error_class`, `error_msg` |
| `llm.call` (degraded) | standard call fields + `degraded=True` |

### Cost Tracking

| Path | Source |
|---|---|
| Agent path | `ResultMessage.total_cost_usd` (SDK-reported, actual billing) |
| Sync fallback | LiteLLM pricing table + per-provider YAML `cost_per_1m_tokens` overrides |

---

## 9. Implementation Checklist

When integrating Claude Agent SDK into a new Python app:

- [ ] Add `anthropic` as optional dependency (e.g., `[agent]` extra in `pyproject.toml`)
- [ ] Create `AgentConfig` Pydantic model with per-purpose opt-in (`agent:` key)
- [ ] Add `ProviderCapabilities` with `agent_mode` flag to `ProviderDescriptor`
- [ ] Validate at router init: reject `agent:` config when provider `agent_mode != "native"`
- [ ] Implement `AgentBridge` with `anyio.from_thread.start_blocking_portal()`
- [ ] Implement `AgentRuntime` wrapping SDK client with turn loop; store `self._purpose`
- [ ] Create schema registry mapping purposes → `model_json_schema()`; auto-populate `output_schema`
- [ ] Add `_field(obj, key, default)` helper for dict/object result access
- [ ] Add text-parse fallback (3-stage cascade) for structured output under subscription auth
- [ ] Add fallback-to-sync on `AgentRuntimeError`; emit `degraded=True`; exclude system prompt
- [ ] Strip trailing `/v1/` from Anthropic `base_url` before LiteLLM init
- [ ] Enforce `max_turns >= 2` validation when `output_schema` is set
- [ ] Emit per-turn events with ULID `run_id` for correlation
- [ ] Document auth setup for daemon contexts (`claude setup-token`)
- [ ] Add `FakeAgentBridge` test double (runs coroutines on fresh asyncio loop)
- [ ] Snapshot tests: config backward compat + schema registry drift
- [ ] If MCP tools needed: implement as subprocess with read-only FS access

---

## 10. Testing Patterns

| Pattern | Detail |
|---|---|
| `FakeAgentBridge` | Runs coroutines on fresh `asyncio.run()` loop — no `pytest-asyncio` dependency needed |
| Config snapshot tests | Verify backward compatibility when `AgentConfig` schema evolves |
| Schema registry snapshots | Catch Pydantic model drift that would silently break `output_schema` |
| Purpose coverage | Both agent and sync paths tested for every purpose |
| Integration tests | Patched bridge + real app code paths (no live API call) |
| Manual smoke tests | Real vault/data against actual agent mode before merging changes |

### FakeAgentBridge Skeleton

```python
class FakeAgentBridge:
    """Sync test double for AgentBridge. No pytest-asyncio required."""

    def __init__(self, response: str, structured: dict | None = None):
        self._response = response
        self._structured = structured

    def run_sync(self, prompt: str, config: AgentConfig) -> dict:
        return {
            "content": self._response,
            "structured_output": self._structured,
            "total_cost_usd": 0.0,
            "turn_count": 1,
        }
```
