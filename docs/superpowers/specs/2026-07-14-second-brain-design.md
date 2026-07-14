# Homunculus Second Brain — Design

**Date:** 2026-07-14
**Status:** Approved
**Scope:** The LLM-maintained clinical knowledge base. First sub-project of Homunculus.

---

## Why this first

The Homunculus vision describes a real-time ICU/NICU platform: device gateways, streaming,
inference, alerting, dashboards. That platform cannot be built end-to-end in one pass, and
most of it is blocked on things we do not yet have — device access, hospital integration,
ethics approval, patient data.

Two components in that architecture are **not** blocked, and are the ones that make the whole
system defensible: the **Knowledge Base** and the **RAG Engine**. Homunculus's central
promise is that *every recommendation explains why*. That promise is only as good as the
evidence base behind it. A deterioration model that fires an alert is a number; a system that
says "lactate is rising and MAP has needed vasopressor support for 40 minutes — Surviving
Sepsis Campaign 2021 suggests reassessing source control" is clinical intelligence.

So we build the evidence base first. It delivers value immediately (it is a research
instrument for the team from day one) and it is the corpus the RAG engine will later retrieve
from. Nothing is wasted.

## Non-goals

- No ML model training. That is the next sub-project and needs its own spec (dataset
  selection, licensing, feature pipeline, evaluation).
- No services, no API, no database, no vector store. Zero application code in this phase.
- No search engine or tooling until the vault is large enough for the need to be real.
- No patient data of any kind, at any point, in this repository.

---

## Approach

**Karpathy-style LLM knowledge base.** Raw sources are captured into an immutable `raw/`
directory. An LLM incrementally *compiles* them into a wiki of markdown articles — summaries,
extracted concepts, backlinks, an index. The human drops in sources, asks questions, and
reviews; the LLM writes and maintains the wiki. Obsidian is the viewer.

Chosen over a RAG-first approach (Qdrant + LlamaIndex ingestion, wiki as a by-product)
because at this scale — tens to low hundreds of articles — an LLM navigating a
well-maintained `INDEX.md` and following `[[wikilinks]]` retrieves at least as well as vector
search, while producing something a *human clinician can read, audit, and correct*. In a
clinical setting, an auditable corpus beats an opaque embedding index. Vector retrieval gets
layered on later, over a corpus we already trust, when the RAG Engine is actually built.

**Language: English.** Clinical sources are overwhelmingly English, and translating them
risks terminology drift and degraded future embedding quality. Questions can be asked in
Turkish; answers come back in Turkish, read out of an English vault.

**First clinical domain: sepsis and septic shock.** It is the single most important alert
scenario in the MVP, it is exceptionally well-covered by high-authority open sources
(Sepsis-3, Surviving Sepsis Campaign), and it exercises every part of the pipeline —
definitions, scores, thresholds, time-critical bundles, conflicting evidence. Ventilation,
NICU, and haemodynamics follow, each in its own compile pass.

---

## Structure

```
Homunculus AI/
├── CLAUDE.md                    ← operating manual: how the vault is built and maintained
├── docs/
│   ├── vision.md                ← the MVP north star
│   └── superpowers/specs/       ← design docs (this file)
└── Homunculus/                  ← the Obsidian vault
    ├── raw/                     ← captured sources. IMMUTABLE.
    ├── wiki/
    │   ├── INDEX.md             ← topic tree + one-line summary per article
    │   ├── concepts/            ← one article per clinical concept
    │   └── sources/             ← one note per raw document
    └── questions/               ← Q&A outputs, filed back into the wiki when durable
```

The vault lives inside the repository so that evidence, wiki, and the code that will
eventually consume them are versioned together — a clinical claim in the wiki and the commit
that introduced it stay linked.

### Three layers, one chain

The design rests on a single invariant: **claim → source note → raw document**.

- `raw/` is the evidence of record, never edited. Superseded sources are marked, not
  overwritten — clinical reasoning must be auditable backwards in time.
- `wiki/sources/` holds one note per raw document: what it is, how authoritative it is
  (`high` / `moderate` / `low`), and which claims it supports.
- `wiki/concepts/` holds the articles. Each cites its sources. Each ends with a **Relevance
  to Homunculus** section — the bridge from literature to system design, naming the signals,
  computations, and thresholds the concept implies.

An article that cannot trace a clinical claim back to `raw/` is a defect, and the health
check exists to find it.

---

## Operation

**Compile loop.** New source lands in `raw/` → LLM writes its `sources/` note → extracts
concepts into new or updated `concepts/` articles → links everything with `[[wikilinks]]` →
updates `INDEX.md`. Unresolved links are a feature: they mark articles worth writing.

**Q&A.** Read `INDEX.md` → follow to articles → answer → file the answer in `questions/` →
fold anything durable back into the wiki. Explorations accumulate rather than evaporate. If
the vault does not hold the answer, the LLM says so plainly rather than improvising.

**Health checks.** Broken links, orphans, stale sources, contradictions, gaps — and above
all **unsourced claims**, which are the one defect class that can make the whole vault
untrustworthy.

**Conflict is preserved, not resolved.** Where guidelines or trials disagree, both go into
the article, attributed, with a note on what current practice is. A knowledge base that
flattens clinical disagreement will eventually give a clinician false confidence.

---

## Deliverables of this phase

1. `CLAUDE.md` — the operating manual (written).
2. `docs/vision.md` — the vision, preserved (written).
3. Vault structure under `Homunculus/` (created).
4. Sepsis seed: high-authority sources captured to `raw/`, source notes written, an initial
   set of concept articles compiled and linked, `INDEX.md` populated.
5. A first health-check pass over the seeded vault.

## Done when

The vault answers a real clinical question — *"what defines septic shock, and what would
Homunculus need to detect it?"* — from its own contents, with every claim traceable to a
source in `raw/`, and the answer filed back into `questions/`.

## Next sub-projects

- **Ventilation / NICU / haemodynamics compile passes** — widen the corpus.
- **The small ML model** — deterioration prediction. Needs its own spec: dataset (MIMIC-IV,
  eICU), licensing and ethics, feature pipeline, evaluation, and honest treatment of the
  gap between retrospective AUROC and prospective clinical value.
- **RAG Engine** — vector retrieval layered over a corpus we already trust.
