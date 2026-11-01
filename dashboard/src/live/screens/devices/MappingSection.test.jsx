// «Monitör–yatak eşleme» (spec §3.2): columns, absent devices, another unit's bed, who may act, the
// lane off, the poll, and no UUID on screen. Synthetic monitors; the screen speaks az (the default).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, screen, within } from "@testing-library/react";
import { expectNoUuid } from "../kabul/kabul.testutil.js";
import { BIO, device, list, mountMapping, onBed } from "./esleme.testutil.js";
import { MappingSection } from "./MappingSection.jsx";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

const pad = (n) => String(n).padStart(2, "0");
const local = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const WARD = list([
  device("192.0.2.11", { device_bed_label: "BED05", row_id: 1, bed: onBed(1, "1") }),
  device("192.0.2.12", { device_bed_label: "BED01", row_id: 2 }),
  device("192.0.2.13"),
  device("192.0.2.14", { device_bed_label: "BEDN1", row_id: 4, editable: false, bed: { id: "x", in_scope: false } }),
  device("192.0.2.20", { device_bed_label: "BED07", row_id: 5, seen: false, status: null,
    last_seen_at: "2026-10-30T09:02:00+00:00", bed: onBed(5, "5", "Otaq 2") }),
  device("192.0.2.21", { row_id: 6, seen: false, status: null, last_seen_at: null }),
]);

const rowOf = (source) => screen.getByText(new RegExp(`^${source.replace(/\./g, "\\.")}`)).closest("tr");

describe("the monitor–bed list", () => {
  it("shows each monitor's address, station name, visibility and bed, in the server's order", async () => {
    await mountMapping(<MappingSection />, { body: WARD });
    const table = screen.getByRole("table", { name: "Monitorlar və çarpayıları" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.cells[0].firstChild.textContent))   // the address, then « · 2050»
      .toEqual(["192.0.2.11", "192.0.2.12", "192.0.2.13", "192.0.2.14", "192.0.2.20", "192.0.2.21"]);
    expect(rowOf("192.0.2.11").cells[0]).toHaveTextContent("192.0.2.11 · 2050");
    // the monitor names its row, so a screen reader reads the address with each cell of it
    expect(within(rowOf("192.0.2.11")).getByRole("rowheader")).toHaveTextContent("192.0.2.11 · 2050");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(6);
    expect(within(rowOf("192.0.2.11")).getByText("1 · Otaq 1 · Reanimasiya")).toBeTruthy();
    expect(within(rowOf("192.0.2.11")).getByText("BED05")).toBeTruthy();
    expect(within(rowOf("192.0.2.11")).getByText("224.0.2.11")).toBeTruthy();
    expect(within(rowOf("192.0.2.11")).getByText("görünür")).toBeTruthy();
    expect(within(rowOf("192.0.2.12")).getByText("qoşulmayıb")).toBeTruthy();
    expect(within(rowOf("192.0.2.13")).getByText("qoşulmayıb")).toBeTruthy();
    expect(within(rowOf("192.0.2.14")).getByText("başqa şöbədə")).toBeTruthy();
    expect(within(rowOf("192.0.2.20")).getByText(`görünmür · son görünmə ${local("2026-10-30T09:02:00+00:00")}`)).toBeTruthy();
    expect(within(rowOf("192.0.2.20")).getByText("5 · Otaq 2 · Reanimasiya")).toBeTruthy();
    expect(within(rowOf("192.0.2.21")).getByText("görünmür · son görünmə bilinmir")).toBeTruthy();
    expectNoUuid();
  });

  it("offers the actions only on a monitor the session may change, named after it", async () => {
    await mountMapping(<MappingSection />, { body: WARD });
    expect(within(rowOf("192.0.2.11")).getByRole("button", { name: "Başqa çarpayıya qoş: 192.0.2.11 (BED05)" })).toBeTruthy();
    expect(within(rowOf("192.0.2.11")).getByRole("button", { name: "Bağlantını kəs: 192.0.2.11 (BED05)" })).toBeTruthy();
    expect(within(rowOf("192.0.2.13")).getByRole("button", { name: "Çarpayıya qoş: 192.0.2.13" })).toBeTruthy();
    expect(within(rowOf("192.0.2.13")).queryByRole("button", { name: /Bağlantını kəs/ })).toBeNull();
    // a v2 row with a station name but no bed (BED01) has nothing to unbind (spec §3.2: «when bound»)
    expect(within(rowOf("192.0.2.12")).getByRole("button", { name: "Çarpayıya qoş: 192.0.2.12 (BED01)" })).toBeTruthy();
    expect(within(rowOf("192.0.2.12")).queryByRole("button", { name: /Bağlantını kəs/ })).toBeNull();
    expect(within(rowOf("192.0.2.14")).queryByRole("button")).toBeNull();
  });

  it("offers nothing to biomedical, who reads the list", async () => {
    const body = list(WARD.devices.map((d) => ({ ...d, editable: false })), { can_bind: false });
    await mountMapping(<MappingSection />, { perms: BIO, body });
    expect(screen.getByRole("table", { name: "Monitorlar və çarpayıları" })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /qoş|kəs/ })).toHaveLength(0);
  });

  it("says the strip is off rather than showing a list", async () => {
    await mountMapping(<MappingSection />, { setup: (api) => {
      api.deviceBeds.mockRejectedValue(Object.assign(new Error("x"), { status: 409, apiCode: "monitor_lane_off" }));
    } });
    expect(screen.getByText(/Monitor zolağı bu xəstəxana üçün işləmir/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("reads through the session's track, so a refused refresh ends the session here too", async () => {
    const mounted = await mountMapping(<MappingSection />, { setup: (api) => {
      api.deviceBeds.mockRejectedValue(Object.assign(new Error("gone"), { status: 401, sessionEnded: true }));
    } });
    expect(mounted.store.getState().phase).toBe("signedOut");
  });

  it("says so when the network collector has reported no monitor", async () => {
    await mountMapping(<MappingSection />, { body: list([]) });
    expect(screen.getByText("Şəbəkə toplayıcısı hələ monitor bildirməyib.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says the list could not be read, and shows it once a later read lands", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { setup: (api) => {
      api.deviceBeds.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    } });
    expect(screen.getByText(/Uyğunlaşdırma siyahısı oxunmadı/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    mounted.api.deviceBeds.mockResolvedValue(WARD);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText(/Uyğunlaşdırma siyahısı oxunmadı/)).toBeNull();
    expect(screen.getByRole("table", { name: "Monitorlar və çarpayıları" })).toBeTruthy();
  });

  it("reads the list again every five seconds while on screen, and stops when it leaves", async () => {
    vi.useFakeTimers();
    const mounted = await mountMapping(<MappingSection />, { body: WARD });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
    cleanup();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(mounted.api.deviceBeds).toHaveBeenCalledTimes(2);
  });

  it("names the section for a screen reader and prints no patient and no UUID anywhere", async () => {
    await mountMapping(<MappingSection />, { body: WARD });
    expect(screen.getByRole("heading", { level: 2, name: "Monitor–çarpayı uyğunlaşdırması" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Monitor–çarpayı uyğunlaşdırması" })).toBeTruthy();
    expectNoUuid();
  });
});
