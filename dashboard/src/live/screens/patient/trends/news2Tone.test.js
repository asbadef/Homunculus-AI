import { describe, it, expect } from "vitest";
import { news2Tone } from "./news2Tone.js";

describe("news2Tone — the engine's points, as a tone (spec D2)", () => {
  it("0 is no tone, 1–2 amber, 3 red", () => {
    expect([0, 1, 2, 3].map(news2Tone)).toEqual([null, "mid", "mid", "crit"]);
  });

  it("is no tone for anything the engine did not send as points", () => {
    for (const nothing of [null, undefined, "3", Number.NaN, -1, Infinity]) expect(news2Tone(nothing), String(nothing)).toBeNull();
  });
});
