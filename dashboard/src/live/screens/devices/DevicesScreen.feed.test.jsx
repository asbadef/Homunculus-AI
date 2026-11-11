// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page answers «is data arriving?» first — the verdict
// and its counts, the silent monitors, the stale channels, the data chain and the table's rows never seen — above
// the editor and the strips. The screen speaks az (the default). Synthetic devices only (shadow.testutil.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { AT, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { DevicesScreen } from "./DevicesScreen.jsx";
import { device, list as mappingList, onBed } from "./esleme.testutil.js";
import { pinZone } from "./zone.testutil.js";

pinZone();     // Baku, UTC+4: AT (10:00Z) reads 14:00
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const before = (minutes) => new Date(Date.parse(AT) - minutes * 60_000).toISOString();
const seen = (...channels) => channels.map(([parameter, minutes]) => ({ parameter, last_value_at: before(minutes) }));
const withLedger = (answer, over = {}) => ({ ...answer, watching_since: before(180), stale_list_after_s: 60, vanished: [], ...over });
const EMPTY_LIST = { stage: "shadow", generated_at: AT, can_bind: false, devices: [] };

async function open(answer, perms = ["devices.manage"], list = EMPTY_LIST) {
  const mounted = await mount(<DevicesScreen />, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      if (list instanceof Error) api.deviceBeds.mockRejectedValue(list);
      else api.deviceBeds.mockResolvedValue(list);
      api.shadowBoard.mockResolvedValue(answer);
    },
  });
  await act(async () => { mounted.shadow.start(perms); await settle(); });
  await act(async () => { await settle(); });       // the editor's first read lands too
  return mounted;
}

const region = (name) => screen.getByRole("region", { name });
const items = (name) => within(region(name)).getAllByRole("listitem").map((li) => li.textContent);

// A streaming bed with a channel quiet for 4½ min, one quiet for 1½ h (counted, not listed) and NBP (never stale), a
// silent bed, an unknown one the hub no longer lists, a monitor in standby, and an unassigned streaming monitor with a
// channel quiet for 2 min.
const WARD = withLedger(strip({
  beds: [
    bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0),
      channels_seen: seen(["hr", 0], ["art_systolic", 4.5], ["art_mean", 90], ["nbp", 30]) }),
    bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(12.5), silent_for_s: 750, channels_seen: [] }),
    bed("REA-01 · 6", [], { status: "unknown", last_packet_at: before(3), silent_for_s: 180, channels_seen: seen(["hr", 3]) }),
    bed("REA-01 · 7", [], { status: "standby", last_packet_at: before(0), channels_seen: seen(["spo2", 50]) }),
  ],
  unassigned: [unassigned("192.0.2.28", "not_in_table", [param("pls", 70)],
    { status: "streaming", last_packet_at: before(0), channels_seen: seen(["pls", 0], ["spo2", 2]) })],
}), { vanished: [{ source: "192.0.2.6", bed_label: "REA-01 · 6", last_packet_at: before(3), last_report_at: before(2.5) }] });

describe("«Cihaz & Veri Akışı» — is data arriving?", () => {
  it("puts its questions first, in the spec's order, above the editor and the strips", async () => {
    await open(WARD);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 5)).toEqual(["Məlumat gəlirmi?", "Səssiz monitorlar", "Köhnələn kanallar", "Məlumat zənciri",
      "Monitor–çarpayı uyğunlaşdırması"]);
  });

  it("says the data flows, with the counts above zero and since when it has watched", async () => {
    await open(WARD);
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict).toHaveTextContent("Məlumat axır · 2/5 monitordan məlumat gəlir");
    expect(verdict).toHaveTextContent("2 səssiz · 2 köhnələn kanal · 1 gözləmə rejimində · 1 təyin edilməmiş");
    expect(verdict).not.toHaveTextContent("məlumat gözləyir");                  // no monitor waiting: no «0»
    expect(verdict).toHaveTextContent("İzləmə 11:00-dan bəri; sistem yenidən başlayanda sıfırlanır");
  });

  it("lists the silent monitors, the longest silence first, and says which one the hub no longer reports", async () => {
    await open(WARD);
    expect(items("Səssiz monitorlar")).toEqual([
      "REA-01 · 5 · 12 dəqiqədir məlumat yoxdur · son məlumat 13:47",
      "REA-01 · 6 · 3 dəqiqədir məlumat yoxdur · son məlumat 13:57 · hub artıq bildirmir",
    ]);
  });

  it("lists the channels a sending monitor has carried no value on for over a minute — never NBP, never a monitor in standby", async () => {
    await open(WARD);
    expect(items("Köhnələn kanallar")).toEqual([
      "REA-01 · 2 · ART S · 4 dəqiqədir dəyər yoxdur",
      "192.0.2.28 · SpO₂ · 2 dəqiqədir dəyər yoxdur",
    ]);
  });

  it("counts the channels silent an hour or more on the section's last line, and prints no such line for none", async () => {
    await open(WARD);
    expect(region("Köhnələn kanallar")).toHaveTextContent("1 kanal 1 saatdan çox dəyər göndərmir (çıxarılmış ola bilər)");
    expect(items("Köhnələn kanallar")).toHaveLength(2);                          // ART M is counted, not listed
    cleanup();
    await open(withLedger(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0]) })] })));
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("çıxarılmış ola bilər");
  });

  it("shows the data chain, each link with its state word", async () => {
    await open(WARD);
    const lines = items("Məlumat zənciri");
    expect(lines[0]).toMatch(/^normal Toplayıcı · son əlaqə \d+ san əvvəl$/);
    expect(lines[1]).toMatch(/^normal Ötürücü · son göndəriş \d+ san əvvəl · 11 göndərildi, 0 uğursuz$/);
    expect(lines[2]).toBe("normal Infinity serveri · 1000 paket alınıb · 0 köhnə və ya təkrar");
    expect(lines[3]).toBe("normal Qəbul edilməyən dəyərlər · çox köhnə 0 · saat 0 · vahid 0 · diapazon 0 · naməlum 0 · təkrar 0");
  });

  it("gives the chain's verdict when no data arrives, and lists no monitor as a fault then", async () => {
    await open(withLedger(strip({ beds: WARD.beds, unassigned: WARD.unassigned,
      feed: { state: "forwarder_silent", last_post_at: before(4.2), last_post_age_s: 252 } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat gəlmir: ötürücü 4 dəqiqədir susur");
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("səssiz");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent("Məlumat zənciri qırılıb: monitorlar bir-bir sadalanmır");
      expect(within(region(name)).queryAllByRole("listitem")).toEqual([]);
    }
    expect(items("Məlumat zənciri")[1]).toMatch(/^dayanıb Ötürücü/);
    cleanup();
    await open(withLedger(strip({ feed: { state: "collector_disconnected", collector_connected: false } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat gəlmir: toplayıcı qoşulmayıb");
    cleanup();
    await open(withLedger(strip({ feed: { state: "never" } })));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Hələ heç bir məlumat gəlməyib");
  });

  it("says a list is empty when the answer is fresh", async () => {
    await open(withLedger(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0]) })] })));
    expect(region("Səssiz monitorlar")).toHaveTextContent("Səssiz monitor yoxdur");
    expect(region("Köhnələn kanallar")).toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("reads an answer with no ledger: the silent card with no time, and no watching line", async () => {
    await open(strip({ beds: [bed("REA-01 · 5", [], { status: "silent" })] }));
    expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · son məlumatın vaxtı məlum deyil"]);
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("İzləmə");
  });

  it("shows no patient, even to a session that also holds board.view", async () => {
    await open(withLedger(strip({ beds: [bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(5), link: "one", patient_id: "S-003" })] })),
      ["devices.manage", "board.view"]);
    expect(document.body).not.toHaveTextContent("S-003");
  });

  it("draws none of it while the strip is off", async () => {
    await open({ stage: "off" });
    expect(screen.queryByRole("region", { name: "Məlumat gəlirmi?" })).toBeNull();
  });
});
