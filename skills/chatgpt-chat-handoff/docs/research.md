# Research handoffs: depth, sources, claims and synthesis

## 1. Choose the route

Use `web_search` for a bounded factual lookup, a small current comparison, or a short set
of source-verification questions. Use `deep_research` for a multi-source investigation,
prior-art review, conflicting evidence, substantial synthesis, or a source-led report.
Use a separate `pro_reasoning` turn for a difficult decision based on gathered evidence.
Deep Research is a product capability, not a synonym for a long answer from a Pro model.

Start Deep Research through the actual Chat UI entry point. Review the proposed plan and
clarify only material ambiguities. Do not silently substitute ordinary search when the
Deep Research capability is unavailable; either obtain the correct mode or record an
explicitly authorized downgrade with limitations. A multi-run protocol has distinct run
IDs, questions, exclusions, and a final synthesis step with all reports attached.

## 2. Research payload

`questions`: concrete, independently answerable questions. `as_of`: the factual cutoff
in YYYY-MM-DD. `date_window`: inclusive start/end where appropriate, otherwise an explicit
statement of scope. `source_policy`: primary-only or primary-preferred, permitted/excluded
source types, domains, uploaded materials and supported connected sources. `counterevidence`:
what would disconfirm or narrow the thesis. `output_structure`: requested tables and report
sections. `citation_contract`: fields needed for a durable source/claim register.

State whether the task is source-bound, externally verified, comparative, or hypothesis
building. Summarizing attached reports is not permission to silently rewrite their claims
from unrelated knowledge. Separate “the report says” from externally verified corrections.
For technical facts, prioritize papers, official documentation, specifications, repositories
and vendor release notes. Distinguish a vendor's statement from an independently measured result.

## 3. Dates and evidentiary strength

Store publication date, updated date, event date, retrieval date and coverage cutoff separately.
Do not invent an exact date from a page that says only “updated last month.” Preserve that
raw label and mark the precise date unknown. Check when an event actually happened rather
than assuming the newest article covers the newest event. Note stale copies and renamed URLs.

A current feature claim needs an as-of date, primary source, availability status and limits.
Use availability categories `ga`, `preview`, `announced`, `roadmap`, `retired`, or `unknown`.
A marketing announcement is not runtime evidence. An absent search result is not proof
that something does not exist. “Earliest credible public use found” is not a claim of
invention or absolute priority; include search scope and unresolved earlier candidates.

## 4. Durable source and claim records

Request a source register with source ID, title, author/organization, exact URL or input
filename, dates, primary/secondary classification, access status, and relevant locator
(section, page, table or line). A citation visible only as a chat-specific marker is not
a portable source record. Preserve normal UI citations and export direct source URLs.

Request a claim ledger with claim ID, wording, source IDs, evidence locators, support
classification (`supported`, `partial`, `unsupported`, `conflicted`, `unknown`), caveats,
and a bounded revision. Unsupported and unknown are different: unavailable evidence
should not be mislabeled as refutation. Do not force a binary answer when evidence is mixed.

Quotations must be short, exact and verifiable; avoid requesting full copyrighted sources.
Paraphrases must still support the stated claim. Separate factual findings, inference,
recommendations, hypotheses and unresolved questions. Confidence is a judgment, not a
manufactured numeric probability. Include what would change the conclusion.

## 5. Multi-run research and handoff

Use independently bounded runs where breadth or adversarial coverage justifies them:
A primary-source fact check; B prior art and terminology; C disconfirming evidence;
D synthesis and publication-safe claim revision. Do not call runs independent when they
share conclusions or one is merely a paraphrase of another. Preserve source overlap.

A synthesis turn receives every report, its source register, the original draft/spec,
and the frozen decision constraints. It returns harvested findings, contradictions,
claim changes, suggested edits, and implementation instructions. It must not silently
rewrite the whole essay when the local agents own prose editing. Classify proposals as
FROZEN, DEFERRED or IMPLEMENTATION_FREEDOM only under the operator's delegated authority.

## 6. Acceptance

Every question is answered or explicitly unresolved. Every consequential factual claim
has evidence. Named products are distinguished from adjacent products and roadmaps.
Coverage and access limits are visible. The recommendations follow the findings without
inflating novelty or certainty. Provide actual requested files when possible; report
uncreated files as gaps. Local import verifies schema and bytes, not research truth.
