/**
 * The sepsis branch, from the board to the button.
 *
 * Two facts decided whether a sepsis alert could exist at all and neither had a control or a
 * display: whether anyone had charted a suspected infection, and what baseline SOFA the score is
 * compared against. `store.setSuspectedInfection` existed in the store and was called from
 * nothing, so the whole branch was unreachable from the ward.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBackendApi } from "./backendApi.js";
import { patientFromBoard as toPatient } from "./liveAdapters.js";

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

function apiWith(fetchMock) {
  return createBackendApi({ baseUrl: "https://api.test", fetchImpl: fetchMock });
}

describe("the board's sepsis context reaches the card", () => {
  it("carries what the criterion is judged against", () => {
    const p = toPatient({
      patient_id: "bed-1",
      sepsis: { suspected_infection: true, sofa: 6, baseline_sofa: 3, baseline_assumed: false, rise: 3 },
    });
    expect(p.sepsis.rise).toBe(3);
    expect(p.sepsis.baseline_assumed).toBe(false);
  });

  it("keeps 'nobody charted it' distinct from 'charted as no'", () => {
    const never = toPatient({ patient_id: "bed-1", sepsis: { suspected_infection: null } });
    const no = toPatient({ patient_id: "bed-1", sepsis: { suspected_infection: false } });
    expect(never.sepsis.suspected_infection).toBeNull();
    expect(no.sepsis.suspected_infection).toBe(false);
    // A quiet card with nothing charted is not a reassuring card: the engine evaluated no
    // sepsis rule at all. Collapsing these two would tell the ward the opposite.
    expect(never.sepsis.suspected_infection).not.toBe(no.sepsis.suspected_infection);
  });

  it("an old engine that sends no sepsis block leaves it null, not a fabricated zero", () => {
    expect(toPatient({ patient_id: "bed-1" }).sepsis).toBeNull();
  });
});

describe("setProfile sends the baseline only when one was charted", () => {
  it("includes baseline_sofa when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await apiWith(fetchMock).setProfile("bed-1", { baselineSofa: 3 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/clinical/bed-1/profile");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body).baseline_sofa).toBe(3);
  });

  it("charts a physician's explicit zero rather than dropping it as falsy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await apiWith(fetchMock).setProfile("bed-1", { baselineSofa: 0 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).baseline_sofa).toBe(0);
  });

  it("omits the key entirely when no baseline is being charted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    await apiWith(fetchMock).setProfile("bed-1", { comorbidities: ["copd"] });
    // Sending null would be indistinguishable from a physician clearing a baseline they set.
    expect("baseline_sofa" in JSON.parse(fetchMock.mock.calls[0][1].body)).toBe(false);
  });
});
