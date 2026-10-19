// Biomedical's monitor screen (Aşama A, Decision 12): every device, where the approved table puts
// it, what it is sending — and nothing about any patient, even when the answer carries a patient
// id (a session that also holds board.view). Synthetic devices only (data/shadow.testutil.js).
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { STAGE_OFF, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { DevicesScreen } from "./DevicesScreen.jsx";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
afterEach(() => localStorage.clear());

async function open(answer, perms = ["devices.manage"]) {
  const mounted = await mount(<DevicesScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      if (answer instanceof Error) api.shadowBoard.mockRejectedValue(answer);
      else api.shadowBoard.mockResolvedValue(answer);
    },
  });
  await act(async () => { mounted.shadow.start(perms); await settle(); });
  return mounted;
}

const WARD = strip({
  beds: [
    bed("REA-01 · 2", [param("hr", 72), param("art_mean", 84)], { link: "one", patient_id: "S-003" }),
    bed("REA-01 · 5", [], { status: "standby", method: "central_station_list" }),
  ],
  unassigned: [unassigned("192.0.2.28", "table_unassigned", [param("spo2", 96)], { status: "streaming" }),
    unassigned("192.0.2.34", "not_in_table")],
});

describe("the monitor screen", () => {
  it("names itself and says it shows no patient", async () => {
    await open(WARD);
    expect(screen.getByRole("heading", { level: 1, name: "Monitorlar" })).toBeInTheDocument();
    expect(screen.getByText(/Xəstə məlumatı göstərilmir/)).toBeInTheDocument();
  });

  it("lists every device: its bed or why it has none, its address, status, values, ages and evidence", async () => {
    await open(WARD);
    const bedStrip = screen.getByRole("region", { name: "REA-01 · 2 · Monitor · təsdiqlənməyib" });
    expect(bedStrip).toHaveTextContent("192.0.2.2");
    expect(bedStrip).toHaveTextContent("72");
    expect(bedStrip).toHaveTextContent("2 san");
    expect(bedStrip).toHaveTextContent("monitor ekranı");
    expect(within(bedStrip).getByText("İki cihazda monitor ekranı ilə eynidir")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "REA-01 · 5 · Monitor · təsdiqlənməyib" }))
      .toHaveTextContent("Monitor gözləmə rejimindədir");
    const stray = screen.getByRole("region", { name: "Təyin edilməmiş cihaz · 192.0.2.28 · Monitor · təsdiqlənməyib" });
    expect(stray).toHaveTextContent("Cihaz→çarpayı cədvəlində çarpayısı müəyyənləşdirilməyib");
    expect(stray).toHaveTextContent("96");
    expect(screen.getByRole("region", { name: "Təyin edilməmiş cihaz · 192.0.2.34 · Monitor · təsdiqlənməyib" }))
      .toHaveTextContent("Cihaz→çarpayı cədvəlində yoxdur");
    expect(document.querySelectorAll("[data-monitor-strip]")).toHaveLength(4);
  });

  it("shows the table's version and sha, and the feed's counters from a read it can vouch for", async () => {
    await open(WARD);
    expect(screen.getByText("Cədvəl versiyası 1 · ab12cd34ef56")).toBeInTheDocument();
    expect(screen.getByText(/Alınan göndəriş: 12/)).toBeInTheDocument();
    expect(screen.getByText(/rədd edilən oxunuş/i)).toBeInTheDocument();
  });

  it("shows no patient id or name, even to a session that also holds board.view", async () => {
    for (const perms of [["devices.manage"], ["devices.manage", "board.view"]]) {
      await open(WARD, perms);
      expect(document.body).not.toHaveTextContent("S-003");
      expect(document.body).not.toHaveTextContent(/xəstə qeydi var|bağlı xəstə/);
      cleanup();
    }
  });

  it("says why no device sits on a bed when the table is missing or invalid, in the server's words", async () => {
    await open(strip({ beds: [], unassigned: [unassigned("192.0.2.28", "table_missing")],
      table: { status: "missing", reason: "dosya yok", version: null, sha256: null } }));
    expect(screen.getAllByText(/Cihaz→çarpayı cədvəli yoxdur və ya etibarsızdır/).length).toBeGreaterThan(0);
    expect(screen.getByText("dosya yok")).toHaveAttribute("lang", "tr");
  });

  it("says the strip is off, and why when it could not be turned on", async () => {
    await open(STAGE_OFF);
    expect(screen.getByText("Monitor zolağı söndürülüb")).toBeInTheDocument();
    cleanup();
    await open({ stage: "off", configured_stage: "shadow", problem: "token_weak" });
    expect(screen.getByText("Monitor zolağı açıla bilmədi: token_weak")).toBeInTheDocument();
  });

  it("says it cannot read the strip, and counts nothing", async () => {
    await open(new Error("down"));
    expect(screen.getByText("Monitor zolağı oxunmur")).toBeInTheDocument();
    expect(screen.queryByText(/Alınan göndəriş/)).toBeNull();
  });
});
