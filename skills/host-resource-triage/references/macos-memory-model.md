# macOS memory model — why exhaustion presents as a CPU problem

Load when memory pressure or load-average semantics are in question.

## The mechanism

macOS does not swap immediately when memory fills. It first **compresses** inactive pages in RAM
(the memory compressor), and only swaps when compression can no longer keep up. That design is
usually invisible and beneficial. Under genuine exhaustion it produces a specific, confusing
signature:

```
1. Physical memory fills               → "unused" approaches zero
2. Kernel compresses inactive pages    → compressor grows; this costs REAL CPU
3. Compression stops keeping up        → swapouts begin
4. Working set no longer fits          → pages fault back in constantly (high pageins/sec)
5. Threads block on paging             → they enter uninterruptible wait
6. Load average counts blocked threads → load explodes while CPU shows idle time
```

Steps 2 and 6 are why this reads as a CPU incident. Two specific tells:

- **`kernel_task` high.** On macOS `kernel_task` is the kernel itself, including the compressor and
  thermal management. Measured on the motivating host: `kernel_task` at **84%** with 844 threads.
  That is nearly a full core spent compressing and decompressing pages instead of doing work. It is
  the **price** of exhaustion, not an independent runaway. There is nothing to kill.
- **Load ≫ cores while idle% > 0.** Load average counts runnable threads **plus** threads in
  uninterruptible wait. A load of 99 on 12 cores with 34% idle is not 99 threads wanting CPU — it is
  a queue full of threads waiting on memory. Conversely, load ≫ cores with idle% ≈ 0 *is* real CPU
  saturation and routes to the CPU path instead.

## Reading the numbers

```bash
sysctl vm.swapusage
vm_stat
top -l 1 -n 0 | grep -E 'PhysMem|Load Avg|CPU usage'
```

| Signal | Healthy | Exhausted (measured example) |
|---|---|---|
| `PhysMem … unused` | GBs free | **136 MB** of 64 GB |
| compressor | small / absent | **32 GB** occupied |
| `vm.swapusage` used | ~0 | **12.3 GB of 13.3 GB** |
| pageins/sec (delta) | near 0 idle | **~300/sec sustained** |
| `kernel_task` | low single digits | **84%** |
| load vs cores, with idle% | load ≤ cores | **load 132 on 12 cores, 0.1% idle** |

Convert compressor pages to bytes with the page size `vm_stat` prints in its header (16384 on
Apple silicon, 4096 on Intel) — do not assume 4 KB:

```bash
vm_stat | awk '/page size of/{ps=$8} /occupied by compressor/{c=$5} END{printf "compressor = %.1f GB\n", c*ps/1073741824}'
```

## Why capping CPU does not help

If the disease is memory, a CPU cap changes nothing: the threads are not competing for CPU, they
are waiting for pages. Worse, capping test parallelism can *extend* the window during which the
memory is held. The correct lever is **reducing resident demand** — fewer concurrent processes,
fewer accumulated sessions, fewer workers each importing a full application image.

Concurrency caps still matter, but for a different reason: each worker's *memory* footprint. A
12-worker test run is not primarily a CPU problem — it is 12 full application images resident at
once. Size worker counts against RAM-per-worker, not core count.

## The distinction that actually drives the fix

| Symptom | Cause | Correct lever |
|---|---|---|
| `kernel_task` burning CPU | memory exhaustion | free memory |
| load average ≫ cores, idle% > 0 | threads blocked on paging | free memory |
| high pageins/sec | working set exceeds RAM | free memory |
| thermal throttling under load | sustained heat | reduce sustained work |
| load ≫ cores, idle% ≈ 0 | genuine CPU saturation | reduce concurrency / find the hot process |

The first three rows are one disease with three faces. Treating them as three problems produces
three patches and no fix.

## Verifying a fix actually worked

Re-measure the same fields and diff them. The signals that prove memory recovery, in priority order:

1. **`unused` rises** — real headroom returned.
2. **Swapouts stop climbing** during the observation window — pressure relieved. A flat counter is
   the goal; the historical total will not decrease.
3. **Compressor shrinks** — pages decompressed or freed.
4. **Load average falls** — *lagging indicator*, and slowest to move. The 1- and 5-minute averages
   keep digesting the earlier thrash for minutes after the underlying pressure is gone. Do not judge
   a fix by load average alone, and do not conclude a fix failed because load is still high.

Measured before/after on the motivating host, after reversible fixes only:

| Signal | Before | After |
|---|---|---|
| `unused` | 136 MB | **2,750 MB** |
| compressor | 32 GB | 27 GB |
| swapouts | climbing | **flat** |
| processes / threads | 1,546 / 13,299 | 1,284 / 12,200 |
