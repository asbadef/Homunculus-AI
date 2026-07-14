# Homunculus — Operating Manual

Homunculus is a clinical intelligence project for ICU and NICU. This repository currently
holds two things:

- `docs/` — the project vision and design specs (human-authored, human-owned).
- `Homunculus/` — an Obsidian vault that is the project's **second brain**: an
  LLM-maintained clinical knowledge base. This file governs how that vault is built and
  maintained.

The long-term purpose of the vault is twofold: it is the research surface the team reasons
against today, and it is the corpus the Homunculus RAG engine will retrieve from later.
Both purposes demand the same thing — **every clinical claim must be traceable to a
source**.

---

## Vault layout

```
Homunculus/                     ← the Obsidian vault (open this folder in Obsidian)
├── raw/                        ← captured source documents. IMMUTABLE.
├── wiki/
│   ├── INDEX.md                ← the map: topic tree + one-line summary per article
│   ├── concepts/               ← one article per clinical concept
│   └── sources/                ← one note per raw document: what it is, what it supports
└── questions/                  ← answers to research questions, filed as markdown
```

**The LLM writes and maintains the vault. The human rarely edits it directly.** The human's
job is to drop sources into `raw/`, ask questions, and review.

---

## The three layers

### 1. `raw/` — evidence, immutable

Captured source material: guideline PDFs converted to markdown, papers, articles, protocol
documents, dataset descriptions.

**Never edit the body of a file in `raw/`.** Once captured, it is the evidence of record. If
a source is superseded (e.g. a 2021 guideline replaced by a 2025 one), capture the new one
as a *new file* and mark the old one superseded in its frontmatter — do not overwrite it.
Clinical reasoning has to be auditable backwards in time; rewriting evidence destroys that.

Every `raw/` file starts with frontmatter:

```yaml
---
title: Surviving Sepsis Campaign 2021 — International Guidelines
source_url: https://...
authors: Evans L, Rhodes A, et al.
publication: Critical Care Medicine
year: 2021
retrieved: 2026-07-14
type: guideline        # guideline | paper | review | protocol | dataset | manual | article
status: current        # current | superseded
superseded_by:         # filename, if status is superseded
---
```

Filenames are kebab-case and descriptive: `surviving-sepsis-campaign-2021.md`,
`sepsis-3-jama-2016.md`.

### 2. `wiki/sources/` — one note per raw document

For each file in `raw/`, there is exactly one note in `wiki/sources/` with the same
basename. It answers: *what is this document, how authoritative is it, and what claims does
it support?*

```markdown
---
raw: ../../raw/sepsis-3-jama-2016.md
type: source-note
authority: high        # high | moderate | low  — see Authority below
---

# Sepsis-3 (JAMA 2016)

**What it is.** The Third International Consensus Definitions task force paper. Replaces the
SIRS-based definition of sepsis.

**Authority.** High. Consensus statement from SCCM/ESICM task force; the reference
definition in current use.

**Key claims it supports.**
- Sepsis is life-threatening organ dysfunction caused by a dysregulated host response to
  infection — operationalised as an acute rise in [[sofa-score]] of ≥2 points. → [[sepsis-3-definition]]
- SIRS criteria are dropped from the definition. → [[sepsis-3-definition]]
- [[septic-shock]] is defined by vasopressor requirement to keep MAP ≥65 mmHg **plus**
  lactate >2 mmol/L after adequate fluid resuscitation.

**Limitations.** Derived largely from retrospective US EHR cohorts; the task force explicitly
notes the criteria were not validated in low-resource settings or in [[nicu-context]].
```

**Authority** is a judgement about how much weight a claim from this document carries:

- `high` — international consensus guideline, major RCT, systematic review.
- `moderate` — single cohort study, narrative review, national/society guidance.
- `low` — expert opinion, preprint, blog, device manual, editorial.

Record it, and carry it into any article that leans on the source. A recommendation the
system might someday surface to a clinician must be able to say how strong its footing is.

### 3. `wiki/concepts/` — one article per concept

An article explains one clinical concept and links to the others. It is written for a
clinician reader, in English, using standard terminology.

```markdown
---
type: concept
tags: [sepsis, scoring]
sources: [sepsis-3-jama-2016, surviving-sepsis-campaign-2021]
---

# SOFA Score

One-paragraph definition up front — what it is and why it matters in the ICU.

## Scoring

...the substance of the article, with [[wikilinks]] wherever another concept is named...

## Relevance to Homunculus

What this concept implies for the system: which signals it needs, what it could compute,
where the alert thresholds sit. This is the section that turns the wiki from a reading list
into a design input.

## Sources

- [[sepsis-3-jama-2016]] (high) — the ≥2-point delta as the operational sepsis criterion.
- [[surviving-sepsis-campaign-2021]] (high) — use in screening.
```

---

## The compile loop

When new material lands in `raw/`, or when asked to compile:

1. **Read** the new raw documents.
2. **Write the source note** in `wiki/sources/` — what it is, its authority, the claims it
   supports.
3. **Extract concepts.** For each concept the document meaningfully covers: create the
   article in `wiki/concepts/` if it doesn't exist, or *update* it if it does. Updating means
   integrating the new evidence into the existing prose, not appending a new section at the
   bottom.
4. **Link.** Every concept named in an article body gets a `[[wikilink]]`. A link to an
   article that doesn't exist yet is fine and expected — it is a marker that the article is
   worth writing, and Obsidian will show it as an unresolved link.
5. **Update `INDEX.md`.** Every article appears there exactly once, with a one-line summary.
   `INDEX.md` is the entry point the LLM reads first for any question — it must stay
   accurate or retrieval degrades.

### Conflict is signal, not noise

When two sources disagree (different thresholds, contradicting trial results, a guideline
that changed between editions), **do not silently pick one.** Write both into the article,
attributed, and say which is current practice and why. Clinical disagreement is usually the
most informative thing in the literature, and a knowledge base that flattens it will
eventually hand a clinician false confidence.

---

## Q&A

Questions are answered from the vault, not from memory.

1. Read `INDEX.md`.
2. Follow it to the relevant articles; follow their `[[wikilinks]]` and `## Sources`.
3. If the vault does not contain the answer, **say so** — then either research it and ingest
   the sources properly, or answer from general knowledge while stating clearly that this
   part is not vault-backed. Never dress up an unsourced answer as a sourced one.
4. Write the answer to `questions/YYYY-MM-DD-<slug>.md`, citing the articles used.
5. If the answer has lasting value, file it back into the wiki — as a new article, or folded
   into an existing one. Explorations should accumulate, not evaporate.

---

## Health checks

Run on request (`check the vault`). Report findings; fix the mechanical ones, surface the
judgement calls:

- **Broken links** — `[[wikilinks]]` pointing at nothing. Either the article is missing (a
  candidate to write) or the link is a typo (fix it).
- **Orphans** — articles in `concepts/` that nothing links to and that `INDEX.md` omits.
- **Unsourced claims** — clinical assertions in an article with no `## Sources` backing.
  This is the most important check. Flag them loudly.
- **Stale sources** — `raw/` documents marked `current` that a newer edition has superseded.
- **Contradictions** — the same value or threshold stated differently in two articles.
- **Gaps** — concepts referenced repeatedly but never written up.

---

## Hard rules

1. **No clinical claim without a source.** If it isn't traceable to `raw/`, it doesn't go in
   the wiki. This is not a style preference — it is the reason the vault can be trusted.
2. **Never invent a citation.** Not a DOI, not an author list, not a page number, not a
   guideline recommendation grade. If the source isn't in `raw/`, there is no citation to
   give. A fabricated reference in a clinical knowledge base is worse than a missing one,
   because it survives review.
3. **`raw/` is immutable.** Supersede, don't overwrite.
4. **Preserve disagreement.** Attribute conflicting sources rather than picking a winner.
5. **Homunculus does not diagnose.** The vault supports explainable *recommendations* and
   the reasoning behind them. Articles should be written in that register — evidence and
   rationale a clinician can evaluate, never an order they should follow.
6. **No patient data in this repository. Ever.** No PHI, no identifiable records, not in
   `raw/`, not in examples, not in test fixtures. Synthetic or properly de-identified public
   research data (e.g. MIMIC-IV) only, and only under its own licence terms.
