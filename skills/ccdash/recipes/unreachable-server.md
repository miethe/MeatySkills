# Recipe: Unreachable Server / Auth Failure

Trigger: any `ccdash` command returns a transport error (DNS, connection refused, TLS, timeout) or a `401` / `403` / `5xx`. **Never** surface the raw error to the user before running this recipe.

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
