# Evidence: model positioning by role (2026-10-07)

Evidence record for `task_class_defaults` in `../model-registry.yaml` (registry v2). The builder
(`scripts/build-model-registry.py`) refuses a class whose current fingerprint is not on a row of an
existing evidence file, so a defaults change cannot build without a record like this one.

- **Source report (authoritative, not copied here):** agentic_meta_dev
  `docs/project_plans/reports/model-eval/positioning-2026-10-07/report.md` at commit `e5234271`
  (branch `model-positioning-2026-10-07`, PR metis-aos/agentic_meta_dev#2083). Node
  `node_01M4C58QYW0KP7987JWADP8YKV`.
- **Nick's framing (2026-10-07, near-verbatim, quoted by the report):** "We shouldn't be relegating
  Haiku 5.5 automatically as a fallback ... Rather, compare it with GPT-6 Luna as our paid ones, and
  presumably as enhancements holding a different role than the free 5.6 Luna from ICA."
- **Method:** 81 native-harness calls (agentic fix x3, long-context retrieval at 464K and ~160K tokens,
  strict schema x2, blind-graded triage, latency), plus about 30 dated community sources. The agentic and
  schema instruments saturated every commercial arm and are recorded as failed instruments, not ties.

## Role map applied (the report's section 3)

| Model | Owns | Placed here as |
|---|---|---|
| Haiku 5.5 (paid, Claude subscription) | Claude-Code-native subagent work, `exploration` leg 1, triage/routing judgment incl. private material, fast single calls, scans to ~160K | `exploration` holder 1; paid peer in `documentation`, `mechanical`; same-family last leg in `second_opinion` (by role: diversity) |
| GPT-6 Luna (paid, personal Codex) | cross-family review / AC validation / second opinion; Codex-sandbox work on the personal account | `second_opinion` and `code_review` holder 1; paid peer in the cheap chains |
| ICA GPT-5.6 Luna (free, employer lane) | free bulk work on PUBLIC content | `documentation` and `mechanical` holder 1; public-only leg in `exploration` |
| Sonnet 5.5 | exhaustive reads at >=300K tokens; complex agentic coding | unchanged `implementation` holder; `frontier.holder` for the cheap classes |
| Nemotron Super 49B | no role earned | not a holder |

Not expressible yet: the report's `triage` and `long_context_read` roles need a task-class
vocabulary bump coordinated with CCDash's pinned digest (`node_01M4C7X4PNQD27MNSSA3RM40CA`). They get
defaults when the vocabulary adds them.

## Classes this evidence sets (fingerprint = sha256 of the entry without `set_by`, first 16 hex)

| Class | Fingerprint | Holders | Effort | Bar |
|---|---|---|---|---|
| `exploration` | `32bc7fad7ef6b053` | `claude/claude-haiku-5-5`, `ica/gpt-5.6-luna`, `codex/gpt-6-luna` | low | 5.5 |
| `documentation` | `14341f7c2761c6dd` | `ica/gpt-5.6-luna`, `claude/claude-haiku-5-5`, `codex/gpt-6-luna` | low | 6.0 |
| `mechanical` | `1849aa47fda475f5` | `ica/gpt-5.6-luna`, `ica/gemma-4-26b-a4b-it`, `claude/claude-haiku-5-5`, `codex/gpt-6-luna` | low | 5.0 |
| `second_opinion` | `c119b80c6d95a55a` | `codex/gpt-6-luna`, `ica/gemini-3.6-flash`, `ica/gemma-4-26b-a4b-it`, `claude/claude-haiku-5-5` | medium | 3.0 |
| `code_review` | `8640e0a44af1ac96` | `codex/gpt-6-luna`, `claude/claude-sonnet-5-5`, `claude/claude-sonnet-5` | medium | 6.5 |

Bars and quality weights are new in v2 and proposed with this record; every holder's measured q
clears its class bar (the builder checks). `margin.lambda` and `frontier` are recorded for M2.
