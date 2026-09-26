# Story understanding, narrative arc, and the scene ledger schema

Referenced from `SKILL.md` step 2 (source inspection) and step 5 (scene ledger). This file
folds in material that was previously duplicated in a standalone production prompt
(`01_PROCEDURAL_ANIMATED_FILM_PRODUCTION_PROMPT.md`) — the narrative-arc heuristic and the
richer story-understanding checklist below did not exist in the original `SKILL.md` and are
carried forward here rather than dropped.

## Story-understanding checklist

Before animation, identify:

- central question
- thesis or emerging conclusion
- strongest evidence
- uncertainty
- important counterarguments
- narrative turning points
- concepts requiring explanation
- moments that deserve visual emphasis

Reduce the film to a sequence of intellectual beats. The conclusion must follow from the material
rather than from a desire for dramatic closure.

## Narrative arc heuristic

A strong structure often resembles:

```text
question → model → investigation → complication → insight → implication
```

Do not force this structure where another works better — it is a starting heuristic, not a
template to satisfy mechanically. Use it to check whether the film has real momentum: if a cut
of the film cannot be read against *some* beat sequence with turning points, the structure is
probably still slideshow-shaped.

## Scene ledger schema

Every scene in the ledger should define:

```yaml
id:
start:
end:
purpose:
narration:
visual:
animation:
assets:
data:
claims:
transition_in:
transition_out:
validation:
```

The ledger is the film's canonical timeline. Prefer one strong visual idea per scene; do not
overcrowd the frame simply because multiple elements are available. Record which claims each
scene makes so factual QA (production-workflow.md step 15, pass 1) has something concrete to
check against the supplied source material.
