// The Yataklar tab (Group 2 · B1a, spec §3.4, §5.4): the caller's beds by unit and room with their
// state, and "Temizlik bitti · boş" on a bed in cleaning — for a holder of `beds.release` only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { ANNOUNCE_DELAY_MS } from "../../ui/index.js";
import { BedsTab } from "./BedsTab.jsx";
import { BED, DOCTOR, NURSE, UUID_TEXT, mountKabul, settle, structure, toasts } from "./kabul.testutil.js";

// Each release button is named after its bed, so a screen reader's list of buttons tells them apart.
const RELEASE_3 = "Təmizlik bitdi · boş: 3 · Otaq 1 · Reanimasiya";
const RELEASE_5 = "Təmizlik bitdi · boş: 5 · Otaq 2 · Reanimasiya";
const releaseButtons = () => screen.queryAllByRole("button", { name: /Təmizlik bitdi/ });
const press = (name) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

/** The synthetic ward with `change` applied to a fresh copy; `rea`/`neo` are its two units. */
const ward = (change) => { const s = structure(); change(s); return s; };
const rea = (s) => s.sites[0].units[0];
const neo = (s) => s.sites[0].units[1];
const twoCleaning = () => ward((s) => { rea(s).rooms[1].beds[0].state = "HOUSEKEEPING"; });

/** A promise settled from outside, for a request the test holds in flight. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/** The bed `label` inside the room landmark `region`, as its row. */
const bedIn = (region, label) => within(within(screen.getByRole("region", { name: region })).getByText(label).closest("li"));

describe("BedsTab", () => {
  it("shows every bed of the caller's units with its state, by name", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    for (const [region, label, state] of [
      ["Reanimasiya · Otaq 1", "1", "Boş"], ["Reanimasiya · Otaq 1", "2", "Dolu"],
      ["Reanimasiya · Otaq 1", "3", "Təmizlikdədir"], ["Reanimasiya · Otaq 1", "4", "Bağlıdır"],
      ["Reanimasiya · Otaq 2", "5", "Boş"], ["Neonatal · N-1", "N1", "Boş"],
    ]) {
      expect(bedIn(region, label).getByText(state)).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: /Neonatal · bağlıdır/ })).toBeTruthy();
    // No UUID anywhere in the page, its attributes (aria-label, ids) included.
    expect(document.body.innerHTML).not.toMatch(UUID_TEXT);
  });

  it("names a room landmark by its unit as well, so two units' rooms of one name stay apart", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.structure.mockResolvedValue(ward((s) => { neo(s).rooms[0].name = "Otaq 1"; })) });
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Neonatal · Otaq 1" })).toBeTruthy();
  });

  it("gives an ordinary occupied bed the neutral tone, and a bed that waits the warning one", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[0].beds[0].state = "PENDING_DISCHARGE"; })) });
    const tone = (region, label, state) => bedIn(region, label).getByText(state).closest("[data-tone]").getAttribute("data-tone");
    expect(tone("Reanimasiya · Otaq 1", "2", "Dolu")).toBe("neutral");
    expect(tone("Reanimasiya · Otaq 1", "3", "Təmizlikdədir")).toBe("warn");
    expect(tone("Reanimasiya · Otaq 1", "1", "Evə yazılma gözləyir")).toBe("warn");
  });

  it("offers the release on the cleaning bed alone, named after its bed", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    expect(releaseButtons().map((button) => button.getAttribute("aria-label"))).toEqual([RELEASE_3]);
    expect(screen.getByRole("button", { name: RELEASE_3 })).toBeTruthy();
  });

  it("names every release button by its own bed when several beds are in cleaning", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE, setup: (a) => a.structure.mockResolvedValue(twoCleaning()) });
    expect(releaseButtons().map((button) => button.getAttribute("aria-label"))).toEqual([RELEASE_3, RELEASE_5]);
  });

  it("offers a physician, who holds no beds.release, none", async () => {
    await mountKabul(<BedsTab />, { perms: DOCTOR });
    expect(screen.getByText("Təmizlikdədir")).toBeTruthy();
    expect(releaseButtons()).toHaveLength(0);
  });

  it.each([
    ["a closed bed", "4", (s) => { rea(s).rooms[0].beds[3].state = "HOUSEKEEPING"; }],
    ["a bed in a closed room", "5", (s) => { rea(s).rooms[1].is_active = false; rea(s).rooms[1].beds[0].state = "HOUSEKEEPING"; }],
    ["a bed in a closed unit", "N1", (s) => { neo(s).rooms[0].beds[0].state = "HOUSEKEEPING"; }],
  ])("offers no release on %s", async (_what, label, change) => {
    await mountKabul(<BedsTab />, { perms: NURSE, setup: (a) => a.structure.mockResolvedValue(ward(change)) });
    expect(screen.getByText(label)).toBeTruthy();
    expect(releaseButtons().map((button) => button.getAttribute("aria-label"))).toEqual([RELEASE_3]);
  });

  it("releases the bed, says so named after it, and reads the beds again", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockResolvedValue({ id: BED(3), state: "AVAILABLE" }) });
    const reads = api.structure.mock.calls.length;
    await press(RELEASE_3);
    await settle();
    expect(api.releaseBed).toHaveBeenCalledWith(BED(3));
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya · çarpayı boşdur").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("keeps the release held until the beds are read again, so a second press cannot repeat it", async () => {
    const release = deferred();
    const reread = deferred();
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE, setup: (a) => a.releaseBed.mockReturnValue(release.promise) });
    const reads = api.structure.mock.calls.length;
    api.structure.mockReturnValueOnce(reread.promise); // the read that follows the release
    await press(RELEASE_3);
    await press(RELEASE_3);
    expect(api.releaseBed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: RELEASE_3 }).getAttribute("aria-busy")).toBe("true");

    // The server has answered, the list has not: the card still shows the bed in cleaning.
    await act(async () => { release.resolve({ id: BED(3), state: "AVAILABLE" }); await new Promise((r) => setTimeout(r, 0)); });
    expect(api.structure.mock.calls.length).toBe(reads + 1);
    expect(screen.getByRole("button", { name: RELEASE_3 }).getAttribute("aria-busy")).toBe("true");
    await press(RELEASE_3);
    expect(api.releaseBed).toHaveBeenCalledTimes(1);

    // The list arrives with the bed free: nothing left to release.
    await act(async () => { reread.resolve(ward((s) => { rea(s).rooms[0].beds[2].state = "AVAILABLE"; })); await new Promise((r) => setTimeout(r, 0)); });
    expect(releaseButtons()).toHaveLength(0);
    expect(api.releaseBed).toHaveBeenCalledTimes(1);
  });

  it("says a release is under way, and holds the other beds' buttons with that reason", async () => {
    const release = deferred();
    await mountKabul(<BedsTab />, { perms: NURSE, setup: (a) => {
      a.structure.mockResolvedValue(twoCleaning());
      a.releaseBed.mockReturnValue(release.promise);
    } });
    const other = () => screen.getByRole("button", { name: RELEASE_5 });
    expect(other().getAttribute("aria-disabled")).toBeNull();

    await press(RELEASE_3);
    expect(screen.getByRole("button", { name: RELEASE_3 }).getAttribute("aria-busy")).toBe("true");
    expect(other().getAttribute("aria-disabled")).toBe("true");
    expect(other().getAttribute("aria-busy")).toBeNull();
    expect(document.getElementById(other().getAttribute("aria-describedby")).textContent).toBe("Çarpayı boşaldılır…");
    await wait(ANNOUNCE_DELAY_MS + 50);
    expect(screen.getAllByRole("status").some((region) => region.textContent === "Çarpayı boşaldılır…")).toBe(true);

    await act(async () => { release.resolve({ id: BED(3), state: "AVAILABLE" }); await new Promise((r) => setTimeout(r, 0)); });
    expect(other().getAttribute("aria-disabled")).toBeNull();
    expect(other().getAttribute("aria-describedby")).toBeNull();
  });

  it("puts a refusal on the toast by its code, and reads the beds again", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockRejectedValue(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" })) });
    const reads = api.structure.mock.calls.length;
    await press(RELEASE_3);
    await settle();
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says an uncoded 404 by its status in the reader's words, never the server's English (A-9)", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockRejectedValue(refusal(404, "Bed not found.")) });
    const reads = api.structure.mock.calls.length;
    await press(RELEASE_3);
    await settle();
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says the beds are being read, as a status, while the first read is out", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE, setup: (a) => a.structure.mockReturnValue(new Promise(() => {})) });
    expect(screen.getByText("Yüklənir…").getAttribute("role")).toBe("status");
  });

  it("offers a retry when the beds could not be read, and shows them once it reads", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.structure.mockRejectedValue(refusal(500, "boom")) });
    expect(screen.queryByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeNull();
    api.structure.mockResolvedValue(structure());
    const reads = api.structure.mock.calls.length;
    await press("Yenidən cəhd et");
    await settle();
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yenidən cəhd et" })).toBeNull();
  });

  it("says so, in a short line, for a unit with no rooms and a room with no beds", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.structure.mockResolvedValue(ward((s) => { rea(s).rooms[1].beds = []; neo(s).rooms = []; })) });
    expect(screen.getByText("Bu otaqda təyin olunmuş çarpayı yoxdur.")).toBeTruthy();
    expect(screen.getByText("Bu şöbədə təyin olunmuş otaq yoxdur.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Reanimasiya · Otaq 2" }).querySelector("ul")).toBeNull();
  });
});
