# scripts/README.md

## verify.py

Validates the four distilled artifacts produced by the `project-context-distiller` skill. Reports findings; never auto-corrects.

### Invocation

```bash
python scripts/verify.py \
  --ledger .claude/context/distilled/.ledger.yaml \
  --output-dir .claude/context/distilled/ \
  --repo-root /path/to/repo
```

### Optional flags

| Flag | Purpose |
|------|---------|
| `--counts-check counts.yaml` | YAML mapping `{label: shell_command}` — verifies claimed counts match live repo |
| `--strict` | Treat warnings as failures (exit 1) |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All checks passed |
| `1` | One or more failures (or warnings with `--strict`) |
| `2` | Fatal invocation error (missing args, bad paths) |

### What it checks

1. **Artifact existence** — all 4 output files are present.
2. **Path citations** — every `` `path/to/file` `` in artifacts resolves against `--repo-root`.
3. **Template fidelity** — no unfilled placeholders (`| | |`, `TODO`, `FIXME`, `<angle-bracket>` stubs).
4. **Required sections** — each artifact contains all mandatory `##` headings.
5. **Confidence tags** — `[evidence H/M/L]`, `[inference H/M/L]`, `[open]` are well-formed.
6. **Ledger inference parents** — every `inference` claim in the ledger references at least one `evidence` parent.
7. **Cross-artifact coherence** — `[evidence H]` claims in research-pack appear in at least one sibling artifact.
8. **Section population** — no required section has an empty body.
9. **Counts check** (optional) — claimed numeric values match live counts from shell commands.

### counts.yaml format

```yaml
router_count: "ls skillmeat/api/routers/*.py | wc -l"
artifact_type_count: "grep -r 'ArtifactType' skillmeat/core/interfaces/ | grep -v test | wc -l"
```

The script searches each artifact's text near the label for a number; compares against command output. Reports PASS/FAIL — does not modify artifacts.

### No external dependencies

`verify.py` uses stdlib only (argparse, re, subprocess, pathlib). No pip install required.
