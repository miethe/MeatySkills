# Evidence: task-class defaults baseline (registry v2, 2026-10-08)

Evidence record for the `task_class_defaults` classes whose holders were set by Nick's dated decisions
before any evaluation path existed, or carried forward from `routing_policy` (node
`node_01M4C696HR9WVV6BVZ2FXQZH0Y`, plan agentic_meta_dev
`docs/project_plans/implementation_plans/routing-mechanization-v1.md` M1). The decisions themselves
are recorded in the comments of `../model-registry.yaml` `routing_policy` and in agentic_meta_dev
`docs/agentic-operator/MODEL-ROUTING.md` §5; this file names them per class and pins the fingerprint
of the entry they justify.

What is new in v2 and needs Nick's approval at the PR: the `bar`, `quality` weights, `margin.lambda`,
`frontier` and `requires_capabilities` values on every class, `margin_policy.lambda_default` (0.5,
the plan's proposal), and holders for the five MUST-stay classes that had no chain.

## Classes this evidence sets

| Class | Fingerprint | Holders | Effort | Bar | Decision on record |
|---|---|---|---|---|---|
| `implementation` | `8a052e0d487e42fe` | `claude/claude-sonnet-5-5`, `claude/claude-sonnet-5` | medium | 7.0 | Nick 2026-09-28: workhorse default moves to Sonnet 5.5 (subscription), Sonnet 5 fallback; contract-clear execution only (2026-09-28 evening). |
| `design_judgment` | `ee6097f3ab9d8488` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | Nick 2026-09-28 (evening): architecture / UX-visual design / hard judgment / ambiguous synthesis start on Opus 5.5, Opus 5 fallback. |
| `raw_strength` | `7078ad6eb7f31dca` | `codex/gpt-6.1-sol`, `codex/gpt-6-sol`, `claude/claude-opus-5-5` | medium | 8.0 | Nick 2026-09-28 (evening) names the class; Nick 2026-09-30: gpt-6.1-sol supersedes gpt-6-sol, which stays the fallback; Opus 5.5 last. |
| `web_research` | `1e512957ad734f5d` | `gemini/gemini-3.6-flash`, `gemini/gemini-3.5-flash`, `ica/gemini-3.1-pro-preview` | medium | 6.0 | rf grounding pilot 2026-07-27 (native gemini-3.6-flash grounded, 3.5 fallback, ICA 3.1-pro ungrounded). NOTE: both native gemini instances are enabled:false, so this class resolves to ica/gemini-3.1-pro-preview today (pre-existing, unchanged). |
| `image_generation` | `cde56f3dadbd0152` | `codex/gpt-6-luna`, `ica/gpt-5.6-terra`, `nano-banana/nano-banana-2`, `nano-banana/nano-banana-pro` | medium | 5.0 | Nick 2026-09-25: Codex subscription chains use GPT-6 Luna (native image_gen.imagegen first), ICA GPT-5.6 Terra shim when already on ICA, Nano Banana fallback. |
| `svg_generation` | `8e136c1ca7f82923` | `claude/claude-fable-5-1`, `ica/gemini-3.1-pro-preview`, `gemini/gemini-3.5-flash`, `gemini/gemini-3.6-flash` | medium | 5.0 | rf pilot 2026-07-28 (rf_run_20260728_pilot_re_eval_svg_generation_routing, conf 0.6) measured Fable 5.0. ⚠️ The chain carries claude-fable-5-1, which auto-routes Fable 5.1 against MODEL-ROUTING §1.5 (explicit opt-in only) and §5 (5.1 unmeasured for SVG). Carried forward unchanged here (defaults are Nick's policy); flagged for decision. |
| `video_generation` | `bb93ab939bbda023` | `sora/sora-2` | medium | 5.0 | Carried forward from routing_policy (single sora-2 leg). No evaluation on record: the L4 procedure owes this class an evaluation the next time a video model ships. |
| `review` | `d1582347b215b211` | `ica/gpt-5.6-sol` | medium | 7.0 | node_01M122PQQ86YWJWDA9GT83PBWQ (2026-08-27): pure-text judgment classes route to the tool_mode:none ICA gpt-5.6-sol instance; callers must pass needs_tools:false. |
| `adjudication` | `d1582347b215b211` | `ica/gpt-5.6-sol` | medium | 7.0 | Same decision as `review` (node_01M122PQQ86YWJWDA9GT83PBWQ). |
| `critique` | `d1582347b215b211` | `ica/gpt-5.6-sol` | medium | 7.0 | Same decision as `review` (node_01M122PQQ86YWJWDA9GT83PBWQ). |
| `advanced_sol` | `5d9c85e3ca527f53` | `codex/gpt-6-astra`, `claude/claude-fable-5-1` | medium | 9.0 | Nick 2026-09-09 (OQ-1): contract-only whole-node class planned for Astra or Fable 5.1, never inferred; Astra effort default medium. |
| `orchestration` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | Spine: agentic_meta_dev CLAUDE.md `Spine = Opus 5.5` (2026-09-22); chains reconciled node_01M3F4F5G93P21P1WAH565MAYQ (2026-09-27). |
| `mode_d` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | Spine (as orchestration); minimum reason authority_absolute is unchanged and lives in task_class_sovereignty, not here. |
| `verdict` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | MODEL-ROUTING §5 row 'Orchestration / verdict / council / schema-recovery / cross-wave-merge -> Opus (subscription)'. NEW holders in v2 (no routing_policy chain existed): resolution moves from 'requested model' to Opus 5.5. |
| `council_review` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | As `verdict` (MODEL-ROUTING §5). NEW holders in v2. |
| `synthesis` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | MODEL-ROUTING §5 'Final synthesis / judge -> Opus (subscription)'. NEW holders in v2. |
| `schema_recovery` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | As `verdict` (MODEL-ROUTING §5). NEW holders in v2. |
| `cross_wave_merge` | `5bd4008474d132e3` | `claude/claude-opus-5-5`, `claude/claude-opus-5` | medium | 8.0 | As `verdict` (MODEL-ROUTING §5). NEW holders in v2. |

## margin_policy

`margin_policy.lambda_default: 0.5` is the plan's proposed registry-wide margin threshold (quality
points given up per cost point gained), recorded for M2 (`node_01M4C697BQPAY337A8JWJ3D7AX`). The
resolver does not apply it in M1.
