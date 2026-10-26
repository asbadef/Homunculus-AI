// The Yataklar tab (Group 2 · B1a, spec §3.4, §5.4): the caller's beds by unit and room with their
// state, and "Temizlik bitti · boş" on a bed in cleaning — for a holder of `beds.release` only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { BedsTab } from "./BedsTab.jsx";
import { BED, DOCTOR, NURSE, UUID_TEXT, mountKabul, settle, toasts } from "./kabul.testutil.js";

describe("BedsTab", () => {
  it("shows every bed of the caller's units with its state, by name", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    const room = within(screen.getByRole("region", { name: "Otaq 1" }));
    for (const [label, state] of [["1", "Boş"], ["2", "Dolu"], ["3", "Təmizlikdədir"], ["4", "Bağlıdır"]]) {
      expect(within(room.getByText(label).closest("li")).getByText(state)).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: /Neonatal · bağlıdır/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("offers the release on the cleaning bed alone", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    expect(screen.getAllByRole("button", { name: "Təmizlik bitdi · boş" })).toHaveLength(1);
  });

  it("offers a physician, who holds no beds.release, none", async () => {
    await mountKabul(<BedsTab />, { perms: DOCTOR });
    expect(screen.getByText("Təmizlikdədir")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Təmizlik bitdi · boş" })).toBeNull();
  });

  it("releases the bed, says so named after it, and reads the beds again", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockResolvedValue({ id: BED(3), state: "AVAILABLE" }) });
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Təmizlik bitdi · boş" })); });
    await settle();
    expect(api.releaseBed).toHaveBeenCalledWith(BED(3));
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya · çarpayı boşdur").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("puts a refusal on the toast by its code", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockRejectedValue(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Təmizlik bitdi · boş" })); });
    await settle();
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length).toBeGreaterThan(0);
  });

  it("says an uncoded 404 by its status in the reader's words, never the server's English (A-9)", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockRejectedValue(refusal(404, "Bed not found.")) });
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Təmizlik bitdi · boş" })); });
    await settle();
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/not found/i);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });
});
