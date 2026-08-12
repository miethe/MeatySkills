# ICA as infrastructure — the platform facts

**Scope: what the ICA gateway *is*, not which model to pick.** Model inventory, `[1m]` semantics,
and selection heuristics live in [`ica-models.md`](./ica-models.md); the delegation workflow lives in
`../SKILL.md`. This file is for the questions that come up when you are reasoning **about** the
gateway rather than delegating through it: what it captures, who else is in the path, what it can act
on, how to read spend for free, and how to tell whether *your own* session is on it.

Every claim here was measured from response headers or a probe, with the date. Anything not probed is
marked as unknown rather than assumed — the recurring failure on this gateway is reasoning from
upstream LiteLLM/Bedrock documentation about a deployment that turns out to diverge.

---

## 1. Your own session may be ICA-routed — check, don't assume

This is the fact most likely to be missed, because it inverts the mental model. `ica-delegate` is
framed around *sending work out* to ICA, so it is easy to assume the calling session is on the
subscription. **It frequently is not:** `~/ica-claude.sh` is a normal way to launch an interactive
Claude Code session, and `claude-opus-5[1m]` is the documented spine-offload lane.

```bash
env | grep -E "^(ANTHROPIC_BASE_URL|ANTHROPIC_MODEL|CCDASH_LAUNCHER)="
```

| Signal | Meaning |
|---|---|
| `ANTHROPIC_BASE_URL=https://api.nextgen-beta.ica.ibm.com/ica` | this session's conversation is carried by ICA |
| `CCDASH_LAUNCHER=ica-claude.sh` | launched through the wrapper |
| `ANTHROPIC_MODEL=claude-opus-5[1m]` | corroborating, but the base URL is the authority |

⚠️ **The trust boundary is inherited from the launcher, not from the process tree.** A *local*
subagent, workflow leg, or shell tool spawned by an ICA session inherits `ANTHROPIC_BASE_URL`, so its
output is transmitted to the gateway too. "Local subagent" is therefore **not** a synonym for "stays
on this machine". Measured 2026-08-09, when a guard written the same hour correctly refused its own
authoring session (`agentic_meta_dev node_01KZKX3MW165WB21VEW2MRKDB7`).

Anything that keys a policy, guard, or eligibility decision on *actor role* — interactive vs
delegated — is keying on the wrong axis. Key it on the gateway.

## 2. The data path — who is in it (measured 2026-08-09)

A single `/v1/messages` call traverses four parties before a model sees it:

```
client → Cloudflare edge → IBM Go gateway → forked LiteLLM 1.89.4 → AWS Bedrock (IBM's account)
                                    └── IBM Instana APM traces the whole path
```

| Header observed | Party | Consequence |
|---|---|---|
| `server: cloudflare`, `cf-ray`, `cf-cache-status: DYNAMIC` | **Cloudflare** | TLS terminates **outside IBM**; a reverse proxy sees plaintext request and response bodies. `DYNAMIC` = this response was not edge-cached. |
| `404 page not found` (plain text, Go's `net/http` default) on `/spend/logs`, `/key/info`, `/guardrails/list` | **an IBM Go gateway** fronting LiteLLM | only `/v1/*` is exposed; the LiteLLM admin surface is unreachable from a client key |
| `x-litellm-version: 1.89.4` | **LiteLLM** | confirmed proxy identity and pinned version |
| `x-litellm-response-cost-margin-percent`, `-margin-amount`, `-discount-amount`, `-original` | **a LiteLLM *fork*** | these are not stock headers — IBM added chargeback logic. **Do not assume stock defaults**, for privacy or behaviour |
| `x-instana-t`, `x-instana-s`, `x-instana-l`, `traceparent`, `tracestate` | **IBM Instana** APM | per-request distributed tracing; Instana can be configured to capture HTTP headers and payloads |
| response id `msg_bdrk_…` | **AWS Bedrock** | Claude models are served by Bedrock, in **IBM's** AWS account |

### The consequence that matters

**Anthropic never sees these calls.** Retention, review, and abuse-monitoring posture are governed by
**IBM's** Bedrock configuration — invocation logging to CloudWatch Logs / S3, Bedrock Guardrails —
not by Anthropic's terms. Citing Anthropic's privacy commitments for an ICA call is a category error.
The same holds per-provider on the non-Claude routes:

| Route | Served by | Retention posture to reason from |
|---|---|---|
| `claude-*` | AWS Bedrock, IBM's account | IBM's Bedrock config; no training on inference data |
| `gpt-*` | Azure OpenAI | Azure's **default abuse monitoring retains prompts/completions ~30 days with authorized-human review**, absent a modified-abuse-monitoring exemption — the highest human-review exposure in the set |
| `ibm/granite-*` and other non-frontier ids | WatsonX | IBM's own tenancy end to end |
| `gemini-*` / `gemma-*` | Google | depends on Vertex (enterprise terms, no training) vs an AI-Studio-tier key (improvement + human review) |

### What is capturable, and what could act on content

Not probed — the admin surface that would answer it 404s. Recorded as **unknown, not clean**:

- **Content in spend logs.** LiteLLM's spend-log schema carries `messages` / `response` columns that
  stock leaves empty unless content logging is enabled. A fork may differ.
- **Callbacks.** LiteLLM success/failure callbacks (Langfuse, Langsmith, Datadog, OTEL, S3/GCS,
  Slack) receive full prompt **and** completion when wired.
- **Guardrails.** Presidio (PII masking), Lakera / Aporia (injection + policy), Bedrock Guardrails.
  These do not merely observe — they **block, mask, or flag**.
- **Caching at rest.** A Redis or semantic cache stores prompts/responses keyed by hash. (Note the
  prompt caching confirmed in `ica-models.md` is *Bedrock-side ephemeral*, a different mechanism.)
- **IBM's Bedrock invocation logging** setting.

**So the exposure class is retention + human review + attribution — not training.** Bedrock, Azure,
and Vertex all disclaim training on inference data. Combined with §3's attribution, the realistic bad
outcome for genuinely sensitive content is a DLP or guardrail rule tripping and a human inside IBM
reading a flagged snippet attributed to a named internal identity.

**Practical rule:** ICA is the right default for engineering work and this is not a reason to stop
offloading. It *is* the reason a workload whose content class is categorically different — personal
history, health, finances, anything under an NDA that is not IBM's — should stay on the subscription.
Worked example and the boundary built on it:
`agentic_meta_dev/docs/policies/corpus-access-policy.md` §1.2 and §7.

## 3. Spend and attribution — a free, zero-token read

**Every response carries `x-litellm-key-spend`**: cumulative spend for the active key, in dollars,
as a float. No admin route, no tokens, no extra request.

```bash
set -a; . ~/.dotfiles/ICA_CLAUDE 2>/dev/null; set +a
curl -sS -D - -o /dev/null -X POST "$ANTHROPIC_BASE_URL/v1/messages" \
  -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"."}]}' \
  | grep -i x-litellm-key-spend
```

Cheaper than any gateway-meter scrape, and it works from inside a normal call — read it off a
response you were making anyway rather than issuing a probe. Useful for budget enforcement that
currently measures spend the expensive way (see the Hermes credit-budget lane).

⚠️ Two cautions. It is **per key** (`CC1`…`CC6`), so a rotation resets what you are watching — read
`ICA_KEY` alongside it. And it is **cumulative for the life of the key**, not per-session: a delta
between two reads is the only way to attribute spend to a run.

**Everything is attributed.** Requests carry the key, the key belongs to a named IBM-internal
identity, and the spend figure on the default `CC1` key was already in the thousands of dollars when
measured on 2026-08-09 — i.e. a long history exists. Anything flagged anywhere in §2's path is
attributable to a person.

## 4. Raw transport vs the Claude Code path — two different contracts

Consolidated here because the split is a platform property, not a model property:

| | Claude Code path (`~/ica-claude.sh`, `ica-settings.json`) | Raw HTTP (`/v1/messages`, app/SDK adapters) |
|---|---|---|
| Model ids | `[1m]` suffix — `claude-opus-5[1m]` | **bare ids only** — `[1m]` returns **403 `team_model_access_denied`** |
| Context | ~1M with `[1m]` | 200k (gateway caps the plain id) |
| Dated ids | — | `claude-haiku-4-5-20251001` **401s**; bare `claude-haiku-4-5` is 200 |

`[1m]` is a **Claude Code client-side hint**, not a gateway model id — proved by 0 of 22 catalog ids
containing it. In zsh, **quote** the arg (`--model 'claude-sonnet-5[1m]'`) or the glob aborts the
command.

## 5. Field laxity — never use ICA to validate a payload

Unknown **top-level** fields are silently dropped where the Anthropic API 400s. The hazard is not the
unknown field, it is a **typo in a real one**: `max_tokenz`, `temperatur`, `tool_choise` all return
**200, ignored, running at defaults**. **Nested is strict** (`messages[0].bogus_nested` → 400), and
that asymmetry is what hides it. A parameter that "had no effect" may never have been sent — which is
indistinguishable from a genuine capability gap. Also silently dropped: `output_config.format`
(structured-JSON schema) — use a forced tool call for structured output on this lane.

**Never route a "prove this payload is correct" leg here.** Detail in `ica-models.md`.

## 6. Rate limits are shared and come in two shapes

`429` arrives as either `"Too many requests"` (request rate) or `"Too many tokens"` (token rate), and
both are **per model group** — Sonnet can 429 while Haiku stays clean. The pool is **shared with
other IBM users**, so a 429 may be entirely someone else's consumption. Never read one as evidence
about your own rate.

---

## Probing discipline for this gateway

Three ways reasoning about ICA has gone wrong, each more than once:

1. **Extrapolating from Bedrock's usual gaps.** Produced two wrong predictions (prompt caching and
   the Models API both *work*). Probe; don't infer from the upstream's reputation.
2. **Trusting a floor-sensitive probe.** The caching probe first showed `cache_creation=0` and looked
   like a feature mask — it was the minimum-cacheable-prefix floor, below which caching is a silent
   no-op identical to absence.
3. **Assuming stock behaviour.** The chargeback headers prove a fork. Documented LiteLLM defaults
   describe something this deployment is not.

And the operational trap that keeps recurring around all of it: **piping to `tail` masks exit codes**
— redirect to a file, then check `$?`.

## Cross-references

| Topic | Where |
|---|---|
| Model inventory, `[1m]` semantics, selection heuristics, caching detail | [`ica-models.md`](./ica-models.md) |
| Delegation workflow, key handling, recipes | [`../SKILL.md`](../SKILL.md) |
| Capability contract | [`../SPEC.md`](../SPEC.md) |
| Model × provider × effort policy (offload eligibility, MUST-stay-primary) | `agentic_meta_dev/docs/agentic-operator/MODEL-ROUTING.md` |
| A boundary built on §2 — worked example | `agentic_meta_dev/docs/policies/corpus-access-policy.md` §1.2, §7 |
| Lane routing | `MeatySkills/meaty-agentic-ops/skills/model-playbook/routes/ica-lanes.md` |
