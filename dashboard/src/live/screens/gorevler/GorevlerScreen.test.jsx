// src/live/screens/gorevler/GorevlerScreen.test.jsx — Görevlerim (G3-02)
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW, board, entry, identity, news2 } from "../../data/board.testutil.js";
import { GorevlerScreen } from "./GorevlerScreen.jsx";

export const VIEW = ["board.view", "tasks.view"];
export const MANAGE = [...VIEW, "tasks.manage", "clinical.chart"];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const AYSE = entry("S-001", [], { identity: identity({ birth_date: "1970-05-05" }), score: news2({ total: 0 }) });
const VUSAL = entry("S-002", [], { identity: identity({ patient_id: "S-002", display_name: "Vüsal Sınaq", bed_label: "REA-01 · 1", bed_id: "REA-01-1", bed_key: "REA^01^1" }) });
const iso = (ms) => new Date(ms).toISOString();
export const TASKS = {
  from: iso(NOW - 2 * 3_600_000), to: iso(NOW + 22 * 3_600_000), shift: { start: iso(NOW - 2 * 3_600_000), end: iso(NOW + 22 * 3_600_000) }, now: iso(NOW),
  settings: { grace_min: 30, intervals: { b0: 720, b1_4: null, b3_single: null, b5_6: null, b7: null } },
  patients: [
    { patient_id: "S-001", bed_key: "REA^01^2", unit_id: "REA-01",
      vital: { state: "late", anchor_at: iso(NOW - 13 * 3_600_000), due_at: iso(NOW - 3_600_000), band: "b0", interval_min: 720, partial: false, skipped_until: null, entries: [iso(NOW - 90 * 60_000)] },
      tasks: [{ id: "t1", patient_id: "S-001", title: "Pansuman", due_at: iso(NOW + 3_600_000), target_role: "nurse", state: "open", late: false,
                created_by: "hem.ayse", created_at: iso(NOW - 600_000), claimed_by: null, claimed_at: null, closed_by: null, closed_at: null }] },
    { patient_id: "S-002", bed_key: "REA^01^1", unit_id: "REA-01", vital: null, tasks: [] },
  ],
};

export async function open({ perms = MANAGE, tasks = TASKS, width = 1200 } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  const mounted = await mount(<GorevlerScreen />, {
    access: token({ perms, groups: ["nurse"] }), me: profile({ perms, groups: [{ slug: "nurse", name: "Hemşire" }] }),
    setup: (api) => {
      api.boardPatients.mockResolvedValue(board([AYSE, VUSAL]));
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      api.tasks.mockResolvedValue(tasks);
    },
  });
  await act(async () => { await mounted.board.start(); });
  await act(async () => { mounted.stream.open(); await settle(); });
  await act(async () => { await settle(); });
  return mounted;
}
export const press = (el) => act(async () => { fireEvent.click(el); await settle(); });
export const toasted = (text) => within(screen.getByRole("region", { name: "Bildirişlər" })).queryAllByText(text);

// Fake timers that keep moving with the wall clock: `settle()` still resolves on its own, and a test may
// jump the 30 s tick with `advanceTimersByTime` (the hook's re-read).
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the task screen", () => {
  it("reads the queue and shows the shift, the counters and one row per patient", async () => {
    const m = await open();
    expect(screen.getByRole("heading", { level: 1, name: "Tapşırıqlarım" })).toBeInTheDocument();
    expect(m.api.tasks).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^Növbə .* · 2 xəstə$/)).toBeInTheDocument();
    expect(screen.getByTestId("counter-late")).toHaveTextContent("1");
    expect(screen.getByTestId("counter-done")).toHaveTextContent("1");
    expect(screen.getByTestId("counter-plan")).toHaveTextContent("1");
    expect(screen.getAllByRole("row", { name: /REA-01 · [12]/ })).toHaveLength(2);
  });
  it("keeps the last answer and says so when a read fails", async () => {
    const m = await open();
    m.api.tasks.mockRejectedValueOnce(refusal(503, "kapsam şu anda okunamıyor"));
    await act(async () => { vi.advanceTimersByTime(30_000); await settle(); });
    expect(screen.getByText(/Tapşırıqlar oxuna bilmədi/)).toBeInTheDocument();
    expect(screen.getByTestId("counter-late")).toHaveTextContent("1");
  });
  it("is read-only without tasks.manage", async () => {
    await open({ perms: VIEW });
    expect(screen.queryByRole("button", { name: "Tapşırıq əlavə et" })).toBeNull();
    expect(screen.getByText("Tapşırıq yazma icazəniz yoxdur; ekran yalnız oxunur.")).toBeInTheDocument();
  });
});

describe("grid and list", () => {
  it("paints the grid: 24 hour columns from the shift start, a vital row and a hand row under the patient", async () => {
    await open();
    const grid = screen.getByRole("table", { name: "Tapşırıqlarım" });
    expect(within(grid).getAllByRole("columnheader")).toHaveLength(25);      // bed/name + 24 hours
    const ayse = within(grid).getByRole("row", { name: /REA-01 · 2/ });
    expect(ayse).toBeInTheDocument();
    expect(within(grid).getByText("Vital ölçmə")).toBeInTheDocument();
    expect(within(grid).getByText("Pansuman")).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: /gecikdi/ })).toBeInTheDocument();   // the late vital cell
    expect(within(grid).getAllByRole("button", { name: /tamamlandı/ })).toHaveLength(1); // the 90-min-old entry
  });
  it("lists open items late first on a narrow screen and hides done ones", async () => {
    await open({ width: 700 });
    const list = screen.getByRole("list", { name: "Tapşırıqlarım" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Vital ölçmə");
    expect(rows[0]).toHaveTextContent("gecikdi");
    expect(rows[1]).toHaveTextContent("Pansuman");
    expect(within(list).queryByText("tamamlandı")).toBeNull();
    expect(screen.getByText("Siyahı görünüşündə tamamlananlar gizlidir; cədvəldə görünür.")).toBeInTheDocument();
  });
  it("filters: only late, only vitals", async () => {
    await open();
    await press(screen.getByLabelText("Yalnız gecikənlər"));
    expect(screen.queryByText("Pansuman")).toBeNull();
    await press(screen.getByRole("button", { name: "Vital" }));
    expect(screen.getByText("Vital ölçmə")).toBeInTheDocument();
  });
});
