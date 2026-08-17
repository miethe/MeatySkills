---
name: ica-delegate
description: >-
  Delegate bounded agentic work to IBM ICA-provisioned Claude instances via ~/ica-claude.sh.
  Use when offloading parallel subtasks, accessing free-tier models for mechanical work,
  or cost-shifting bounded tasks to a secondary subscription.
version: 2.12
app_version: "2026-06-11"
updated: 2026-08-17
spec: ./SPEC.md
---

# ICA Delegate

Delegate bounded work to a secondary Claude subscription accessed through the IBM ICA gateway. The transport is `~/ica-claude.sh -p "prompt"` with model, turn, and output flags. Each invocation is independent by default — no shared state with the calling session.

> ### 🔑 You do NOT set, pass, or manage an API key
> `~/ica-claude.sh` **already loads an active key** (`CC1` by default) from `~/.dotfiles/ICA_CLAUDE`
> on every call, and points Claude Code at the ICA gateway for you. For a normal delegation there is
> **nothing to configure** — just run the wrapper:
> ```bash
> ~/ica-claude.sh -p "your task" --model 'claude-sonnet-5[1m]' --max-turns 20 < /dev/null
> ```
> **Do NOT** set `ANTHROPIC_API_KEY`, `ICA_CLAUDE_CODE_API_KEY`, or `ANTHROPIC_AUTH_TOKEN`; **do NOT**
> pass `--api-key`; **do NOT** `export` a key. Those either do nothing or break the wrapper's own
> auth. A key is already active — you don't pick one unless you deliberately want a *different* named
> key for parallel runs (see **Key Rotation**).
>
> The only two key-related env vars you might ever set (both optional, both advanced):
> - `ICA_KEY=<NAME>` — select a **named block** to run on. The value is a block **name** like `CC1`,
>   `CC2`, … `CC6` — **never a number** (`ICA_KEY=1` ❌) and **never a raw `sk-…` token**.
> - `ICA_AUTH_TOKEN=sk-…` — supply a **raw token** ad-hoc (bypasses the key file entirely).
>
> These are different inputs: a **name** goes in `ICA_KEY`, a **token** goes in `ICA_AUTH_TOKEN`.

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
| Tasks requiring more than 200k context (standard models only) | Standard models hard-capped at 200k; use `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `claude-sonnet-5[1m]`) for tasks up to ~800k tokens |
| Interactive or multi-turn conversation with the user | Each invocation is a single Bash call; not interactive |
| Tasks requiring models unavailable on the gateway | Check model inventory first |
| Work that needs the primary session's file-edit capabilities | Delegate reads file paths, not edits in the calling workspace |

## Delegation Context Pre-Flight (CF-E — MANDATORY first step)

Before **every** dispatch, resolve the active delegation-context bundle/manifest via the
Context Fabric §E.2 resolver and thread it into the invocation with
`--append-system-prompt-file`. The resolver ladder is offline and fail-open — a pure file
read, never a model/DB/network call: `AOS_MANIFEST_REF` (execution-manifest.yaml; bundle via
its `context.bundle_ref`) → `AOS_CONTEXT_BUNDLE_PATH` (bundle path directly) → explicit path
arg → nothing. If nothing resolves, **proceed without it and log the omission to stderr** —
never block the dispatch. The plan-gate dispatcher that ran `op context pack` is the setter of
`AOS_MANIFEST_REF`; delegates never re-derive the pack (delegation-context contract).

Executable pre-flight assertion (the CF-E coverage validator greps the `CF-E-PREFLIGHT`
marker; the resolver itself exits 1 with no output when the resolve-first step was skipped —
that failing smoke is the §E.5 AC, not an error to suppress). **`--destination external` is
mandatory on this lane (D4 egress enforcement):** an ICA delegate is an external
destination, and the resolver REFUSES (exit 1) to hand over any bundle/manifest that was not
*built* destination-external (an internal build carries the personal persona slice, which
never egresses). A refusal is handled exactly like "nothing resolved": dispatch without the
bundle and log the omission — never fall back to `--destination internal` to "make it work".

```bash
# CF-E-PREFLIGHT — resolve-first (Context Fabric §E.2, D4 external lane); fail-open for the
# dispatch, fail-CLOSED for egress; ALWAYS log an omission.
CF_E_RESOLVER="${CF_E_RESOLVER:-$HOME/.claude/hooks/cf_context_resolve.py}"
CTX_FLAGS=()
CTX_BUNDLE=""
if [ -r "$CF_E_RESOLVER" ]; then
  CTX_BUNDLE="$(python3 "$CF_E_RESOLVER" --print-bundle-path --destination external 2>/dev/null || true)"
fi
if [ -n "$CTX_BUNDLE" ]; then
  CTX_FLAGS=(--append-system-prompt-file "$CTX_BUNDLE")
else
  echo "[CF-E-PREFLIGHT] no external-safe delegation context resolved (ref unset/unreadable, or the artifact was built destination-internal and is REFUSED for egress, D4) — dispatching WITHOUT the context bundle" >&2
fi

~/ica-claude.sh -p "your task" "${CTX_FLAGS[@]}" \
  --model 'claude-sonnet-5[1m]' --max-turns 20 < /dev/null
```

Composition notes:

- Under `--bare` the bundle competes with the curated root `CLAUDE.md` for the
  `--append-system-prompt-file` slot — when you need **both**, concatenate them into one temp
  file and pass that single path (`cat "$CTX_BUNDLE" /path/to/CLAUDE.md > /tmp/ctx.$$.md`).
- The resolver deploys to `~/.claude/hooks/cf_context_resolve.py` (upstream:
  `agentic_meta_dev/infra/persona-hooks/cf_context_resolve.py`, installed by that directory's
  `install.sh`); override the path with `CF_E_RESOLVER`. Spec:
  `agentic_meta_dev/docs/project_plans/design-specs/context-fabric/CF-E-auto-injection.md`.

## The Split That Works (orchestrator vs free ICA)

On a taste-sensitive, multi-phase build (the Command Center v3 visual rebuild),
paid subagents were **never needed** — this split delivered the whole feature:

| Keep in the orchestrator session | Delegate to free ICA |
|----------------------------------|----------------------|
| Token-budget-sensitive work; the design-system / CSS application | Seed authoring, demo content, fixtures |
| Novel components and anything where **taste / fidelity** is the deliverable | Test maintenance and mechanical wiring |
| The **fix loop** (iterate → screenshot → compare) | Bounded backend enrichment with a clear contract |
| Final adjudication and merge | One **opus-ICA read-only delegate** for the adversarial / visual-fidelity review |

Heuristic: delegate to ICA when the task is **mechanical and ≤2–3 files in scope**
with a clear deliverable; keep it in-session when the output is judged by taste, when
it touches the design system, or when it's a tight iterate-and-verify loop. Whatever
you delegate, re-run its gates in-session before trusting it (see Build-and-Gate
Pre-Flight and `dev-execution/orchestration/batch-delegation.md`).

## Confidence Anchor

| Check | Expected |
|-------|----------|
| `~/ica-claude.sh` exists and is executable | `test -x ~/ica-claude.sh` passes |
| API key file present | `~/.dotfiles/ICA_CLAUDE` contains `ICA_CLAUDE_CODE_API_KEY=...` |
| Gateway endpoint | `https://api.nextgen-beta.ica.ibm.com/ica` |
| Default model in script | `claude-opus-4-8[1m]` via `ANTHROPIC_MODEL`, **and** `model: "claude-opus-4-8[1m]"` in `ica-settings.json` — both must be `[1m]` or the no-`--model` default silently downgrades to 200k (see "Durable fix" below). Still prefer an explicit `--model`. |
| Free-tier models | `claude-haiku-4-5`, `gemma-4-26b-a4b-it`, `meta-llama/llama-4-maverick-17b-128e-instruct-fp8`, `ibm/granite-4-h-small` |
| Context cap | 200k (standard models); ~1M for `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `claude-sonnet-5[1m]`) — confirmed 2026-06-08 |

## Prefer `[1m]` for Opus, Sonnet, and Gemini — Always **on the Claude Code path**

> ### 🚦 First decide the CALL PATH, then the id form — they are not the same rule
> `[1m]` is a **Claude Code client-side hint**, not a gateway model id. It is *right* on the
> wrapper path and *fatal* on a raw transport. Pick the row for how you are calling:
>
> | Call path | Id form | Wrong form gives you |
> |---|---|---|
> | `~/ica-claude.sh` / `claude --model` / `ica-settings.json` / Agent-tool subagents | **`[1m]`** — `'claude-sonnet-5[1m]'` | plain id → silent 200k cap (no error, truncated context) |
> | Raw `POST /v1/messages`, `/chat/completions`, Anthropic/OpenAI **SDKs**, any app adapter (e.g. an embedded agent in your own service) | **plain** — `claude-sonnet-5` | `[1m]` → **HTTP 403 `team_model_access_denied`** |
>
> The 403 message is *"team not allowed to access model. This team can only access
> models=['global-models']"*, which reads like the model is unavailable to you entirely. It is
> not — **drop the suffix and the identical call succeeds.** Before concluding any ICA model is
> unavailable, retry once with `[1m]` stripped.
>
> **Positive proof, not inference:** `GET /v1/models` lists **22** servable ids and **zero** of
> them contain `[1m]` (verified 2026-08-07). The suffix exists only in the Claude Code client
> layer — see [Enumerate the catalog](#enumerate-the-catalog-free-authoritative) below and
> `references/ica-models.md`.
>
> ⚠️ **If you are building an app/SDK adapter against ICA, this section's title does not apply
> to you** — you are on the bottom row. Send bare ids.

**When delegating to ICA *via Claude Code*, always use the `[1m]` (1M-context) variant for Claude Opus/Sonnet AND Gemini** wherever one exists. Same shared token pool, same cost tier, strictly larger context window — there is no downside, and it removes the silent-truncation risk on context-heavy work. The gateway **silently caps the plain id at 200k** even for models that are natively 1M (Sonnet 5, Gemini 3.x); the `[1m]` suffix is what unlocks the full window on the ICA path.

| Class | Plain (avoid) | Use this `[1m]` variant |
|-------|---------------|-------------------------|
| **Sonnet 5** (preferred ICA workhorse for **non-reasoning** waves, since 2026-07-08) | `claude-sonnet-5` | `claude-sonnet-5[1m]` |
| Sonnet 4.6 (older fallback) | `claude-sonnet-4-6` | `claude-sonnet-4-6[1m]` |
| Opus 4.8 (default) | `claude-opus-4-8` | `claude-opus-4-8[1m]` (or `opus[1m]` alias) |
| Opus 4.7 | `claude-opus-4-7` | `claude-opus-4-7[1m]` |
| Opus 4.6 | `claude-opus-4-6` | `claude-opus-4-6[1m]` |
| Gemini 3.5 Flash | `gemini-3.5-flash` | `gemini-3.5-flash[1m]` |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview[1m]` |

> ⚠️ **Keep the `claude-` prefix on the `[1m]` id.** The bare form `sonnet-4-6[1m]` / `sonnet-5[1m]` **401s** on teams limited to the `global-models` group: the gateway strips `[1m]`, is left with the un-prefixed `sonnet-4-6` (not in `global-models`), and rejects it. Use the fully-prefixed `claude-sonnet-5[1m]` (Sonnet 5 confirmed 1M via `modelUsage.contextWindow` on 2026-07-08). The `opus[1m]` alias is fine (routes to `claude-opus-4-8[1m]`), but for Sonnet there is no bare alias — always write `claude-sonnet-5[1m]`.
>
> ⚠️ **Quote the model arg in zsh.** `[1m]` is a glob bracket; unquoted, zsh aborts the whole command with `no matches found` (NO_MATCH is fatal) and nothing runs. Always: `--model 'claude-sonnet-5[1m]'`.

> ✅ **ICA Sonnet 5 reasoning WORKS via Claude Code — reasoning-dependent offload is fine (revalidated
> 2026-07-20; supersedes the stale 2026-07-09 "no reasoning" caveat).** Claude Code (2.1.215) now emits
> the `thinking.type: adaptive` + `output_config.effort` controls the Claude-5 family needs, and ICA
> Sonnet 5 reasons end-to-end. Evidence (raw `/ica/v1/messages`, **`--fallback-model` OFF**, unique
> nonces): legacy `thinking.type: enabled` now returns **HTTP 400** on Sonnet 5 (so if CC still sent
> legacy the leg would *error*, not run flat); adaptive produces real thinking blocks and
> `output_config.effort` scales depth (effort=low → ~1,116 think tokens, max → 6,000 capped); the CC
> path is proven (`claude --model 'claude-sonnet-5[1m]'`, fallback off → thinking block, no 400).
> 0-token cases are adaptive *correctly declining* to think on trivial prompts.
>
> **So `claude-sonnet-5[1m]` is the offload workhorse for both bounded/mechanical AND
> reasoning-dependent waves** (behind the usual reviewer gate). `claude-opus-4-8[1m]` remains the pick
> when you want the strongest reasoning, but Sonnet 5 reasoning is no longer disqualified from ICA.
>
> **⚠️ One remaining gap:** `output_config.format` (structured-JSON schema) is silently **dropped** by
> the ICA gateway (effort passes through, format does not) → you get prose, not schema-constrained
> JSON. For structured output on the ICA Sonnet 5 lane, use a forced **tool-call** instead. Full
> detail: MODEL-ROUTING §1.

Exceptions (no `[1m]` needed): **Haiku** and the free open models (Gemma, Llama, Granite) — mechanical/free-tier work where context is not the constraint and no `[1m]` variant exists; and **GPT**, served at its native window. ⚠️ **Gemini on ICA is NOT served at its native 1M** — the plain `gemini-3.5-flash` / `gemini-3.1-pro-preview` ids cap at 200k on the gateway; use the `[1m]` id there. (On the **native gemini-cli** path Gemini 3.x *is* 1M without a suffix — the `[1m]` id is an ICA-gateway artifact only.) The plain 200k Opus/Sonnet/Gemini IDs remain valid only as a fallback if a `[1m]` variant is unavailable.

> The delegation-router enforces the same rule automatically: for ICA-served Opus/Sonnet/Gemini it emits the `[1m]` model_id and keeps the plain 200k ID as a demoted fallback (see `model-registry.yaml` → "ICA 1M-CONTEXT PREFERENCE").

## ICA is NOT a validation lane — a green run here proves nothing about the paid lane

**The gateway silently discards unrecognized top-level request fields.** It is a LiteLLM-style
proxy, not the Anthropic API, and its outer envelope is loosely validated. Anthropic direct
returns **400** for the same body. Verified 2026-08-07 (`/v1/messages`, `claude-haiku-4-5`):

| Request body | ICA | Anthropic direct |
|---|---|---|
| `"ccdash_unknown_probe": true` (invented field) | **200** — ignored | 400 |
| `"max_tokenz": 5` (misspelled real field) | **200** — ignored, `max_tokens` default applies | 400 |
| `"temperatur": 0.9` (misspelled real field) | **200** — ignored, runs at default temperature | 400 |
| `"tool_choise": {...}` (misspelled real field) | **200** — ignored, no tool forcing | 400 |
| `messages[0].bogus_nested: 1` (**nested** unknown) | **400** `messages.0.bogus_nested: Extra inputs are not permitted` | 400 |

Read the asymmetry carefully — it is the trap. **Top-level = lax, nested = strict.** So partial
strictness gives false confidence: your nested content is schema-checked, your envelope is not.

The dangerous case is not the invented field, it is the **typo in a real one**. `temperatur: 0.9`
is accepted, silently ignored, and your call runs at default temperature — behaving *plausibly*
while doing something other than what you wrote. Then it 400s on the paid lane, or worse, quietly
behaves differently there.

**Rules:**
- **Never treat an ICA 200 as evidence your request shape is correct.** Validate request bodies
  against **Anthropic direct** (or a local JSON-schema check) — ICA-green means nothing.
- A parameter that "had no effect" on ICA was very possibly **never sent**. Check spelling before
  concluding the gateway strips a feature. (Genuine strips do exist — e.g. `output_config.format`
  on Sonnet 5 — but a typo is indistinguishable from a strip by observation alone.)
- Assert the effect, not the acceptance: read `usage`, `stop_reason`, `modelUsage.<id>` back.

## Enumerate the catalog — free, authoritative

`GET /v1/models` is the only reliable answer to *"is model X served on ICA?"* — free, instant, no
tokens, no model call. Prefer it over probing candidate ids one at a time (which is how a plain
availability question gets misread as an access problem).

```bash
KEY="$(grep -E '^ICA_CLAUDE_CODE_API_KEY=' ~/.dotfiles/ICA_CLAUDE | head -n1 | cut -d= -f2-)"
curl -s https://api.nextgen-beta.ica.ibm.com/ica/v1/models -H "x-api-key: $KEY" \
  | python3 -c 'import json,sys;[print(m["id"]) for m in json.load(sys.stdin)["data"]]'
```

Full 22-id inventory, what it proves about `[1m]`, and the LiteLLM/Bedrock identity of the
gateway: `references/ica-models.md`.

**Reasoning *about* the gateway rather than delegating through it?** `references/ica-platform-facts.md`
carries the measured platform facts: the four-party data path (Cloudflare → IBM Go gateway → a
**forked** LiteLLM → Bedrock in IBM's account, Instana-traced), what it can capture and act on,
`x-litellm-key-spend` as a free zero-token spend read, and — most easily missed — **how to tell
whether your own session is ICA-routed**, since a local subagent inherits the gateway from its
launcher and "local" is not a synonym for "stays on this machine".

## ICA Gateway Model Routing (Agent Tool)

When the calling agent is itself running on the ICA profile, the built-in **Agent tool** (subagents) has a model routing constraint:

| Model specifier | Resolves to | Gateway accepts? |
|----------------|-------------|-----------------|
| `model: "sonnet"` | Gateway-compatible ID | **Yes** |
| `model: "opus"` | Gateway-compatible ID | **Yes** |
| `model: "haiku"` (default) | `claude-haiku-4-5-20251001` (dated ID) | **No** — 401 error |
| Omitted (default) | Haiku dated ID | **No** — 401 error |

The ICA gateway only accepts models in the `global-models` group. Dated model IDs (e.g., `claude-haiku-4-5-20251001`) are NOT in that group. **Always specify `model: "sonnet"` or `model: "opus"` when using the Agent tool on the ICA profile.** Alternatively, delegate via `~/ica-claude.sh` (Bash tool) which handles model routing through its own `--model` flag.

### Durable fix — alias remap in `ica-settings.json` (no proxy needed)

The 401 above is the `haiku`/`sonnet`/`opus` **alias** resolving to a non-`global-models` id (dated Haiku, or plain 200k Sonnet). The Claude Code model-config env vars remap what those aliases resolve to, and `~/ica-claude.sh` already loads `--settings ~/.claude/ica-settings.json` — so set them there once and **every** delegate, subagent (e.g. a `model: haiku` `document-writer`), and background task on the ICA profile is fixed, with zero effect on the primary Anthropic session:

```jsonc
{
  "model": "claude-opus-4-8[1m]",            // no-`--model` default is now 1M, not plain 200k
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.nextgen-beta.ica.ibm.com/ica",
    "ANTHROPIC_DEFAULT_OPUS_MODEL":   "claude-opus-4-8[1m]",   // `opus`  alias → 1M
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5[1m]",   // `sonnet` alias → Sonnet 5, 1M (ICA serves Sonnet 5 since 2026-07-08; was claude-sonnet-4-6[1m])
    "ANTHROPIC_DEFAULT_HAIKU_MODEL":  "claude-haiku-4-5"       // `haiku` alias + background tasks → global-models id (kills the 401)
  }
}
```

- `ANTHROPIC_DEFAULT_HAIKU_MODEL` controls the `haiku` alias **and** background functionality (title-gen, summaries) — both otherwise resolve to the dated id and 401. This is the fix for any subagent pinned to `model: haiku`.
- `CLAUDE_CODE_SUBAGENT_MODEL` is a heavier alternative: it forces **all** subagents to one model, overriding their frontmatter. Avoid it unless you want to flatten every subagent to a single model — the alias remaps above are more surgical.
- A global LiteLLM-style proxy is unnecessary: these env vars do the same remap declaratively and stay scoped to the ICA profile.

### Built-in `WebSearch` / `WebFetch` — broken under ICA, NOT alias-fixable

When the session runs on the ICA profile, the built-in **`WebSearch`** and **`WebFetch`** tools fail for the orchestrator **and** every delegate/subagent:

```
API Error: 400 {"message":"The provided request is not valid"}. Received Model Group=claude-haiku-4-5
```

Key differences from the Agent-tool 401 above:

- It is a **400** (malformed request), not a 401 (auth/model-group). These tools pin their **own** internal `claude-haiku-4-5` model group, which the gateway rejects outright.
- The `ANTHROPIC_DEFAULT_HAIKU_MODEL` alias remap does **NOT** fix it — these tools do not resolve through the `haiku` alias. There is no settings-level fix.
- Overriding a subagent's `model: opus` does **not** help — the failing model group is internal to the tool, not the agent. Verified: a delegate spawned with `model: opus` hits the identical 400.

**Workaround — route web work through model-routing-independent CLIs (Bash tool), never the built-ins:**

| Need | Use | Why it works |
|------|-----|--------------|
| Web search | `firecrawl search "<query>" --limit N` (firecrawl skill) | External Firecrawl API, independent of Anthropic model routing |
| Scrape / fetch a URL | `firecrawl scrape <url>` | same |
| Second search source | `gemini-cli` skill (Google Search) | Routes through Google, not the ICA gateway |

Firecrawl auth/credits: `firecrawl --status` (shared credit pool, ~1,000/cycle — don't burn on loops). Because these are Bash CLI calls, **delegates can use them too** — pass the recipe in the delegate prompt rather than expecting `WebSearch` to work.

## Routing Posture

CLI (`~/ica-claude.sh -p`) is the only supported transport. Each call is stateless by default; use `--continue`/`--resume` for opt-in session continuity across calls. In `-p` mode the agent runs to completion unless constrained by `--max-turns` or `--max-budget-usd`. Future: LiteLLM gateway endpoint.

### Cost: the ICA gateway is free-to-us

Delegating to ICA is **cost-shifted** — these calls do not bill our primary budget. Dollars are therefore **not** the constraint, and `--max-budget-usd` is **generally unnecessary** (and actively harmful for live/stateful work — see below). Default to **omitting it**. Prefer allowing the delegate to do **more / deeper work**, especially for opus-driven reasoning, rather than throttling it. The only real discipline that still applies is **don't waste tokens on pointless loops** — bound that with a generous `--max-turns` (a backstop against runaways, not a cost lever), never with a dollar cap. Treat any `--max-budget-usd` figure in the recipes below as legacy/optional, not recommended.

## Invocation Flags

⚠️ **NEVER pass `--dangerously-skip-permissions`. It is what makes the dispatch fail.**

Measured 2026-08-14: **4 of 4** `ica-executor` legs were refused by the Claude Code auto-mode
permission classifier *before running*, on that flag. It is not an availability failure, and walking
`fallback_chain` is wrong — a denial is a decision about whether this content may take this path
(delegation-router SPEC §5a). An `allow` rule does **not** rescue it: `Bash(~/ica-claude.sh:*)` has
been in `~/.claude/settings.json` the whole time and every one of those legs was still denied. The
classifier objects to the flag token in the argument list, not to the script.

Verified by two-sided probe the same day:

| Invocation | Result |
|---|---|
| wrapper, no dangerous flag | **allowed**, rc=0 |
| wrapper **+ `--dangerously-skip-permissions`** | **denied**, 4/4 |
| wrapper + a `permissions` block in the settings file, no flag | **allowed**, rc=0, ran Bash |

**PREREQUISITE — `~/.claude/ica-settings.json` must carry a `permissions` block.** The wrapper
already passes `--settings "$HOME/.claude/ica-settings.json"` on every call, so the grant belongs
there, declared once, rather than retyped per invocation. It needs `defaultMode` (`acceptEdits` is
sufficient — probed) plus an `allow` list covering the tools your legs actually use, and a `deny`
list. This is a real reduction in authority, not the flag relocated: the flag grants everything; the
block grants a named set and can deny `git push` / `git merge` / `git stash` / `reset --hard` /
`rm -rf`.

If a delegate reports a tool it cannot use, **widen that `allow` list — never reach back for the
flag.** In headless `-p` mode an un-allowlisted call is *refused*, not prompted, so it fails loudly
rather than hanging. Editing that file is a **human action**; agents do not rewrite their own grants.

Also pass `< /dev/null` unless you are genuinely piping stdin — otherwise the wrapper waits 3s and
warns `no stdin data received`.

| Flag | Purpose | When to Use |
|------|---------|-------------|
| ~~`--dangerously-skip-permissions`~~ | ~~Bypass all permission prompts~~ | 🚫 **NEVER** — the auto-mode classifier denies the whole invocation (4/4, 2026-08-14). Use the `permissions` block in `ica-settings.json` instead |
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
| `--bare` | Skip hooks, LSP, plugin sync, attribution, **auto-memory, and CLAUDE.md auto-discovery** (skills still resolve via `/name`) | Repo-launched calls — but **must be paired with explicit context re-injection** (see "Context Injection Under `--bare`") |
| `--append-system-prompt-file <path>` | Inject a specific file's contents into the system prompt | **The bare-mode companion** — feed the root/curated CLAUDE.md without triggering full-tree discovery |
| `--system-prompt-file <path>` | Replace (not append) the default system prompt with a file | Heavily customized delegate personas (rare) |
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
3. **Always pass `--bare` when launching from inside a repo that has a large `CLAUDE.md`/rules/memory** (e.g. this project). Without it the delegate auto-loads the entire project context on startup and fails with **`Prompt is too long`** before your task even runs. `--bare` skips hooks/skills/MCP/auto-memory/CLAUDE.md — so **re-inject the bounded root CLAUDE.md via `--append-system-prompt-file`** (and `--add-dir` for on-demand reads of deeper docs) or the delegate flies blind on conventions. See "Context Injection Under `--bare`".
4. **Transient gateway drops happen** (`API Error: socket connection closed unexpectedly`). Add `--fallback-model` for resilience and simply retry — a single drop is not a reason to abandon bash delegation.
5. **Sequence live ops as: read-only verify → mutate → read-only verify.** Before a mutating retry, run a cheap read-only state-check delegate so you never mutate a system whose current state you cannot confirm.

## Context Injection Under `--bare` — Don't Fly Blind

`--bare` is **mandatory** for any delegate launched from inside a real project (it prevents the `Prompt is too long` startup failure). But `--bare` skips **CLAUDE.md auto-discovery AND auto-memory** — so a bare delegate launched naked gets **zero project conventions**. It only knows what you put in the prompt. This is the #1 silent quality leak in bash delegation: the delegate ignores frozen-file rules, commit policy, test commands, and arch invariants it was never told about.

The CLI is designed to pair `--bare` with **explicit** context re-injection. Always do this when delegating into a project:

| Mechanism | What it does | Use for |
|-----------|--------------|---------|
| `--append-system-prompt-file <root>/CLAUDE.md` | Injects the **root** CLAUDE.md only (~3–8k tokens) — bounded, deterministic | The always-on baseline for repo delegations |
| `--add-dir <project>` | Grants filesystem access so the delegate can **read** nested/feature CLAUDE.md and context files on demand | Let the delegate pull deeper context itself (name the paths in the prompt) |
| Prompt path list | "Read `./packages/foo/CLAUDE.md` and `./docs/ARCH.md` before editing" | Surgical, on-demand context without inlining file contents |

### Why a naked `--bare` overloads in the first place

The failure is **gateway ceiling × monorepo CLAUDE.md tree**, not "ICA loads more than normal":
- ICA `[1m]` models **self-report a 200k window**; the CLI sizes its "prompt too long" / compaction logic against that, and the beta gateway enforces a real per-request input cap well under the advertised 1M.
- CLAUDE.md **auto-discovery** in large monorepos is huge — e.g. `skillmeat` (**121 files / ~849k chars**), `meatywiki` (**49 files / ~1.14M chars**). Auto-discovery + a large inline prompt stacks past the effective ceiling → `Prompt is too long` *before the task runs*.
- Normal subscription subagents don't hit this: correctly-reported large window + lazy interactive CLAUDE.md loading.

`--bare` removes the runaway auto-discovery; `--append-system-prompt-file` adds back **only** the bounded root instructions. Never re-enable full auto-discovery (drop `--bare`) to "fix" missing context — that reintroduces the overload.

### Recommended: a curated delegate context pack

For a project you delegate into repeatedly, maintain a hand-trimmed `CLAUDE.delegate.md` (or `docs/AGENT_CONTEXT.md`) holding only what a fresh delegate needs — frozen-file/ownership rules, commit policy (orchestrator commits, delegates don't), test/build commands, arch invariants. Inject it with `--append-system-prompt-file`. Best of both: project-aware **and** bounded, with zero tree-discovery risk.

### Canonical repo-delegation skeleton

```bash
~/ica-claude.sh -p "Task: ...
Project conventions are in the injected CLAUDE.md. If you touch packages/foo,
read ./packages/foo/CLAUDE.md first. Write files incrementally.
Deliverable: ..." \
  --model 'claude-opus-4-8[1m]' \
  --bare \
  --append-system-prompt-file /path/to/project/CLAUDE.md \
  --add-dir /path/to/project \
  --max-turns 40 \
  --allowedTools "Read Write Edit Bash"
```

## Build-and-Gate Pre-Flight (worktree · env · data · visual)

Before any build-and-gate delegation wave, run these checks. They each map to a
real failure that cost a session (see the Command Center one-shot AAR). "Green
gates" do **not** prove these — every one passed unit tests while the running app
was broken or off-brief.

1. **Worktree env parity.** A git worktree does **not** inherit the main checkout's
   untracked files — including `.env`. The Command Center build broke because the
   v2 worktree had **no `backend/.env`**, so the backend booted with config defaults
   (`SEED_ON_STARTUP=false`, default DB creds) that diverged from the main checkout.
   Preflight: copy/create the worktree's `.env` (DB URL, secrets, feature/seed flags)
   and confirm it matches the surface you'll actually run. Plus the AAR's uv traps:
   `uv sync --reinstall-package <editable-pkg>`, `uv sync --extra dev`, and assert the
   resolved tool path (`which pytest && pytest --version`) to catch silent PATH fallbacks.

2. **Data/seed assumptions.** Tests use fixtures; the *running app* needs real data.
   The Command Center frontend hardcodes an active-workspace slug (`ACTIVE_TREE_SLUG
   = "atlas"`) that only exists if the demo seed is loaded — and the seed had been made
   opt-in. Result: every pre-existing page 404'd against a clean DB even though all
   tests passed. Preflight: identify what data the running surface assumes (default
   IDs/slugs, seed workspaces), and either seed the target DB or confirm the app
   resolves it dynamically. **Smoke the live endpoints, not just the test suite.**

3. **Visual grounding for any FE work (do not style from prose).** The #1 reason a
   build "looks like crap / ignores the mockups": delegates were handed a *prose*
   design brief, never the images. A prose paraphrase reproduces layout structure and
   loses all aesthetic fidelity. Preflight for every FE delegate:
   - Point it at the **specific** mockup/reference PNG(s) for its region and require it
     to `Read` them (they're images — the Read tool renders them).
   - Load the project's **design-system skill / token kit** (e.g. IntentTree's
     `.agents/skills/intenttree-design-system/` — `tokens.css`, `components.css`,
     `DESIGN.full.md`, per-view ref images) and require token use, not ad-hoc CSS.
   - Add a **visual-fidelity review pass** (a read-only delegate that diffs the built
     screen against the reference image) — behavioral/unit gates never catch this.
     Run it per the `dev-execution` skill's `validation/visual-fidelity.md` protocol:
     **capture by structural selector + screen-identity assertion** (never visible
     text — title collisions clicked the wrong card and got a never-captured screen
     reviewed in v3); **region-crop the build shots** on the same grid as the reference
     crops before dispatching (the Read-tool downsamples full-page PNGs, so a reviewer
     judging a full shot mistakes illegible-but-present elements for missing ones); and
     keep an **adjudication pass mandatory** — re-verify every finding against zoom crops
     and classify {real / capture artifact / misread / accepted deviation} before coding.
     Capture to disk with **Playwright** (Chrome-MCP shots are invisible to delegates);
     dnd-kit needs manual pointer choreography (`playwright-visual-review-capture` memory).

4. **Run the orchestration inside the target repo.** Delegating a project build from a
   *sibling* docs repo strands the target's own skills, `.agents/`, `CLAUDE.md`, and
   design references out of scope. Launch the orchestrator with the **target repo** as
   cwd (or `--add-dir` it and name the skill/ref paths) so design-system skills and
   reference images are loadable by the FE delegates that need them.

## Routing Table

| Intent | Pattern | Model | Tool Scope | Turn Cap |
|--------|---------|-------|------------|----------|
| Quick answer / extraction | Single-shot, no tools | `claude-haiku-4-5` (free) | None | — |
| Bounded code task (generate, refactor) | Agentic | `claude-sonnet-5[1m]` (4.6[1m] = older fallback) | `"Read Write Edit Bash"` | `--max-turns 20` |
| Large parallel fan-out (many small tasks) | Multiple single-shot calls | `claude-haiku-4-5` (free) | None | — |
| Complex reasoning subtask | Agentic | `claude-opus-4-8[1m]` | `"Read Write Edit Bash"` | `--max-turns 50` (no cost cap — ICA is free-to-us) |
| Structured data extraction | Single-shot + `--json-schema` | `claude-haiku-4-5` (free) | None | — |
| Second opinion (read-only review) | Agentic, read-only | `gpt-4o` or `gemini-3.1-pro-preview` | `"Read Bash(grep:*) Bash(find:*)"` | `--max-turns 15` |
| **Large-context task (>100k–800k tokens input)** | Single-shot or agentic | `claude-opus-4-8[1m]` or `opus[1m]` | As needed | — |
| **Live infra / DB / deploy (mutating)** | Agentic, `--bare`, self-restoring prompt | `claude-opus-4-7[1m]`/`-4-8[1m]` + `--fallback-model` | `"Read Bash"` | **No cost cap; generous `--max-turns` only** — see "Live/Stateful Delegations" |

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
  --model claude-haiku-4-5
```

### Recipe 2 — Agentic Implementation (Standard Tier)

```bash
~/ica-claude.sh -p "Task: [task description]
Context: [minimal required context -- file paths, not contents]
Deliverable: [expected output format]" \
  --model 'claude-sonnet-5[1m]' \
  --max-turns 20 \
  --allowedTools "Read Write Edit Bash" \
  --add-dir /path/to/project \
  --append-system-prompt "Complete the task in a single pass. Do not iterate beyond the initial implementation."
```

### Recipe 3 — Read-Only Review (Standard/Cross-Family)

```bash
~/ica-claude.sh -p "Review [target] for [criteria]. Report findings only." \
  --model gpt-4o \
  --max-turns 15 \
  --allowedTools "Read Bash(grep:*) Bash(find:*) Bash(git:*)" \
  --add-dir /path/to/project
```

### Recipe 4 — Structured Output (Free Tier)

```bash
~/ica-claude.sh -p "Extract [thing] from [source]. Return JSON matching this schema: {...}" \
  --model claude-haiku-4-5 \
  --output-format json
```

### Recipe 5 — Parallel Fan-Out (Free Tier)

```bash
for item in "${items[@]}"; do
  ~/ica-claude.sh -p "Process: $item" \
    --model claude-haiku-4-5 \
    > "/tmp/delegate-output-${item}.txt" &
done
wait
```

### Recipe 6 — Deep Opus Reasoning (no cost cap)

ICA is free-to-us, so do **not** dollar-cap opus reasoning — let it do the work. Bound only with a generous `--max-turns` as a runaway backstop. (Omit `--max-budget-usd` entirely; the old "budget-capped" framing is deprecated.)

> ✅ **Sonnet 5 is a valid cheaper reasoning lane here (revalidated 2026-07-20).** ICA
> `claude-sonnet-5[1m]` now reasons via Claude Code (adaptive thinking + `output_config.effort`
> honored — see the reasoning note above). Prefer **Opus** (`claude-opus-4-8[1m]`, below) for the
> hardest reasoning; drop to `claude-sonnet-5[1m]` when Sonnet-tier reasoning suffices. Only caveat on
> the Sonnet 5 lane: `output_config.format` structured JSON is dropped — use a tool-call.

```bash
~/ica-claude.sh -p "Task: [complex architecture/design task]
Context: [paths to relevant files]
Deliverable: [structured recommendation]" \
  --model claude-opus-4-8[1m] \
  --bare \
  --append-system-prompt-file /path/to/project/CLAUDE.md \
  --max-turns 60 \
  --effort high \
  --fallback-model claude-opus-4-7[1m],claude-opus-4-6[1m] \
  --allowedTools "Read Bash(grep:*) Bash(find:*)" \
  --add-dir /path/to/project
```

> When launching from inside a project, pair `--bare` with `--append-system-prompt-file <root>/CLAUDE.md` so the delegate still gets project conventions. See "Context Injection Under `--bare`".

### Recipe 7 — Session-Continuity Workflow

```bash
# First call — starts a session
~/ica-claude.sh -p "Analyze /path/to/codebase for security issues. Write findings to /tmp/security-report.md" \
  --model 'claude-sonnet-5[1m]' \
  --allowedTools "Read Write Bash(grep:*) Bash(find:*)" \
  --add-dir /path/to/codebase

# Follow-up call — continues the same session
~/ica-claude.sh -p "Now prioritize the findings by severity and add remediation suggestions" \
  --continue
```

### Recipe 8 — Bare Mode Fan-Out (Optimized)

```bash
for file in "${files[@]}"; do
  ~/ica-claude.sh -p "Summarize: $file" \
    --model claude-haiku-4-5 \
    --bare \
    --no-session-persistence \
    > "/tmp/summary-$(basename "$file").txt" &
done
wait
```

### Recipe 9 — Schema-Validated Structured Output

```bash
~/ica-claude.sh -p "Extract all function signatures from /path/to/module.ts" \
  --model claude-haiku-4-5 \
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
  --append-system-prompt-file /path/to/project/CLAUDE.md \
  --add-dir /path/to/project \
  --max-turns 30 \
  --fallback-model claude-opus-4-8,claude-opus-4-7[1m],claude-opus-4-7
```

> **Note**: `[1m]` variants self-report 200k context — ignore this. Confirmed ~1M actual context (tested 2026-06-08). Practical ceiling ~800k tokens to leave room for output and tool-use overhead.

---

## Do Not Say

| Prohibited Claim | Truth |
|-----------------|-------|
| "The ICA gateway supports unlimited context" | False. Standard models have a hard 200k cap; `[1m]` variants (`opus[1m]`, `claude-opus-4-8[1m]`, `claude-sonnet-5[1m]`) are confirmed to ~1M but are NOT unlimited. |
| "All models on the gateway are free" | Only specific small models (Haiku, Gemma) are free tier. |
| "Use this for tasks requiring the current session's MCP tools" | Delegates cannot access the calling session's MCP servers. |
| "The delegate can continue a previous conversation" | Each invocation is stateless by default. Use `--continue`/`--resume` for opt-in continuity. |
| "Include `--dangerously-skip-permissions` so the delegate can act" | **Inverted 2026-08-14.** That flag now gets the invocation DENIED by the auto-mode classifier before it runs (4/4 legs, ~660k tokens for zero deliverable). Omitting it is correct; the grant lives in `ica-settings.json`'s `permissions` block. The old advice — that omitting causes hangs — held only with no such block: with one, a headless leg runs Bash fine (probed), and an un-allowlisted call is refused rather than hung. |
| "Use `--continue` for multi-turn conversations with users" | False. `--continue` resumes a prior session; it does NOT create an interactive multi-turn experience. Each `~/ica-claude.sh` call is still a single Bash invocation. |
| "Use `--bare` for all delegations" | Not always. `--bare` skips skills/plugins which may be needed for some tasks. Use for mechanical/fan-out work. |
| "`--bare` delegates still get the project's CLAUDE.md" | False. `--bare` skips CLAUDE.md auto-discovery AND auto-memory. A bare delegate gets project conventions ONLY if you inject them via `--append-system-prompt-file` (+ `--add-dir` for on-demand reads). See "Context Injection Under `--bare`". |
| "If a `--bare` delegate is missing context, drop `--bare`" | False — that reintroduces the `Prompt is too long` overload (full nested CLAUDE.md tree × the gateway's effective ceiling). Keep `--bare`; re-inject the bounded root CLAUDE.md instead. |
| "Use the Agent tool with default model on ICA profile" | Default model (Haiku) uses a dated ID that the gateway rejects. Always specify `model: "sonnet"` or `model: "opus"` for Agent tool subagents. |
| "ICA Sonnet 5 can't reason / think hard, so route reasoning to Opus/Sonnet 4.6" | Stale — this was the 2026-07-09 finding, **reversed 2026-07-20**. ICA `claude-sonnet-5[1m]` reasons fine via Claude Code now (adaptive thinking + `output_config.effort` honored). Reasoning-dependent offload to Sonnet 5 is fine; reserve Opus for the hardest reasoning. See the reasoning note above. |
| "ICA Sonnet 5 returns schema-constrained JSON if I pass `output_config.format`" | False. The ICA gateway silently drops `output_config.format` (it forwards `effort` but not `format`) → you get prose, not schema JSON. Use a forced **tool-call** for structured output on the ICA lane. |

## Key Rotation

Keys live in `~/.dotfiles/ICA_CLAUDE`. Format: `## NAME` header followed by `[#]ICA_CLAUDE_CODE_API_KEY=sk-...`. Exactly one line is uncommented (active). `ica-key` manages rotation non-interactively; use `$ICA_KEY_FILE` to point at a test copy.

```bash
ica-key list              # all keys: name, masked value, active marker
ica-key list --json       # machine-readable (useful for scripts)
ica-key current           # active key name + masked value
ica-key use CC1           # activate CC1, comment all others (atomic write + .bak)
ica-key next              # rotate to next key in file (wraps); prints old→new
ica-key verify            # test active key against gateway; exit 0=ok / 1=failed
ica-key verify CC1 --json # test a specific key; JSON: {name, masked_key, http_status, classification}
ica-key add CC4 <key>     # append inactive block; --use to also activate
ica-key remove CC3        # delete block; refuses if active (--force to override)
```

`ICA_KEY=<NAME>` env override — when set on `~/ica-claude.sh`, selects that named block's key (even if commented) **without rewriting the file**. Leave it unset and the currently-active block is used automatically. Set it to run a *specific* named key — for parallel sessions on different keys, or to spread a fan-out (see **Spreading load** below):

⚠️ **Do not hardcode a key name as "the active one".** Which block is uncommented changes every time anyone runs `ica-key use`/`next`, and this section named `CC1` for long enough to go stale (the active key was `CC5` on 2026-08-17). Ask: `ica-key current`.

```bash
ICA_KEY=CC1 ~/ica-claude.sh -p "task" --model 'claude-haiku-4-5'
ICA_KEY=CC3 ~/ica-claude.sh -p "task" --model 'claude-haiku-4-5'
```

**`ICA_KEY` takes a block NAME, not a number and not a token.** Valid values are exactly the `## NAME`
headers in `~/.dotfiles/ICA_CLAUDE` — **enumerate them with `ica-key list`, never from a list in a
doc.** As of 2026-08-17 that is `CC1`…`CC6` plus `BB1`; earlier revisions of this section said
`CC1`…`CC6` and had already missed one. Common mistakes:

| ❌ Wrong | Why | ✅ Right |
|---------|-----|--------|
| `ICA_KEY=1` | There is no key named `1`; blocks are `CC1`…`CC6` → wrapper errors `ICA_KEY='1' not found` | `ICA_KEY=CC1` |
| `ICA_KEY=sk-abc…` | `ICA_KEY` is a name selector, not a token slot → same "not found" error | `ICA_AUTH_TOKEN=sk-abc…` (raw-token slot) |
| `export ICA_KEY=CC2` globally | Leaks onto every later call; hard to notice | prefix one call: `ICA_KEY=CC2 ~/ica-claude.sh …` |
| Setting `ICA_KEY` "to authenticate" | Not needed — `CC1` is already active | omit it entirely |

### Exhaustion + renewal

Each key has its own allowance and a shared weekly renewal date. Per-key status
(`fresh`/`partial`/`exhausted`) and the renewal live in a sidecar
(`~/.dotfiles/ICA_CLAUDE.state.json`); the key file is never touched for state.

```bash
ica-key exhausted --rotate            # mark active key spent + rotate to next usable key
ica-key mark CC2 partial --usage 75   # record a soft usage hint
ica-key list                          # status column + renewal countdown
ica-key renewal                       # show shared renewal (auto-rolls +7d when past, resets all fresh)
```

`ica-key next` automatically skips `exhausted` keys (`--any` to override).

It also skips **reserved** keys. `ica-key reserve` marks a key as belonging to another instance —
`CC6` is reserved for Hermes — and both `next` and `use` honour that. **Never pass
`--include-reserved` or `use --force` to get at one**: the reservation exists because a
long-running instance is already spending that key's allowance, and stealing it produces two
consumers on one budget with no way to attribute either.

### Spreading load across keys — prefer `ICA_KEY=`, do NOT rotate

There are two different lanes here and conflating them is how a fan-out starves:

| Goal | Lane | Mutates the key file? |
|---|---|---|
| **React** to the active key being spent | `ica-key exhausted --rotate` | **Yes** — rewrites which block is uncommented |
| **Spread** N parallel legs across N keys | `ICA_KEY=<NAME>` per invocation | **No** |

**Rotation is the wrong instrument for spreading load.** `ica-key next` rewrites a file that every
other ICA session on this host reads, so with concurrent sessions (routinely ~30 here) two legs
rotating at once both skip keys *and* change the active key under third parties mid-run. `ICA_KEY=`
is per-process, race-free, and invisible to everyone else.

Round-robin with no shared cursor and no mutation — pick the *i*-th eligible key for leg *i*:

```bash
# Eligible = not exhausted, not reserved. Read-only; zero model calls.
ica-key list --json | python3 -c '
import json,sys
ks=[k for k in json.load(sys.stdin)["keys"]
    if k["status"]!="exhausted" and not k.get("reserved_for")]
ks.sort(key=lambda k: (k["status"]!="fresh", k.get("usage") or 0))
print(" ".join(k["name"] for k in ks))'
# -> e.g. "CC5 CC1 BB1 CC3"   then leg i uses key[i % len]
```

⚠️ **The field is `reserved_for`, not `reserved`.** `ica-key list --json` emits `reserved_for` on a
reserved entry and omits the key entirely otherwise (verified 2026-08-17: only `CC6` carries it).
Filtering on `reserved` therefore silently matches nothing and puts Hermes's reserved key back into
the pool — it went wrong exactly that way while this recipe was being written.

Ordering is deliberate: `fresh` first, then `partial` by ascending `usage`, so the least-consumed
key takes the next leg. Because selection is a pure read of `ICA_CLAUDE.state.json`, this costs
nothing and cannot race.

⚠️ **Two honest limits.** (1) `usage` is a **hand-recorded hint** written by `ica-key mark`, not a
metered figure — treat the ordering as a heuristic, not an accounting. (2) Nothing decrements a key
as legs consume it, so a burst of legs assigned round-robin will each still discover exhaustion on
their own; the reactive path above is still required, and this only reduces how often it fires.

**Free-tier work does NOT require a fresh key.** ICA models marked
`allowance: unlimited`/`free` in the model registry (Haiku / Gemma / Llama /
Granite) stay callable on ANY key, including exhausted ones — only paid
`shared_token_pool` models (Sonnet/Opus) are blocked. So:

- On 401/allowance-exhaustion during **paid** delegation → `ica-key exhausted --rotate`, then retry once. If all keys are exhausted, downshift to a free model instead of failing.
- For **free-tier** delegation, ignore exhaustion entirely.
- **This applies to whoever issues the invocation — orchestrator or delegate alike.** An
  orchestrator shelling `~/ica-claude.sh` directly owns the rotate-and-retry; it is not something the
  delegate can do on its behalf, because the delegate's process already resolved its token at
  startup. `ica-executor` carries the same rule in its own definition.
- ⚠️ **Exhaustion is NOT unavailability — never let it walk a `fallback_chain`.** The gateway is up
  and you are authorized; one key's weekly allowance is spent. Traversing the chain moves the work to
  a **paid** provider while free capacity sits one key away. Rotate, retry once, and only then report
  `{"status": "unavailable", "reason": "all_ica_keys_exhausted", "fallback_applied": false}`.

```bash
ica-key exhausted --rotate && ~/ica-claude.sh -p "retry prompt" ...
```

## Key References

| Resource | Path |
|----------|------|
| Gateway wrapper script | `/Users/miethe/ica-claude.sh` |
| API key env file | `/Users/miethe/.dotfiles/ICA_CLAUDE` |
| Key rotation CLI | `/Users/miethe/.local/bin/ica-key` |
| Capability contract | `/Users/miethe/.claude/skills/ica-delegate/SPEC.md` |
| Model inventory and selection heuristics | `/Users/miethe/.claude/skills/ica-delegate/references/ica-models.md` |
| **Platform facts** — data path, what the gateway captures, free spend read, self-detection | `/Users/miethe/.claude/skills/ica-delegate/references/ica-platform-facts.md` |
