import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { chooseMode, AppShell } from "./main.jsx";

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

describe("AppShell", () => {
  // jsdom does no layout, so this pins the structure instead of measuring it. The frame is one
  // screen tall with overflow hidden: if the app's wrapper did not scroll, everything below the
  // first screen (a bed below the fold) would be unreachable. Measured in Chrome at 1366x768
  // before the fix: 3032 px of board in a 672 px window, no scrollbar anywhere.
  it("lets the app scroll inside the one-screen frame, in live mode", () => {
    render(createElement(AppShell, { mode: "live" }, createElement("p", null, "uygulama")));
    const wrapper = screen.getByText("uygulama").parentElement;
    expect(wrapper.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]));
    expect(wrapper.parentElement.className).toContain("overflow-hidden");
  });

  it("shows the demo banner only for the simulation", () => {
    const { container, unmount } = render(createElement(AppShell, { mode: "live" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
    unmount();
    const demo = render(createElement(AppShell, { mode: "demo" }, "x"));
    expect(demo.container.firstChild.children).toHaveLength(2);
  });
});

describe("design gallery (?tasarim=1)", () => {
  it("opens the new UI's design gallery", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1"))).toBe("tasarim");
  });

  it("never wins over an explicit ?live=1", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1&live=1"))).toBe("live");
  });

  it("gets no demo banner: it shows no data", () => {
    const { container } = render(createElement(AppShell, { mode: "tasarim" }, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});
