# GPT-6 registry decision — 2026-09-25

Nick's decision is reflected in the Codex subscription routing: GPT-6 Luna is the workhorse, GPT-6 Sol is the hard-task tier, and Astra remains permission-only. GPT-5.6 stays available on the separate ICA lanes.

## Failure causes

- `test-p3-dry-run.js`: stale scenario expectations. The Codex cases named GPT-5.6 Terra/Luna despite the new GPT-6 Luna subscription mapping; exploration and completeness expectations also ignored the existing free-first ICA chains. Updated the test inputs and expected providers. No registry regression was found.
- `test-workflow-routing-log-shape.js`: real routing-log loss on four unwrapped degraded-council exits in each of `execute-contract.js` and `execute-plan.js`. Wrapped those returned envelopes with `withRouting()`.

## Validation

All 19 delegation-router test files passed: 414 reported cases/assertions, plus registry-builder validation. The two previously failing JS tests pass.

Implementation and test changes commit: `476513150e725fb073964315e2bf0de602f59f67`.
