// Transcribed from Homunculus/wiki/sources/*.md — the H1 title and the frontmatter `authority`.
// Nothing is minted here. If a citation is not in this table, the drawer says so; it never invents
// a plausible-looking reference, which in a clinical knowledge base is the one failure that
// survives review.

export type Authority = "high" | "moderate" | "low";

export interface SourceNote {
  id: string;
  title: string;
  authority: Authority;
  superseded: boolean;
}

const SOURCE_NOTES: Record<string, SourceNote> = {
  "sepsis-3-jama-2016": {
    id: "sepsis-3-jama-2016",
    title: "Sepsis-3 (JAMA 2016)",
    authority: "high",
    superseded: false,
  },
  "surviving-sepsis-campaign-2026": {
    id: "surviving-sepsis-campaign-2026",
    title: "Surviving Sepsis Campaign 2026",
    authority: "high",
    superseded: false,
  },
  "surviving-sepsis-campaign-2021": {
    id: "surviving-sepsis-campaign-2021",
    title: "Surviving Sepsis Campaign 2021 (SUPERSEDED)",
    authority: "high",
    superseded: true,
  },
  "news2-rcp-2017": {
    id: "news2-rcp-2017",
    title: "NEWS2 (RCP, 2017)",
    authority: "high",
    superseded: false,
  },
  "phoenix-criteria-jama-2024": {
    id: "phoenix-criteria-jama-2024",
    title: "Phoenix Criteria (JAMA 2024)",
    authority: "high",
    superseded: false,
  },
  "neonatal-sepsis-review-2024": {
    id: "neonatal-sepsis-review-2024",
    title: "Neonatal Sepsis: A Comprehensive Review (Antibiotics 2024)",
    authority: "moderate",
    superseded: false,
  },
  "nsofa-systematic-review-2026": {
    id: "nsofa-systematic-review-2026",
    title: "nSOFA in the NICU — Systematic Review (Diagnostics 2026)",
    authority: "moderate",
    superseded: false,
  },
  "physionet-cinc-2019": {
    id: "physionet-cinc-2019",
    title: "PhysioNet/CinC Challenge 2019 (Early Sepsis Prediction)",
    authority: "moderate",
    superseded: false,
  },
};

export function lookupSource(id: string): SourceNote | null {
  return SOURCE_NOTES[id] ?? null;
}
