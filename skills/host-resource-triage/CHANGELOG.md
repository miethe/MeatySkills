# Changelog — `host-resource-triage`

## 2026-08-06 — v0.1 — Initial version

Extracted from a live triage session on a 64 GB / 12-core macOS workstation that had driven
itself into swap (load average 132, 0.1% idle, 136 MB unused, 32 GB in the memory compressor,
12.3 GB of 13.3 GB swap consumed).

Encodes five practices, each of which corresponds to a mistake made or narrowly avoided during
that session:

1. **The three CPU quantities** — recent rate (`ps %cpu`, a decaying ~1-minute average),
   sustained average (`TIME / ELAPSED`), and total burn (`TIME`). Written because the session
   first named two bursty processes as sustained causes off a *single* `ps` sample, then
   "corrected" that with the wrong mechanism (claiming `%cpu` is a lifetime average). The man
   page and a controlled multi-sample test settle it: it is a ~1-minute decaying average, so
   those were **real bursts wrongly generalised**, not averaging artifacts. Both the original
   error and the bad correction are recorded in Do Not Say so neither recurs.
2. **Cause vs symptom** — memory exhaustion presents as a CPU incident via `kernel_task`
   (the memory compressor, measured at 84%) and via load average counting threads blocked on
   paging. The session's opening hypothesis (pytest was eating the CPU) was wrong; pytest never
   appeared in the live top consumers.
3. **Agent-session sprawl** — 37 accumulated CLI sessions holding 13.0 GB, 172 processes with
   children counted. A first-class cause on an agent-heavy workstation and easy to miss because
   no single session looks unreasonable.
4. **Non-destructive-first ladder** — stop dead-sink work, restart wedged services, cap
   concurrency, reap sessions (dry-run, human decides), and only then user-facing apps. With a
   mandatory before/after measurement at each rung.
5. **Verify a monitoring sink is alive** — an agent had been shipping metrics for four days to a
   host that answered no pings, and looked perfectly healthy doing it. Includes the API-version
   check (v1 vs v2 wire protocol) and a prompt to scan configs for plaintext credentials.

Files: `SKILL.md`, `references/measurement-traps.md`, `references/macos-memory-model.md`,
`references/remediation-ladder.md`, `scripts/host-snapshot.sh`, `scripts/agent-session-reaper.sh`.

### Deliberate divergence from the `skill-dev` template: no `Key References` section

The template prescribes a `Key References` section of **absolute** paths, enforced by validator
checks 8 and 9 (absolute, and resolving on disk). This skill instead carries a **`Supporting Files`**
table of paths relative to `SKILL.md`.

Reason: MeatySkills is a *portable* library — skills are copied into SkillMeat, other repos, and
other machines. An absolute path resolves on exactly one host and is dead everywhere else, so for a
portable artifact the template's rule optimises for the wrong thing. 21 of the 23 skills in this
library carry no absolute-path reference section for the same reason; the two that do are mirrors
whose upstream genuinely lives at a fixed canonical path.

The skill is fully conformant (validator exit 0 — checks 8/9 pass vacuously with no `Key References`
heading), and every relative path was verified to resolve from the skill directory. This is recorded
here rather than left implicit so a future reader does not "fix" it by hardcoding one machine's paths.

### Scripts verified by execution, not inspection

Both scripts were run, not just syntax-checked. `host-snapshot.sh` had a real bug on first run —
command names truncated at the first whitespace (`/Applications/AI/IBM` instead of the full
`IBM Bob Helper (Plugin)` path), because the awk field for `comm` stops at a space. Fixed in all
three report blocks via `substr($0, index($0,$N))`. `agent-session-reaper.sh` was verified for
correct exit codes (2 on bad args, 0 on `--help`) and — most importantly — that the invoking session
is excluded from the victim list **even under `--all`**.

Scope: macOS-primary. Linux is a mapping table (including PSI), explicitly marked as sketched
rather than independently validated. No Windows coverage. No container/cgroup-scoped attribution.
