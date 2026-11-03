# Bound-front dispatch preflight

Target-Node: node_01M52WQT5JX6QBKESK80GMS1WR

Resolve lane eligibility, account, model, effort and write capability first. Keep one
whole-node owner and cap its return at 300 words, pointers only. A refusal is evidence;
never rotate credentials/accounts or waive a gate to make the same send pass.

1. Source existing credentials: `set -a; . ~/.config/aos/secrets.env; set +a`.
2. Stamp the node: `op pack stamp "$node" --kind filing`. Use the returned materialized
   directory; do not guess its sequence or read status from an older pack.
3. Export `AOS_MANIFEST_REF="$pack/execution-manifest.yaml"` and
   `AOS_CONTEXT_BUNDLE_PATH="$pack/pack.md"`. The disk resolver also finds the newest
   stamped pack when no explicit refs or node-binding sidecar exists. A present invalid
   sidecar still refuses; export the verified stamp or repair the binding explicitly.
4. Use a linked worktree. Keep the brief at its absolute front-owned path; pass it by
   `--prompt-file`, without copying it into the worktree. Start it with a real
   `Target-Node:`. Pre-gather authorized sibling-repo reads into worktree artifacts and
   reference those artifacts; ICA brief prose must contain no outside source paths.
5. Run the offline checks below. Send ONE leg, confirm its provider-running receipt,
   then send other independent work. Check-only verifies local predicates; it does not
   attest remote service or provider availability. Campaign preview never reserves an
   attempt or changes the red streak.

## ICA write

```bash
python3 infra/dispatch/ica_authorization.py --prompt "$brief" --authorized-repo "$wt"
aos-leg --lane ica --model 'claude-opus-5-5[1m]' --task-class write \
  --prompt-file "$brief" --node "$node" --session "$sid" --cwd "$wt" \
  --ica-authorized-repo "$wt" --allow-cred INTENTTREE_API_TOKEN \
  --timeout 3300 --effort medium --check-only
# After all predicates pass, repeat that exact invocation without --check-only.
```

## Codex write

The standing account is `codex_primary` (Nick, 2026-10-16: `codex_secondary` is downgraded
until 2026-11-12). Use `codex_secondary` only as an explicit routing decision.

```bash
op context pack --node-id "$node" --destination codex-external \
  --session-id "$sid" --project-root . --project agentic_meta_dev
# Export AOS_CONTEXT_BUNDLE_PATH to the path printed by that command.
aos-leg --lane codex --codex-identity codex_primary --model gpt-6-luna \
  --task-class write --prompt-file "$brief" --node "$node" --session "$sid" \
  --codex-network --cwd "$wt" --allow-cred INTENTTREE_API_TOKEN \
  --timeout 3300 --effort medium --check-only
# After all predicates pass, repeat that exact invocation without --check-only.
```

Choose `gpt-6.1-sol` when the contract requires raw strength. The caller must wait for
foreground execution to finish; a harness timeout must exceed the leg's ceiling
(the measured front shape used 7200000ms). Preserve model/account pins on retries.
After dispatch code merges, refresh the installed pinned runtime with
`python3 infra/codex-identities/install-local.py --operator-runtime` from the authorized
checkout. A branch edit alone does not update the running dispatcher.

| Predicate/refusal | Evidence and fix |
| --- | --- |
| `campaign_suspended` | Read the stopping leg/node/front and suspension receipt. Human decision only: `campaign_admission.py reauthorize --decision <Nick-quote> --evidence <receipt> --answer-ref <answer>`. |
| `campaign_genesis_or_head_mismatch` | The anchor and ledger disagree; admission stays suspended. There is no automatic re-anchor: clearance goes through the same human-receipted `reauthorize` path as any other suspension. A receipted re-anchor design is tracked on `node_01M532BPP630XG9QA3P3WMET2A`. |
| `ica_authorization_out_of_scope:<paths>` | Pre-gather authorized reads into the worktree; remove outside paths in prose; run the offline authorization check. Never enlarge scope without authority. |
| `CONTEXT-BLIND-REFUSED` | Stamp, export both returned paths, verify external-safe resolver output. Disk packs avoid the live binding refresh deadline. |
| `parent_lacks:<NAME>` | Source existing secrets in the parent, then explicitly grant only the needed name. |
| Worktree/node unmet | Supply the actual linked, non-conflicted worktree and resolvable Target-Node. |
| Codex network unmet | Add `--codex-network` when the brief needs network. Never pass this Codex flag to ICA. |

Project hooks capture failure events and Stop-scan refusal markers into the existing
hazard register, with fingerprint deduplication and hit counts. They do not clear gates
or decide whether a refusal counts as a campaign red. That decision remains on
node_01M4SN2DGZ2XH4EC0XN6BTDYE2. Tests prove branch wiring; deployment follows merge.
