# Evidence — cross-provider task_class_defaults (2026-10-08)

Routing M1 rework, node `node_01M4C696HR9WVV6BVZ2FXQZH0Y` (WP `node_01M4C5P20MBBV11YNB5FM9359A`).
This file supersedes `positioning-2026-10-07.md` and `defaults-baseline-2026-10-08.md` as the
`set_by.evidence` of every `task_class_defaults` row. Those two stay as the record of what each
row held before this pass.

## The decisions this pass applies

1. **Nick, on `req_01M4EFJ6ZBKFXWPHSWEPT9MDVE` (2026-10-08, recorded via `op decide`).**
   `svg_generation` moves to Opus 5.5. Fable 5.1 stays explicit opt-in and is never auto-routed.
   The builder now refuses `claude/claude-fable-5-1` as a holder outside `advanced_sol`.
2. **Nick, 2026-10-08 ~20:05Z, widening the same request.** Defaults should consider optimal
   models across providers, Opus 5.5 vs Sol 6.1. Many domains may be equivalent, and a select few
   give one or the other priority. So no class defaults to one family by habit:
   - Every row records `cross_family`. Its candidates always include Opus 5.5 and GPT-6.1 Sol,
     filtered first by the class's eligibility minimum.
   - **Equivalent:** Cost picks the default, and the other family is the first fallback.
   - **Priority:** names the owner, with its evidence.
   - **Unmeasured:** defaults to the cheapest candidate.

## What the positioning study can and cannot say

The study is `agentic_meta_dev` `docs/project_plans/reports/model-eval/positioning-2026-10-07/report.md`,
node `node_01M4C58QYW0KP7987JWADP8YKV`, PR #2083.

- **It ran no Opus 5.5 arm and no GPT-6.1 Sol arm.** Its arms were Haiku 5.5, Sonnet 5.5 as a
  reference, GPT-6 Luna, ICA 5.6 Luna and Nemotron. So it has no evidence either way on Opus vs Sol
  for any class. Every Opus-vs-Sol call below is a doctrine priority, a capability or authority
  exclusion, or `unmeasured`.
- **The registry scores cannot settle it either.** Opus 5.5 and Sol 6.1 carry identical
  Intelligence and Taste (9 and 8). A score that cannot separate two models is a ceiling, not a tie.
- **One equivalence it did measure is in the cheap tier.** On every task the bench could measure
  for correctness, Haiku 5.5, ICA 5.6 Luna and GPT-6 Luna tied. That is `exploration`, where Cost
  then reproduces the study's own order.

## Contradictions recorded rather than resolved

These are for Nick. Eligibility minima and absolute reasons are out of this pass's scope.

1. **`mode_d`.**
   - Registry `task_class_sovereignty.mode_d` says `min_rung: subscription, reason: quality_bar`.
   - MODEL-ROUTING §4 point 2 says `authority_absolute`, and that a Codex subscription satisfies
     the personal-account floor.
   - But `docs/rules/mode-d-enforcement.md`'s enforced `mode-d-scan.sh` hard-exits on a codex
     producer.
   - So `mode_d` stays Opus-held on the **authority** axis. A Sol default would hard-fail the
     enforced scan.
2. **`documentation` and `mechanical`.** The study gives ICA 5.6 Luna priority because it is $0.
   The registry Cost scores rank Haiku 5.5 (10) above ICA 5.6 Luna (8). Read as a pure Cost pick,
   the scores would reverse the study's order. The rows record a study **priority** instead.
3. **`implementation`.**
   - MODEL-ROUTING §5 names Codex `gpt-6-luna` for contract-clear implementation that needs no
     Claude Code mechanism.
   - But `resolver.js` `sandboxModeFor` makes a codex holder read-only at effort medium, so it
     cannot meet the class's `execution.file_edit`.
   - Codex is therefore excluded on the **capability** axis. Finding: `node_01M4EJC19SDMP1Z6F14G9QDDFH`.
     The same coupling applies to the write-needing must-stay classes that now default to Sol at
     medium (`cross_wave_merge`, `schema_recovery`).

## Unmeasured classes (no evidence; cheapest candidate holds the default)

| Classes | Default | Cost score |
|---|---|---|
| `verdict`, `council_review`, `synthesis`, `schema_recovery`, `cross_wave_merge` | GPT-6.1 Sol | 4, over Opus 5.5 at 3 |
| `review`, `adjudication`, `critique` | ICA GPT-5.6 Sol | 8 |
| `implementation` | Sonnet 5.5 | 5 |

Each needs a discriminating Opus 5.5 vs Sol 6.1 bench. Under the MODEL-ROUTING §6c L4 step, that
bench is now a mandatory follow-up.

## Per-class table

The fingerprints are from `build-model-registry.py --stamp`.

| Class | Fingerprint | Equivalence | Default (holders[0]) | First fallback | Excluded (axis) | Basis |
|---|---|---|---|---|---|---|
| `exploration` | `c1dccb2252f56532` | equivalent (claude/claude-haiku-5-5, ica/gpt-5.6-luna, codex/gpt-6-luna) | `claude/claude-haiku-5-5` | `ica/gpt-5.6-luna` | - | positioning study report.md section 3 (node_01M4C58QYW0KP7987JWADP8YKV): Haiku 5.5, ICA 5.6 Luna and GPT-6 Luna tied on every task the bench could measure for correctness; Cost decides (Haiku 10, ICA Luna 8, GPT-6 Luna 7). Opus 5.5 / Sol 6.1 clear the bar but lose on Cost |
| `documentation` | `fbb8e8a3ac34a733` | priority: ica/gpt-5.6-luna | `ica/gpt-5.6-luna` | `claude/claude-haiku-5-5` | - | positioning study report.md section 3 (node_01M4C58QYW0KP7987JWADP8YKV): ICA 5.6 Luna owns free bulk work on PUBLIC content ($0); the registry Cost scores rank Haiku 5.5 (10) above it (8), so this is a study priority, not a Cost pick |
| `mechanical` | `ec0631e18577c88b` | priority: ica/gpt-5.6-luna | `ica/gpt-5.6-luna` | `ica/gemma-4-26b-a4b-it` | - | positioning study report.md section 3 (node_01M4C58QYW0KP7987JWADP8YKV): ICA 5.6 Luna owns free bulk work on PUBLIC content ($0); the registry Cost scores rank Haiku 5.5 (10) above it (8), so this is a study priority, not a Cost pick |
| `second_opinion` | `b60ef67087dc65e1` | priority: codex/gpt-6-luna | `codex/gpt-6-luna` | `ica/gemini-3.6-flash` | - | positioning study report.md section 3 (node_01M4C58QYW0KP7987JWADP8YKV): GPT-6 Luna owns cross-family review and second opinion (family diversity against every Claude lane) |
| `implementation` | `ab088ef9d87f28c3` | unmeasured | `claude/claude-sonnet-5-5` | `claude/claude-sonnet-5` | codex/gpt-6-luna (capability); codex/gpt-6.1-sol (capability) | agentic correctness saturated in the study (a failed instrument, not a tie) and it ran no Opus/Sol arm; default = cheapest eligible candidate (Sonnet 5.5, Cost 5, over Opus 5.5, Cost 3) |
| `design_judgment` | `f8ccee02ee0ffdf6` | priority: claude/claude-opus-5-5 | `claude/claude-opus-5-5` | `codex/gpt-6.1-sol` | claude/claude-sonnet-5-5 (doctrine) | MODEL-ROUTING section 5 design_judgment row (Nick 2026-09-28 evening): architecture/UX/hard judgment starts on Opus 5.5; Sol 6.1 is the cross-family first fallback |
| `raw_strength` | `0c15fe5028d77018` | priority: codex/gpt-6.1-sol | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | - | MODEL-ROUTING section 5 raw_strength row (Nick 2026-09-30): hard algorithmic/debugging/reasoning-heavy legs start on GPT-6.1 Sol; Opus 5.5 is the cross-family first fallback |
| `web_research` | `386c3ec012970087` | priority: gemini/gemini-3.6-flash | `gemini/gemini-3.6-flash` | `gemini/gemini-3.5-flash` | - | MODEL-ROUTING section 5 web-grounded research row: native Gemini fuses Google-Search grounding with reasoning; Opus/Sol have no grounded-search lane in the router |
| `code_review` | `19603113502155d1` | priority: codex/gpt-6-luna | `codex/gpt-6-luna` | `claude/claude-sonnet-5-5` | - | positioning study report.md section 3 (node_01M4C58QYW0KP7987JWADP8YKV): GPT-6 Luna owns AC validation and cross-family review; MODEL-ROUTING section 5 AC-validation row |
| `image_generation` | `6597bb1b137f79e3` | priority: codex/gpt-6-luna | `codex/gpt-6-luna` | `ica/gpt-5.6-terra` | claude/claude-opus-5-5 (capability); claude/claude-sonnet-5-5 (capability) | MODEL-ROUTING section 5 + codex-executor contract: native Codex image_gen.imagegen first, ICA GPT shim, then Nano Banana; Claude models have no image output |
| `svg_generation` | `890cd7af994e399c` | priority: claude/claude-opus-5-5 | `claude/claude-opus-5-5` | `ica/gemini-3.1-pro-preview` | - | Nick decision req_01M4EFJ6ZBKFXWPHSWEPT9MDVE (2026-10-08): svg_generation moves to Opus 5.5 and Fable 5.1 stays explicit opt-in, never auto-routed; Gemini chain from use-case-rankings.yaml svg-generation stays as the cross-family fallback |
| `video_generation` | `f8f9faa68fdef949` | priority: sora/sora-2 | `sora/sora-2` | - | claude/claude-opus-5-5 (capability); codex/gpt-6.1-sol (capability) | capability-bound: only sora-2 declares video_output |
| `review` | `adea0d9046fb3e62` | unmeasured | `ica/gpt-5.6-sol` | `claude/claude-sonnet-5-5` | - | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheapest eligible candidate (ICA 5.6 Sol, Cost 8, tool-less); Sonnet 5.5 (contract-clear review is its named role) is the cross-family first fallback a tool-needing leg lands on |
| `adjudication` | `365fc20b91552a92` | unmeasured | `ica/gpt-5.6-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheapest eligible candidate (ICA 5.6 Sol, Cost 8, tool-less); Opus 5.5 is the cross-family first fallback a tool-needing leg lands on |
| `critique` | `365fc20b91552a92` | unmeasured | `ica/gpt-5.6-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheapest eligible candidate (ICA 5.6 Sol, Cost 8, tool-less); Opus 5.5 is the cross-family first fallback a tool-needing leg lands on |
| `advanced_sol` | `1ad1502a5860beea` | priority: codex/gpt-6-astra | `codex/gpt-6-astra` | `claude/claude-fable-5-1` | claude/claude-opus-5-5 (bar); codex/gpt-6.1-sol (bar) | MODEL-ROUTING section 1.5 advanced-Sol class: planned from the start for Astra or Fable 5.1 by an explicit execution contract |
| `orchestration` | `295c6734118a0d14` | priority: claude/claude-opus-5-5 | `claude/claude-opus-5-5` | `claude/claude-opus-5` | codex/gpt-6.1-sol (capability); claude/claude-sonnet-5-5 (doctrine) | capability-bound: orchestration drives Claude-Code-native mechanisms, the one legitimate reason a class is Claude-only |
| `mode_d` | `1f7011131e7bef17` | priority: claude/claude-opus-5-5 | `claude/claude-opus-5-5` | `claude/claude-opus-5` | codex/gpt-6.1-sol (authority); claude/claude-sonnet-5-5 (doctrine) | authority-bound: the enforced Mode-D scan rejects a codex producer; the registry's personal-account floor alone would admit Codex (contradiction recorded in the evidence file) |
| `verdict` | `4d826c72a0860607` | unmeasured | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheaper eligible candidate (GPT-6.1 Sol, Cost 4, over Opus 5.5, Cost 3); Opus 5.5 is the cross-family first fallback; Codex subscription clears the personal-account floor |
| `council_review` | `4d826c72a0860607` | unmeasured | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheaper eligible candidate (GPT-6.1 Sol, Cost 4, over Opus 5.5, Cost 3); Opus 5.5 is the cross-family first fallback; Codex subscription clears the personal-account floor |
| `synthesis` | `4d826c72a0860607` | unmeasured | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheaper eligible candidate (GPT-6.1 Sol, Cost 4, over Opus 5.5, Cost 3); Opus 5.5 is the cross-family first fallback; Codex subscription clears the personal-account floor |
| `schema_recovery` | `4d826c72a0860607` | unmeasured | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheaper eligible candidate (GPT-6.1 Sol, Cost 4, over Opus 5.5, Cost 3); Opus 5.5 is the cross-family first fallback; Codex subscription clears the personal-account floor |
| `cross_wave_merge` | `4d826c72a0860607` | unmeasured | `codex/gpt-6.1-sol` | `claude/claude-opus-5-5` | claude/claude-sonnet-5-5 (doctrine) | positioning study ran neither Opus 5.5 nor GPT-6.1 Sol; use-case-rankings.yaml marks this use case unmeasured; default = cheaper eligible candidate (GPT-6.1 Sol, Cost 4, over Opus 5.5, Cost 3); Opus 5.5 is the cross-family first fallback; Codex subscription clears the personal-account floor |
