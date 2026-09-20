/**
 * A patient the hospital already admitted is confirmed here, not retyped.
 *
 * The admission form asks for a name, a date of birth, a sex and a diagnosis — every one of
 * which the HIS already sent in its ADT and none of which reached this screen. So a clinician
 * typed, from a screen next to them, what the hospital had already said. A retyped date of
 * birth is a date of birth that can be wrong.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ageFromBirthDate, awaitingLocalAdmission, patientFromBoard } from "./liveAdapters.js";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState, ROLE } from "./clinicalDemo.js";

beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.42));
afterEach(() => vi.restoreAllMocks());

const boardEntry = (over = {}) => ({
  patient_id: "20239121", risk: "none", alerts: [],
  latest: { heart_rate: null, map: null, sbp: null, spo2: null, temperature: null,
            resp_rate: null, lactate: null, sofa: null, news2: null },
  identity: {
    patient_id: "20239121", display_name: "AYSE YILMAZ", bed_label: "YB 304-2",
    state: "admitted", source: "comed", updated_at: null,
    bed_id: null, bed_matched: false, bed_key: "YB^304^2",
    birth_date: "1967-04-17", sex: "female",
    diagnoses: [{ code: "A41.9", text: "Sepsis, unspecified", system: "I10", kind: "A" }],
    ...over,
  },
});

describe("age is derived, never stored", () => {
  it("is computed from the date of birth", () => {
    expect(ageFromBirthDate("1967-04-17", new Date("2026-09-08"))).toBe(59);
  });

  it("has not had the birthday yet this year", () => {
    expect(ageFromBirthDate("1967-12-31", new Date("2026-09-08"))).toBe(58);
  });

  it("a missing date of birth is null, not zero", () => {
    // Zero would render as a newborn on a clinical card.
    expect(ageFromBirthDate("")).toBeNull();
    expect(ageFromBirthDate(null)).toBeNull();
  });

  it("an unreadable or future date does not become a confident number", () => {
    expect(ageFromBirthDate("not-a-date")).toBeNull();
    expect(ageFromBirthDate("2030-01-01", new Date("2026-09-08"))).toBeNull();
  });
});

describe("what the HIS said reaches the form", () => {
  it("sex and date of birth travel", () => {
    const p = patientFromBoard(boardEntry());
    expect(p.sex).toBe("female");
    expect(p.birthDate).toBe("1967-04-17");
    expect(p.age).toBeGreaterThan(50);
  });

  it("an unknown sex arrives as null so it cannot render as a stated one", () => {
    const p = patientFromBoard(boardEntry({ sex: "unknown" }));
    expect(p.sex).toBeNull();
  });

  it("the admitting diagnoses travel with their codes", () => {
    const p = patientFromBoard(boardEntry());
    expect(p.hisDiagnoses[0].code).toBe("A41.9");
  });
});

describe("who is waiting to be taken onto a bed here", () => {
  const fromHis = { patient_id: "1", source: "comed", bedId: null, identityState: "admitted" };

  it("a HIS admission with no local bed is waiting", () => {
    expect(awaitingLocalAdmission([fromHis])).toHaveLength(1);
  });

  it("one already on a bed here is not offered again", () => {
    expect(awaitingLocalAdmission([{ ...fromHis, bedId: "bed-a1" }])).toEqual([]);
  });

  it("a discharged one is not offered", () => {
    expect(awaitingLocalAdmission([{ ...fromHis, identityState: "discharged" }])).toEqual([]);
  });

  it("a patient entered by hand here is not a HIS admission", () => {
    expect(awaitingLocalAdmission([{ ...fromHis, source: "manuel" }])).toEqual([]);
  });

  it("an empty board is not an error", () => {
    expect(awaitingLocalAdmission()).toEqual([]);
  });
});

describe("the admission page offers them", () => {
  it("shows a waiting HIS admission on the admission page", async () => {
    const store = createDemoStore(buildRealisticState());
    await act(async () => { store.loginAs(ROLE.ATTENDING); });
    render(<ClinicalDemo store={store} simulation />);
    await act(async () => { await Promise.resolve(); });

    // Nav order follows NAV_ITEMS: board, admission, ...
    const nav = Array.from(document.querySelectorAll("aside button[title]"));
    await act(async () => { nav[1].click(); await Promise.resolve(); });

    // The simulation has no HIS feed, so the panel must be absent rather than empty-and-loud.
    expect(screen.queryByText(/HBYS'den bekleyen/)).toBeNull();
  });
});
