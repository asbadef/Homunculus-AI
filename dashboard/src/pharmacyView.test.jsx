/**
 * The pharmacy view (E9) — the role that had no work.
 *
 * PHARMACIST, RAPID_RESPONSE and BIOMEDICAL all saw the same three screens, and none of the three
 * appeared in the navigation at all. This page is the pharmacist's own, and its whole value is the
 * antibiotic clock: previously reachable only as an alert that had already fired, which is exactly
 * too late for the person who could have stopped it firing.
 *
 * Two lines the tests hold, because crossing either would be worse than having no screen:
 *   - it suggests no dose;
 *   - it never renders "nothing charted" as "not given".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";
import { patientFromBoard } from "./liveAdapters.js";

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.42));
afterEach(() => vi.restoreAllMocks());

const PHARMACY = "Eczane";

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

const T0 = "2026-09-08T09:00:00+00:00";

function bed(meds, id = "bed-1") {
  return patientFromBoard({ patient_id: id, risk: "high", alerts: [], latest: {}, meds });
}

const CLOCK = {
  recognized_at: T0, deadline: "2026-09-08T10:00:00+00:00",
  remaining_sec: 1500, elapsed_sec: 2100, met: null,
};

describe("the antibiotic clock is visible while it is still running", () => {
  it("carries the clock through the adapter rather than dropping it", () => {
    const p = bed({ pressors: {}, on_pressor: false, antibiotic_given: null,
                    antibiotic_clock: CLOCK, creatinine: 2.4, weight_kg: 72 });
    expect(p.meds.antibiotic_clock.remaining_sec).toBe(1500);
    expect(p.meds.creatinine).toBe(2.4);
  });

  it("a board entry with no meds block leaves it null rather than an empty regimen", () => {
    expect(patientFromBoard({ patient_id: "bed-1" }).meds).toBeNull();
  });
});

describe("nothing charted is never rendered as not given", () => {
  it("keeps the three states apart", () => {
    const unknown = bed({ antibiotic_given: null, antibiotic_clock: CLOCK, pressors: {} });
    const none = bed({ antibiotic_given: false, antibiotic_clock: CLOCK, pressors: {} });
    const given = bed({ antibiotic_given: true, antibiotic_clock: { ...CLOCK, met: true }, pressors: {} });
    expect(unknown.meds.antibiotic_given).toBeNull();
    expect(none.meds.antibiotic_given).toBe(false);
    expect(given.meds.antibiotic_given).toBe(true);
  });
});

describe("the pharmacist finally has a page of their own", () => {
  it("the pharmacist can reach it", async () => {
    expect(await navFor(ROLE.PHARMACIST)).toContain(PHARMACY);
  });

  it("the attending can too — the antibiotic clock is a shared deadline", async () => {
    expect(await navFor(ROLE.ATTENDING)).toContain(PHARMACY);
  });

  it("the nurse is not given a screen that is not their work", async () => {
    expect(await navFor(ROLE.CHARGE_NURSE)).not.toContain(PHARMACY);
  });

  it("the pharmacist is no longer shown the same three screens as everyone else", async () => {
    const pharmacist = await navFor(ROLE.PHARMACIST);
    const rrt = await navFor(ROLE.RRT);
    expect(pharmacist).not.toEqual(rrt);
    // RRT and biomedical are still open findings, and saying so out loud keeps them open.
    expect(rrt).not.toContain(PHARMACY);
  });
});
