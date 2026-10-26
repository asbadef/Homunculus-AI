// Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6): the administrator adds sites, units of a
// type, rooms with their number and isolation, and beds under their parents, renames, closes and
// reopens them — nothing is deleted — and a refusal (an occupied bed, a room with an open bed) goes
// on the toast named after its subject: a room as "room · unit", a bed as "label · room · unit" (a
// unit with its site's name too when there is more than one site). Every control names what it
// acts on, no two alike, one write is out at a time, and nothing held is a silent no-op.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { StructureTab } from "./StructureTab.jsx";
import { ADMIN, BED, REA, ROOM1, ROOM2, SITE, T, UUID_TEXT, mountKabul, settle, structure, toasts } from "../kabul/kabul.testutil.js";

const SITE2 = "22222222-2222-4222-8222-222222222299";
const UNIT9 = "33333333-3333-4333-8333-333333333309";
const ROOM9 = "44444444-4444-4444-8444-444444444409";

const submitIn = async (label, text) => {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.submit(input.closest("form")); });
  await settle();
};
const button = (name) => screen.getByRole("button", { name });
const press = async (name) => {
  await act(async () => { fireEvent.click(button(name)); });
  await settle();
};
/** A unit's, a room's or a bed's own line, by the name it shows. */
const line = (name) => screen.getAllByText(name).find((el) => el.tagName === "B").closest("li");
/** The sentence an element's aria-describedby points at. */
const describedBy = (el) => document.getElementById(el.getAttribute("aria-describedby"));
/** The accessible names of the tab's controls of one role — each of them, and all different. */
const namesOf = (role) => {
  const tab = screen.getByText(/^Bina, şöbə, otaq və çarpayıları buradan qurun/).parentElement;
  const names = within(tab).getAllByRole(role).map((el) => el.getAttribute("aria-label"));
  expect(names.every((name) => typeof name === "string" && name.length > 0)).toBe(true);
  expect(new Set(names).size).toBe(names.length);
  return names;
};

describe("StructureTab", () => {
  it("shows the tree by name, a closed place marked, and no UUID — in its text or its labels", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    expect(screen.getByRole("heading", { name: "Ana bina" })).toBeTruthy();
    for (const name of ["Reanimasiya", "Neonatal", "Otaq 1", "Otaq 2"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText("Bağlıdır").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    const labelled = [...document.querySelectorAll("[aria-label], [title], [placeholder]")];
    expect(labelled.length).toBeGreaterThan(10);
    for (const el of labelled) {
      for (const attr of ["aria-label", "title", "placeholder"]) expect(el.getAttribute(attr) ?? "").not.toMatch(UUID_TEXT);
    }
  });

  it("says it is loading, as a status", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockReturnValue(new Promise(() => {})) });
    expect(screen.getByText("Yüklənir…").getAttribute("role")).toBe("status");
  });

  it("says the first read failed, and offers to read again", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.structure.mockRejectedValueOnce(refusal(503, "Service Unavailable")) });
    expect(screen.queryByRole("heading", { name: "Ana bina" })).toBeNull();
    await press("Yenidən cəhd et");
    expect(api.structure).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Ana bina" })).toBeTruthy();
  });

  it("shows each unit's type, and each room's number and whether it isolates", async () => {
    const tree = structure();
    Object.assign(tree.sites[0].units[0].rooms[1], { room_number: "12", is_isolation: true });
    await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockResolvedValue(tree) });
    expect(within(line("Reanimasiya")).getByText("Böyüklər reanimasiyası")).toBeTruthy();
    expect(within(line("Neonatal")).getByText("Yenidoğulmuşlar reanimasiyası")).toBeTruthy();
    expect(within(line("Otaq 2")).getByText("Otaq nömrəsi: 12")).toBeTruthy();
    expect(within(line("Otaq 2")).getByText("İzolyasiya otağı")).toBeTruthy();
    expect(within(line("Otaq 1")).queryByText(/Otaq nömrəsi|İzolyasiya/)).toBeNull();
  });

  it("adds a site, a unit of the chosen type, a room with its number and isolation, and a bed under their parents", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    await submitIn("Yeni binanın adı", "Yeni korpus");
    expect(api.createSite).toHaveBeenCalledWith(T, { name: "Yeni korpus" });
    fireEvent.change(screen.getByRole("combobox", { name: "Şöbənin növü: Ana bina" }), { target: { value: "NICU" } });
    await submitIn("Ana bina daxilində yeni şöbənin adı", "Neonatal 2");
    expect(api.createUnit).toHaveBeenCalledWith(SITE, { name: "Neonatal 2", unit_type: "NICU" });
    const number = screen.getByRole("textbox", { name: "Reanimasiya daxilində yeni otağın nömrəsi (məcburi deyil)" });
    const isolation = screen.getByRole("checkbox", { name: "Reanimasiya daxilində yeni otaq izolyasiya otağıdır" });
    fireEvent.change(number, { target: { value: " 12 " } });
    fireEvent.click(isolation);
    await submitIn("Reanimasiya daxilində yeni otağın adı", "Otaq 3");
    expect(api.createRoom).toHaveBeenCalledWith(REA, { name: "Otaq 3", room_number: "12", is_isolation: true });
    expect(toasts().getAllByText("Otaq 3 · Reanimasiya · əlavə edildi").length).toBeGreaterThan(0);
    expect(number.value).toBe("");
    expect(isolation.checked).toBe(false);
    await submitIn("Reanimasiya daxilində yeni otağın adı", "Otaq 4");
    expect(api.createRoom).toHaveBeenLastCalledWith(REA, { name: "Otaq 4", room_number: null, is_isolation: false });
    await submitIn("Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi", "6");
    expect(api.createBed).toHaveBeenCalledWith(ROOM1, { label: "6" });
    expect(toasts().getAllByText("6 · Otaq 1 · Reanimasiya · əlavə edildi").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(5);         // read again after each
  });

  it("holds a room's isolation box while that room's add is out, and says why", async () => {
    let land;
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.createRoom.mockReturnValue(new Promise((resolve) => { land = resolve; })) });
    const isolation = screen.getByRole("checkbox", { name: "Reanimasiya daxilində yeni otaq izolyasiya otağıdır" });
    fireEvent.click(isolation);
    await submitIn("Reanimasiya daxilində yeni otağın adı", "Otaq 3");
    expect(api.createRoom).toHaveBeenCalledWith(REA, { name: "Otaq 3", room_number: null, is_isolation: true });
    expect(isolation.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(isolation).textContent).toBe("Otaq 3 · Reanimasiya · yadda saxlanılır…");
    fireEvent.click(isolation);
    expect(isolation.checked).toBe(true);
    await act(async () => { land(); });
    await settle();
    expect(isolation.getAttribute("aria-disabled")).toBeNull();
    expect(isolation.checked).toBe(false);                               // the add landed: a fresh form
  });

  it("keeps each site's unit type to itself", async () => {
    const tree = structure();
    tree.sites.push({ id: SITE2, name: "Yeni korpus", is_active: true, units: [] });
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockResolvedValue(tree) });
    fireEvent.change(screen.getByRole("combobox", { name: "Şöbənin növü: Ana bina" }), { target: { value: "NICU" } });
    expect(screen.getByRole("combobox", { name: "Şöbənin növü: Yeni korpus" }).value).toBe("ADULT_ICU");
    await submitIn("Yeni korpus daxilində yeni şöbənin adı", "Reanimasiya 2");
    expect(api.createUnit).toHaveBeenCalledWith(SITE2, { name: "Reanimasiya 2", unit_type: "ADULT_ICU" });
  });

  it("names every control by what it acts on — a room with its unit, a bed as label · room · unit — so no two read alike", async () => {
    const tree = structure();
    tree.sites[0].units[1].rooms[0].name = "Otaq 1";                    // Neonatal has an "Otaq 1" too
    await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockResolvedValue(tree) });
    const buttons = namesOf("button");
    const boxes = namesOf("textbox");
    expect(buttons.every((name) => name.includes(": "))).toBe(true);
    for (const name of ["Bina əlavə et: Sentetik Hastane", "Şöbə əlavə et: Ana bina", "Otaq əlavə et: Reanimasiya",
      "Adını dəyiş: Reanimasiya", "Yenidən aç: Neonatal",
      "Adını dəyiş: Otaq 1 · Reanimasiya", "Adını dəyiş: Otaq 1 · Neonatal", "Bağla: Otaq 2 · Reanimasiya",
      "Çarpayı əlavə et: Otaq 1 · Reanimasiya", "Çarpayı əlavə et: Otaq 1 · Neonatal",
      "Bağla: 2 · Otaq 1 · Reanimasiya", "Bağla: N1 · Otaq 1 · Neonatal", "Yenidən aç: 4 · Otaq 1 · Reanimasiya",
    ]) expect(buttons).toContain(name);
    expect(boxes).toContain("Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi");
    expect(boxes).toContain("Otaq 1 · Neonatal daxilində yeni çarpayının etiketi");
  });

  it("names a unit by its site too when there is more than one site", async () => {
    const tree = structure();
    tree.sites.push({ id: SITE2, name: "Yeni korpus", is_active: true, units: [
      { id: UNIT9, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
        { id: ROOM9, name: "Otaq 1", room_number: null, is_isolation: false, is_active: true,
          beds: [{ id: BED(9), label: "1", state: "AVAILABLE", is_active: true }] },
      ] },
    ] });
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockResolvedValue(tree) });
    const buttons = namesOf("button");
    const boxes = namesOf("textbox");
    for (const name of ["Bağla: Reanimasiya · Ana bina", "Bağla: Reanimasiya · Yeni korpus",
      "Bağla: Otaq 1 · Reanimasiya · Ana bina", "Bağla: Otaq 1 · Reanimasiya · Yeni korpus",
      "Bağla: 1 · Otaq 1 · Reanimasiya · Ana bina", "Bağla: 1 · Otaq 1 · Reanimasiya · Yeni korpus",
    ]) expect(buttons).toContain(name);
    expect(boxes).toContain("Reanimasiya · Yeni korpus daxilində yeni otağın adı");
    await press("Bağla: Reanimasiya · Yeni korpus");
    expect(api.patchUnit).toHaveBeenCalledWith(UNIT9, { is_active: false });
    expect(toasts().getAllByText("Reanimasiya · Yeni korpus · bağlandı").length).toBeGreaterThan(0);
  });

  it("bounds every box by what its column holds", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    const max = (name) => screen.getByRole("textbox", { name }).maxLength;
    expect(max("Yeni binanın adı")).toBe(200);
    expect(max("Ana bina daxilində yeni şöbənin adı")).toBe(200);
    expect(max("Reanimasiya daxilində yeni otağın adı")).toBe(100);
    expect(max("Reanimasiya daxilində yeni otağın nömrəsi (məcburi deyil)")).toBe(20);
    expect(max("Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi")).toBe(50);
    fireEvent.click(button("Adını dəyiş: Reanimasiya"));
    fireEvent.click(button("Adını dəyiş: Otaq 1 · Reanimasiya"));
    fireEvent.click(button("Adını dəyiş: 1 · Otaq 1 · Reanimasiya"));
    expect(max("Reanimasiya üçün yeni ad")).toBe(200);
    expect(max("Otaq 1 · Reanimasiya üçün yeni ad")).toBe(100);
    expect(max("1 · Otaq 1 · Reanimasiya üçün yeni ad")).toBe(50);
  });

  it("renames a bed from its own line, and hands the focus back to the line's button", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const toggle = button("Adını dəyiş: 1 · Otaq 1 · Reanimasiya");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const box = screen.getByRole("textbox", { name: "1 · Otaq 1 · Reanimasiya üçün yeni ad" });
    expect(document.getElementById(toggle.getAttribute("aria-controls")).contains(box)).toBe(true);
    expect(document.activeElement).toBe(box);
    await submitIn("1 · Otaq 1 · Reanimasiya üçün yeni ad", "1A");
    expect(api.patchBed).toHaveBeenCalledWith(BED(1), { label: "1A" });
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya · adı dəyişdi").length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "1 · Otaq 1 · Reanimasiya üçün yeni ad" })).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("renames a room under its unit's name", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    fireEvent.click(button("Adını dəyiş: Otaq 2 · Reanimasiya"));
    await submitIn("Otaq 2 · Reanimasiya üçün yeni ad", "Otaq 2A");
    expect(api.patchRoom).toHaveBeenCalledWith(ROOM2, { name: "Otaq 2A" });
    expect(toasts().getAllByText("Otaq 2 · Reanimasiya · adı dəyişdi").length).toBeGreaterThan(0);
  });

  it("closes the editor and sends nothing when a rename keeps the same name", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const toggle = button("Adını dəyiş: 1 · Otaq 1 · Reanimasiya");
    fireEvent.click(toggle);
    await submitIn("1 · Otaq 1 · Reanimasiya üçün yeni ad", " 1 ");
    expect(api.patchBed).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "1 · Otaq 1 · Reanimasiya üçün yeni ad" })).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("holds a blank or whitespace name, says why, and sends nothing", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const addBed = button("Çarpayı əlavə et: Otaq 1 · Reanimasiya");
    expect(addBed.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(addBed).textContent).toBe("Çarpayı etiketi boş ola bilməz.");
    expect(describedBy(button("Otaq əlavə et: Reanimasiya")).textContent).toBe("Ad boş ola bilməz.");
    await submitIn("Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi", "   ");
    expect(api.createBed).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi" }).getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(addBed).className).not.toContain("sr-only");       // shown, once she tried
  });

  it("closes an open bed and reopens a closed one, each named after the bed", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    await press("Bağla: 5 · Otaq 2 · Reanimasiya");
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { is_active: false });
    expect(toasts().getAllByText("5 · Otaq 2 · Reanimasiya · bağlandı").length).toBeGreaterThan(0);
    await press("Yenidən aç: 4 · Otaq 1 · Reanimasiya");
    expect(api.patchBed).toHaveBeenCalledWith(BED(4), { is_active: true });
    expect(toasts().getAllByText("4 · Otaq 1 · Reanimasiya · yenidən açıldı").length).toBeGreaterThan(0);
  });

  it("sends one write at a time: a second submit sends nothing, and every other write is held and says why", async () => {
    let land;
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.createBed.mockReturnValue(new Promise((resolve) => { land = resolve; })) });
    const input = screen.getByRole("textbox", { name: "Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi" });
    fireEvent.change(input, { target: { value: "6" } });
    await act(async () => { fireEvent.submit(input.closest("form")); fireEvent.submit(input.closest("form")); });
    await settle();
    expect(api.createBed).toHaveBeenCalledTimes(1);
    expect(button("Çarpayı əlavə et: Otaq 1 · Reanimasiya").getAttribute("aria-busy")).toBe("true");
    const other = button("Bağla: 5 · Otaq 2 · Reanimasiya");
    expect(other.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(other).textContent).toBe("6 · Otaq 1 · Reanimasiya · yadda saxlanılır…");
    await act(async () => { fireEvent.click(other); });
    expect(api.patchBed).not.toHaveBeenCalled();
    await act(async () => { land(); });
    await settle();
    expect(button("Bağla: 5 · Otaq 2 · Reanimasiya").getAttribute("aria-disabled")).toBeNull();
  });

  it("frees its buttons only once the tree has been read again", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    let answer;
    api.structure.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    await press("Bağla: 5 · Otaq 2 · Reanimasiya");
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { is_active: false });
    expect(button("Bağla: 5 · Otaq 2 · Reanimasiya").getAttribute("aria-busy")).toBe("true");
    await act(async () => { answer(structure()); });
    await settle();
    expect(button("Bağla: 5 · Otaq 2 · Reanimasiya").getAttribute("aria-busy")).toBeNull();
  });

  it("puts the server's refusal on the toast, named after what it was about", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.patchRoom.mockRejectedValue(refusal(409, "Close every bed of this room first.", { apiCode: "has_open_beds" })) });
    await press("Bağla: Otaq 2 · Reanimasiya");
    expect(toasts().getAllByText("Otaq 2 · Reanimasiya: Əvvəlcə altındakı bütün çarpayıları bağlayın.").length).toBeGreaterThan(0);
  });

  it("says an occupied bed cannot be closed, named after the bed", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.patchBed.mockRejectedValue(refusal(409, "The bed has a patient.", { apiCode: "bed_in_use" })) });
    await press("Bağla: 2 · Otaq 1 · Reanimasiya");
    expect(api.patchBed).toHaveBeenCalledWith(BED(2), { is_active: false });
    expect(toasts().getAllByText("2 · Otaq 1 · Reanimasiya: Xəstəsi olan çarpayı bağlana bilməz.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("The bed has a patient.");
  });

  // Amendment A-5: a bed's label is unique within its unit, any room, closed beds included — the
  // server refuses `bed_label_taken`, and the tab says so by the code, never by the server's words.
  it("says a unit already has a bed with that label, for a new bed and for a renamed one", async () => {
    const taken = () => refusal(409, "Bed label already used in this unit.", { apiCode: "bed_label_taken" });
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => { a.createBed.mockRejectedValue(taken()); a.patchBed.mockRejectedValue(taken()); } });
    await submitIn("Otaq 2 · Reanimasiya daxilində yeni çarpayının etiketi", "1");
    expect(api.createBed).toHaveBeenCalledWith(ROOM2, { label: "1" });
    expect(toasts().getAllByText("1 · Otaq 2 · Reanimasiya: Bu şöbədə eyni etiketli çarpayı artıq var.").length).toBeGreaterThan(0);
    fireEvent.click(button("Adını dəyiş: 5 · Otaq 2 · Reanimasiya"));
    await submitIn("5 · Otaq 2 · Reanimasiya üçün yeni ad", "2");
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { label: "2" });
    expect(toasts().getAllByText("5 · Otaq 2 · Reanimasiya: Bu şöbədə eyni etiketli çarpayı artıq var.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Bed label already used");
  });

  // Amendment A-9: a 404 the server did not code (a place gone from under the screen: "Room not
  // found", tenant/router.py) is said by its status in the reader's language, never in English.
  it("says an uncoded 404 by its status in the reader's language, never in the server's English", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.createBed.mockRejectedValue(refusal(404, "Room not found")) });
    await submitIn("Otaq 1 · Reanimasiya daxilində yeni çarpayının etiketi", "7");
    expect(toasts().getAllByText("7 · Otaq 1 · Reanimasiya: Sorğu uğursuz oldu (404).").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Room not found");
  });
});
