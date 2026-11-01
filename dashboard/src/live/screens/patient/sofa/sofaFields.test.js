// sofaFields.test.js — the rows in the source's order, the door's bounds for the six inputs the form
// completes, the 24-hour time rule, the engine's way of counting a reason, and one list of corrections for the
// preview and the signature (G2-A4). Pure functions; synthetic values.
import { describe, it, expect } from "vitest";
import { NOW } from "../../../data/board.testutil.js";
import {
  ORGANS, checkTime, checkValue, correctionsKey, isEnterable, labelOf, overridesOf, reasonCount, recordedOf,
  rowsInOrder, sourceText, stampOf, supportText, toLocalInput,
} from "./sofaFields.js";
import { WHY, previewAnswer, sofaForm } from "./sofa.testutil.js";

const t = (key) => key;

describe("sofaFields", () => {
  it("puts the engine's rows in the source table's order, and draws no row the engine did not send", () => {
    expect(rowsInOrder(sofaForm()).map((entry) => entry.organ))
      .toEqual(["respiration", "coagulation", "liver", "cardiovascular", "cns", "renal"]);
    expect(rowsInOrder(null)).toEqual([]);
    expect(rowsInOrder({ rows: [{ organ: "renal", inputs: [] }, { organ: "spleen", inputs: [] }] }).map((e) => e.organ)).toEqual(["renal"]);
    expect(ORGANS.find((o) => o.organ === "renal").noteKey).toBe("sofa.renalNote");
    expect(ORGANS.find((o) => o.organ === "cardiovascular").noteKey).toBe("sofa.cardioNote");
  });

  it("holds a slipped digit back with the door's bounds, and a correction of the pressors by theirs", () => {
    expect(checkValue("platelets", "5000")).toEqual({ value: 5000 });                        // the engine's bounds, mirrored
    expect(checkValue("platelets", "5001")).toEqual({ error: { key: "sofa.outOfRange", params: { low: 0, high: 5000 } } });
    expect(checkValue("bilirubin", "2,4")).toEqual({ value: 2.4 });
    expect(checkValue("bilirubin", "61").error.key).toBe("sofa.outOfRange");
    expect(checkValue("creatinine", "40")).toEqual({ value: 40 });
    expect(checkValue("creatinine", "150").error.params).toEqual({ low: 0, high: 40 });      // a µmol/L creatinine
    expect(checkValue("gcs", "2").error.params).toEqual({ low: 3, high: 15 });
    expect(checkValue("gcs", "14.5")).toEqual({ error: { key: "sofa.notWhole" } });            // the door takes a whole GCS only
    expect(checkValue("gcs", "14,5").error.key).toBe("sofa.notWhole");
    expect(checkValue("gcs", "14")).toEqual({ value: 14 });
    expect(checkValue("gcs", "16").error.key).toBe("sofa.outOfRange");
    expect(checkValue("platelets", "45.5")).toEqual({ value: 45.5 });                         // only GCS is whole
    expect(checkValue("pao2_fio2", "19").error.params).toEqual({ low: 20, high: 700 });
    expect(checkValue("pao2_fio2", "700")).toEqual({ value: 700 });
    expect(checkValue("norepinephrine_rate", "25").error.params).toEqual({ low: 0, high: 20 });
    expect(checkValue("map", "250")).toEqual({ value: 250 });                                  // the door bounds no MAP; nor does this
    expect(checkValue("platelets", "").error.key).toBe("sofa.valueEmpty");
    expect(checkValue("platelets", "1e3").error.key).toBe("sofa.notNumber");
    expect(checkValue("platelets", "-5").error.key).toBe("sofa.notNumber");
  });

  it("takes the support flag as 1 or 0 and nothing else", () => {
    expect(checkValue("on_resp_support", "1")).toEqual({ value: 1 });
    expect(checkValue("on_resp_support", "0")).toEqual({ value: 0 });
    expect(checkValue("on_resp_support", "").error.key).toBe("sofa.supportEmpty");
    expect(checkValue("on_resp_support", "2").error.key).toBe("sofa.supportEmpty");
    expect(isEnterable("on_resp_support")).toBe(true);
    expect(isEnterable("map")).toBe(false);                                                    // D9: MAP is not entered here
    expect(isEnterable("constructor")).toBe(false);
  });

  // The field holds minutes (toLocalInput drops the seconds), so each edge is tried a whole minute either side.
  it("dates a measurement up to 24 h back and never ahead, a minute of skew aside", () => {
    expect(checkTime(toLocalInput(NOW), NOW)).toEqual({ recordedAt: new Date(NOW).toISOString() });
    expect(checkTime(toLocalInput(NOW + 60_000), NOW)).toEqual({ recordedAt: new Date(NOW + 60_000).toISOString() });   // the skew
    expect(checkTime(toLocalInput(NOW + 2 * 60_000), NOW).error.key).toBe("sofa.atFuture");
    expect(checkTime(toLocalInput(NOW - 24 * 3600_000), NOW)).toEqual({ recordedAt: new Date(NOW - 24 * 3600_000).toISOString() });
    expect(checkTime(toLocalInput(NOW - 24 * 3600_000 - 60_000), NOW).error.key).toBe("sofa.atTooOld");
    expect(checkTime("", NOW).error.key).toBe("sofa.atInvalid");
  });

  it("counts a reason as the engine does — trimmed, in characters — and reads what the record holds", () => {
    expect(reasonCount("  qısa  ")).toBe(4);
    expect(reasonCount(null)).toBe(0);
    expect(reasonCount("😀")).toBe(1);                                                        // one character, two UTF-16 units
    expect(recordedOf(sofaForm(), "platelets")).toBe(45);
    expect(recordedOf(previewAnswer().form, "platelets")).toBe(45);                           // a corrected cell's original
    expect(recordedOf(sofaForm(), "bilirubin")).toBeNull();
    expect(recordedOf(sofaForm(), "lactate")).toBeNull();
  });

  it("sends one list of corrections for the preview and the signature, keyed so that a change shows", () => {
    const held = { platelets: { value: 80, reason: ` ${WHY} ` } };
    expect(overridesOf(held)).toEqual([{ code: "platelets", value: 80, reason: WHY }]);
    expect(correctionsKey(held)).not.toBe(correctionsKey({ platelets: { value: 81, reason: WHY } }));
    expect(correctionsKey({})).toBe("[]");
  });

  // Review 2 (C3): the support state the ratio was scored on, as the engine sent it on the respiration row.
  it("says the support basis of the ratio: yes or no with its entry's time, no entry, or nothing at all", () => {
    const at = "2026-10-08T07:00:00+00:00";
    const tp = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key);
    expect(supportText(tp, { on_support: true, at }, NOW)).toBe(`sofa.supportBasisYes {"time":"${stampOf(at, NOW)}"}`);
    expect(supportText(tp, { on_support: false, at }, NOW)).toBe(`sofa.supportBasisNo {"time":"${stampOf(at, NOW)}"}`);
    expect(supportText(tp, { on_support: false, at: null }, NOW)).toBe("sofa.supportBasisNone");
    expect(supportText(tp, { on_support: true, at: null }, NOW)).toBe(`sofa.supportBasisYes {"time":"—"}`);   // never "no entry" for a yes
    expect(supportText(tp, null, NOW)).toBe("");                                                       // a row with no ratio
    expect(supportText(tp, undefined, NOW)).toBe("");                                                  // an engine before C3
    expect(supportText(tp, { on_support: "yes", at }, NOW)).toBe("");                                  // a shape this build does not know
  });

  it("names a source and an input in the reader's words, and an unknown one by the engine's own code", () => {
    expect(sourceText(t, "clinician")).toBe("sofa.srcClinician");
    expect(sourceText(t, "hekim")).toBe("sofa.srcCorrection");
    expect(sourceText(t, "nce")).toBe("nce");
    expect(sourceText(t, "")).toBe("");
    expect(labelOf(t, "creatinine")).toEqual({ label: "sofa.inCreatinine", unit: "sofa.unitMgdl" });   // D11: mg/dL
    expect(labelOf(t, "map")).toEqual({ label: "board.chMap", unit: "board.unitMmhg" });
    expect(labelOf(t, "gcs")).toEqual({ label: "sofa.inGcs", unit: "" });                    // its label says GCS; "points" would be the score's word
    expect(labelOf(t, "dopamine_rate")).toEqual({ label: "patient.medsDrugDopamine", unit: "patient.medsRateUnit" });
    expect(labelOf(t, "constructor")).toEqual({ label: "constructor", unit: "" });
    expect(stampOf(null, NOW)).toBe("");
  });
});
