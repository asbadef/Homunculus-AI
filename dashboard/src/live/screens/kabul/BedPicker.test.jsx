// The bed picker (Group 2 · B1a, spec §5.2): unit → room → bed; only an open, AVAILABLE bed can be
// chosen, and every other bed says why it is not offered.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { BedPicker } from "./BedPicker.jsx";
import { refusal } from "../../session/mount.testutil.jsx";
import { BED, NEO, REA, ROOM2, UUID_TEXT, structure } from "./kabul.testutil.js";

function draw(props = {}) {
  const onUnit = vi.fn();
  const onBed = vi.fn();
  render(<I18nProvider><BedPicker structure={structure()} unitId={REA} bedId={null} onUnit={onUnit} onBed={onBed} {...props} /></I18nProvider>);
  return { onUnit, onBed };
}

/** The structure with room 2 of Reanimasiya closed — its one AVAILABLE bed with it. */
function roomTwoClosed() {
  const tree = structure();
  for (const unit of tree.sites[0].units) for (const room of unit.rooms) if (room.id === ROOM2) room.is_active = false;
  return tree;
}

describe("BedPicker", () => {
  // Walk M-3: a unit button was named "Reanimasiya2 boş", run together, and a bed only "1": the
  // name a screen reader says is now the unit and its free beds apart, and a bed as every screen of
  // the slice names it, "label · room · unit" — with why it is held when it is.
  it("lists the units with their free beds, and a closed unit as closed — each named with the two apart", () => {
    const { onUnit } = draw({ unitId: null });
    const units = within(screen.getByRole("group", { name: "Şöbə" }));
    expect(units.getByRole("button", { name: "Reanimasiya · 2 boş" })).toBeTruthy();
    expect(units.getByRole("button", { name: "Neonatal · bağlıdır" })).toBeTruthy();
    expect(screen.getByText("Əvvəlcə şöbəni seçin.")).toBeTruthy();
    fireEvent.click(units.getByRole("button", { name: /Reanimasiya/ }));
    expect(onUnit).toHaveBeenCalledWith(REA);
  });

  it("counts no bed of a closed room as free", () => {
    draw({ unitId: null, structure: roomTwoClosed() });
    expect(within(screen.getByRole("group", { name: "Şöbə" })).getByRole("button", { name: "Reanimasiya · 1 boş" })).toBeTruthy();
  });

  it("names each bed as label · room · unit, and a held one with why", () => {
    draw();
    const names = screen.getAllByRole("button").map((el) => el.getAttribute("aria-label")).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining([
      "1 · Otaq 1 · Reanimasiya", "2 · Otaq 1 · Reanimasiya · Dolu", "3 · Otaq 1 · Reanimasiya · Təmizlikdədir",
      "4 · Otaq 1 · Reanimasiya · Bağlıdır", "5 · Otaq 2 · Reanimasiya",
    ]));
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("says the beds are being read, not that the scope holds none, before the first answer", () => {
    draw({ structure: null, phase: "loading" });
    expect(screen.getByRole("status").textContent).toBe("Yüklənir…");
    expect(screen.queryByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeNull();
  });

  it("says the first read failed, not that the scope holds none, and reads again on request", () => {
    const onRetry = vi.fn();
    draw({ structure: null, phase: "failed", error: refusal(500, "Internal Server Error"), onRetry });
    expect(screen.getByRole("alert").textContent).toMatch(/^Siyahı oxunmadı: /);
    expect(screen.queryByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yenidən cəhd et" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("puts `focusId` on the first bed that can be chosen in the chosen unit", () => {
    draw({ focusId: "bed-field" });
    expect(document.getElementById("bed-field")).toBe(screen.getByRole("button", { name: "1 · Otaq 1 · Reanimasiya" }));
  });

  it("puts `focusId` on the first unit while none is chosen", () => {
    draw({ unitId: null, focusId: "bed-field" });
    expect(document.getElementById("bed-field").textContent).toMatch(/^Reanimasiya/);
  });

  it("offers an open AVAILABLE bed, and names it bed · room · unit", () => {
    const { onBed } = draw();
    fireEvent.click(within(screen.getByRole("group", { name: "Otaq 2" })).getByRole("button", { name: "5 · Otaq 2 · Reanimasiya" }));
    expect(onBed).toHaveBeenCalledWith({ id: BED(5), unitId: REA, label: "5 · Otaq 2 · Reanimasiya" });
  });

  it("shows every other bed dimmed with its reason, and choosing it does nothing", () => {
    const { onBed } = draw();
    const room = within(screen.getByRole("group", { name: "Otaq 1" }));
    for (const [label, why] of [["2", "Dolu"], ["3", "Təmizlikdədir"], ["4", "Bağlıdır"]]) {
      const bed = room.getByRole("button", { name: `${label} · Otaq 1 · Reanimasiya · ${why}` });
      expect(bed.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(bed);
    }
    expect(onBed).not.toHaveBeenCalled();
  });

  it("marks the chosen bed pressed and says which it is", () => {
    draw({ bedId: BED(1) });
    expect(screen.getByRole("button", { name: "1 · Otaq 1 · Reanimasiya" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Seçilən: 1 · Otaq 1 · Reanimasiya")).toBeTruthy();
  });

  it("says when there is nothing to choose, and never prints a UUID", () => {
    draw({ unitId: NEO });
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    render(<I18nProvider><BedPicker structure={{ sites: [] }} unitId={null} bedId={null} onUnit={() => {}} onBed={() => {}} /></I18nProvider>);
    expect(screen.getByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeTruthy();
  });
});
