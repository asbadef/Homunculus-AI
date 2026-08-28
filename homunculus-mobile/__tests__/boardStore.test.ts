/// <reference types="jest" />

import { boardReducer, initialBoardState, selectPatient, selectWard } from "../src/store/boardStore";
import type { BoardAlert, BoardNotification, PatientBoard } from "../src/transport/types";

function alert(kind: string, overrides: Partial<BoardAlert> = {}): BoardAlert {
  return {
    patient_id: "bed-3", kind, severity: "critical", urgency: "immediate", summary: kind,
    clinical_reasoning: "", supporting_evidence: [], recommended_actions: [], confidence: "",
    source: "rule", downgraded: false, chronic_context: "", stale_inputs: [], acknowledged: false,
    acknowledged_by: null, acknowledged_at: null, first_seen_at: null, escalated: false,
    ...overrides,
  };
}

function board(id: string, sofa: number | null, alerts: BoardAlert[] = []): PatientBoard {
  return {
    patient_id: id, risk: alerts.length ? "critical" : "none", alerts,
    latest: { heart_rate: null, map: 70, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa },
  };
}

const note: BoardNotification = {
  tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
  urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
  body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
};

describe("boardReducer", () => {
  it("upserts a patient board", () => {
    const state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    expect(state.patients["bed-3"].latest.sofa).toBe(2);
  });

  it("stamps first-seen once, on the app's own clock", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 2, [alert("septic_shock")]), now: 100,
    });
    state = boardReducer(state, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 5000,
    });
    expect(state.firstSeen["bed-3|septic_shock"]).toBe(100);
  });

  it("accumulates a series per vital, skipping nulls", () => {
    let state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    state = boardReducer(state, { type: "board", board: board("bed-3", null), now: 200 });
    state = boardReducer(state, { type: "board", board: board("bed-3", 6), now: 300 });
    expect(state.series["bed-3"].sofa).toEqual([2, 6]);
    expect(state.series["bed-3"].map).toEqual([70, 70, 70]);
    expect(state.series["bed-3"].heart_rate).toEqual([]);
  });

  it("keeps the newest notification first", () => {
    let state = boardReducer(initialBoardState, { type: "notification", note });
    state = boardReducer(state, { type: "notification", note: { ...note, kind: "sepsis" } });
    expect(state.notifications[0].kind).toBe("sepsis");
  });

  it("records a local acknowledgement", () => {
    const state = boardReducer(initialBoardState, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "nurse", now: 400,
    });
    expect(state.acknowledged).toContain("bed-3|septic_shock");
  });

  it("ignores a repeated acknowledgement instead of growing the list", () => {
    const once = boardReducer(initialBoardState, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "nurse", now: 400,
    });
    const twice = boardReducer(once, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "doctor", now: 500,
    });
    expect(twice).toBe(once);
    expect(twice.acknowledged).toEqual(["bed-3|septic_shock"]);
  });

  it("caps the notification feed at 50, newest surviving", () => {
    let state = initialBoardState;
    for (let i = 0; i < 55; i += 1) {
      state = boardReducer(state, { type: "notification", note: { ...note, kind: `k${i}` } });
    }
    expect(state.notifications).toHaveLength(50);
    expect(state.notifications[0].kind).toBe("k54");
    expect(state.notifications.at(-1)!.kind).toBe("k5");
  });

  it("caps a vital series at 120, most recent surviving", () => {
    let state = initialBoardState;
    for (let i = 0; i < 125; i += 1) {
      state = boardReducer(state, { type: "board", board: board("bed-3", i), now: i });
    }
    expect(state.series["bed-3"].sofa).toHaveLength(120);
    expect(state.series["bed-3"].sofa[0]).toBe(5);
    expect(state.series["bed-3"].sofa.at(-1)).toBe(124);
  });

  it("clears everything on a loop, because the scenario starts over", () => {
    let state = boardReducer(initialBoardState, { type: "board", board: board("bed-3", 2), now: 100 });
    state = boardReducer(state, { type: "ack", patientId: "bed-3", kind: "x", role: "nurse", now: 200 });
    expect(boardReducer(state, { type: "loop" })).toEqual(initialBoardState);
  });
});

describe("selectWard", () => {
  it("orders by risk and derives escalation from the app's clock", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 0,
    });
    state = boardReducer(state, { type: "board", board: board("bed-5", 0), now: 0 });

    const calm = selectWard(state, { now: 1000, thresholdMs: 20_000 });
    expect(calm.map((v) => v.board.patient_id)).toEqual(["bed-3", "bed-5"]);
    expect(calm[0].escalated).toBe(false);

    const late = selectWard(state, { now: 30_000, thresholdMs: 20_000 });
    expect(late[0].escalated).toBe(true);
    expect(late[0].tone).toBe("critical");
  });

  it("stops escalating once acknowledged", () => {
    let state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock")]), now: 0,
    });
    state = boardReducer(state, {
      type: "ack", patientId: "bed-3", kind: "septic_shock", role: "nurse", now: 100,
    });
    expect(selectWard(state, { now: 30_000, thresholdMs: 20_000 })[0].escalated).toBe(false);
  });

  it("escalates on the server's own flag, even with no client-side signal at all", () => {
    const state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock", { escalated: true })]), now: 0,
    });
    // now === firstSeen and thresholdMs is well beyond either, so the client-side rule cannot be
    // what fires here — only the merge with the server's own `alert.escalated` can.
    const view = selectWard(state, { now: 0, thresholdMs: 20_000 })[0];
    expect(view.escalated).toBe(true);
    expect(view.tone).toBe("critical");
  });

  it("stays calm when the server's flag is false and no client key fires either", () => {
    const state = boardReducer(initialBoardState, {
      type: "board", board: board("bed-3", 6, [alert("septic_shock", { escalated: false })]), now: 0,
    });
    expect(selectWard(state, { now: 0, thresholdMs: 20_000 })[0].escalated).toBe(false);
  });
});

describe("selectPatient", () => {
  it("returns undefined for a bed that is not on the board", () => {
    expect(selectPatient(initialBoardState, "bed-99", { now: 0, thresholdMs: 20_000 })).toBeUndefined();
  });
});
