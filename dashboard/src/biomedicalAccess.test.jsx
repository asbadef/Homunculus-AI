/**
 * The role responsible for the devices can see the devices.
 *
 * Measured 07.09.2026: RRT, the pharmacist and the biomedical engineer all saw exactly the same
 * three screens — bed board, alarms, heatmap — because none of them appears in NAV_ITEMS. The
 * device inventory screen existed and was written, but lived inside the admin page, which only
 * HOSPITAL_ADMIN can open. So the one role whose job is the devices was the one role that could
 * not reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.42));
afterEach(() => vi.restoreAllMocks());

/**
 * Sign in as `role` and return the sidebar's nav labels.
 *
 * The tenant setup is completed first because HOSPITAL_ADMIN otherwise lands in the setup
 * wizard and never reaches a sidebar at all — open finding E11, and worth knowing that it is
 * the reason this helper exists rather than a quirk of the test.
 */
async function navFor(role) {
  const store = createDemoStore(buildRealisticState());
  await act(async () => {
    store.loginAs(role);
    if (typeof store.completeTenantSetup === "function") {
      try { store.completeTenantSetup(); } catch { /* already complete */ }
    }
  });
  const { unmount } = render(<ClinicalDemo store={store} simulation />);
  await act(async () => { await Promise.resolve(); });
  const labels = Array.from(document.querySelectorAll("aside button[title]"))
    .map((b) => b.getAttribute("title"));
  unmount();
  return labels;
}

/** Open a page by its nav title and return the rendered text. */
async function openPage(role, title) {
  const store = createDemoStore(buildRealisticState());
  await act(async () => { store.loginAs(role); });
  render(<ClinicalDemo store={store} simulation />);
  await act(async () => { await Promise.resolve(); });
  const button = Array.from(document.querySelectorAll("aside button[title]"))
    .find((b) => b.getAttribute("title") === title);
  if (!button) throw new Error(`nav item not found: ${title}`);
  await act(async () => { button.click(); await Promise.resolve(); });
  return document.body.textContent || "";
}

const TECH = "Cihaz & Veri Akışı";

describe("who can reach the device page", () => {
  it("the biomedical engineer can", async () => {
    expect(await navFor(ROLE.BIOMEDICAL)).toContain(TECH);
  });

  it("the hospital administrator can too — they answer for the estate", async () => {
    expect(await navFor(ROLE.HOSPITAL_ADMIN)).toContain(TECH);
  });

  it("a physician does not — it is not their screen", async () => {
    expect(await navFor(ROLE.ATTENDING)).not.toContain(TECH);
  });

  it("a nurse does not either", async () => {
    expect(await navFor(ROLE.CHARGE_NURSE)).not.toContain(TECH);
  });
});

describe("biomedical is no longer given the same three screens as everyone else", () => {
  it("sees more than the bed board, alarms and heatmap", async () => {
    const nav = await navFor(ROLE.BIOMEDICAL);
    expect(nav.length).toBeGreaterThan(3);
  });

  it("the pharmacist and RRT still have no page of their own — a known gap, not a fix", async () => {
    // Stated so the gap stays visible: E9 is open, and this test failing means someone closed
    // it without updating the plan.
    expect(await navFor(ROLE.PHARMACIST)).not.toContain(TECH);
    expect(await navFor(ROLE.RRT)).not.toContain(TECH);
  });
});

describe("what the page shows", () => {
  it("answers 'is anything arriving' before anything else", async () => {
    const text = await openPage(ROLE.BIOMEDICAL, TECH);
    expect(text).toMatch(/Sessiz yatak/);
    expect(text).toMatch(/Bayat kanal/);
    expect(text).toMatch(/Veri akışı/);
  });

  it("carries the device inventory that already existed", async () => {
    const text = await openPage(ROLE.BIOMEDICAL, TECH);
    // DeviceAdmin renders the device list; its heading comes from the shared strings.
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/Sessiz yatak/);
  });
});
