# Project Overclaim-Guard Addendum — TEMPLATE

> Copy this file into your project (e.g. `docs/reporting/overclaim-guard.md`) and fill it in.
> The `delivery-report` renderer enforces generic honesty rules (evidence resolution, path
> existence, truth labels), but **it has no notion of your domain's claim classes**. Any project
> with a claim class that must never be blurred needs this addendum. The report author reads it
> before writing narrative; a reviewer checks the report against it.

## 1. Forbidden equivalences

List the claim-class conflations that are *never* allowed in a report for this project. State each
as "X does NOT establish Y".

| Do NOT let this claim… | …stand in for this claim | Why it matters here |
|---|---|---|
| _e.g._ "software behaviour verified" | "clinically validated" | Only a credentialed human clearing G1/G4 establishes clinical validity. |
| | | |
| | | |

## 2. Reserved fields / states that must stay empty or exact

Fields a report must never describe as populated/passed unless a named human act has occurred.

| Field / state | Correct reported value until the gate clears | Gate that clears it |
|---|---|---|
| _e.g._ `approvedBy[]` | empty (schema-forced) | G1 + G4, credentialed reviewer |
| | | |

## 3. Language rules

- Facts use direct language: "The focused suite passed 18 tests."
- Inference uses qualified language: "This should reduce setup time because deployment is now one
  command; production timing was not measured."
- Never turn expected value into measured value without a metric source.
- Delegated/subagent claims are marked `verified_by: delegated` or `unverified` until spot-checked.

## 4. Standing report-global constraints

The single `report.constraints` string injected into every handoff payload. Keep it short and
imperative — it is the invariant a dispatched agent must not violate.

```
<one or two sentences: the invariants a pasted-in agent must never break>
```
