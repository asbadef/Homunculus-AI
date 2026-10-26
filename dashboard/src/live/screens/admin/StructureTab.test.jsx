// Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6): the administrator adds sites, units, rooms
// and beds under their parents, renames, closes and reopens them — nothing is deleted — and a
// refusal (an occupied bed, a room with an open bed) goes on the toast named after its subject.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { StructureTab } from "./StructureTab.jsx";
import { ADMIN, BED, REA, ROOM1, ROOM2, SITE, T, UUID_TEXT, mountKabul, settle, toasts } from "../kabul/kabul.testutil.js";

const submitIn = async (label, text) => {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.submit(input.closest("form")); });
  await settle();
};

describe("StructureTab", () => {
  it("shows the tree by name, a closed place marked, and no UUID", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    expect(screen.getByRole("heading", { name: "Ana bina" })).toBeTruthy();
    for (const name of ["Reanimasiya", "Neonatal", "Otaq 1", "Otaq 2"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText("Bağlıdır").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("adds a site, a unit of the chosen type, a room and a bed under their parents", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    await submitIn("Yeni binanın adı", "Yeni korpus");
    expect(api.createSite).toHaveBeenCalledWith(T, { name: "Yeni korpus" });
    fireEvent.change(screen.getByRole("combobox", { name: "Şöbənin növü" }), { target: { value: "NICU" } });
    await submitIn("Ana bina daxilində yeni şöbənin adı", "Neonatal 2");
    expect(api.createUnit).toHaveBeenCalledWith(SITE, { name: "Neonatal 2", unit_type: "NICU" });
    await submitIn("Reanimasiya daxilində yeni otağın adı", "Otaq 3");
    expect(api.createRoom).toHaveBeenCalledWith(REA, { name: "Otaq 3" });
    await submitIn("Otaq 1 daxilində yeni çarpayının etiketi", "6");
    expect(api.createBed).toHaveBeenCalledWith(ROOM1, { label: "6" });
    expect(toasts().getAllByText("6 · əlavə edildi").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(4);         // read again after each
  });

  it("renames a bed from its own line", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const bedOne = screen.getAllByText("1").find((el) => el.tagName === "B").closest("li");
    fireEvent.click(within(bedOne).getByRole("button", { name: "Adını dəyiş" }));
    await submitIn("1 üçün yeni ad", "1A");
    expect(api.patchBed).toHaveBeenCalledWith(BED(1), { label: "1A" });
  });

  it("closes an open bed and reopens a closed one", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const line = (label) => screen.getAllByText(label).find((el) => el.tagName === "B").closest("li");
    await act(async () => { fireEvent.click(within(line("5")).getByRole("button", { name: "Bağla" })); });
    await settle();
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { is_active: false });
    await act(async () => { fireEvent.click(within(line("4")).getByRole("button", { name: "Yenidən aç" })); });
    await settle();
    expect(api.patchBed).toHaveBeenCalledWith(BED(4), { is_active: true });
  });

  it("puts the server's refusal on the toast, named after what it was about", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.patchRoom.mockRejectedValue(refusal(409, "Close every bed of this room first.", { apiCode: "has_open_beds" })) });
    const room = screen.getAllByText("Otaq 2").find((el) => el.tagName === "B").closest("li");
    await act(async () => { fireEvent.click(within(room).getAllByRole("button", { name: "Bağla" })[0]); });
    await settle();
    expect(toasts().getAllByText("Otaq 2: Əvvəlcə altındakı bütün çarpayıları bağlayın.").length).toBeGreaterThan(0);
  });

  // Amendment A-5: a bed's label is unique within its unit, any room, closed beds included — the
  // server refuses `bed_label_taken`, and the tab says so by the code, never by the server's words.
  it("says a unit already has a bed with that label, for a new bed and for a renamed one", async () => {
    const taken = () => refusal(409, "Bed label already used in this unit.", { apiCode: "bed_label_taken" });
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => { a.createBed.mockRejectedValue(taken()); a.patchBed.mockRejectedValue(taken()); } });
    await submitIn("Otaq 2 daxilində yeni çarpayının etiketi", "1");
    expect(api.createBed).toHaveBeenCalledWith(ROOM2, { label: "1" });
    expect(toasts().getAllByText("1: Bu şöbədə eyni etiketli çarpayı artıq var.").length).toBeGreaterThan(0);
    const bedFive = screen.getAllByText("5").find((el) => el.tagName === "B").closest("li");
    fireEvent.click(within(bedFive).getByRole("button", { name: "Adını dəyiş" }));
    await submitIn("5 üçün yeni ad", "2");
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { label: "2" });
    expect(toasts().getAllByText("5: Bu şöbədə eyni etiketli çarpayı artıq var.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Bed label already used");
  });

  // Amendment A-9: a 404 the server did not code (a place gone from under the screen: "Room not
  // found", tenant/router.py) is said by its status in the reader's language, never in English.
  it("says an uncoded 404 by its status in the reader's language, never in the server's English", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.createBed.mockRejectedValue(refusal(404, "Room not found")) });
    await submitIn("Otaq 1 daxilində yeni çarpayının etiketi", "7");
    expect(toasts().getAllByText("7: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Room not found");
  });
});
