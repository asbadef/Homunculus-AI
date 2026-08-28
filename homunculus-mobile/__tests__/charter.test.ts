/// <reference types="jest" />
import recording from "../assets/demo/icu-ward.json";
import { findForbiddenTokens, isRecommendation, tokenize } from "../src/domain/noOrders";
import { tr } from "../src/i18n/tr";
import type { Recording } from "../src/transport/types";

const ward = recording as Recording;

describe("tokenize", () => {
  it("splits on non-letters and lowercases with Turkish rules", () => {
    expect(tokenize("İzleyin: laktat, 30 mL/kg")).toEqual(["izleyin", "laktat", "30", "ml", "kg"]);
  });
});

describe("isRecommendation", () => {
  it("accepts the register's approved openers", () => {
    expect(isRecommendation("Consider repeat lactate to confirm the trend.")).toBe(true);
    expect(isRecommendation("Monitor lactate and MAP after the next fluid bolus.")).toBe(true);
  });

  it("accepts a recommendation that merely mentions an administered drug", () => {
    expect(isRecommendation("Review whether antibiotics can be given within the 1-hour window.")).toBe(true);
  });

  it("rejects an order however politely it is phrased", () => {
    expect(isRecommendation("Give 500 mL crystalloid now.")).toBe(false);
    expect(isRecommendation("Order a lactate.")).toBe(false);
  });
});

describe("findForbiddenTokens", () => {
  it("finds an imperative order", () => {
    expect(findForbiddenTokens("Hastaya 500 mL sıvı verin.")).toEqual(["verin"]);
  });

  it("does not fire on a word that merely contains a forbidden one", () => {
    expect(findForbiddenTokens("Bayat veri: kreatinin")).toEqual([]);
  });
});

describe("charter: no orders", () => {
  it("every recommended action in the recording opens with an approved verb", () => {
    const actions = ward.frames.flatMap((f) => f.boards.flatMap((b) => b.alerts.flatMap((a) => a.recommended_actions)));
    expect(actions.length).toBeGreaterThan(0);
    const offenders = actions.filter((a) => !isRecommendation(a));
    expect(offenders).toEqual([]);
  });

  it("no string in the Turkish catalogue reads as an order", () => {
    const offenders = Object.entries(tr).filter(([, value]) => findForbiddenTokens(value).length > 0);
    expect(offenders).toEqual([]);
  });
});

describe("charter: no PHI", () => {
  it("identifies patients only by bed", () => {
    for (const frame of ward.frames) {
      for (const board of frame.boards) {
        expect(board.patient_id).toMatch(/^bed-\d+$/);
        expect(Object.keys(board)).toEqual(["patient_id", "risk", "alerts", "latest"]);
      }
    }
  });

  it("carries no demographic or identifying field anywhere in an alert", () => {
    const forbidden = /name|surname|mrn|tckn|ssn|birth|dob|address|phone/i;
    for (const frame of ward.frames) {
      for (const board of frame.boards) {
        for (const alert of board.alerts) {
          expect(Object.keys(alert).filter((k) => forbidden.test(k))).toEqual([]);
        }
      }
    }
  });
});
