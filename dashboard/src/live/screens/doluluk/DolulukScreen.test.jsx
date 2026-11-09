// The Doluluk screen (G2-B3a, spec §3, R1, X7, X10).
// - It shows the caller's beds by unit and room: state in words, for how long, and the counts.
// - The short name and the notes come from their own read; when that read fails, the beds stay
//   and the names go.
// - Each move is offered to the right that makes it. One move is out at a time, and every move is
//   followed by a re-read.
// - «Bu çarpayıya xəstə qəbul et» puts the bed in the session's admission form and opens Kabul.
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { ROUTES, canReach } from "../../shell/routes.js";
import { admitDraftOf } from "../kabul/admitDraft.js";
import { BED, CHARGE, DOCTOR, NURSE, UUID_TEXT, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";
import { DolulukScreen } from "./DolulukScreen.jsx";

const MANAGER = [...CHARGE, "beds.manage_state"];
const ward = (change) => { const s = structure(); change?.(s); return s; };
const rea = (s) => s.sites[0].units[0];
/** The bed `label` inside the room landmark `region`, as its tile. */
const tile = (region, label) => within(within(screen.getByRole("region", { name: region })).getByText(label, { selector: "b" }).closest("li"));
const press = (name) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
const names = (beds) => ({ beds });

async function mountScreen(perms, setup) {
  return mountKabul(<DolulukScreen />, { perms, setup: (a) => { a.occupancy.mockResolvedValue(names([])); setup?.(a); } });
}

afterEach(() => { window.location.hash = ""; });

describe("DolulukScreen", () => {
  it("is a route for whoever reads, admits, confirms a discharge or releases a bed", () => {
    const route = ROUTES.find((r) => r.id === "doluluk");
    expect(route.path).toBe("/doluluk");
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"], ["beds.release"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["users.manage"])).toBe(false);
    expect(canReach(route, ["devices.map_beds"])).toBe(false);
  });

  it("shows every bed of the caller's units with its state in words, and no UUID", async () => {
    await mountScreen(NURSE);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Çarpayı doluluğu"]);
    for (const [region, label, state] of [
      ["Reanimasiya · Otaq 1", "1", "Boş"], ["Reanimasiya · Otaq 1", "2", "Dolu"],
      ["Reanimasiya · Otaq 1", "3", "Təmizlikdədir"], ["Reanimasiya · Otaq 1", "4", "Bağlıdır"],
      ["Reanimasiya · Otaq 2", "5", "Boş"], ["Neonatal · N-1", "N1", "Bağlıdır"],
    ]) {
      expect(tile(region, label).getByText(state)).toBeTruthy();
    }
    expect(document.body.innerHTML).not.toMatch(UUID_TEXT);
  });

  it("heads each unit with occupied of usable and the counts that are not zero", async () => {
    await mountScreen(NURSE);
    const box = screen.getByRole("region", { name: "Reanimasiya · Otaq 1" }).closest("section").parentElement;
    expect(within(box).getByText("1 / 4 doludur")).toBeTruthy();
    expect(within(box).getByText("boş: 2")).toBeTruthy();
    expect(within(box).getByText("təmizlikdə: 1")).toBeTruthy();
    expect(within(box).queryByText(/rezervdə/)).toBeNull();
  });

  it("names the patient in an occupied bed by the short name only, and shows a reservation's note", async () => {
    await mountScreen(NURSE, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "RESERVED"; }));
      a.occupancy.mockResolvedValue(names([
        { bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null },
        { bed_id: BED(5), occupant_short: null, state_reason: null, state_note: "Sentetik planlı kabul" },
      ]));
    });
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 2", "5").getByText("Rezervdədir")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 2", "5").getByText("Sentetik planlı kabul")).toBeTruthy();
  });

  it("shows an out-of-service bed's reason, and how long a bed has been in its state", async () => {
    const since = new Date(Date.now() - 25 * 60_000).toISOString();
    await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => {
        rea(s).rooms[0].beds[0].state = "BLOCKED";
        rea(s).rooms[0].beds[2].state_since = since;
      }));
      a.occupancy.mockResolvedValue(names([{ bed_id: BED(1), occupant_short: null, state_reason: "FAULT", state_note: null }]));
    });
    expect(tile("Reanimasiya · Otaq 1", "1").getByText("İstifadədən kənar")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "1").getByText("Nasazlıq")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "3").getByText("25 dəq")).toBeTruthy();
    expect(screen.getByRole("button", { name: "İstifadəyə ver: 1 · Otaq 1 · Reanimasiya" })).toBeTruthy();
  });

  it("keeps the beds and drops every name when the names cannot be read", async () => {
    await mountScreen(NURSE, (a) => a.occupancy.mockRejectedValue(refusal(503, "Service unavailable")));
    expect(screen.getByText(/^Xəstə adları və qeydlər oxunmadı: /)).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Dolu")).toBeTruthy();
  });

  it("offers each move to its right only", async () => {
    await mountScreen(NURSE);
    expect(screen.getByRole("button", { name: "Bu çarpayıya xəstə qəbul et: 1 · Otaq 1 · Reanimasiya" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Rezerv et:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya" })).toBeTruthy();
  });

  it("reserves through the dialog and reads the beds and the names again", async () => {
    const { api } = await mountScreen(MANAGER, (a) => a.reserveBed.mockResolvedValue({ state: "RESERVED" }));
    const before = [api.structure.mock.calls.length, api.occupancy.mock.calls.length];
    await press("Rezerv et: 1 · Otaq 1 · Reanimasiya");
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(/^Qeyd/), { target: { value: "Sentetik planlı kabul" } });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rezerv et" })); });
    await settle();
    expect(api.reserveBed).toHaveBeenCalledWith(BED(1), { note: "Sentetik planlı kabul" });
    expect(api.structure.mock.calls.length).toBeGreaterThan(before[0]);
    expect(api.occupancy.mock.calls.length).toBeGreaterThan(before[1]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancels a reservation, releases a cleaned bed and returns one to service, each by its route", async () => {
    const { api } = await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => {
        rea(s).rooms[1].beds[0].state = "RESERVED";
        rea(s).rooms[0].beds[0].state = "MAINTENANCE";
      }));
      for (const call of ["unreserveBed", "releaseBed", "bedReturnToService"]) a[call].mockResolvedValue({});
    });
    await press("Rezervi ləğv et: 5 · Otaq 2 · Reanimasiya");
    await settle();
    await press("Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya");
    await settle();
    await press("İstifadəyə ver: 1 · Otaq 1 · Reanimasiya");
    await settle();
    expect(api.unreserveBed).toHaveBeenCalledWith(BED(5));
    expect(api.releaseBed).toHaveBeenCalledWith(BED(3));
    expect(api.bedReturnToService).toHaveBeenCalledWith(BED(1));
    // The toast renders twice (an sr-only live copy and the visible one), as StructureTab.test.jsx reads it.
    expect(toasts().getAllByText("5 · Otaq 2 · Reanimasiya · Rezerv ləğv edildi.").length).toBeGreaterThan(0);
  });

  it("says a refusal on the toast, named after the bed, and reads the beds again", async () => {
    const { api } = await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "RESERVED"; }));
      a.unreserveBed.mockRejectedValue(refusal(409, "Only a reserved bed can be unreserved (it is OCCUPIED).", { apiCode: "invalid_transition" }));
    });
    const reads = api.structure.mock.calls.length;
    await press("Rezervi ləğv et: 5 · Otaq 2 · Reanimasiya");
    await settle();
    expect(toasts().getByText(/^5 · Otaq 2 · Reanimasiya: /)).toBeTruthy();
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("puts the bed in the session's admission form and opens Kabul (X10)", async () => {
    const { store } = await mountScreen(NURSE);
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    const form = admitDraftOf(store).get().form;
    expect([form.bedId, form.bedLabel]).toEqual([BED(5), "5 · Otaq 2 · Reanimasiya"]);
    expect(window.location.hash).toBe("#/kabul");
  });

  it("leaves a form with a send waiting for an answer alone, and says so", async () => {
    const { store } = await mountScreen(NURSE);
    admitDraftOf(store).update({ unanswered: [{ bedId: BED(1), bed: "1 · Otaq 1 · Reanimasiya", name: "Sentetik Hasta", checked: false, requestId: "r-1" }] });
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    expect(admitDraftOf(store).get().form.bedId).not.toBe(BED(5));
    expect(toasts().getByText("Qəbul formasında cavab gözləyən göndəriş var; çarpayı seçimi dəyişdirilmədi.")).toBeTruthy();
    expect(window.location.hash).not.toBe("#/kabul");
  });

  it("chooses one unit or all of them", async () => {
    await mountScreen(DOCTOR);
    fireEvent.click(within(screen.getByRole("group", { name: "Şöbə" })).getByRole("button", { name: "Neonatal" }));
    expect(screen.queryByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeNull();
    expect(screen.getByRole("region", { name: "Neonatal · N-1" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Şöbə" })).getByRole("button", { name: "Hamısı" }));
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeTruthy();
  });
});
