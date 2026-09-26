# Route Policy — section matrices + eligibility

`report.route` selects the report's shape and its mandatory sections. One skill, five routes across
three renderers (retrospective `feature`, longitudinal `dossier`, forward `program`/`phase`/`readiness`).

## When to use which route

| Route | Answers | Typical trigger |
|---|---|---|
| `feature` | "What did we finish, and how do we know?" (one completed thing, backward-looking) | "feature report", "completion showcase", "what did we deliver" |
| `dossier` | "Where does this feature stand across its whole life — research → plan → execute → validate?" (one feature, longitudinal, regenerated each phase) | "delivery dossier", "living record", "where does this feature stand" |
| `program` | "Where is this whole effort? What's blocked, what isn't?" | "project status", "where are we", "program status" |
| `phase` | "How did this wave/phase land, and what's next?" | "phase report", "wave recap", "sprint report" |
| `readiness` | "Should we invest further? Go or no-go?" | "readiness review", "go/no-go", "is this worth continuing" |

`program` / `phase` / `readiness` share the entire forward-looking machine — the difference is only
which sections are emphasised and the eligibility posture. They are not separate renderers.

## Mandatory sections by route

| Section | feature | program | phase | readiness |
|---|:--:|:--:|:--:|:--:|
| `executive_summary` / `problem` / `solution` | ✅ | — | — | — |
| `value_adds[]` / `changes[]` | ✅ | — | — | — |
| `validation[]` | ✅ | — | — | — |
| `vitals[]` (each with `measured_by`) | — | ✅ | ✅ | ✅ |
| `items[]` (kind-validated + handoffs) | — | ✅ | ✅ | ✅ |
| `domains{}` (closed vocabulary) | — | ✅ | ✅ | ✅ |
| `corrections[]` | — | on re-render | on re-render | on re-render |
| `visuals.flowsheet` | — | recommended | recommended | optional |
| `visuals.ladder` | — | recommended | recommended | **recommended** (the go/no-go frame) |
| `evidence[]` | ✅ (≥2 when required) | recommended | recommended | recommended |
| a visual or `no_visual_reason` | required-when-required | recommended | recommended | recommended |

`readiness` leans on the two-track ladder + a clear "you are here" and an explicit recommendation in
`report.scope_note`; it is the route where the reader is making an invest/stop decision.

## Mandatory sections — `dossier`

The `dossier` route has its own spine and reuses the forward-route machinery (items/handoffs,
vitals, corrections, evidence, visuals) for the rest. It is a longitudinal per-feature record,
regenerated at each phase boundary, with a stamped `generated_at` + `revision` + "you are here".

| Section | dossier |
|---|:--:|
| `stages[]` (the lifecycle spine) | ✅ (≥1) |
| `vitals[]` (each `measured_by`) | recommended |
| `items[]` + `domains{}` (open work + handoffs) | recommended |
| `open_questions[]` | when any exist |
| `decisions[]` | recommended |
| `validation[]` | required at the `validate` stage |
| `evidence[]` | recommended |
| `corrections[]` | on re-render |
| a visual or `no_visual_reason` | recommended (the stage timeline itself is the primary visual) |

Blocking honesty rules (`_validate_dossier`): `stages` non-empty with unique ids and valid
`kind`∈{research,plan,execute,validate} / `state`∈{pending,active,done,blocked};
`open_questions[].status`∈{open,answered,resolved,superseded} and `answered` ⇒ `answer` present;
`decisions[]` well-formed; every `stages[]`/`decisions[]` `evidence_refs` entry resolves to an
`evidence[].id`; deferred/blocked items still run the handoff checks. A `blocking: true` open
question with no `channel` (how to answer) is a warning.

Eligibility: `dossier` is **on-demand / recommended** for Tier 2/3 features (never tier-gated as
required); an explicit request always wins — the same posture as the forward routes. It complements,
never replaces, the enforced end-of-feature `feature` report.

**You normally do not author a dossier manifest by hand — hooks own both ends of its lifecycle:**

| Moment | Hook | Behaviour |
|---|---|---|
| Plan time (Tier 2/3) | `dev-execution/hooks/seed-dossier.sh` | Deterministically creates the manifest from the plan (spine from `wave_plan.phases[]` / phase headings; OQs + decisions from frontmatter). Tier 0/1 needs `DOSSIER_SEED_FORCE=1`. |
| Each phase close | `dev-execution/hooks/update-dossier.sh` | The phase-closing agent authors that stage; the hook re-renders + re-validates. |

Both share the `AOS_DELIVERY_DOSSIER` master switch, are binding-gated, non-fatal, and always exit 0.
Seeding is what arms the loop — the regeneration hook no-ops when no manifest exists. Author one
directly only when retrofitting a record onto a feature planned before the seed existed.

## Eligibility (feature route)

Ported from `feature-report`. An explicit user request always yields `required`.

| Tier system | Tier/size | Decision |
|---|---|---|
| `dev-execution` | Tier 2 or 3 | required |
| `dev-execution` | Tier 1 and ≥ 5 estimated points | recommended |
| `dev-execution` | Tier 1 with visible / cross-component / security / migration / material-finding signal | recommended |
| `dev-execution` | Tier 0 / quick feature | optional unless explicitly requested |
| `aos` | Tier 3 or 4 | required |
| `aos` | Tier 2 | recommended |
| `aos` | Tier 0 or 1 | optional unless explicitly requested |
| `custom` | `report_policy.required: true` | required |

Lowering or waiving a required report needs a recorded `report_policy.waiver_reason`. Set the policy
under `report_policy` (`tier_system`, `tier`, `estimated_points`, `signals`, `explicit_request`).

## Eligibility (forward routes)

`program` / `phase` / `readiness` are produced **on request** — they are point-in-time artifacts, not
tier-gated. `eligibility` returns `on_demand` unless `report_policy.required`/`explicit_request`.
Do **not** render a full artifact for a quick conversational "what's the status?" — answer in chat.

## dev-execution end-of-feature sequence (feature route)

1. Finish implementation and run the repository's normal tests.
2. Obtain the tier-appropriate reviewer verdict against the exact current tree.
3. Resolve shipped / branch-local / deployed truth and owner-held gaps.
4. `delivery_report.py init --route feature`, populate, attach evidence IDs.
5. Add screenshots/illustrations only after redaction review.
6. `eligibility`, then `render`, then `validate --require-report --expect-route feature`.
7. Record the manifest + HTML paths in the completion report / tracker evidence.
8. Do not change the completion verdict merely because the report rendered.

The `dev-execution` gate calls `hooks/verify-delivery-report.sh`
(`.claude/skills/dev-execution/validation/completion-criteria.md`).
