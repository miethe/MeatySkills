---
name: host-resource-triage
description: >-
  Diagnose a developer workstation or server that is thrashing — RAM exhaustion, swap
  churn, runaway load average, "everything is slow" — by measuring correctly, separating
  cause from symptom, and remediating non-destructive-first. macOS-primary, with Linux
  equivalents. Use when a machine feels slow or unresponsive, load average is far above
  core count, swap is filling, a build/test run tanks the box, agent or editor sessions
  have accumulated, or you need a repeatable before/after record of a performance fix.
  Triggers: "machine is slow", "high load average", "swap is full", "out of memory",
  "CPU pegged", "what is eating my RAM", "why is my laptop thrashing", "memory pressure",
  "runaway process", "too many sessions". Do NOT use for: profiling code inside one
  application (use a language profiler), tuning a database or web service's own
  configuration, capacity planning, or standing up a monitoring stack (that is an infra
  task — this skill only verifies whether a monitoring agent's sink is actually alive).
version: 0.1
app_version: "2026-08-06"
updated: 2026-08-06
---

# Host Resource Triage Skill

Find out why a machine is thrashing, prove it with numbers, and fix it in an order that
cannot make things worse. The core discipline: **measure three different quantities and never
confuse them**, then **separate the disease from its symptoms** before touching anything.

## When To Use

Use this skill when:
- A workstation or server "feels slow", is unresponsive, or beachballs/stalls under normal work.
- Load average is far above the core count, or swap/paging is climbing.
- A test suite, build, or agent fan-out tanks the whole box.
- Long-lived sessions (agent CLIs, editors, shells) may have accumulated unnoticed.
- You need a defensible before/after record proving a fix worked.

## When NOT To Use

Do NOT use this skill for:
- Profiling hot code paths inside a single application — use a language profiler (py-spy, Instruments, perf).
- Tuning a service's own config (Postgres `shared_buffers`, JVM heap, nginx workers) — that is service-specific work.
- Capacity planning or sizing new hardware — this is incident triage, not forecasting.
- Building or deploying a monitoring stack — infra work. This skill only checks whether an
  existing agent's sink is reachable, because a dead sink looks identical to a working one.

## Overview

Resource triage fails in three predictable ways, and this skill exists to block each one.

1. **Mismeasurement.** `ps %cpu` is a *decaying ~1-minute average*, not an instantaneous or
   lifetime figure. One sample of a bursty process reads like sustained load. Acting on a single
   sample is the most common way a triage session invents a culprit.
2. **Symptom-chasing.** On a memory-starved machine the kernel burns real CPU compressing pages,
   and the load average fills with threads blocked on paging. That looks exactly like a CPU
   problem. Fix the memory and the "CPU problem" evaporates; cap the CPU and nothing improves.
3. **Destructive-first remediation.** Killing things is fast, irreversible, and usually
   unnecessary. Everything reversible comes first, and killing a user's sessions is the user's
   call, never the agent's.

## Decision Tree

```
OBSERVATION                                          NEXT ACTION
──────────────────────────────────────────────────────────────────────────────────────
"machine is slow" (no data yet)                   →  Workflow 1 — baseline snapshot
load average >> cores BUT idle% > 0               →  memory/IO bound, NOT CPU → Workflow 2
load average >> cores AND idle% ≈ 0               →  genuine CPU saturation → Workflow 3
swap used / compressor large / unused ≈ 0         →  Workflow 2 (memory exhaustion)
one process suspected                             →  Workflow 3 (attribute before accusing)
many long-lived sessions suspected                →  references/remediation-ladder.md § sprawl
ready to fix                                      →  Workflow 4 — non-destructive-first ladder
a monitoring agent is installed                   →  Workflow 5 — verify the sink is alive
```

## The three quantities (never interchange them)

This is the load-bearing distinction in the whole skill.

| Quantity | How to get it (macOS) | Answers | Trap |
|---|---|---|---|
| **Recent rate** | `ps -o pcpu=` (decaying ~1 min) or `top -l 2 -s 2` (**discard sample 1**) | "What is hot *right now*?" | A single sample of a bursty process reads as sustained. Sample 2–3× before claiming sustained load. |
| **Sustained average** | `ps -o time=,etime=` → `TIME / ELAPSED` | "What has this averaged over its whole life?" | Not what `ps %cpu` shows. Measured example: WindowServer read **67% recent** but **33% lifetime**. |
| **Total burn** | `ps -o time=` alone, sorted | "What has consumed the most CPU cumulatively?" | A high total on an old process may be perfectly normal. Rate ≠ total. |

**Rule:** `recent ≫ sustained` ⇒ bursty *or* newly degraded (investigate further, do not yet
accuse). `recent ≈ sustained` ⇒ steady consumer (safe to name it). `top`'s **first** sample is
since-boot and must always be thrown away.

Full worked derivation, including the man-page wording that misleads: `references/measurement-traps.md`.

## Command Map

| Purpose | Command | Notes |
|---|---|---|
| Baseline snapshot | `scripts/host-snapshot.sh` | One shot, all metrics; re-run after fixes to diff |
| True recent CPU | `top -l 2 -o cpu -n 15 -s 2` | Take the **second** sample only |
| Sustained average | `ps -Axo time,etime,pcpu,comm \| sort -r` | Compute TIME/ELAPSED yourself |
| Memory pressure | `vm_stat` + `sysctl vm.swapusage` | Watch *compressor pages* and swap used |
| Paging **rate** (not total) | delta of `vm_stat` pageins/swapins over N sec | Counters are since-boot; a total tells you nothing |
| Per-process memory | `ps -Ao pid,rss,etime,comm -m` | RSS drops as pages compress — falling RSS ≠ freed memory |
| Session sprawl | `ps -Ao pid,etime,rss,comm` + `lsof -a -p <pid> -d cwd -Fn` | `lsof` resolves each session's project dir |
| Process tree | `pgrep -P <pid>` recursively | Children (MCP servers, tunnels) must be counted with the parent |
| Reap stale sessions | `scripts/agent-session-reaper.sh` | **Dry-run by default**; self-protecting; `--kill` opts in |

Linux equivalents (`/proc/pressure/*`, `free`, `vmstat`, `pidstat`, `systemd-cgtop`):
`references/measurement-traps.md` § Linux.

## Workflows

### Workflow 1 — Baseline snapshot (always first)

Capture everything *before* forming a hypothesis, so the fix has a comparison point.

```bash
scripts/host-snapshot.sh > /tmp/triage-before.txt
```

Records: core count, load average, `top` CPU split (user/sys/**idle**), PhysMem incl. compressor
and unused, swap usage, paging **rates**, process and thread counts.

**Note your own footprint.** A recursive `find` or a full-tree grep during triage measurably
raises load and paging. Attribute it to yourself; do not report it as a finding.

### Workflow 2 — Memory-bound path

Confirm exhaustion, then quantify the CPU it is *causing*:

```bash
sysctl vm.swapusage                      # swap used vs total
vm_stat | grep -E 'compressor|Pages free'
top -l 1 -n 0 | grep PhysMem             # "unused" near zero = no headroom
```

Then check the tell that converts this from a memory story to a CPU story: on macOS a high
`kernel_task` is the **memory compressor doing work**. That CPU is the *price* of exhaustion, not
an independent problem. Mechanism and the load-average semantics: `references/macos-memory-model.md`.

### Workflow 3 — Attribute a CPU consumer (before accusing it)

```bash
top -l 2 -o cpu -n 15 -s 2 | awk '/^Processes:/{s++} s==2'   # recent rate
ps -o time=,etime= -p <pid>                                   # sustained average
```

Compare per the rule above. Also total per-application families rather than per-process — an
Electron app or browser spreads across many helpers and each one alone looks innocent:

```bash
ps -Ao rss,args | grep -i '<app>' | grep -v grep \
  | awk '{s+=$1} END{printf "%.2f GB across %d procs\n", s/1048576, NR}'
```

### Workflow 4 — Non-destructive-first remediation ladder

Strict order. Each rung is reversible; stop and re-measure at every one.

1. **Stop work that goes nowhere** — agents shipping to dead sinks, retry loops. (Workflow 5.)
2. **Restart wedged services** — a service pegged for hours is a bug, not load. Prefer its
   supervisor (`launchctl kickstart -k`, `systemctl restart`) over `kill`.
3. **Cap concurrency** — fixed worker counts instead of `-n auto` / `-j$(nproc)`, which size to
   *core count* and ignore that N suites may run at once.
4. **Reclaim accumulated sessions** — dry-run first, hand the decision to the human.
5. **Only then** consider killing user-facing applications — **the user's call, always.**

Full rationale, the before/after protocol, and the sprawl case: `references/remediation-ladder.md`.

### Workflow 5 — Verify a monitoring agent's sink is alive

An agent with an unreachable sink looks identical to a healthy one: process up, config valid,
data going nowhere. Verify all three layers, in order:

```bash
grep -A5 -E '^\[\[outputs|remote_write|url' <agent-config>   # where is it shipping?
ping -c2 <sink-host>                                          # 1. host reachable?
curl -s -m5 http://<sink-host>:<port>/health                  # 2. service answering?
```

3. **API version match.** An agent speaking InfluxDB **v2** (token + org) against a **1.8**
   server, or Prometheus remote-write v1 vs v2, fails at the wire protocol while every process
   looks healthy. Confirm the agent's output plugin matches the server's major version.

**While you are reading configs, scan for plaintext credentials** — monitoring configs routinely
carry tokens in world-readable files. Report the finding and recommend rotation; never echo the
secret into output or a transcript.

## Guardrails

- **Never kill a user's applications or interactive sessions unilaterally.** Produce the list, the
  reclaimable total, and a dry-run. The human decides. Editors, browsers, and agent sessions may
  hold unsaved work that no amount of freed RAM justifies losing.
- **Any reaper must protect its own ancestry.** Walk the ppid chain and exclude the invoking
  session, or the script kills the hand holding it.
- **Signal gently, then firmly.** SIGTERM → grace period → SIGKILL stragglers only. Reap children
  with their parent; never orphan them.
- **Report rates, not counters.** `vm_stat` swapins/pageins are since-boot totals; a large total on
  a 5-day-old machine may be irrelevant. Always diff over an interval.
- **Falling RSS is not freed memory.** Under pressure, pages move into the compressor and RSS
  drops while pressure is unchanged. Check compressor size and `unused`, not RSS alone.
- **Distinguish "cannot determine" from "zero."** If a probe could not run (missing scope, no
  permission, host offline), say so. An unmeasured quantity is never reported as absent.
- **Sample before you accuse.** One `ps` reading is a hypothesis, not a finding.

## Deferred / Do Not Say

| Claim | Status | What NOT to say |
|---|---|---|
| "`ps %cpu` is a lifetime average" | **FALSE** — it is a decaying **~1-minute** average (man ps). Verified: WindowServer 67% recent vs 33% lifetime. | "That 38% is just an averaging artifact." |
| "`ps %cpu` is instantaneous" | Also false — it decays over up to a minute, so it lags and smooths. | "ps shows what's happening right now." |
| "High load average means CPU saturation" | Load counts runnable **plus** threads blocked in uninterruptible wait. Load ≫ cores with non-zero idle% means blocked, not busy. | "Load 100 means we need more cores." |
| "`kernel_task` is a runaway process" | On macOS it is the kernel, including the memory compressor and thermal management. High = a symptom of pressure. | "Kill kernel_task." |
| Spotlight/FSEvents exclusions as a major CPU fix | Usually **marginal**. Measured on one 4-day-old host: `fseventsd` averaged ~3% lifetime despite a 37% single sample. | "Excluding node_modules will fix your CPU." |
| A tuned `-n`/`-j` value that suits every host | Not portable — it depends on core count, RAM per worker, and how many suites run at once. | "Use `-n 4` everywhere." |
| This skill sizes or builds monitoring | It does not. It verifies an existing sink is alive (Workflow 5). | "This will set up Grafana." |

**Known gaps:**
- macOS-primary. Linux coverage is a mapping table (`references/measurement-traps.md` § Linux), not
  an independently validated path; cgroup-v2 and PSI-based triage are sketched, not exercised.
- No Windows coverage.
- Container/cgroup-scoped attribution (a process starved by its own cgroup limit rather than host
  pressure) is out of scope.
- `scripts/host-snapshot.sh` reports; it never remediates.

## Supporting Files

Paths are **relative to this `SKILL.md`**, deliberately. MeatySkills is a portable library — its
skills get copied into SkillMeat, other repos, and other machines, so an absolute path would resolve
on exactly one host and rot everywhere else. (21 of 23 skills in this library carry no absolute-path
reference section for the same reason.)

| File | Load when |
|---|---|
| `references/measurement-traps.md` | deciding what a CPU number means; working on Linux |
| `references/macos-memory-model.md` | memory pressure or load-average semantics are in question |
| `references/remediation-ladder.md` | **before changing anything** on the host |
| `scripts/host-snapshot.sh` | taking the baseline and the after-state |
| `scripts/agent-session-reaper.sh` | reclaiming accumulated sessions (dry-run first) |
