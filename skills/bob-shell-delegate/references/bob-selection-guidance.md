# Bob Selection Guidance

Observed strengths and weaknesses from CCDash Phase 1 review. This is project experience, not official documentation.

## Operational Posture

Bob is a **fast secondary engineer**, not an autonomous senior engineer.

- Use Bob for speed where correctness can be cheaply verified
- Constrain Bob tightly when the task touches integration seams
- Never trust mocked success if the task is about real adapters or contracts
- Treat Bob output as candidate work until validated

## Observed Strengths

- Rapidly generates large volume of code and documentation
- Packages work into coherent deliverables
- Strong at scaffolding DTOs, tests, README-heavy outputs
- Executes bounded tasks with clear local expectations well
- Produces candidate implementations quickly enough for cheap parallel exploration

## Observed Weaknesses

- Does NOT respect existing repository and port contracts unless explicitly forced
- Confuses mocked test seams with real runtime seams
- Struggles with cross-layer integrations without contract verification
- May produce passing test suites that validate the wrong abstraction
- Poor at autonomous architecture decisions in critical-path backend code

## Recommended Use Cases

| Use Case | Why Bob Works |
|----------|--------------|
| Draft documentation | High volume, low integration risk |
| Generate boilerplate | Repetitive, well-defined output |
| Write candidate DTOs/serializers | Bounded, schema-driven |
| First-pass tests (contract known) | Speed; Claude Code validates seams |
| Migration notes, reports, summaries | Prose generation strength |
| Explore implementation variants | Cheap parallel exploration |
| Bounded refactors in isolated files | Clear scope, easy to validate |
| Non-critical research/inventory | Claude Code validates results |

## Discouraged Use Cases

| Use Case | Why Bob Fails |
|----------|--------------|
| Define new storage/repository boundaries | Architecture decisions need deep context |
| Cross-layer backend integration | Misses real integration boundaries |
| "Build Phase X end-to-end" | Scope too broad, contract drift |
| Mock-heavy test tasks | Bob may mock the wrong seam and claim success |
| High-trust architecture conformity | Requires existing codebase intimacy |

## Escalation for Bad-Fit Tasks

If user insists on delegating a discouraged task to Bob:

1. Narrow the scope to a single bounded piece
2. Use Template 2 (Constrained Implementation) with explicit interface pins
3. Add interface-verification steps to the prompt
4. Plan for higher rejection rate on validation
