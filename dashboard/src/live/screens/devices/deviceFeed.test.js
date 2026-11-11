// G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D4, D5): the device page's answer, pure, on a fixed clock. The
// server's instant is AT (the fixtures' generated_at); this browser's is FETCHED when the answer arrived.
// Synthetic devices only (data/shadow.testutil.js): addresses 192.0.2.x, labels «REA-01 · n».
import { describe, it, expect } from "vitest";
import { AT, bed, strip, unassigned } from "../../data/shadow.testutil.js";
import {
  STALE_LIST_AFTER_S, STALE_LIST_UNTIL_S, chainLines, countsOf, minutesOf, neverSeenRows, serverNowMs, silentRows,
  staleAfterOf, staleLongCount, staleRows, staleUntilOf, verdictOf,
} from "./deviceFeed.js";

const AT_MS = Date.parse(AT);
const FETCHED = 5_000_000;
const NOW = AT_MS;
const before = (seconds) => new Date(AT_MS - seconds * 1000).toISOString();
const seen = (...channels) => channels.map(([parameter, seconds]) => ({ parameter, last_value_at: before(seconds) }));
const withLedger = (answer, over = {}) => ({ ...answer, watching_since: before(3 * 3600), stale_list_after_s: 60, vanished: [], ...over });

describe("the server's clock", () => {
  it("is the answer's generated_at plus the time since it arrived on this browser", () => {
    const data = strip();
    expect(serverNowMs(data, FETCHED + 30_000, FETCHED)).toBe(AT_MS + 30_000);
    expect(serverNowMs(data, FETCHED - 1, FETCHED)).toBe(AT_MS);              // a clock stepped back: never younger
    expect(serverNowMs({ ...data, generated_at: undefined }, FETCHED, FETCHED)).toBeNull();
  });

  it("counts whole minutes, «<1 dk» being 0", () => {
    expect([minutesOf(0), minutesOf(59_999), minutesOf(60_000), minutesOf(270_000), minutesOf(-5)]).toEqual([0, 0, 1, 4, 0]);
    expect(minutesOf(NaN)).toBeNull();
  });
});

describe("the verdict", () => {
  it("says the data flows, with the server's counts, when the chain is ok", () => {
    const data = strip({ beds: [bed("REA-01 · 2"), bed("REA-01 · 3", [], { status: "silent" })] });
    expect(verdictOf(data, NOW)).toEqual({ chain: false, key: "cihaz.verdictFlowing", streaming: 1, total: 2 });
  });

  it("is the chain's when the feed is not ok: the forwarder's silence and since when, the collector, never", () => {
    expect(verdictOf(strip({ feed: { state: "forwarder_silent", last_post_at: before(4 * 60 + 10) } }), NOW))
      .toEqual({ chain: true, key: "cihaz.verdictForwarder", minutes: 4 });
    expect(verdictOf(strip({ feed: { state: "forwarder_silent", last_post_at: null } }), NOW))
      .toEqual({ chain: true, key: "cihaz.verdictForwarderNoTime", minutes: null });
    expect(verdictOf(strip({ feed: { state: "collector_disconnected" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictCollector" });
    expect(verdictOf(strip({ feed: { state: "never" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictNever" });
    expect(verdictOf(strip({ feed: { state: "something_new" } }), NOW)).toMatchObject({ chain: true, key: "cihaz.verdictUnknown" });
  });
});

describe("«Sessiz monitörler»", () => {
  const ward = withLedger(strip({
    beds: [
      bed("REA-01 · 2", [], { last_packet_at: before(1) }),
      bed("REA-01 · 3", [], { status: "silent", last_packet_at: before(3 * 60) }),
      bed("REA-01 · 4", [], { status: "unknown", last_packet_at: before(12 * 60 + 30) }),
      bed("REA-01 · 5", [], { status: "standby", last_packet_at: before(1) }),
      bed("REA-01 · 6", [], { status: "waiting", last_packet_at: null }),
      bed("REA-01 · 7", [], { status: "unknown", last_packet_at: null }),
    ],
    unassigned: [unassigned("192.0.2.40", "not_in_table", [], { status: "silent", last_packet_at: before(30) })],
  }), { vanished: [
    { source: "192.0.2.4", bed_label: "REA-01 · 4", last_packet_at: before(12 * 60 + 30), last_report_at: before(12 * 60) },
    { source: "192.0.2.90", bed_label: null, last_packet_at: before(20 * 60), last_report_at: before(20 * 60) },
  ] });

  it("lists the silent, the unknown and the vanished once each, the longest silence first, an unknown time last", () => {
    expect(silentRows(ward, NOW).map((r) => [r.label ?? r.source, r.minutes, r.vanished])).toEqual([
      ["192.0.2.90", 20, true],             // vanished, and no card for it: still listed
      ["REA-01 · 4", 12, true],             // unknown AND vanished: one row
      ["REA-01 · 3", 3, false],
      ["192.0.2.40", 0, false],             // unassigned: by its address; under a minute
      ["REA-01 · 7", null, false],          // no last packet known: after every row that has one
    ]);
  });

  it("leaves out a streaming, a standby and a waiting monitor", () => {
    const sources = silentRows(ward, NOW).map((r) => r.source);
    for (const source of ["192.0.2.2", "192.0.2.5", "192.0.2.6"]) expect(sources).not.toContain(source);
  });

  it("reads an answer with no ledger (an API before G4-01): the silent card with no time", () => {
    const old = strip({ beds: [bed("REA-01 · 3", [], { status: "silent" })] });
    expect(silentRows(old, NOW)).toEqual([{ source: "192.0.2.3", label: "REA-01 · 3", lastMs: null, minutes: null, vanished: false }]);
  });
});

describe("«Eskiyen kanallar»", () => {
  it("lists a channel from 60 s up to an hour — 60 s and 3599 s yes, 59 s and 3600 s no — oldest first, the devices by their oldest", () => {
    const data = withLedger(strip({
      beds: [
        bed("REA-01 · 2", [], { channels_seen: seen(["hr", 0], ["spo2", 59], ["art_systolic", 60], ["etco2", 5 * 60]) }),
        bed("REA-01 · 3", [], { channels_seen: seen(["hr", 3599], ["temperature", 3600]) }),
      ],
    }));
    expect(staleRows(data, NOW)).toEqual([
      { source: "192.0.2.3", label: "REA-01 · 3", channels: [{ parameter: "hr", lastMs: AT_MS - 3_599_000, minutes: 59 }] },
      { source: "192.0.2.2", label: "REA-01 · 2", channels: [
        { parameter: "etco2", lastMs: AT_MS - 300_000, minutes: 5 },
        { parameter: "art_systolic", lastMs: AT_MS - 60_000, minutes: 1 },
      ] },
    ]);
    expect(staleLongCount(data, NOW)).toBe(1);                   // temperature, at 3600 s: counted, not listed
  });

  it("counts the channels silent an hour or more on one line instead — never NBP, never a monitor not sending — by the server's hour", () => {
    const data = withLedger(strip({
      beds: [
        bed("REA-01 · 2", [], { channels_seen: seen(["art_systolic", 2 * 3600], ["art_mean", 2 * 3600], ["nbp", 5 * 3600]) }),
        bed("REA-01 · 3", [], { status: "standby", channels_seen: seen(["hr", 2 * 3600]) }),
      ],
    }));
    expect(staleRows(data, NOW)).toEqual([]);
    expect(staleLongCount(data, NOW)).toBe(2);
    expect(staleLongCount(withLedger(strip()), NOW)).toBe(0);
    expect(staleUntilOf(strip())).toBe(STALE_LIST_UNTIL_S);   // an answer that sends none: the client's 3600
    const longer = { ...data, stale_list_until_s: 3 * 3600 };
    expect(staleRows(longer, NOW).map((row) => row.channels.length)).toEqual([2]);
    expect(staleLongCount(longer, NOW)).toBe(0);
  });

  it("takes the server's limit, and 60 s from an answer that sends none", () => {
    const card = bed("REA-01 · 2", [], { channels_seen: seen(["spo2", 90]) });
    expect(staleRows(withLedger(strip({ beds: [card] }), { stale_list_after_s: 120 }), NOW)).toEqual([]);
    const none = strip({ beds: [card] });
    expect(staleAfterOf(none)).toBe(STALE_LIST_AFTER_S);
    expect(staleRows(none, NOW)).toHaveLength(1);
  });

  it("never lists NBP, and no channel of a monitor in standby, silent or unknown", () => {
    const data = withLedger(strip({
      beds: [
        bed("REA-01 · 2", [], { channels_seen: seen(["nbp", 3 * 3600]) }),
        bed("REA-01 · 3", [], { status: "standby", channels_seen: seen(["hr", 600]) }),
        bed("REA-01 · 4", [], { status: "silent", channels_seen: seen(["hr", 600]) }),
        bed("REA-01 · 5", [], { status: "unknown", channels_seen: seen(["hr", 600]) }),
      ],
    }));
    expect(staleRows(data, NOW)).toEqual([]);
  });
});

describe("the counts", () => {
  it("are the rows' and the server's: silent monitors, stale channels, standby, waiting, unassigned", () => {
    const data = strip({
      beds: [bed("REA-01 · 3", [], { status: "standby" }), bed("REA-01 · 4", [], { status: "waiting" })],
      unassigned: [unassigned("192.0.2.40")],
    });
    const silent = [{ source: "a" }, { source: "b" }];
    const stale = [{ channels: [{}, {}] }, { channels: [{}] }];
    expect(countsOf(data, silent, stale)).toEqual({ silent: 2, stale: 3, standby: 2, waiting: 1, unassigned: 1 });
  });
});

describe("«Veri zinciri»", () => {
  it("gives each link its state word, and its age aged since the answer arrived", () => {
    const lines = chainLines(strip(), FETCHED + 3000, FETCHED);
    expect(lines.map((line) => [line.id, line.word])).toEqual([["collector", "ok"], ["forwarder", "ok"], ["hub", "ok"], ["rejected", "ok"]]);
    expect(lines[0]).toMatchObject({ heard: true, ageS: 4 });                  // 1 s when it answered, 3 s since
    expect(lines[1]).toMatchObject({ posted: true, ageS: 5, sent: 11, failed: 0 });
    expect(lines[2]).toMatchObject({ accepted: 1000, old: 0 });
  });

  it("says which link stopped", () => {
    const words = (feed) => Object.fromEntries(chainLines(strip({ feed }), FETCHED, FETCHED).map((line) => [line.id, line.word]));
    expect(words({ state: "forwarder_silent" })).toMatchObject({ forwarder: "down", hub: "unknown" });
    expect(words({ state: "collector_disconnected", collector_connected: false })).toMatchObject({ collector: "down", forwarder: "ok" });
    expect(words({ state: "never", collector_connected: null, collector_age_s: null, last_post_age_s: null, forwarder: null, hub: null }))
      .toEqual({ collector: "unknown", forwarder: "unknown", hub: "unknown", rejected: "ok" });
    expect(words({ rejected: { too_old: 2, clock: 0, unit: 0, range: 0, unknown_parameter: 0, duplicate: 0 } }).rejected).toBe("warn");
  });
});

describe("«Tabloda var, hiç görülmedi»", () => {
  it("is the table's rows whose monitor was never reported (status null), in the list's order", () => {
    const body = { stage: "shadow", generated_at: AT, can_bind: false, devices: [
      { source: "192.0.2.11", status: "streaming", row_id: 1 },
      { source: "192.0.2.12", status: null, row_id: 2 },
      { source: "192.0.2.13", status: "unknown", row_id: 3 },       // seen, then gone: not «never seen»
      { source: "192.0.2.14", status: null, row_id: 4 },
    ] };
    expect(neverSeenRows(body).map((d) => d.source)).toEqual(["192.0.2.12", "192.0.2.14"]);
    expect(neverSeenRows(null)).toEqual([]);
  });
});
