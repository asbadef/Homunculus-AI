import { describe, it, expect } from "vitest";
import { chooseMode } from "./main.jsx";

describe("chooseMode", () => {
  it("defaults to live — the address a clinician types is the real system", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
  });

  it("keeps the simulation on ?demo=1", () => {
    expect(chooseMode(new URLSearchParams("demo=1"))).toBe("demo");
  });

  it("still honours ?live=1 for anyone with an old link", () => {
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  it("routes the replay demo via ?mode=replay", () => {
    expect(chooseMode(new URLSearchParams("mode=replay"))).toBe("replay");
  });

  it("routes the replay demo via ?scenario=", () => {
    expect(chooseMode(new URLSearchParams("scenario=septic_shock"))).toBe("replay");
  });

  it("routes the legacy board", () => {
    expect(chooseMode(new URLSearchParams("board=1"))).toBe("board");
  });

  it("lets an explicit demo flag win over nothing", () => {
    // ?demo=1&live=1 is contradictory; live wins because showing simulated data by accident is
    // the worse failure. Document the decision either way with this assertion.
    expect(chooseMode(new URLSearchParams("demo=1&live=1"))).toBe("live");
  });
});
