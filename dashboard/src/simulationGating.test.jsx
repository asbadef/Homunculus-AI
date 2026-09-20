/**
 * The simulation controls must never render on a live ward.
 *
 * They fabricate alarms, lab results and clock speed. What they produce is written to the
 * audit log and afterwards cannot be told apart from the real thing, which corrupts both the
 * statutory record and the quality figures drawn from it — and "Pause" on a monitoring screen
 * reads as "monitoring has stopped". They were visible in the live pilot until 07.09.2026;
 * these tests are the brake that keeps them out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.42));
afterEach(() => vi.restoreAllMocks());

/** Render signed in as an attending, on `page`, in the given mode. */
async function open(page, { simulation }) {
  const store = createDemoStore(buildRealisticState());
  await act(async () => { store.loginAs(ROLE.ATTENDING); });
  const view = render(<ClinicalDemo store={store} simulation={simulation} />);
  await act(async () => { await Promise.resolve(); });

  // Selected by title, not by position. This helper used to index into the sidebar by number,
  // which silently depended on NAV_ITEMS never gaining an entry — and broke the day one did.
  await act(async () => { navButton(page).click(); await Promise.resolve(); });
  return view;
}

const text = () => document.body.textContent || "";

/** The sidebar entry for a page key, found by its Turkish label. */
const NAV_TITLE = {
  board: "Yatak Paneli", admission: "Hasta Kabul / Transfer", care: "Bakım Ekibi",
  alarms: "Alarm Yönetimi", results: "Sonuçlar", heatmap: "Isı Haritası",
};
function navButton(page) {
  const title = NAV_TITLE[page];
  const button = Array.from(document.querySelectorAll("aside button[title]"))
    .find((b) => b.getAttribute("title") === title);
  if (!button) throw new Error(`nav item not found: ${title}`);
  return button;
}

describe("simulation controls are gated to simulation mode", () => {
  it("live alarm page offers no way to fabricate an alarm or move the clock", async () => {
    await open("alarms", { simulation: false });
    // The clock control's speeds are the least ambiguous fingerprint of the panel.
    expect(text()).not.toMatch(/30×|60×|120×/);
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent || "");
    expect(labels.some((l) => /pause|duraklat/i.test(l))).toBe(false);
  });

  it("demo alarm page still has them — the demo is what they are for", async () => {
    await open("alarms", { simulation: true });
    expect(text()).toMatch(/30×/);
  });

  it("break-glass survives in live mode — it is a real clinical control, not tooling", async () => {
    await open("alarms", { simulation: false });
    // Its reason box is required to be >= 20 characters; that placeholder is unique to it.
    expect(document.querySelector('textarea[placeholder*="20"]')).not.toBeNull();
  });

  it("live results page cannot fabricate an inbound result", async () => {
    await open("results", { simulation: false });
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent || "");
    expect(labels.some((l) => /simulate|simüle/i.test(l))).toBe(false);
    expect(text()).not.toMatch(/\bDEMO\b/);
  });

  it("live results page keeps the real pending count and the manual upload", async () => {
    await open("results", { simulation: false });
    const labels = Array.from(document.querySelectorAll("button")).map((b) => b.textContent || "");
    expect(labels.some((l) => /upload|yükle/i.test(l))).toBe(true);
  });

  it("defaults to live when a caller forgets to declare the mode", async () => {
    const store = createDemoStore(buildRealisticState());
    await act(async () => { store.loginAs(ROLE.ATTENDING); });
    render(<ClinicalDemo store={store} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { navButton("alarms").click(); await Promise.resolve(); });
    expect(text()).not.toMatch(/30×|60×|120×/);
  });
});

describe("auto-detected language never lands a ward on English", () => {
  it("an English-locale browser still opens in Turkish", async () => {
    // The pilot's ward PCs run an English-locale Chrome over Turkish patient data.
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US", "en"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    const { detectClang } = await import("./clinicalI18n.js");
    expect(detectClang()).toBe("tr");
  });

  it("an Azerbaijani device is still greeted in Azerbaijani", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["az-AZ", "az"]);
    vi.spyOn(navigator, "language", "get").mockReturnValue("az-AZ");
    const { detectClang } = await import("./clinicalI18n.js");
    expect(detectClang()).toBe("az");
  });
});
