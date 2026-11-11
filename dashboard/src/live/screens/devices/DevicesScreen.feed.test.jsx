// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): the device page answers «is data arriving?» first — the verdict
// and its counts, the silent monitors, the stale channels, the data chain and the table's rows never seen — above
// the editor and the strips. The screen speaks az (the default). Synthetic devices only (shadow.testutil.js).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { AT, bed, param, strip, unassigned } from "../../data/shadow.testutil.js";
import { DICTIONARIES } from "../../i18n/catalog.js";
import { DevicesScreen } from "./DevicesScreen.jsx";
import { device, list as mappingList, onBed } from "./esleme.testutil.js";
import { pinZone } from "./zone.testutil.js";

pinZone();     // Baku, UTC+4: AT (10:00Z) reads 14:00
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); localStorage.clear();
  delete document.visibilityState; delete document.hidden;       // hide(): back to jsdom's own (visible)
});

/** A refusal shaped as the API's own (backendApi.js `failure`): an Error with its detail and status, and its code. */
const refusal = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Hide or show the tab for real: both of the page's own signals, as a browser sets them (shadowStore, useNow). */
function hide(hidden) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

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
      if (answer instanceof Error) api.shadowBoard.mockRejectedValue(answer);
      else api.shadowBoard.mockResolvedValue(answer);
    },
  });
  await act(async () => { mounted.shadow.start(perms); await settle(); });
  await act(async () => { await settle(); });       // the editor's first read lands too
  return mounted;
}

const NO_LEDGER = DICTIONARIES.az["cihaz.listNoLedger"];
const LIST_UNKNOWN = DICTIONARIES.az["cihaz.listUnknown"];
const NEVER_NONE = "Cədvəldə olub heç görünməyən monitor yoxdur";

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
    expect(headings.slice(0, 6)).toEqual(["Məlumat gəlirmi?", "Səssiz monitorlar", "Köhnələn kanallar", "Məlumat zənciri",
      "Cədvəldə var, heç görünməyib", "Monitor–çarpayı uyğunlaşdırması"]);
  });

  it("says the data flows, with the counts above zero and since when it has watched", async () => {
    await open(WARD);
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict).toHaveTextContent("Məlumat axır · 2/5 monitordan məlumat gəlir");
    expect(verdict).toHaveTextContent("2 səssiz · 2 köhnələn kanal · 1 gözləmə rejimində · 1 təyin edilməmiş");
    expect(verdict).not.toHaveTextContent("məlumat gözləyir");                  // no monitor waiting: no «0»
    expect(verdict).toHaveTextContent("İzləmə başlanğıcı 11:00 · sistem yenidən başlayanda sıfırlanır");
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

  it("says why it calls the refused values «diqqət»: a missing reason reads 0, one this build does not know «digər»", async () => {
    await open({ ...WARD, feed: { ...WARD.feed, rejected: { too_old: 1, checksum: 3 } } });
    const line = items("Məlumat zənciri")[3];
    expect(line).toBe("diqqət Qəbul edilməyən dəyərlər · çox köhnə 1 · saat 0 · vahid 0 · diapazon 0 · naməlum 0 · təkrar 0 · digər 3");
    expect(line).not.toMatch(/[{}]/);
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

  it("reads an answer with no ledger: the silent card with no time, no watching line, and «since when» unknown in both lists", async () => {
    await open(strip({ beds: [bed("REA-01 · 5", [], { status: "silent" }), bed("REA-01 · 2", [param("hr", 72)])] }));
    expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · son məlumatın vaxtı məlum deyil"]);
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("İzləmə");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) expect(region(name)).toHaveTextContent(NO_LEDGER);
    expect(within(region("Köhnələn kanallar")).queryAllByRole("listitem")).toEqual([]);
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("never calls a list empty from an answer with no ledger, even one with no silent card", async () => {
    await open(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)])] }));
    expect(region("Səssiz monitorlar")).toHaveTextContent(NO_LEDGER);
    expect(region("Səssiz monitorlar")).not.toHaveTextContent("Səssiz monitor yoxdur");
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("cannot time anything from an answer with no generated_at, and says so instead of listing", async () => {
    await open({ ...WARD, generated_at: undefined });
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent(DICTIONARIES.az["cihaz.listNoClock"]);
      expect(within(region(name)).queryAllByRole("listitem")).toEqual([]);
    }
    expect(region("Səssiz monitorlar")).not.toHaveTextContent("Səssiz monitor yoxdur");
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("says the chain works but no monitor sends — never «flowing» — and still lists the silent ones", async () => {
    await open(withLedger(strip({ beds: [
      bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(12.5), channels_seen: [] }),
      bed("REA-01 · 7", [], { status: "standby", last_packet_at: before(0), channels_seen: [] }),
    ] })));
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict).toHaveTextContent("Zəncir işləyir, amma heç bir monitordan məlumat gəlmir");
    expect(verdict).not.toHaveTextContent("Məlumat axır");
    expect(verdict).toHaveTextContent("1 səssiz · 1 gözləmə rejimində");
    expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · 12 dəqiqədir məlumat yoxdur · son məlumat 13:47"]);
  });

  it("says the hub reports no monitor, and calls neither list empty", async () => {
    await open(withLedger(strip()));
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Hub heç bir monitor bildirmir");
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("Məlumat axır");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent(DICTIONARIES.az["cihaz.listNoMonitors"]);
    }
    expect(region("Səssiz monitorlar")).not.toHaveTextContent("Səssiz monitor yoxdur");
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("Köhnələn kanal yoxdur");
  });

  it("reads a count the answer does not carry as unknown: no «flowing», no counts, no list called empty", async () => {
    await open({ ...WARD, feed: { ...WARD.feed, devices: undefined } });
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict).toHaveTextContent("Zəncir işləyir; monitor sayları oxunmur");
    expect(verdict).not.toHaveTextContent("Məlumat axır");
    expect(verdict).not.toHaveTextContent("səssiz");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent(LIST_UNKNOWN);
      expect(within(region(name)).queryAllByRole("listitem")).toEqual([]);
    }
  });

  it("says a feed state this build does not know is unknown — not that the chain is broken", async () => {
    await open({ ...WARD, feed: { ...WARD.feed, state: "something_new" } });
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Məlumat axınının vəziyyəti oxunmur");
    for (const name of ["Səssiz monitorlar", "Köhnələn kanallar"]) {
      expect(region(name)).toHaveTextContent(LIST_UNKNOWN);
      expect(region(name)).not.toHaveTextContent("Məlumat zənciri qırılıb");
      expect(within(region(name)).queryAllByRole("listitem")).toEqual([]);
    }
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

/** Let the page's clock run `ms` on while its next poll is out and has not landed (the store asks again, and
 *  ShadowProvider reads the clock again, on a visibilitychange). Under the display limit the answer stays fresh. */
async function later(mounted, ms) {
  mounted.api.shadowBoard.mockReturnValue(new Promise(() => {}));
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + ms);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
}

// A polite status for a screen reader: the verdict and whether the board is fresh, and nothing that ticks — so it
// speaks when the answer's state changes, not every minute.
describe("what a screen reader is told", () => {
  const status = () => document.querySelector("[data-feed-status]");

  it("holds only the verdict and whether the board is fresh — never a minute or a count", async () => {
    const mounted = await open(WARD);
    expect(status()).toHaveAttribute("role", "status");
    expect(status()).toHaveClass("sr-only");
    await waitFor(() => expect(status()).toHaveTextContent(/^Məlumat axır$/));
    await later(mounted, 10_000);                                   // still fresh: the durations move on, the status does not
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 250); }); });
    expect(status()).toHaveTextContent(/^Məlumat axır$/);
    await later(mounted, 10_000);                                   // 20 s without an answer: no longer fresh
    await waitFor(() => expect(status()).toHaveTextContent(/^Lövhə yenilənməyib · Son cavabda məlumat axırdı$/));
    expect(status().textContent).not.toMatch(/\d/);
  });

  it("names a broken chain's link without its minutes", async () => {
    await open(withLedger(strip({ feed: { state: "forwarder_silent", last_post_at: before(4.2), last_post_age_s: 252 } })));
    await waitFor(() => expect(status()).toHaveTextContent(/^Məlumat gəlmir: ötürücü susur$/));
  });
});

// Section 5 reads the editor's own list (GET /infinity-shadow/device-beds, `status` null: never reported since the
// API started) — devices.manage or devices.map_beds, the page's own two keys. Synthetic monitors (esleme.testutil.js).
describe("«Tabloda var, hiç görülmedi»", () => {
  const LIST = mappingList([
    device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
    device("192.0.2.21", { device_bed_label: "BED09", row_id: 6, seen: false, status: null, last_seen_at: null, bed: onBed(9, "9") }),
    device("192.0.2.22", { row_id: 7, seen: false, status: null, last_seen_at: null }),
    device("192.0.2.20", { row_id: 5, seen: false, status: "unknown", last_seen_at: null }),   // seen once: not here
  ]);

  it("lists the table's rows whose monitor was never reported, with the bed and the device's address", async () => {
    await open(WARD, ["devices.manage"], LIST);
    expect(items("Cədvəldə var, heç görünməyib")).toEqual(["9 · Otaq 1 · Reanimasiya · 192.0.2.21 (BED09)", "qoşulmayıb · 192.0.2.22"]);
  });

  it("is there for a charge nurse too, whose devices.map_beds reads the same list", async () => {
    await open(WARD, ["devices.map_beds", "board.view"], LIST);
    expect(items("Cədvəldə var, heç görünməyib")).toHaveLength(2);
  });

  it("says none only from a list that answered", async () => {
    await open(WARD);
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent("Cədvəldə olub heç görünməyən monitor yoxdur");
    cleanup();
    await open(WARD, ["devices.manage"], new Error("down"));
    expect(region("Cədvəldə var, heç görünməyib")).not.toHaveTextContent("Cədvəldə olub heç görünməyən monitor yoxdur");
  });

  it("keeps the rows of a list it can no longer read, and says so", async () => {
    const mounted = await open(WARD, ["devices.manage"], LIST);
    mounted.api.deviceBeds.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(items("Cədvəldə var, heç görünməyib")).toHaveLength(2);
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent(DICTIONARIES.az["esleme.unreadable"]);
  });

  it("is absent for a session that holds neither key, and nothing asks for the list", async () => {
    const mounted = await open(WARD, ["board.view"]);
    expect(screen.queryByRole("region", { name: "Cədvəldə var, heç görünməyib" })).toBeNull();
    expect(mounted.api.deviceBeds).not.toHaveBeenCalled();
  });

  it("answers a session that holds only devices.map_beds: the never-seen rows, and a note that the rest needs the device or board right", async () => {
    const mounted = await open(WARD, ["devices.map_beds"], LIST);
    expect(screen.getByText(DICTIONARIES.az["cihaz.needsRight"])).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Məlumat gəlirmi?" })).toBeNull();
    expect(items("Cədvəldə var, heç görünməyib")).toEqual(["9 · Otaq 1 · Reanimasiya · 192.0.2.21 (BED09)", "qoşulmayıb · 192.0.2.22"]);
    expect(mounted.api.shadowBoard).not.toHaveBeenCalled();                    // the strip is not this session's to read
  });

  it("answers whatever the strip does: a board that never answered still leaves the list's rows", async () => {
    await open(refusal(503, "kapsam şu anda okunamıyor"), ["devices.manage"], LIST);
    expect(screen.queryByRole("region", { name: "Məlumat gəlirmi?" })).toBeNull();
    expect(items("Cədvəldə var, heç görünməyib")).toHaveLength(2);
  });

  it("says the list is loading while it loads, and nothing about its rows", async () => {
    await open(WARD, ["devices.manage"], new Promise(() => {}));
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent(DICTIONARIES.az["esleme.loading"]);
    expect(region("Cədvəldə var, heç görünməyib")).not.toHaveTextContent(NEVER_NONE);
  });

  it("treats a lane that is off like a list it cannot read", async () => {
    await open(WARD, ["devices.manage"], refusal(409, "Monitor zolağı bu xəstəxanada söndürülüb", { apiCode: "monitor_lane_off" }));
    expect(region("Cədvəldə var, heç görünməyib")).toHaveTextContent(DICTIONARIES.az["esleme.unreadable"]);
    expect(region("Cədvəldə var, heç görünməyib")).not.toHaveTextContent(NEVER_NONE);
  });
});

// Decision 18: only a fresh answer may say a list is empty. One that is not — a poll that hangs past the display
// limit, a poll that failed — keeps what it said, marked with the answer's own time.
describe("a board that is not fresh (Decision 18)", () => {
  const stall = async (mounted, ms = 18_000) => {
    mounted.api.shadowBoard.mockReturnValue(new Promise(() => {}));         // the next poll never answers
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + ms);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
  };
  const MARK = "Lövhə yenilənməyib · 14:00";
  const LEAD = "Lövhə yenilənməyib · son cavab 14:00";

  // A sending monitor whose two channels carried a value a moment ago, and a monitor silent for two minutes: a page
  // that kept measuring after its last answer would list both channels as stale within minutes, and count them past
  // the hour — silences the answer never reported.
  const LIVELY = withLedger(strip({ beds: [
    bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0], ["spo2", 0.5]) }),
    bed("REA-01 · 5", [], { status: "silent", last_packet_at: before(2), silent_for_s: 120, channels_seen: [] }),
  ] }));
  const frozen = () => {
    expect(within(region("Köhnələn kanallar")).queryAllByRole("listitem")).toEqual([]);
    expect(region("Köhnələn kanallar")).not.toHaveTextContent("çıxarılmış ola bilər");
    expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · 2 dəqiqədir məlumat yoxdur · son məlumat 13:58"]);
    expect(items("Məlumat zənciri")[1]).toMatch(/son göndəriş 2 san əvvəl/);       // the answer's own age, not aged on
    expect(region("Səssiz monitorlar")).toHaveTextContent(MARK);
  };

  for (const minutes of [5, 70]) {
    it(`measures at the last answer's own instant after a stall of ${minutes} min: no new stale channel, no count line, durations frozen`, async () => {
      const mounted = await open(LIVELY);
      expect(items("Səssiz monitorlar")).toEqual(["REA-01 · 5 · 2 dəqiqədir məlumat yoxdur · son məlumat 13:58"]);
      await stall(mounted, minutes * 60_000);
      frozen();
    });
  }

  it("measures at the last answer when a hidden tab is shown again before its poll lands", async () => {
    const mounted = await open(LIVELY);
    hide(true);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    const asked = mounted.api.shadowBoard.mock.calls.length;
    mounted.api.shadowBoard.mockReturnValue(new Promise(() => {}));          // the poll on showing never lands
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 70 * 60_000);
    hide(false);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(mounted.api.shadowBoard.mock.calls.length).toBe(asked + 1);         // it asked again on showing
    frozen();
  });

  it("leads the verdict with «not up to date · last answer», says the old verdict in the past tense, and marks the rest", async () => {
    const mounted = await open(WARD);
    expect(screen.queryByText(MARK)).toBeNull();
    expect(screen.queryByText(LEAD)).toBeNull();
    await stall(mounted);
    const verdict = region("Məlumat gəlirmi?");
    expect(verdict.textContent.startsWith(`Məlumat gəlirmi?${LEAD}`)).toBe(true);           // the section leads with it
    expect(verdict).toHaveTextContent("Son cavabda məlumat axırdı · 2/5 monitordan məlumat gəlirdi");
    expect(verdict).not.toHaveTextContent("Məlumat axır ·");                                 // no present-tense «all fine»
    expect(screen.getAllByText(MARK)).toHaveLength(3);                                       // sections 2, 3 and 4
    expect(items("Səssiz monitorlar")).toHaveLength(2);
  });

  it("says a broken chain's verdict in the past tense too", async () => {
    const mounted = await open(withLedger(strip({ beds: WARD.beds, unassigned: WARD.unassigned,
      feed: { state: "forwarder_silent", last_post_at: before(4.2), last_post_age_s: 252 } })));
    await stall(mounted);
    expect(region("Məlumat gəlirmi?")).toHaveTextContent("Son cavabda məlumat gəlmirdi: ötürücü 4 dəqiqədir susurdu");
    expect(region("Məlumat gəlirmi?")).not.toHaveTextContent("Məlumat gəlmir:");
  });

  it("keeps the chain's last values as detail, but calls every link's state unknown", async () => {
    const mounted = await open(WARD);
    expect(items("Məlumat zənciri").every((line) => line.startsWith("normal "))).toBe(true);
    await stall(mounted);
    const lines = items("Məlumat zənciri");
    for (const line of lines) expect(line).toMatch(/^məlum deyil /);
    expect(lines[1]).toMatch(/^məlum deyil Ötürücü · son göndəriş 2 san əvvəl · 11 göndərildi, 0 uğursuz$/);
    expect(lines[2]).toBe("məlum deyil Infinity serveri · 1000 paket alınıb · 0 köhnə və ya təkrar");
  });

  it("says nothing is empty from an answer it cannot vouch for", async () => {
    const mounted = await open(withLedger(strip({ beds: [bed("REA-01 · 2", [param("hr", 72)], { last_packet_at: before(0), channels_seen: seen(["hr", 0]) })] })));
    expect(screen.getByText("Səssiz monitor yoxdur")).toBeInTheDocument();
    await stall(mounted);
    expect(screen.queryByText("Səssiz monitor yoxdur")).toBeNull();
    expect(screen.queryByText("Köhnələn kanal yoxdur")).toBeNull();
    expect(region("Səssiz monitorlar")).toHaveTextContent(MARK);
  });

  it("marks a failed poll the same way", async () => {
    const mounted = await open(WARD);
    mounted.api.shadowBoard.mockRejectedValue(new Error("down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
    expect(screen.getByText(LEAD)).toBeInTheDocument();
    expect(screen.getAllByText(MARK)).toHaveLength(3);
  });
});
