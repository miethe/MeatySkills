# Recipe: Unreachable Runtime / Probe Failure / MCP Discovery Failure

Trigger: a CCDash request fails because the hosted API is unreachable, the worker probe is failing, or the shipped MCP server is not discovered.

This recipe replaces stale `ccdash doctor` / target-management guidance. The current repo posture is:

- hosted runtime validation goes through API health and worker probes
- MCP is a shipped stdio adapter
- CLI and MCP are lightweight query adapters, not runtime supervisors

## Classify The Failure First

Pick the branch that matches the actual symptom:

- **API/runtime failure**: HTTP requests to CCDash fail or the hosted runtime seems unhealthy.
- **Worker readiness failure**: API responds, but jobs/sync/freshness posture looks wrong or worker probes fail.
- **MCP discovery/startup failure**: Claude Code does not discover `ccdash`, or `python -m backend.mcp.server` fails to start.
- **Query-surface failure only**: CLI or MCP returns an error payload, but the runtime contract itself may still be healthy.

Do not collapse these into one generic "server down" diagnosis.

## Branch A: Hosted API Runtime Validation

1. **Check the canonical API health contract first.**

   ```bash
   curl -sS http://127.0.0.1:8000/api/health
   ```

2. **Inspect the minimum Phase 6 fields.**

   Confirm at least:

   - `profile`
   - `storageComposition`
   - `storageBackend`
   - `storageCanonicalStore`
   - `migrationGovernanceStatus`
   - `canonicalSessionStore`
   - `sessionIntelligenceProfile`
   - `storageProfileValidationMatrix`
   - `watchEnabled`
   - `syncEnabled`
   - `syncProvisioned`
   - `jobsEnabled`

3. **Interpret the result against the intended posture.**

   - Hosted API validation should report `profile=api`.
   - If the deployment is supposed to be enterprise-backed, the storage/session-intelligence fields must reflect the documented enterprise posture.
   - If the API health payload contradicts the intended deployment mode, stop and fix the deployment contract before debugging CLI or MCP symptoms.

## Branch B: Worker Probe Validation

Use this when API health is up but background-job ownership or freshness looks wrong.

1. **Check worker probes directly.**

   ```bash
   curl -sS http://127.0.0.1:9465/livez
   curl -sS http://127.0.0.1:9465/readyz
   curl -sS http://127.0.0.1:9465/detailz
   ```

2. **Interpret the probe semantics correctly.**

   - `/livez` answers whether the worker process is alive.
   - `/readyz` answers whether the worker binding/readiness contract is satisfied.
   - `/detailz` is the diagnostic view for worker posture, backlog, and freshness clues.

3. **Remember the split-runtime rule.**

   A healthy `/api/health` response does not prove the worker is ready, and worker readiness does not replace the API health contract.

## Branch C: MCP Discovery Or Startup Failure

1. **Confirm the shipped MCP config exists.**

   Check [`.mcp.json`](/Users/miethe/dev/homelab/development/CCDash/.mcp.json).

2. **Confirm the config posture is the shipped one.**

   It should point Claude Code at:

   - `type: "stdio"`
   - `command: "python"`
   - `args: ["-m", "backend.mcp.server"]`

3. **Validate the server starts.**

   ```bash
   backend/.venv/bin/python -m backend.mcp.server
   ```

4. **If discovery still fails, use the repo troubleshooting flow.**

   Route to:

   - [docs/guides/mcp-setup-guide.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-setup-guide.md)
   - [docs/guides/mcp-troubleshooting.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-troubleshooting.md)

## Branch D: Query-Surface Error With Healthy Runtime

Use this when `/api/health` and the worker probes look correct, but a CLI or MCP query still returns an error payload.

1. **Treat it as a data/project-resolution problem first, not a deployment failure.**
2. **Retry the equivalent surface once for parity.**

   Examples:

   ```bash
   ccdash status project
   ccdash feature report FEATURE_ID --json
   ccdash workflow failures --json
   ccdash report aar --feature FEATURE_ID --md
   ```

3. **If MCP fails but CLI succeeds, the runtime is usually healthy and the issue is MCP discovery/configuration or tool invocation shape.**
4. **If both fail while health/probes are good, the likely problem is unresolved project scope, missing feature data, or an evidence/query issue.**

## Do Not

- Do not tell the user to run `ccdash doctor`, `ccdash target show`, or other non-shipped transport commands.
- Do not validate hosted enterprise posture with `backend.main:app` or `npm run dev`.
- Do not claim that CLI or MCP bootstraps prove background jobs are running.
- Do not treat `/livez`, `/readyz`, `/detailz`, and `/api/health` as interchangeable.

## Provenance To Echo

- API host/port used
- worker probe host/port used
- relevant health/probe fields inspected
- whether the failure was runtime, worker, MCP discovery, or query-surface specific

## Cross-Links

- [SKILL.md](/Users/miethe/dev/homelab/development/CCDash/.claude/skills/ccdash/SKILL.md)
- [docs/guides/enterprise-session-intelligence-runbook.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/enterprise-session-intelligence-runbook.md)
- [docs/setup-user-guide.md](/Users/miethe/dev/homelab/development/CCDash/docs/setup-user-guide.md)
- [docs/guides/mcp-setup-guide.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-setup-guide.md)
- [docs/guides/mcp-troubleshooting.md](/Users/miethe/dev/homelab/development/CCDash/docs/guides/mcp-troubleshooting.md)
