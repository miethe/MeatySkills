# Operator card — Twelve-slide governed workflow illustration set

This card is for the human relay; paste a turn file, not this card.
1. Open the intended Project in Chat mode. Verify the current route's model, thinking and tool separately.
2. Use the matching CGH Project sources or rely on the self-contained turn. Do not upload private local maps or secrets.
3. Attach only this turn's declared files. Supply actual upstream images/files before dependent review/export turns.
4. Paste rendered/turns/Txx.md for exactly one current turn. Generation may end with images only; that is expected.
5. Save actual results locally, map output IDs and selected variants, and record gaps/amendments.
6. Do not advance dependent turns until their inputs exist. Resume only failed/missing outputs when possible.
7. Gather a handback.json plus actual files; import into a new quarantine directory and review before promotion.

| Turn | Capability | Prerequisites | Produced output IDs |
|---|---|---|---|
| T01 | image_generation | none | S01, S02, S03, S04 |
| T02 | image_generation | T01 | S05, S06, S07, S08 |
| T03 | image_generation | T02 | S09, S10, S11, S12 |
| T04 | visual_review | T03 | QA |
| T05 | artifact_creation | T04 | DECK, MAP |

## Account and limits
{
  "plan": "Pro",
  "tier": "unknown",
  "ui_verified_at": null
}
Exact tier, current tools and remaining allowance are not inferred. The configured ten-image ceiling is an operator policy.
The working batch is four unless changed explicitly; use any lower actual limit shown by the service.

## Integrity
Manifest SHA-256: `57a1316331471c6956c1a35c704104cef4b21111d30adc0bb9498085f590d711`.
Rendering does not establish successful source retrieval, model selection, semantic correctness or completed work.
