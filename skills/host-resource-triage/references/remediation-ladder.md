# Remediation ladder — fix order, and the sprawl case

Load before changing anything on the host.

## Why order matters more than speed

Every rung below is chosen to be **reversible and attributable**. Reversible so a wrong guess costs
nothing; attributable so you can tell which change produced which improvement. Doing the
destructive thing first works often enough to feel justified and teaches you nothing about the
cause — and when it is wrong, it is wrong irrecoverably.

Re-measure after **every** rung (`scripts/host-snapshot.sh`). A fix you cannot measure is a story.

## Rung 1 — stop work that goes nowhere

Highest value-to-risk ratio on the ladder. Look for processes doing real work whose *output* is
discarded:

- Metrics/log agents shipping to an unreachable sink (see SKILL.md Workflow 5).
- Retry loops against a dead dependency.
- Watchers on paths that no longer exist.

These consume CPU, memory, and file descriptors indefinitely and are safe to stop, because nothing
downstream is receiving anything.

## Rung 2 — restart wedged services

A service pegged for hours is a **bug**, not load. Distinguish it from a busy service by comparing
cumulative CPU time to elapsed:

```bash
ps -o pid=,time=,etime=,args= -p <pid>
```

Measured example: a worker with **15 hours of CPU time in 22.5 hours elapsed** (~66% sustained,
64 threads) — a hot loop, not throughput. After restart: ~12% and stable.

Restart through the supervisor so the restart is recorded and the process is replaced rather than
merely killed:

```bash
launchctl kickstart -k gui/$(id -u)/<label>    # macOS
systemctl --user restart <unit>                # Linux
```

**File the underlying bug.** A restart clears the symptom; the loop will return.

## Rung 3 — cap concurrency

Auto-sizing flags size to **core count** and are blind to (a) RAM per worker and (b) how many
suites run concurrently. Two auto-sized suites on a 12-core host = 24 workers, each holding a full
application image.

| Tool | Auto (hazard) | Bounded |
|---|---|---|
| pytest-xdist | `-n auto` | `-n 4` |
| make | `-j$(nproc)` | `-j4` |
| cargo/ninja | default = cores | `--jobs 4` |
| jest | default = cores−1 | `--maxWorkers=4` |

Keep CI at auto by overriding on the command line — for pytest, the **last** `-n` wins, so an ini
default of `-n 4` plus `-n auto` in CI resolves to auto. Leave a comment stating *why* the number is
low; a bare magic number gets "optimised" back to `auto` by the next reader.

There is no portable correct value (SKILL.md § Do Not Say). Choose against RAM-per-worker.

## Rung 4 — reclaim accumulated sessions (dry-run first)

### The sprawl pattern

Long-lived interactive sessions accumulate silently. Nothing crashes, nothing alerts, and each one
individually looks reasonable. Measured on the motivating host:

- **37 agent-CLI processes, 13.0 GB RSS**, oldest **4 days** old
- spread across **17 project directories, including 10 stale git worktrees**
- **32 login sessions** (terminal panes)
- with children counted — MCP servers, language servers, long-lived `ssh` tunnels — **172 processes**
  in scope for 30 reapable sessions

The children matter: each session held several helper processes plus multi-day `ssh` tunnels. Reaping
parents without children orphans them.

### Finding them

```bash
# sessions with age and size
ps -Ao pid,etime,rss,comm | grep -E '<session-binary>'

# what project is each one sitting in?
lsof -a -p <pid> -d cwd -Fn | sed -n 's|^n||p'

# full descendant set
pgrep -P <pid>          # recurse
```

### Reaping safely

Use `scripts/agent-session-reaper.sh` — dry-run by default:

```bash
./agent-session-reaper.sh --older-than 12          # report only
./agent-session-reaper.sh --older-than 12 --kill   # act
```

Non-negotiable properties of any such script:

1. **Dry-run default.** Acting requires an explicit flag.
2. **Self-protection.** Walk the ppid chain, find the invoking session, exclude it. A reaper that
   kills its own parent takes the operator's terminal with it.
3. **Children with parents.** Collect the full descendant set; never orphan.
4. **TERM → grace → KILL.** Give processes a chance to persist state.
5. **Age threshold, not "all".** Recent sessions are probably in use.
6. **Report the total before acting**, so the human can weigh it.

### The decision is the human's

Sessions may hold unsaved work, in-flight context, or a task mid-run that no amount of freed RAM
justifies losing. **Produce the list, the reclaimable total, and the dry-run; then stop.** This
holds even when the numbers are damning — especially then, because a large total means a lot of
someone's work is in there.

## Rung 5 — user-facing applications

Browsers and editors are frequently the largest consumers, and are almost always the *last* thing to
touch. Measured example: two browser tabs holding 3.3 GB with 63 combined hours of CPU time, and an
editor at 2.55 GB across 11 processes with a stuck extension host.

Prefer the least destructive intervention that exists:

- Reload the editor window (clears a stuck extension host without losing the workspace).
- Discard individual browser tabs rather than quitting the browser.
- Only then suggest quitting the application — as a **recommendation to the user**, with the numbers.

## The before/after protocol

Without a matched pair of measurements you cannot distinguish a fix from a coincidence — and load
average, the number people quote, is the slowest to respond.

```bash
scripts/host-snapshot.sh > /tmp/triage-before.txt
# … one rung …
scripts/host-snapshot.sh > /tmp/triage-after.txt
diff /tmp/triage-before.txt /tmp/triage-after.txt
```

Report a table of the same fields both times. Judge recovery by `unused`, swapout flatness, and
compressor size — not by load average, which lags by minutes.

**Account for your own footprint.** Recursive `find`, full-tree `grep`, and cold-cache reads during
triage raise load and paging measurably. On the motivating host, a walk over 4,091 directories was a
visible contributor to the load climb *during the diagnosis*. Say so; do not book it as a finding.
