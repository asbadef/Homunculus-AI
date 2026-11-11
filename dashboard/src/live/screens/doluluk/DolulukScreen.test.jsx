// The Doluluk screen (G2-B3a, spec §3, R1, X7, X10).
// - It shows the caller's beds by unit and room: state in words, for how long, and the counts.
// - The short name and the notes come from their own read; when that read fails, the beds stay
//   and the names go.
// - Each move is offered to the right that makes it. One move is out at a time, and every move is
//   followed by a re-read.
// - «Bu çarpayıya xəstə qəbul et» puts the bed in the session's admission form and opens Kabul.
// - Each move says its result on the screen as well as on the toast, and a move that takes its
//   button away leaves the focus on the bed's tile (A-22).
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { ROUTES, canReach } from "../../shell/routes.js";
import { STRUCTURE_PERMS, useStructure } from "../../data/StructureProvider.jsx";
import { admitDraftOf } from "../kabul/admitDraft.js";
import { BED, CHARGE, DOCTOR, NURSE, REA, UUID_TEXT, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";
import { DolulukScreen } from "./DolulukScreen.jsx";

const MANAGER = [...CHARGE, "beds.manage_state"];
const ward = (change) => { const s = structure(); change?.(s); return s; };
const rea = (s) => s.sites[0].units[0];
/** The bed `label` inside the room landmark `region`: its tile's <li>, and queries within it. */
const tileOf = (region, label) => within(screen.getByRole("region", { name: region })).getByText(label, { selector: "b" }).closest("li");
const tile = (region, label) => within(tileOf(region, label));
const button = (name) => screen.getByRole("button", { name });
const press = (name) => act(async () => { fireEvent.click(button(name)); });
const names = (beds) => ({ beds });
/** The screen's own line with the last move's result (§3), apart from the toast's copies. */
const resultLine = () => document.querySelector("p[role=status]:not(.sr-only)");
/** A request the test holds in flight, settled from outside. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
/** Let a held request's answer, and what it starts, land. */
const land = (fn) => act(async () => { fn(); await new Promise((r) => { setTimeout(r, 0); }); });
const ADMIT_1 = "Bu çarpayıya xəstə qəbul et: 1 · Otaq 1 · Reanimasiya";
const RELEASE_3 = "Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya";
const RELEASE_5 = "Təmizlik bitdi · boş: 5 · Otaq 2 · Reanimasiya";
const RESERVE_1 = "Rezerv et: 1 · Otaq 1 · Reanimasiya";

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

  // Final review M-3: the screen is built from the structure, so every right that opens it opens
  // the structure's read too — else it says «Çarpayılar oxunur…» for ever.
  it("shows the beds to a session holding only the right to confirm a discharge", async () => {
    const route = ROUTES.find((r) => r.id === "doluluk");
    expect(route.perms.filter((key) => !STRUCTURE_PERMS.includes(key))).toEqual([]);
    const { api } = await mountScreen(["admissions.discharge.confirm"]);
    expect(api.structure).toHaveBeenCalled();
    expect(screen.queryByText("Çarpayılar oxunur…")).toBeNull();
    expect(tile("Reanimasiya · Otaq 1", "1").getByText("Boş")).toBeTruthy();
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

  it("marks a free bed green and an occupied bed red — tag and tile edge — and other states as before (owner, 2026-11-10)", async () => {
    await mountScreen(NURSE);
    const tag = (region, label, state) => tile(region, label).getByText(state);
    expect(tag("Reanimasiya · Otaq 1", "1", "Boş")).toHaveAttribute("data-tone", "ok");
    expect(tag("Reanimasiya · Otaq 2", "5", "Boş")).toHaveAttribute("data-tone", "ok");
    expect(tag("Reanimasiya · Otaq 1", "2", "Dolu")).toHaveAttribute("data-tone", "crit");
    expect(tag("Reanimasiya · Otaq 1", "3", "Təmizlikdədir")).toHaveAttribute("data-tone", "warn");
    expect(tileOf("Reanimasiya · Otaq 1", "1")).toHaveClass("border-l-ok");
    expect(tileOf("Reanimasiya · Otaq 1", "2")).toHaveClass("border-l-crit");
    expect(tileOf("Reanimasiya · Otaq 1", "3")).not.toHaveClass("border-l-ok");
    expect(tileOf("Reanimasiya · Otaq 1", "3")).not.toHaveClass("border-l-crit");
    // A closed bed is never coloured as free, whatever its stored state.
    expect(tileOf("Neonatal · N-1", "N1")).not.toHaveClass("border-l-ok");
    const box = screen.getByRole("region", { name: "Reanimasiya · Otaq 1" }).closest("section").parentElement;
    expect(within(box).getByText("boş: 2")).toHaveAttribute("data-tone", "ok");
  });

  it("heads each unit with occupied of usable and the counts that are not zero", async () => {
    await mountScreen(NURSE);
    const box = screen.getByRole("region", { name: "Reanimasiya · Otaq 1" }).closest("section").parentElement;
    expect(within(box).getByText("1 / 4 doludur")).toBeTruthy();
    expect(within(box).getByText("boş: 2")).toBeTruthy();
    expect(within(box).getByText("təmizlikdə: 1")).toBeTruthy();
    expect(within(box).queryByText(/rezervdə/)).toBeNull();
  });

  it("heads each unit with its type beside its name, in words (§3)", async () => {
    await mountScreen(NURSE);
    const boxOf = (region) => screen.getByRole("region", { name: region }).closest("section").parentElement;
    expect(within(boxOf("Reanimasiya · Otaq 1")).getByText("Böyüklər reanimasiyası")).toBeTruthy();
    expect(within(boxOf("Neonatal · N-1")).getByText("Yenidoğulmuşlar reanimasiyası")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ADULT_ICU|NICU/);
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
    const { api } = await mountScreen(NURSE, (a) => {
      a.occupancy.mockResolvedValue(names([{ bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null }]));
      a.releaseBed.mockResolvedValue({});
    });
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    // A move's re-read of the names fails: the name read before goes with it, never left standing.
    api.occupancy.mockRejectedValue(refusal(503, "Service unavailable"));
    await press(RELEASE_3);
    await settle();
    expect(screen.getByText(/^Xəstə adları və qeydlər oxunmadı: /)).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Dolu")).toBeTruthy();
    expect(screen.queryByText("Əli M.")).toBeNull();
  });

  it("never lets an older, slower read of the names overwrite a newer one", async () => {
    const slow = deferred();
    const { api } = await mountScreen(NURSE, (a) => {
      a.occupancy.mockReturnValueOnce(slow.promise)
        .mockResolvedValue(names([{ bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null }]));
      a.releaseBed.mockResolvedValue({});
    });
    await press(RELEASE_3);                                                   // a newer read, answered at once
    await settle();
    expect(api.occupancy).toHaveBeenCalledTimes(2);
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    await land(() => slow.resolve(names([{ bed_id: BED(2), occupant_short: "Kaya A.", state_reason: null, state_note: null }])));
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    expect(screen.queryByText("Kaya A.")).toBeNull();
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
    expect(resultLine().textContent).toBe("1 · Otaq 1 · Reanimasiya · Rezerv edildi.");    // on the screen too (§3)
  });

  it("states each move's result on the screen as well as on the toast, and clears it when the next move starts (§3)", async () => {
    const release = deferred();
    await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "RESERVED"; }));
      a.unreserveBed.mockResolvedValue({});
      a.releaseBed.mockReturnValue(release.promise);
    });
    expect(resultLine()).toBeNull();
    await press("Rezervi ləğv et: 5 · Otaq 2 · Reanimasiya");
    await settle();
    const DONE = "5 · Otaq 2 · Reanimasiya · Rezerv ləğv edildi.";
    expect(resultLine().textContent).toBe(DONE);
    expect(toasts().getAllByText(DONE).length).toBeGreaterThan(0);

    await press(RELEASE_3);                                                   // the next move: the last result goes
    expect(resultLine()).toBeNull();
    await land(() => release.reject(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" })));
    await settle();
    const REFUSED = "3 · Otaq 1 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.";
    expect(resultLine().textContent).toBe(REFUSED);
    expect(toasts().getAllByText(REFUSED).length).toBeGreaterThan(0);
  });

  it("takes the focus to the bed's tile after a dialog's move, once the beds are read again — not to <body> (A-22)", async () => {
    const { api } = await mountScreen(MANAGER, (a) => a.reserveBed.mockResolvedValue({ state: "RESERVED" }));
    api.structure.mockResolvedValue(ward((s) => { rea(s).rooms[0].beds[0].state = "RESERVED"; }));
    button(RESERVE_1).focus();                                                // a keyboard user's press
    await press(RESERVE_1);
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rezerv et" })); });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: RESERVE_1 })).toBeNull();    // the bed is reserved now
    expect(document.activeElement).toBe(tileOf("Reanimasiya · Otaq 1", "1"));
    expect(tileOf("Reanimasiya · Otaq 1", "1")).toHaveTextContent("Rezervdədir");
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

  // Review I-1: after an admission the draft holds its number box, and the form under it is the
  // next patient's. The bed goes into a fresh form and the box closes: left open, Kabul showed the
  // old number, and its «Yeni qəbul» emptied the bed again.
  it("after a finished admission, opens Kabul on a fresh form with this bed, not on the old number box (I-1)", async () => {
    const { store } = await mountScreen(NURSE);
    const draft = admitDraftOf(store);
    draft.update({ done: { number: "H2600042", bed: "1 · Otaq 1 · Reanimasiya", engine: null } });
    const spent = draft.get().requestId;
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    const now = draft.get();
    expect(now.done).toBeNull();
    expect([now.form.unitId, now.form.bedId, now.form.bedLabel]).toEqual([REA, BED(5), "5 · Otaq 2 · Reanimasiya"]);
    expect(now.form.name).toBe("");
    expect(now.requestId).not.toBe(spent);
    expect(window.location.hash).toBe("#/kabul");
  });

  it("keeps an earlier patient's box open for her to read, and puts the bed in the form it keeps", async () => {
    const { store } = await mountScreen(NURSE);
    const draft = admitDraftOf(store);
    draft.update({ form: { ...draft.get().form, name: "Kaya Ayşe" },
      done: { number: "H2600042", bed: "1 · Otaq 1 · Reanimasiya", engine: null, recovered: true, earlier: "Sentetik Hasta" } });
    await press("Bu çarpayıya xəstə qəbul et: 5 · Otaq 2 · Reanimasiya");
    const now = draft.get();
    expect(now.done).toMatchObject({ earlier: "Sentetik Hasta" });
    expect([now.form.name, now.form.bedId]).toEqual(["Kaya Ayşe", BED(5)]);
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

  // Ported from the Yataklar tab (BedsTab.test.jsx, deleted in c3965ed5), for what still applies.
  it("holds every other bed's buttons while a move is out, and the reason names the bed being worked on (A-17)", async () => {
    const release = deferred();
    const { api } = await mountScreen(NURSE, (a) => {
      a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds[0].state = "HOUSEKEEPING"; }));
      a.releaseBed.mockReturnValue(release.promise);
    });
    expect(button(RELEASE_5).getAttribute("aria-disabled")).toBeNull();

    await press(RELEASE_3);
    expect(button(RELEASE_3).getAttribute("aria-busy")).toBe("true");
    for (const name of [RELEASE_5, ADMIT_1]) {
      expect(button(name).getAttribute("aria-disabled"), name).toBe("true");
      expect(button(name).getAttribute("aria-busy"), name).toBeNull();
      // Which bed: "a move is out" alone does not tell her that her press waits on bed 3.
      expect(document.getElementById(button(name).getAttribute("aria-describedby")).textContent)
        .toBe("Əməliyyat gedir: 3 · Otaq 1 · Reanimasiya");
    }
    await press(RELEASE_5);                                                   // held: nothing goes out
    expect(api.releaseBed).toHaveBeenCalledTimes(1);

    await land(() => release.resolve({}));
    await settle();
    expect(button(RELEASE_5).getAttribute("aria-disabled")).toBeNull();
    expect(button(RELEASE_5).getAttribute("aria-describedby")).toBeNull();
  });

  it("keeps a move held until the beds are read again, so a second press cannot repeat it", async () => {
    const release = deferred();
    const reread = deferred();
    const { api } = await mountScreen(NURSE, (a) => a.releaseBed.mockReturnValue(release.promise));
    const reads = api.structure.mock.calls.length;
    api.structure.mockReturnValueOnce(reread.promise);                        // the read that follows the move
    await press(RELEASE_3);
    await press(RELEASE_3);
    expect(api.releaseBed).toHaveBeenCalledTimes(1);

    // The server has answered, the beds have not been read: the tile still shows the bed in cleaning.
    await land(() => release.resolve({}));
    expect(api.structure.mock.calls.length).toBe(reads + 1);
    expect(button(RELEASE_3).getAttribute("aria-busy")).toBe("true");
    await press(RELEASE_3);
    expect(api.releaseBed).toHaveBeenCalledTimes(1);

    // The beds arrive with bed 3 free: nothing left to release.
    await land(() => reread.resolve(ward((s) => { rea(s).rooms[0].beds[2].state = "AVAILABLE"; })));
    expect(screen.queryByRole("button", { name: RELEASE_3 })).toBeNull();
    expect(api.releaseBed).toHaveBeenCalledTimes(1);
  });

  it("takes the focus its button had to the bed's tile, which now says what it is — not to <body> (A-22)", async () => {
    const { api } = await mountScreen(NURSE, (a) => a.releaseBed.mockResolvedValue({}));
    api.structure.mockResolvedValue(ward((s) => { rea(s).rooms[0].beds[2].state = "AVAILABLE"; }));
    button(RELEASE_3).focus();                                                // a keyboard user's press
    await press(RELEASE_3);
    await settle();
    expect(screen.queryByRole("button", { name: RELEASE_3 })).toBeNull();
    expect(document.activeElement).toBe(tileOf("Reanimasiya · Otaq 1", "3"));
    expect(tileOf("Reanimasiya · Otaq 1", "3")).toHaveTextContent("Boş");
  });

  it("leaves the focus on the button when the move was refused and the button is still there", async () => {
    await mountScreen(NURSE, (a) => a.releaseBed.mockRejectedValue(
      refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" })));
    button(RELEASE_3).focus();
    await press(RELEASE_3);
    await settle();
    expect(document.activeElement).toBe(button(RELEASE_3));
  });

  it("says the beds are being read, as a status, while the first read is out", async () => {
    await mountScreen(NURSE, (a) => a.structure.mockReturnValue(new Promise(() => {})));
    expect(screen.getByText("Çarpayılar oxunur…").getAttribute("role")).toBe("status");
  });

  it("offers a retry when the beds could not be read, and shows them once it reads", async () => {
    const { api } = await mountScreen(NURSE, (a) => a.structure.mockRejectedValue(refusal(500, "boom")));
    expect(screen.getByText(/^Çarpayılar oxunmadı: /)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeNull();
    api.structure.mockResolvedValue(structure());
    const reads = api.structure.mock.calls.length;
    await press("Yenidən cəhd et");
    await settle();
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yenidən cəhd et" })).toBeNull();
  });
});

// Final review M-2: the structure and the names are two reads. The structure is also read again on
// its own (StructureProvider: a retry, a unit added, another screen's write), so a tile may show a
// newer state before the names have caught up.
describe("DolulukScreen · what the names read says, by the state shown (M-2)", () => {
  /** A re-read of the structure that no move of this screen asked for. */
  function Reread() {
    const { reload } = useStructure();
    return <button type="button" onClick={() => reload()}>reread</button>;
  }

  it("takes the name off a bed the structure, read again on its own, shows its patient has left", async () => {
    const { api } = await mountKabul(<><DolulukScreen /><Reread /></>, { perms: NURSE, setup: (a) => {
      a.occupancy.mockResolvedValue(names([{ bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null }]));
    } });
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Əli M.")).toBeTruthy();
    api.structure.mockResolvedValue(ward((s) => { rea(s).rooms[0].beds[1].state = "HOUSEKEEPING"; }));
    await press("reread");
    await settle();
    expect(tile("Reanimasiya · Otaq 1", "2").getByText("Təmizlikdədir")).toBeTruthy();
    expect(screen.queryByText("Əli M.")).toBeNull();
  });

  it("shows a name only on a bed a patient is in, a note only reserved or out of service, a reason only out of service", async () => {
    await mountScreen(MANAGER, (a) => {
      a.structure.mockResolvedValue(ward((s) => {
        rea(s).rooms[0].beds[0].state = "AVAILABLE";                       // bed 1: back in service
        rea(s).rooms[0].beds[1].state = "AVAILABLE";                       // bed 2: its patient has left
        rea(s).rooms[0].beds[2].state = "PENDING_DISCHARGE";               // bed 3: a patient on her way out
        rea(s).rooms[1].beds[0].state = "RESERVED";                        // bed 5: reserved
      }));
      a.occupancy.mockResolvedValue(names([
        { bed_id: BED(1), occupant_short: null, state_reason: "FAULT", state_note: "Sentetik arıza" },
        { bed_id: BED(2), occupant_short: "Əli M.", state_reason: null, state_note: null },
        { bed_id: BED(3), occupant_short: "Ayşe K.", state_reason: null, state_note: null },
        { bed_id: BED(5), occupant_short: null, state_reason: "FAULT", state_note: "Sentetik planlı kabul" },
      ]));
    });
    expect(screen.queryByText("Əli M.")).toBeNull();
    expect(screen.queryByText("Sentetik arıza")).toBeNull();
    expect(screen.queryByText("Nasazlıq")).toBeNull();                      // nor on the reserved bed 5
    expect(tile("Reanimasiya · Otaq 1", "3").getByText("Ayşe K.")).toBeTruthy();
    expect(tile("Reanimasiya · Otaq 2", "5").getByText("Sentetik planlı kabul")).toBeTruthy();
  });
});

describe("DolulukScreen · read again while it is seen (M-2)", () => {
  const REREAD_MS = 60_000;                                                  // DischargeTab's minute
  const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const reads = (api) => [api.structure.mock.calls.length, api.occupancy.mock.calls.length];
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("reads the beds and the names again every minute", async () => {
    vi.useFakeTimers();
    const { api } = await mountScreen(NURSE);
    const [beds, notes] = reads(api);
    await tick(REREAD_MS - 1);
    expect(reads(api)).toEqual([beds, notes]);
    await tick(1);
    expect(reads(api)).toEqual([beds + 1, notes + 1]);
    await tick(REREAD_MS);
    expect(reads(api)).toEqual([beds + 2, notes + 2]);
  });

  it("reads nothing while the page is hidden, and reads at once when it is seen again", async () => {
    vi.useFakeTimers();
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const { api } = await mountScreen(NURSE);
    const [beds, notes] = reads(api);
    state.mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(5 * REREAD_MS);
    expect(reads(api)).toEqual([beds, notes]);
    state.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(reads(api)).toEqual([beds + 1, notes + 1]);
    await tick(REREAD_MS);
    expect(reads(api)).toEqual([beds + 2, notes + 2]);
  });
});
