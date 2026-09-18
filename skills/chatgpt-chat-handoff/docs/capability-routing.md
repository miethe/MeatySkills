# Chat capability routing — verified 2026-09-17

## Documented facts versus operating choices

The official model article lists GPT-6 Pro for eligible Pro tiers, and separate Sol thinking
levels. Actual selection happens in the UI; writing “think harder” is not a verified switch.
Pro model usage is limited, and the exact allowance depends on tier. The user's exact tier
and remaining allowance were not inspected. Chat is distinct from Work/Codex [OAI-01].

Deep Research in Chat has its own plan-dependent task allowance, a reviewable research plan,
web/uploaded sources and supported authorized app read actions. It is not a Pro-model alias
and does not perform app writes as part of Chat research [OAI-02]. Images supports creation,
editing, requested text and transparency; Images with thinking is documented for Pro. The
operator's stated ten-image ceiling is not established here as a universal product limit
[OAI-04]. The upload FAQ lists 40 Pro Project files and warns that ordinary document retrieval
can omit embedded images; directly attach reference renders for visual tasks [OAI-05].

## Recommended routing (authored policy, not vendor benchmarks)

| Work | Default | Escalation/boundary |
|---|---|---|
| Hard architecture/research decision | `pro-decision` | Prefer GPT-6 Pro; verify allowance and tools |
| Routine structured review or code critique | `reasoned-standard` | High; Extra High when useful and exposed |
| Generate/edit visuals | `image-execution` | Use image-capable Chat UI; separate QA/export |
| Multi-source investigation | `deep-research-execution` | Select Deep Research, then optional Pro synthesis |
| Bounded current lookup | `search-execution` | Require browsing and dated source evidence |
| Data, visual QA, actual files | `tool-analysis` | Required tools take priority over model preference |

These are quality/cost recommendations, not measured rankings. There is no Pro-plus-Extra-High
setting asserted. Compatibility is a runtime check, not assumed from subscription level.
The receiver reports unavailable capability; the human chooses an authorized fallback.
No route falls back to Work. No route promises unlimited use, a context size, guaranteed
pixel dimensions, fixed generation latency or automatic multi-turn execution.

## Per-run operator check

Record surface=Chat; exact selected UI model/thinking labels when visible; feature entry
point; date; required tools; and known allowance warnings. Unknown fields stay unknown.
Do not ask the assistant to certify hidden UI state. For research, use the actual
Deep Research entry point rather than only typing a decorative label in an ordinary message.

## Sources and change handling

See the source register for exact URLs, retrieval dates and raw update labels. Review this
snapshot after 14 days or any material UI change; that interval is a local policy. More
recent primary documentation and the current UI can supersede this snapshot only through
an explicit recorded update, not a silent change to the same frozen version.
