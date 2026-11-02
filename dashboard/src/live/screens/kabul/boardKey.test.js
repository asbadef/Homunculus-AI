// The card key of an admission row (G2-B1d, spec §4, E12): the server's `board_key` — the protocol
// number of an admission made since 0015 — else the H-number an answer without the field keyed its
// card by.
import { describe, it, expect } from "vitest";
import { boardKeyOf } from "./boardKey.js";

describe("boardKeyOf", () => {
  it("is the server's board key", () => {
    expect(boardKeyOf({ board_key: "202600000001", patient_number: "H2600042" })).toBe("202600000001");
  });

  it("is the H-number for an answer without one, and nothing for no row", () => {
    expect(boardKeyOf({ patient_number: "H2600042" })).toBe("H2600042");
    expect(boardKeyOf({ board_key: "", patient_number: "H2600042" })).toBe("H2600042");
    expect(boardKeyOf(null)).toBeNull();
    expect(boardKeyOf({})).toBeNull();
  });
});
