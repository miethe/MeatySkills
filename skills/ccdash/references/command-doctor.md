# `ccdash doctor`

Connectivity + auth + config diagnosis. First command to run whenever any other `ccdash` call errors with a transport or 401/403.

## Usage

```text
ccdash doctor [--target NAME]
```

`--target` scopes the probe to a named target; without it, doctor probes the resolved active target.

## What It Checks

Doctor runs a series of probes and prints human-readable results:

1. **CLI version** vs. server's expected contract version.
2. **Resolved target** (name, URL, project, token_ref).
3. **Config file** — presence and parse of `~/.config/ccdash/config.toml`.
4. **Token resolution** — env var vs keyring vs none; redacted.
5. **DNS / TCP reach** to the target URL.
6. **TLS handshake** (if https).
7. **HTTP probe** against `/api/client/v1/health` (or equivalent): status code + latency.
8. **Authentication probe** — whether the provided token is accepted (401/403 distinguishes missing vs invalid).
9. **Clock skew** hint if server timestamps deviate from local clock.

## Interpretation Cheat Sheet

| Symptom | Likely cause | Remediation |
|---|---|---|
| `DNS resolution failed` | Target URL hostname typo or split-DNS not on VPN | Fix URL via `ccdash target add <name> <correct-url>` or connect VPN. |
| `connection refused` | Server not running at that URL | Start backend (`npm run dev:backend` in CCDash repo) or update URL. |
| `TLS: certificate verify failed` | Self-signed cert or expired cert | Use `http://` for local dev, or install the CA bundle. Never disable TLS verification in prod. |
| `HTTP 401 from server` with token present | Wrong / revoked token | `ccdash target logout <name>` then `ccdash target login <name>`. |
| `HTTP 401 from server` with no token | Server requires auth | `ccdash target login <name>` or set `CCDASH_TOKEN`. |
| `HTTP 403` | Token valid but lacks scope | Ask the operator to rotate / upgrade the token on the server side. |
| `HTTP 5xx` | Server-side fault | Not a CLI problem. Point the user at server logs. |
| `clock skew > N seconds` | Local clock drift | Run NTP sync; tokens with `exp` will fail otherwise. |
| `config file missing` | Fresh install never ran `target add` | Run `recipes/target-onboarding.md`. |

## Output Shape

Human output only (for now). When a JSON variant ships, update this file and `scripts/router-table.json`.

## When To Run

- Any transport/auth error from another `ccdash` command. Always run `doctor` before surfacing the raw error to the user.
- Before the first query of a session against an unfamiliar target.
- After editing `~/.config/ccdash/config.toml` or changing env vars.
- After a server upgrade to confirm CLI/server contract compatibility.

## Cross-Links

- Recipe: `recipes/unreachable-server.md` (full fail-path walkthrough).
- Target management: `command-target.md`.
- Install/auth basics: `install-setup.md`.
