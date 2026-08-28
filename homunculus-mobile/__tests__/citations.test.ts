/// <reference types="jest" />
import recording from "../assets/demo/icu-ward.json";
import { lookupSource } from "../src/domain/citations";
import type { Recording } from "../src/transport/types";

const ward = recording as Recording;

describe("lookupSource", () => {
  it("resolves a vault source note to its title and authority", () => {
    expect(lookupSource("sepsis-3-jama-2016")).toEqual({
      id: "sepsis-3-jama-2016",
      title: "Sepsis-3 (JAMA 2016)",
      authority: "high",
      superseded: false,
    });
  });

  it("marks a superseded edition as superseded", () => {
    expect(lookupSource("surviving-sepsis-campaign-2021")!.superseded).toBe(true);
  });

  it("returns null for an unknown id instead of inventing a source", () => {
    expect(lookupSource("made-up-guideline-2030")).toBeNull();
  });

  it("covers every citation the recording actually uses", () => {
    const cited = new Set(
      ward.frames.flatMap((f) => f.boards.flatMap((b) => b.alerts.flatMap((a) => a.supporting_evidence))),
    );
    expect(cited.size).toBeGreaterThan(0);
    for (const id of cited) expect(lookupSource(id)).not.toBeNull();
  });
});
