#!/usr/bin/env bash
# host-snapshot.sh — one-shot host resource snapshot, designed to be diffed.
#
# Emits a stable, line-oriented report so two runs can be compared directly:
#   ./host-snapshot.sh > /tmp/triage-before.txt
#   … apply one remediation rung …
#   ./host-snapshot.sh > /tmp/triage-after.txt
#   diff /tmp/triage-before.txt /tmp/triage-after.txt
#
# Reports only. Never remediates, never signals a process.
#
# Deliberate choices:
#   - Paging figures are RATES (sampled deltas), not since-boot counters, which are
#     meaningless on a multi-day-uptime host.
#   - CPU split comes from `top -l 2` with the FIRST sample discarded (sample 1 is
#     since-boot and would make an idle machine look busy).
#   - Per-process CPU is shown with BOTH the recent rate and cumulative TIME/ELAPSED,
#     because `ps %cpu` is a decaying ~1-minute average and a single sample of a
#     bursty process is not a sustained-load claim. See references/measurement-traps.md.

set -uo pipefail

SAMPLE_S="${SAMPLE_S:-5}"
TOPN="${TOPN:-12}"
OS="$(uname -s)"

echo "=============================================================="
echo "host snapshot — $(date -u '+%Y-%m-%dT%H:%M:%SZ') — $OS"
echo "=============================================================="

# ---------------------------------------------------------------- capacity ----
echo
echo "## capacity"
if [ "$OS" = "Darwin" ]; then
  printf 'model:    %s\n' "$(sysctl -n hw.model 2>/dev/null)"
  printf 'cores:    %s\n' "$(sysctl -n hw.ncpu 2>/dev/null)"
  printf 'ram:      %.0f GB\n' "$(bc -l <<<"$(sysctl -n hw.memsize)/1073741824")"
else
  printf 'cores:    %s\n' "$(nproc 2>/dev/null || echo '?')"
  awk '/MemTotal/{printf "ram:      %.0f GB\n", $2/1048576}' /proc/meminfo 2>/dev/null
fi
printf 'uptime:   %s\n' "$(uptime | sed 's/.*up //; s/,[[:space:]]*[0-9]* user.*//')"

# --------------------------------------------------------------- cpu split ----
echo
echo "## load + cpu split  (idle% is the cause-vs-symptom discriminator)"
if [ "$OS" = "Darwin" ]; then
  # -l 2 then keep only the SECOND sample block
  top -l 2 -n 0 -s 2 2>/dev/null | awk '/^Processes:/{s++} s==2' \
    | grep -E '^(Processes|Load Avg|CPU usage|PhysMem|VM):' \
    | sed 's/^/  /'
else
  printf '  load:   %s\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
  command -v vmstat >/dev/null && vmstat 1 2 | tail -1 | awk '{printf "  cpu:    us=%s sy=%s id=%s wa=%s\n",$13,$14,$15,$16}'
fi
echo
echo "  interpretation:"
echo "    load >> cores AND idle% > 0   -> blocked threads (memory/IO), NOT cpu-bound"
echo "    load >> cores AND idle% ~ 0   -> genuine cpu saturation"
echo "    load lags minutes behind recovery; judge fixes by 'unused' + swapout flatness"

# ------------------------------------------------------------------ memory ----
echo
echo "## memory"
if [ "$OS" = "Darwin" ]; then
  sysctl -n vm.swapusage | sed 's/^/  swap: /'
  vm_stat 2>/dev/null | awk '
    /page size of/      {ps=$8}
    /Pages free/        {free=$3}
    /Pages active/      {act=$3}
    /Pages wired/       {wire=$4}
    /occupied by compressor/ {comp=$5}
    END {
      gsub(/\./,"",free); gsub(/\./,"",act); gsub(/\./,"",wire); gsub(/\./,"",comp)
      printf "  page size:   %d bytes\n", ps
      printf "  free:        %.2f GB\n", free*ps/1073741824
      printf "  active:      %.2f GB\n", act*ps/1073741824
      printf "  wired:       %.2f GB\n", wire*ps/1073741824
      printf "  compressor:  %.2f GB   <- growth = pressure; cost shows up as kernel_task cpu\n", comp*ps/1073741824
    }'
else
  free -h 2>/dev/null | sed 's/^/  /'
  [ -r /proc/pressure/memory ] && sed 's/^/  psi-mem: /' /proc/pressure/memory
fi

# -------------------------------------------------------------- paging rate ----
echo
echo "## paging RATE (${SAMPLE_S}s sample — counters since boot are meaningless)"
if [ "$OS" = "Darwin" ]; then
  read -r pi0 si0 so0 < <(vm_stat | awk '/Pageins/{a=$2} /Swapins/{b=$2} /Swapouts/{c=$3} END{gsub(/\./,"",a);gsub(/\./,"",b);gsub(/\./,"",c); print a, b, c}')
  sleep "$SAMPLE_S"
  read -r pi1 si1 so1 < <(vm_stat | awk '/Pageins/{a=$2} /Swapins/{b=$2} /Swapouts/{c=$3} END{gsub(/\./,"",a);gsub(/\./,"",b);gsub(/\./,"",c); print a, b, c}')
  printf '  pageins/sec:   %d\n' $(( (pi1 - pi0) / SAMPLE_S ))
  printf '  swapins/sec:   %d\n' $(( (si1 - si0) / SAMPLE_S ))
  printf '  swapouts/sec:  %d   <- nonzero = actively swapping NOW\n' $(( (so1 - so0) / SAMPLE_S ))
else
  command -v vmstat >/dev/null && vmstat "$SAMPLE_S" 2 | tail -1 | awk '{printf "  swap-in/sec=%s  swap-out/sec=%s\n",$7,$8}'
fi

# ------------------------------------------------------------------ process ----
echo
echo "## process + thread counts"
printf '  processes: %s\n' "$(ps -Ao pid= 2>/dev/null | wc -l | xargs)"
if [ "$OS" = "Darwin" ]; then
  top -l 1 -n 0 2>/dev/null | awk '/^Processes:/{print "  " $0}'
else
  printf '  threads:   %s\n' "$(ps -eLo pid= 2>/dev/null | wc -l | xargs)"
fi

# ------------------------------------------------- top consumers (two views) ----
echo
echo "## top $TOPN by RECENT cpu  (decaying ~1min avg — sample again before accusing)"
ps -Ao pcpu=,rss=,time=,etime=,comm= -r 2>/dev/null | head -"$TOPN" \
  | awk '{cmd=substr($0, index($0,$5)); rss=$2/1024;
          printf "  %6.1f%%  %8.0f MB  cum=%-11s elapsed=%-13s %s\n", $1, rss, $3, $4, cmd}'

echo
echo "## top $TOPN by SUSTAINED average (cumulative TIME / ELAPSED)"
ps -Ao time=,etime=,rss=,comm= 2>/dev/null | awk '
  function secs(t,  n,p) { n=split(t,p,/[-:]/);
    if (n==4) return p[1]*86400+p[2]*3600+p[3]*60+p[4];
    if (n==3) return p[1]*3600+p[2]*60+p[3];
    if (n==2) return p[1]*60+p[2]; return 0 }
  { c=secs($1); e=secs($2); cmd=substr($0, index($0,$4));
    if (e>0) printf "%.1f\t%s\t%s\t%.0f\t%s\n", 100*c/e, $1, $2, $3/1024, cmd }
' | sort -rn | head -"$TOPN" \
  | awk -F'\t' '{printf "  %6.1f%%  cum=%-11s elapsed=%-13s %6d MB  %s\n", $1, $2, $3, $4, $5}'

echo
echo "## top $TOPN by RSS  (falling RSS != freed memory — pages may be compressed)"
ps -Ao rss=,etime=,comm= -m 2>/dev/null | head -"$TOPN" \
  | awk '{cmd=substr($0, index($0,$3));
          printf "  %8.0f MB  elapsed=%-13s %s\n", $1/1024, $2, cmd}'

echo
echo "=============================================================="
echo "reminder: recent >> sustained = bursty or newly degraded (do not accuse yet)"
echo "          recent ~= sustained = steady consumer (safe to name)"
echo "=============================================================="
