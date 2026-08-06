# Measurement traps — what a CPU/memory number actually means

Load when deciding what a number means, or when working on Linux.

## 1. `ps %cpu` is a decaying ~1-minute average

The macOS/BSD man page is explicit, and it is the sentence most people never read:

> `%cpu` — The CPU utilization of the process; this is a **decaying average over up to a minute
> of previous (real) time**. Because the time base over which this is computed varies (some
> processes may be very young), it is possible for the sum of all `%cpu` fields to exceed 100%.

So it is **neither** instantaneous **nor** lifetime. Both misreadings produce wrong conclusions:

| Misreading | Consequence |
|---|---|
| "instantaneous" | You treat a smoothed, lagging figure as a live rate and chase a spike that already ended. |
| "lifetime average" | You dismiss a real, current burst as a historical artifact and clear an actual culprit. |

### The verification, so you don't take this on faith

Sample the same pid repeatedly, then compare against cumulative CPU time over elapsed time:

```bash
for i in 1 2 3; do ps -o pcpu= -p <pid>; sleep 2; done
ps -o time=,etime= -p <pid>
```

Measured on a 5-day-uptime macOS host:

| Process | `ps %cpu` (3 samples) | `TIME / ELAPSED` | Reading |
|---|---|---|---|
| WindowServer | 67.1, 66.3, 68.4 | 2446 min / 7351 min = **33%** | Recent ≫ lifetime → genuinely hot *now*, not historically |
| Chrome (parent) | 1.3, 1.2, 1.5 | 128 min / 7351 min = **1.7%** | Recent ≈ lifetime → steady, unremarkable |

If `%cpu` were a lifetime average, WindowServer could not read 67% against a 33% history. If it
were instantaneous, three samples of a bursty process would not cluster so tightly. It is a
short-window decaying average — exactly as documented.

### The failure mode this actually causes

Bursty processes are the hazard. A metrics agent flushing every 10s, or a filesystem-event daemon
reacting to a build, sits near idle and spikes hard. Two single samples of the same process,
minutes apart, legitimately read 38% and 0.8%. **Both are true for their window.** Neither is a
sustained-load claim.

On the host that motivated this skill, a single `ps -r` sample was used to name a metrics agent and
a filesystem daemon as sustained causes. Multi-sampling showed the agent near idle and the daemon
averaging ~3% over its life. The subsequent "it was just a lifetime average" explanation was *also*
wrong. The correct account is: real bursts, wrongly generalised to sustained load.

### The rule

```
recent ≫ sustained   → bursty, or newly degraded. Sample more. Do not accuse yet.
recent ≈ sustained   → steady consumer. Safe to name.
recent ≪ sustained   → the burst is over; look at what it was doing, not what it is doing.
```

## 2. `top`'s first sample is since-boot — throw it away

`top -l 1` reports averages since boot for the CPU split. Any interval-based reading needs at least
two samples, and you use the second:

```bash
top -l 2 -o cpu -n 15 -s 2 | awk '/^Processes:/{s++} s==2'
```

`-l 2` = two samples, `-s 2` = 2s apart, the `awk` keeps only the second block. Getting this wrong
makes an idle machine look busy and a busy machine look average.

## 3. Counters vs rates

`vm_stat`'s `Pageins`, `Swapins`, `Swapouts`, `Compressions` are **cumulative since boot**. On a
multi-day-uptime host the totals are enormous and meaningless. Diff them:

```bash
a=$(vm_stat | awk '/Pageins/{print $2}' | tr -d '.'); sleep 10
b=$(vm_stat | awk '/Pageins/{print $2}' | tr -d '.')
echo "pageins/sec = $(( (b-a)/10 ))"
```

A sustained triple-digit pageins/sec on a workstation is active thrash. A total of 229 million
over five days tells you nothing at all.

The same applies to swap: `Swapouts` climbing *during your observation window* means pressure now;
a large static total means it happened at some point.

## 4. RSS lies under memory pressure

Resident set size falls when pages move into the compressor or out to swap. A process whose RSS
"improved" from 13 GB to 10 GB across two readings may have had **nothing** freed — the pages were
compressed. Cross-check with:

- `vm_stat` → `Pages occupied by compressor` (× page size)
- `top -l 1 -n 0 | grep PhysMem` → the `unused` figure

Sum-of-RSS across all processes also double-counts shared pages, so it overstates. Use it for
ranking consumers, never as a total.

## 5. Per-application totals, not per-process

Electron apps and browsers spread across many helper processes; each looks innocent alone. Always
total the family:

```bash
ps -Ao rss,args | grep -i '<app-name>' | grep -v grep \
  | awk '{s+=$1} END{printf "%.2f GB across %d procs\n", s/1048576, NR}'
```

An editor at "300 MB" in Activity Monitor's front row was 2.55 GB across 11 processes, with one
extension host pegged at ~100% of a core.

## 6. Linux equivalents

Mapping table — this path is **sketched, not independently validated** (see SKILL.md § Known gaps).

| Need | macOS | Linux |
|---|---|---|
| Recent CPU per process | `top -l 2`, `ps -o pcpu` | `pidstat 2 3`, `top -b -n 2` (use 2nd), `ps -o pcpu` (same ~1-min decay caveat) |
| Sustained average | `ps -o time=,etime=` | same |
| Memory pressure | `vm_stat` compressor, `sysctl vm.swapusage` | `free -h`, `/proc/pressure/memory` (PSI), `vmstat 1` |
| Paging rate | `vm_stat` delta | `vmstat 1` `si`/`so` columns (already rates) |
| Compressor analogue | memory compressor | zram/zswap if enabled, else none — Linux swaps sooner |
| Load-average semantics | runnable + uninterruptible wait | identical (includes `D` state) |
| Per-cgroup attribution | n/a | `systemd-cgtop`, `/sys/fs/cgroup/*/memory.current` |
| Kernel-side pressure cost | `kernel_task` | `kswapd*`, plus PSI `some`/`full` stall percentages |

Linux advantage worth using: **PSI** (`/proc/pressure/{cpu,memory,io}`) reports stall time directly,
which is the quantity macOS forces you to infer from load-vs-idle.
