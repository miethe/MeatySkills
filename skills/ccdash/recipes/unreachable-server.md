# Recipe: Unreachable Server / Auth Failure / Endpoint Timeout

Trigger: any `ccdash` command returns a transport error (DNS, connection refused, TLS, timeout) or a `401` / `403` / `5xx`. **Never** surface the raw error to the user before running this recipe.

## Triage: transport failure vs. endpoint timeout

Before running doctor, classify the failure. The two modes look alike (both raise `ConnectionError` in the CLI — see `packages/ccdash_cli/src/ccdash_cli/runtime/client.py`) but have completely different fixes:

- **Transport failure** — DNS / connection refused / TLS / 5xx from *any* command, including lightweight ones (`ccdash target show`, `ccdash feature list --limit 1`). Server is unreachable or auth is broken. Run the main flow below.
- **Endpoint timeout** — lightweight commands succeed, but a known-expensive endpoint (see `SKILL.md` "Known Expensive Endpoints") hit the 30 s client default and aborted. Server is healthy; this specific command is too slow. Doctor will report `PASS` — that is a **false negative**, not a green light. Skip to "Endpoint timeout branch" below.

Quick probe:

```bash
ccdash feature list --limit 1 --json   # cheap; succeeds if server is up
```

If that succeeds while the original command timed out, you're in the endpoint-timeout branch.

## Steps

1. **Capture the failing command + short error.** Keep the original invocation; the user may want to retry after fixing the target.

2. **Run doctor against the resolved target.**

   ```bash
   ccdash doctor
   ```

   If the user scoped their request to a named target (e.g. "is staging reachable"), run `ccdash doctor --target <name>` instead. Also acceptable: `ccdash target check <name>` for a lighter reachability probe.

3. **Branch on doctor output** (see `references/command-doctor.md` cheat sheet):

   - **DNS / connection refused** → confirm target URL with `ccdash target show`; if URL is wrong, `ccdash target add <name> <correct-url>`; if the server is simply not running, tell the user and (for local dev) suggest `npm run dev:backend`.
   - **TLS error** → confirm https vs http; for local dev, prefer `http://`; for prod, the operator's CA bundle is broken — stop and escalate, do not disable verification.
   - **401 with token** → `ccdash target logout <name>` then `ccdash target login <name>`. If that still 401s, the token is rejected — escalate.
   - **401 without token** → `ccdash target login <name>` (or set `CCDASH_TOKEN`).
   - **403** → token lacks scope; escalate to the operator who provisions tokens on the server.
   - **5xx** → server-side; share doctor's probe output with the user and suggest checking server logs. Retry once after 30 seconds if it might have been transient.

4. **Retry the original command.** Do not paraphrase the earlier failure — re-run verbatim so the user sees the fix land.

5. **If the retry also fails**, surface the doctor output (not the raw HTTP error) plus the one-line original error. Offer the specific next step from the cheat sheet.

## Endpoint timeout branch

Use when the triage probe confirmed the server is healthy but a known-expensive command aborted at the timeout ceiling. The CLI default is 30 s; **override with `--timeout N` (seconds) or `CCDASH_TIMEOUT=N`** before retrying. `ccdash doctor` reports the active value and its source. For deep diagnosis see `docs/guides/cli-timeout-debugging.md`.

1. **Confirm it's a known-expensive endpoint.** The current list (see `SKILL.md`):
   - `ccdash status project`
   - `ccdash report aar --feature <id>`
   - `ccdash report feature <id>`
   - `ccdash workflow failures`

   These run synchronous cross-domain aggregations on the server (sessions + documents + tasks + workflow effectiveness). They are deterministic — no LLM call — so failures are almost always DB load, not model latency.

2. **Retry with an elevated timeout first.**

   ```bash
   ccdash --timeout 90 report aar --feature FEATURE_ID --md
   # or
   CCDASH_TIMEOUT=90 ccdash report aar --feature FEATURE_ID --md
   ```

   If the command succeeds, done. If it still times out at a generous ceiling (>120 s), treat it as a server-side load problem and proceed to step 3.

3. **Tell the user plainly if retry also fails.** "Server is up; `<command>` is a known-slow aggregation and exceeded the timeout even after raising it to Ns. This indicates server-side DB load, not a CLI configuration issue." Do not repeat doctor's green checkmark as if it solves the problem.

4. **Offer a decomposed fallback** instead of retrying the same command. Pick the one that matches intent:
   - `report aar` intent → follow `recipes/blog-retrospective-research.md` (`feature show` + `feature sessions` gives ~80% of the AAR content from cheap endpoints).
   - `status project` intent → `ccdash feature list --json` + client-side filter by `status` / `updated_at`.
   - `workflow failures` intent → `ccdash feature list --json`, identify features with non-empty `failure_patterns` or elevated `rework_signals`, then `ccdash feature show <id>` on the top offenders.

5. **Escalate the server-side fix when it recurs.** Expensive endpoints should either be cached, paginated, or moved to a background job the CLI can poll. File under CCDash backend work, not skill work.

## Provenance To Echo

- `target.name`, `target.url`, `authenticated` (from doctor).
- The original command string (so the user can retry or edit).

## Do Not

- Disable TLS verification, clear keyring entries, or modify config.toml without explicit user consent.
- Infer "the server is down" from a single failure without running doctor.
- Loop doctor more than twice; if two runs don't yield a fix, stop and escalate with what doctor reported.

## Cross-Links

- `references/command-doctor.md`
- `references/command-target.md`
- `recipes/target-onboarding.md` (for fresh installs that have never had a target configured)
- `recipes/blog-retrospective-research.md` (fallback when `report aar` times out)
