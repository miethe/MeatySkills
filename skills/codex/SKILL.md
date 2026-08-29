---
name: codex
description: Use when the user asks to run Codex CLI (codex exec, codex resume) or references OpenAI Codex for code analysis, refactoring, or automated editing. Uses the GPT-5.6 line (Terra workhorse default, Sol for hardest reasoning, Luna for cheap/fast) for state-of-the-art software engineering.
---

# Codex Skill Guide

## Delegation Context Pre-Flight (CF-E — MANDATORY first step)

Before **every** `codex exec` dispatch, resolve the active delegation-context bundle/manifest
via the Context Fabric §E.2 resolver and **prepend the role-scoped slice to the exec prompt**
(Codex has no `--append-system-prompt-file`; the prompt preamble *is* its context channel).
The resolver ladder is offline and fail-open — a pure file read, never a model/DB/network
call: `AOS_MANIFEST_REF` (execution-manifest.yaml; bundle via its `context.bundle_ref`) →
`AOS_CONTEXT_BUNDLE_PATH` (bundle path directly) → explicit path arg → nothing. If nothing
resolves, **proceed without it and log the omission to stderr** — never block the dispatch.
The plan-gate dispatcher that ran `op context pack` is the setter of `AOS_MANIFEST_REF`;
delegates never re-derive the pack (delegation-context contract).

Executable pre-flight assertion (the CF-E coverage validator greps the `CF-E-PREFLIGHT`
marker; the resolver itself exits 1 with no output when the resolve-first step was skipped —
that failing smoke is the §E.5 AC, not an error to suppress). **`--destination external` is
mandatory on this lane (D4 egress enforcement):** a Codex delegate is an external
destination, so the resolver emits the external-safe slice — Part 0 plus the non-personal
parts only; the persona slice (Part 1) and the personal recall bank are ALWAYS excluded from
what leaves the machine. Never drop the flag to "get more context" — that is the personal
scope leaking.

```bash
# CF-E-PREFLIGHT — resolve-first (Context Fabric §E.2, D4 external lane); fail-open for the
# dispatch, fail-CLOSED for egress; ALWAYS log an omission.
CF_E_RESOLVER="${CF_E_RESOLVER:-$HOME/.claude/hooks/cf_context_resolve.py}"
CTX_SLICE=""
if [ -r "$CF_E_RESOLVER" ]; then
  CTX_SLICE="$(python3 "$CF_E_RESOLVER" --print-slice --agent-type codex-executor --destination external 2>/dev/null || true)"
fi
if [ -z "$CTX_SLICE" ]; then
  echo "[CF-E-PREFLIGHT] no delegation context resolved (AOS_MANIFEST_REF / AOS_CONTEXT_BUNDLE_PATH unset or unreadable) — dispatching WITHOUT the context slice" >&2
fi
{ [ -n "$CTX_SLICE" ] && printf '%s\n\n' "$CTX_SLICE"; printf '%s\n' "<your task prompt>"; } \
  | timeout 600 codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only \
      -C "$REPO" -m gpt-5.6-terra --config model_reasoning_effort="medium" --json 2>"$LOG.err"
```

The resolver deploys to `~/.claude/hooks/cf_context_resolve.py` (upstream:
`agentic_meta_dev/infra/persona-hooks/cf_context_resolve.py`, installed by that directory's
`install.sh`); override the path with `CF_E_RESOLVER`. Spec:
`agentic_meta_dev/docs/project_plans/design-specs/context-fabric/CF-E-auto-injection.md`.

## Write-Lane Pre-Flight (CODEX-WRITE-PREFLIGHT — MANDATORY for any edit dispatch)

**Dispatch every `codex exec` through `scripts/codex-run.sh`, and pass `--task-class write`
whenever the run is expected to edit files.** The wrapper is transparent — it forwards stdin,
stdout, stderr and codex's own exit code — and it does two things prose could not:

1. **Refuses (exit 2) an invocation that cannot do what it was dispatched to do.** A declared
   write task in `--sandbox read-only`, or with no explicit `--sandbox` at all, never launches.
2. **Refuses (exit 2) a `resume` with no explicit `--sandbox`**, regardless of task class.

```bash
CODEX_RUN="$(git rev-parse --show-toplevel)/.claude/skills/codex/scripts/codex-run.sh"
echo "<your prompt>" | "$CODEX_RUN" --task-class write -- \
  timeout 900 codex exec --ignore-user-config --skip-git-repo-check \
    --sandbox workspace-write -C "$REPO" -m gpt-5.6-sol \
    --config model_reasoning_effort="xhigh" --json 2>"$LOG.err"
```

Every invocation — allowed **and** refused — appends one JSON line (full argv, sandbox, model,
effort, cwd, verdict, reason) to `${CODEX_INVOCATION_LOG:-${CODEX_SESSION_LOG_DIR:-~/.codex/exec-logs}/invocations.jsonl}`
at mode 0600, and a piped prompt is tee'd to a sibling `.prompt` file. Logging is best-effort and
never blocks a dispatch; a refusal is never suppressed by a logging failure. Use `--check-only` to
validate a command you intend to build yourself.

> **Why this is a script and not a paragraph.** ⚠️ **`resume` does NOT reliably inherit the
> sandbox mode** — this file asserted that it did, in two places, and the claim is falsified.
> Measured 2026-08-18 (`node_01M0BCYZXQ2MNVRWAJZCHV9Y6X`): `codex exec resume --last` dropped
> `--sandbox workspace-write`; the resumed turn self-reported *"the continuation environment is
> read-only"*, burned **5.66M input tokens** and wrote **zero files at exit 0**. A fresh
> non-resume dispatch with an explicit `--sandbox`, against the same on-disk partial state, same
> model and effort, completed cleanly. The 2026-08-16 "Idea-A derail" (3 sessions, exit 0, zero
> files) has the **identical shape** and its cause can never be confirmed, because **the
> invocation was never written to disk.** A read-only run's exit 0 is indistinguishable from a
> derail, and both are indistinguishable from success until you check the diff — so the refusal
> and the log are the same fix, and neither can live in a sentence a dispatcher may skip.
>
> Tests: `scripts/tests/test_codex_run.sh` (26 assertions; the first case is the literal breach
> shape — if it stops failing against an unguarded wrapper, the guard is decoration). Usage errors
> exit **64, not 2**, so a misparsed flag never reads as a breach.

## Running a Task

> **Headless-first.** `codex exec` is non-interactive and the default here. **Never block the run
> on `AskUserQuestion`** — pick a sensible effort/sandbox from the defaults below and go. Only ask a
> question when the session is genuinely interactive (a live user this turn) *and* the choice is
> both consequential and ambiguous (e.g. `workspace-write` vs `danger-full-access` on an unfamiliar
> repo). In any background job, loop, cron, or AOS-managed run, asking = a hang; choose and proceed.

> **Model & effort come from the plan first.** Resolve `(model, reasoning_effort)` in this
> precedence order, top wins:
> 1. **Explicit assignment in the given plan / contract / task node.** If the plan, PRD, IntentTree
>    node, `op` dispatch, or the user's request assigns a model and/or reasoning effort for this leg,
>    use those **verbatim** — do not substitute a default and do not ask. A plan-assigned value is
>    authoritative.
> 2. **`delegation-router` (and `MODEL-ROUTING.md`) when the plan is silent or you're unsure.** For
>    anything non-trivial where the plan doesn't pin a model/effort/provider, consult the
>    `delegation-router` skill to route the `(model, provider, effort, profile, task_class)` tuple —
>    it encodes the cost/capability/MUST-stay-primary policy from
>    [`docs/agentic-operator/MODEL-ROUTING.md`](../../../docs/agentic-operator/MODEL-ROUTING.md).
>    Honor the RoutingRecord it emits (e.g. a review leg routed to Codex `gpt-5.6-terra`).
> 3. **The task-type defaults below**, only when neither of the above applies (e.g. a direct ad-hoc
>    `/codex` request with no plan and no routing need).
>
> Thread the resolved values into the invocation as `-m <MODEL>` and
> `--config model_reasoning_effort="<level>"`. Never block on `AskUserQuestion` just to pick these —
> the plan or the router already answers it; ask only on a live interactive turn where a genuinely
> ambiguous, consequential choice remains.

1. **Model.** Default to `gpt-5.6-terra` (the workhorse) **only when the precedence chain above yields
   nothing** — use `gpt-5.6-sol` for the hardest reasoning / escalation and `gpt-5.6-luna` for lighter
   or cost-sensitive passes. Otherwise use the plan-assigned or router-assigned model verbatim. Pass
   it with `-m <MODEL>` (see Model Options for the catalog). Do not ask which model unless the user
   raised it. (`gpt-5.5`/`-pro` are superseded — selectable for compatibility but not a default.)
2. **Reasoning effort — pick, don't ask.** Use the plan-assigned or router-assigned effort if there
   is one; otherwise default by task type per the Effort Policy table below (`medium` for
   implementation/review, `low` for search/docs, `high`+ only when blocked with concrete artifacts).
   Pass it explicitly: `--config model_reasoning_effort="<level>"`. With `--ignore-user-config` the
   built-in default is `none`, so **always** set it.
3. **Sandbox.** Default `--sandbox read-only`; use `workspace-write` for edits, `danger-full-access`
   only when network/broad access is required (ask first for the latter two if interactive — see
   Error Handling). Always pass an explicit `--sandbox <mode>` plus `--ignore-user-config` so the
   global `~/.codex/config.toml` (which defaults to `danger-full-access`) cannot silently widen
   permissions. **On an edit run this is not a convention — it is enforced**: dispatch through
   `scripts/codex-run.sh --task-class write` (§ Write-Lane Pre-Flight), which refuses the run
   rather than letting it burn tokens in a sandbox that cannot write.
4. **Always pass** `--ignore-user-config`, an explicit `--sandbox <mode>`, `--skip-git-repo-check`,
   and **`-C <repo-root>`** for AOS-managed / headless `codex exec` calls. `-C <repo-root>` is not
   optional in headless mode: the session-rollout `session_meta` records that directory as `cwd`,
   and **CCDash attributes the session to a project by that cwd** (see Session Logging). Omitting it
   lands the run in CCDash's *Unattributed* bucket. Direct interactive runs may omit
   `--ignore-user-config` only when the user explicitly wants their profile/config.
5. **Wrap every run in `timeout`** so a stalled call fails loud instead of hanging the caller.
   Default `600s`; raise for known-long `high`/`xhigh` repo-scale work. On timeout (exit 124),
   report it and resume rather than silently retrying.
6. **For anything longer than a quick lookup, stream with `--json`** (or `--json 2>codex-err.log`)
   so progress is visible and a long run is never mistaken for a hang. Reserve the plain
   `2>/dev/null` form for short, fast calls. **In headless mode send stderr to a log file, not
   `/dev/null`** — you want the warnings/errors captured (`2>"$LOG.err"`), not discarded.
7. **`--full-auto` no longer exists** (removed in current Codex). To let Codex apply edits
   non-interactively, use `--sandbox workspace-write`. `codex exec` does not prompt for approvals.
8. **Resume**: `echo "your prompt" | codex exec --ignore-user-config --skip-git-repo-check --sandbox <mode> resume --last 2>codex-err.log`.
   All flags go between `exec` and `resume`; don't change model/effort on resume unless asked —
   but **always re-pass `--sandbox` explicitly.** It is *not* reliably inherited (§ Write-Lane
   Pre-Flight); a resume that silently drops `workspace-write` runs read-only and returns exit 0
   having written nothing.
9. Run the command, then **surface the session id and rollout path** (see Session Logging) so the
   run is traceable and CCDash-ingestable. Summarize the outcome.
10. **After Codex completes** (interactive only), you may note: "You can resume this Codex session
    at any time by saying 'codex resume'." Skip this line in headless/AOS runs.

> **Redirect `< /dev/null` on every non-interactive run — the prompt-as-argv stdin trap.**
> When the prompt is passed as an **argv argument** (not piped), `codex exec` still reads stdin:
> per `codex exec --help`, *"If stdin is piped and a prompt is also provided, stdin is appended as
> a `<stdin>` block."* If stdin is an open pipe with no writer — which is the case for any
> backgrounded, detached, or subagent-spawned process — Codex prints `Reading additional input
> from stdin...` and **blocks indefinitely** waiting for EOF that never comes. Verified 2026-08-09
> (gpt-5.6-terra implementer pilot, `node_01KZC05SRHJZZ0ETHB6GN42KES`): three leg dispatches passed
> the prompt as argv and every one logged that line; two earlier legs burned a full 900s timeout
> producing zero bytes before it was diagnosed. **Always append `< /dev/null`** to an argv-prompt
> run so stdin is a closed, empty stream and Codex proceeds immediately:
>
> ```bash
> codex exec --ignore-user-config --skip-git-repo-check --sandbox read-only "<prompt>" < /dev/null 2>err.log
> ```
>
> The `echo "<prompt>" | codex exec …` piped form (used in the canonical invocation below) is
> **immune** — `echo` writes the prompt then closes the pipe, so stdin reaches EOF at once. The
> trap is specific to the argv form under a non-terminal stdin; `< /dev/null` is harmless in the
> piped form too, so prefer it unconditionally in any scripted/headless/delegated invocation.

### Canonical headless invocation (copy/paste)

```bash
# Read-only analysis, streamed, timed, CCDash-attributed, dual-logged.
REPO=/path/to/repo
LOGDIR="${CODEX_SESSION_LOG_DIR:-$HOME/.codex/exec-logs}"; mkdir -p "$LOGDIR"
TS=$(date +%Y%m%dT%H%M%S); LOG="$LOGDIR/$TS-analysis"
echo "<your prompt>" | timeout 600 codex exec \
  --ignore-user-config --skip-git-repo-check --sandbox read-only \
  -C "$REPO" -m gpt-5.6-terra --config model_reasoning_effort="medium" \
  --json 2>"$LOG.err" | tee "$LOG.jsonl"
echo "[exit ${PIPESTATUS[0]}] flat log: $LOG.jsonl  errlog: $LOG.err"
```

For **edit** tasks, swap `--sandbox workspace-write` (and drop `--json` for a human-readable
stream, or keep it) **and route the whole command through `codex-run.sh --task-class write --`**
per § Write-Lane Pre-Flight. The native rollout JSONL is still written to `~/.codex/sessions/...`
regardless.

### Quick Reference
Headless runs: prepend `timeout 600`, add `-C <repo-root>`, and prefer `--json` with `2>"$LOG.err"`
(not `2>/dev/null`) so nothing is silently dropped. The `2>/dev/null` short form below is fine only
for quick interactive one-shots.

| Use case | Sandbox mode | Key flags |
| --- | --- | --- |
| Read-only review or analysis | `read-only` | `timeout 600 codex exec --ignore-user-config --sandbox read-only -C <DIR> --json 2>err.log` |
| Apply local edits | `workspace-write` | `codex-run.sh --task-class write -- timeout 900 codex exec --ignore-user-config --sandbox workspace-write -C <DIR> --json 2>err.log` (wrapper MANDATORY — § Write-Lane Pre-Flight) |
| Permit network or broad access | `danger-full-access` | `--ignore-user-config --sandbox danger-full-access -C <DIR>` (ask first if interactive) |
| Resume recent session | ⚠️ **NOT inherited — re-pass it** | `echo "prompt" \| codex exec --ignore-user-config --skip-git-repo-check --sandbox <mode> resume --last 2>err.log` |
| Quick argv one-shot (scripted) | `read-only` | `--ignore-user-config --sandbox read-only "<prompt>" < /dev/null 2>/dev/null` (argv prompt → redirect stdin, see the stdin trap above) |
| Code review of changes | `read-only` | `codex exec --ignore-user-config --sandbox read-only -C <DIR> review --uncommitted 2>err.log` (or `--base <branch>` / `--commit <sha>`) |

### Prompt shape for `codex exec` fix runs

> **Keep fix/edit prompts SINGLE-CONCERN and SHORT.** One concrete defect (or one narrow pattern)
> per `codex exec` run — ideally under ~60 prompt lines against a small file set (~1–2 files). A
> tight, single-concern prompt is where `codex exec` is at its best: verified 2026-07-30 (RF
> operator-mcp P3), a ~60-line/2-file/one-defect run produced a correct root-cause fix at 38.9k
> tokens, exit 0.

> **Long, multi-concern prompts can DERAIL — verified 2026-07-30.** A ~110-line prompt spanning 4+
> files that bundled an enumerate-the-pattern sweep *plus* a secondary propagation-handling sub-task
> (same repo, same `gpt-5.6-terra`, same `--sandbox workspace-write`) derailed: Codex pulled in the
> repo's own skill docs (`CLAUDE.md` / artifact-tracking), then looped trying to spawn full-history
> forked subagents — each failing with the router error *"Full-history forked agents inherit the
> parent agent type; omit agent_type, or spawn without a full-history fork"* — and got stuck in a
> "collab: Wait" loop. It **exited 0 having made ZERO edits** (clean tree, unchanged files).

> **Mitigation: SPLIT, don't abandon.** Break a large fix into several single-concern `codex exec`
> runs and re-dispatch each piece separately, rather than sending one big prompt. Don't drop Codex
> over the derail — the small-run output quality is excellent for root-cause fixes. After **every**
> edit run, verify the on-disk result (see "Verify on disk: exit 0 is NOT a completion signal" under
> Error Handling) — a derailed run's exit 0 is indistinguishable from success until you check the diff.

## Session Logging & CCDash Ingestion

**Every `codex exec` already writes a full session-rollout JSONL** — the *same* file interactive
Codex produces — to `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<session-id>.jsonl`. This holds for
headless runs and **is not suppressed by `--ignore-user-config`** (verified 2026-07-06,
`codex-cli 0.142.5`). The first line is a `session_meta` record with `payload.cwd` + git branch/commit;
subsequent lines are the full turn-by-turn `response_item` stream.

**CCDash ingests this path natively.** The Mac CCDash worker scans `~/.codex/sessions`
(`CCDASH_CODEX_INGEST_ENABLED=1` in `~/.ccdash/stream.env`) and attributes each session to a project
by resolving `session_meta.cwd` against `projects.repo_path`. So for CCDash you do **not** need any
extra logging — you need only:

1. **Run with `-C <repo-root>`** so `cwd` resolves to a real project (else → *Unattributed* bucket).
2. **Surface the session id + rollout path** after each run so the run is traceable:
   ```bash
   SID=$(grep -a 'session id:' "$LOG.err" | sed 's/\x1b\[[0-9;]*m//g; s/.*session id:[[:space:]]*//' | tr -d '[:space:]')
   ROLLOUT=$(find ~/.codex/sessions -name "*$SID*.jsonl" 2>/dev/null | head -1)
   echo "session=$SID rollout=$ROLLOUT"
   ```
   (The `session id:` line prints to stderr, so capture stderr to `$LOG.err` — another reason not to
   use `2>/dev/null` in headless mode.)

**Redundant flat log (optional but recommended for AOS/headless).** Tee the run's stdout to a
durable flat log under `${CODEX_SESSION_LOG_DIR:-~/.codex/exec-logs}/` (see the canonical invocation
above). The native rollout is the CCDash source of truth; the flat log is a human-readable,
grep-able backup that survives even if the rollout is pruned. Never route real output to
`/dev/null` in headless mode.

> Do **not** re-implement session capture on top of Codex — the rollout JSONL is the contract CCDash
> already parses (`backend/parsers/platforms/codex/parser.py`). Adding a parallel format just creates
> a second thing to keep in sync.

## Model Options

Current model IDs accepted by the installed CLI (`codex --version` → `codex-cli 0.144.0-alpha.4`). The **gpt-5.6 line** is current; the installed global `~/.codex/config.toml` pins `gpt-5.6-sol` @ `xhigh` for interactive use. Switch with `-m <model>` or `/model` inside an interactive session.

### The gpt-5.6 line (current)

| Model | Best for | Effort ceiling |
| --- | --- | --- |
| `gpt-5.6-terra` ⭐ | **Default workhorse** ("better 5.5"): software engineering, agentic coding, code review, AC validation | Ultra |
| `gpt-5.6-sol` | **Frontier SOTA** — hardest reasoning / deep problem analysis / escalation when `terra` stalls | Ultra |
| `gpt-5.6-luna` | Cheaper·faster: lighter review/analysis, quick fixes, mechanical edits, cost-efficient second opinions | Extra High (no Ultra) |

### Legacy (superseded — selectable, not a default)

| Model | Notes |
| --- | --- |
| `gpt-5.5`, `gpt-5.5-pro` | Superseded by `gpt-5.6-terra` / `gpt-5.6-sol` respectively. Prefer the 5.6 line. |
| `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` | Older general line; use `gpt-5.6-luna` for the cheap/fast role. |

> Older generations (`gpt-5.3-codex`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`) remain in the catalog for compatibility but are not the default. There is no `-codex` or `-spark` suffix on the 5.4/5.5/5.6 line — those are unified models.

**Reliability Hazard**: Codex models can overfit to their own generated plan — re-check outputs against repo reality (existing types, APIs, test state) before committing.

**Reasoning Effort Levels** (`model_reasoning_effort`). The gpt-5.6 line exposes five product tiers
that map to these config strings — always pass the **config string**, not the product name:

| Product name (gpt-5.6) | `model_reasoning_effort` | Use for |
| --- | --- | --- |
| Ultra | `ultra` | **Sol/Terra only** — maximum-depth reasoning for the hardest, most ambiguous problems (highest latency/cost). Luna does **not** offer Ultra. |
| Extra High | `xhigh` | Ultra-complex tasks (deep problem analysis, complex reasoning) — the installed `~/.codex` default. Luna's ceiling. |
| High | `high` | Complex tasks (refactoring, architecture, security analysis, performance optimization) |
| Medium | `medium` | Standard tasks (refactoring, code organization, feature additions, bug fixes) |
| Light | `low` | Simple tasks (quick fixes, simple changes, code formatting, documentation) |
| — (below Light) | `minimal` | Mechanical tasks (pure formatting, trivial text changes, no real reasoning required) |
| — (below Light) | `none` | No reasoning budget at all |

> **Ultra caveat:** the CLI passes `model_reasoning_effort` straight through, and the API's `400`
> invalid-enum message understates the set (`none·minimal·low·medium·high·xhigh`, omitting `ultra`).
> `ultra` is nonetheless **accepted on `gpt-5.6-sol` and `gpt-5.6-terra`** (verified 2026-07-09).
> Per product design Luna tops out at Extra High (`xhigh`) — don't drive Luna at Ultra.

Not every model supports every effort level; keep Ultra to Sol/Terra.

**Effort Policy** (default selection by task type):

| Task type | Reasoning effort |
| --- | --- |
| Architecture design | `xhigh` |
| Complex debug | `xhigh` |
| Plan generation | `high` |
| Plan review | `medium` |
| Implementation | `medium` |
| Code review | `medium` |
| Simple search | `low` |
| Documentation | `low` |
| Formatting | `minimal` |

**Escalation rule**: Attempt with `medium` first. Escalate to `xhigh` only when blocked with concrete artifacts (failing tests, stack traces). Reserve `ultra` for genuinely intractable problems after `xhigh` has been tried.

## Following Up
- **Do not reflexively `AskUserQuestion` after a run.** In headless/AOS/background/loop contexts,
  never ask — report the result (with session id + rollout path) and either continue the plan or
  stop. Reserve `AskUserQuestion` for a live interactive turn where a genuine decision is needed.
- When resuming an AOS-managed run, pipe the new prompt via stdin **and re-pass `--sandbox`
  explicitly**: `echo "new prompt" | codex exec --ignore-user-config --skip-git-repo-check --sandbox workspace-write resume --last 2>err.log`.
  ⚠️ **The sandbox mode is NOT reliably inherited** — this line claimed it was until 2026-08-19, and
  that claim is falsified (see § Write-Lane Pre-Flight). Model and reasoning effort do appear to
  carry over, but they are cheap to re-pass and the sandbox is not; pass all three.
- Restate the chosen model, reasoning effort, and sandbox mode when proposing follow-up actions.

## Error Handling
- **`code-mode host` / `tools::router` error ⇒ TOTAL tool-loss, and it still exits 0.** If stderr
  carries `failed to spawn code-mode host … codex-code-mode-host` or `ERROR codex_core::tools::router`,
  Codex cannot run **any** shell command (the model reports *"Unable to run the command: the shell
  host is missing"*) while the process exits **0** — so an orchestrator checking exit codes sees
  success and a delegated leg returns having read no files and run no tests. **Fix:**
  `bash infra/codex-host/install.sh` in the launchpad (idempotent; `--check` to report only). Cause is
  path resolution — Codex looks for the host next to `argv[0]`, i.e. the `codex` *symlink's* directory,
  while the binary ships next to the resolved binary. Do **not** follow the warning's own advice:
  `features.code_mode_host` needs no enabling and nothing needs installing, and
  `--disable code_mode_host` does **not** help (measured — it still fails closed, there is no fallback
  exec tool). Details: `agentic_meta_dev/infra/codex-host/README.md`; continuously re-checked by the
  attestation probe `aos.codex.code_mode_host_resolvable`.
- **Timeouts (exit 124)** — the run exceeded its `timeout` wrapper. Report it plainly (the task is
  likely still slow, not deadlocked); consider resuming with `resume --last` or raising the timeout.
  Do not silently retry the same command.
- Stop and report failures whenever `codex --version` or a `codex exec` command exits non-zero. In
  headless mode, report and move on per the plan; request direction only in an interactive turn.
- **Verify on disk: exit 0 is NOT a completion signal.** For `codex exec`, exit code 0 does **not**
  mean the task was completed — a derailed run (see "Prompt shape for `codex exec` fix runs" under
  Running a Task) can exit 0 having made ZERO edits. ALWAYS verify the actual on-disk result after a
  `codex exec` edit run: check `git status --porcelain` / `git diff --stat` for the expected changes,
  or re-run the task's own acceptance probe. Treat **"exit 0 + empty diff on an edit task" as a
  FAILED/derailed run, not a success.**
- **A read-only review/AC-validation run can crash mid-turn and STILL exit 0 — never trust the exit
  code, ever.** Verified 2026-08-12 (`codex-cli 0.147.0-alpha.6.5`, `node_01KZVX4MT9129FK4S2S8FRCBAW`):
  two consecutive `codex exec --sandbox read-only` review invocations each read the target files via
  `command_execution`, then died on a different internal Codex error before emitting any
  `agent_message` — and both processes exited 0. A caller that reads exit code alone sees a clean,
  completed review; there is no answer. The positive marker to check for instead: the `--json` event
  stream's **last non-blank line must be `{"type":"turn.completed",...}`**, which Codex only writes
  when a turn actually finishes — a crash stops the stream before it regardless of the exit code —
  **and** at least one `{"type":"item.completed","item":{"type":"agent_message",...}}` must appear
  in the stream (a completed turn with zero agent_message is not "answered" either). Use
  [`scripts/codex_review.sh`](../../../scripts/codex_review.sh) rather than hand-rolling this check:
  it runs the invocation, applies exactly this detector, prints ONLY the final answer on success, and
  exits non-zero naming the transcript path when no completed turn with an answer was found. Positive
  control (a fabricated crashed-shape transcript that the detector must refuse) lives in
  [`scripts/test_codex_review.sh`](../../../scripts/test_codex_review.sh).
- Before using high-impact flags (`--sandbox workspace-write`, `--sandbox danger-full-access`,
  `--dangerously-bypass-approvals-and-sandbox`), get the user's permission **if interactive** and not
  already granted. In headless/AOS runs, follow the sandbox the plan/contract specifies — do not
  block on a question. `--ignore-user-config` + explicit sandbox flags are required safety defaults.
- **ICA gateway lanes (`~/ica-codex.sh`) — free-to-us, model-dependent.** Runs Codex against ICA's
  Azure-backed GPT models (shared pool) as an alternative to the metered ChatGPT path. Two lanes,
  auto-selected by model:
  - `gpt-5.5-gus`: **direct** — reaches ICA's `/responses` deployment as-is (`--profile ica`), no shim.
  - `gpt-5.6-terra-dzus` (workhorse) / `gpt-5.6-luna-dzus` (cheap): **shimmed** — ICA's `/responses` is
    Azure-api-version-gated for these ids, so `~/ica-codex.sh` auto-starts a local Responses→Chat proxy
    (`infra/ica-codex-shim/`) and points Codex at it via inline `-c`. Verified agentic (tool-using file
    edits, multi-turn) 2026-07-29. Usage: `~/ica-codex.sh exec -m gpt-5.6-terra-dzus "…"`.
  Caveat (dzus lane): reasoning effort is dropped on tool turns — ICA can't do reasoning+tools on the
  chat wire, so effort defaults server-side. The default `openai`/ChatGPT provider (gpt-5.6-sol/terra) is
  untouched; keep plain `codex exec` (no `--profile`/wrapper) for the metered SOTA path.
- If `stderr` shows `failed to load skill … missing YAML frontmatter`, that is non-fatal ERROR noise
  from a malformed skill file (not this run failing) — the exec still completes.

## CLI Version

Verified against Codex CLI **v0.144.0-alpha.4** (2026-07-09). The **gpt-5.6 line** is current (`gpt-5.6-terra` workhorse · `gpt-5.6-sol` frontier/hardest · `gpt-5.6-luna` cheap·fast); the installed global `~/.codex/config.toml` pins `gpt-5.6-sol` @ `xhigh`. Note: the `--full-auto` flag was **removed** — use `--sandbox workspace-write` instead. Check version: `codex --version`.

Use the `/model` slash command within a Codex session to switch models and reasoning effort, or set defaults in `~/.codex/config.toml` (`model`, `model_reasoning_effort`).
