// The bed picker (Group 2 · B1a, spec §5.2): unit → room → bed; only an open, AVAILABLE bed can be
// chosen, and every other bed says why it is not offered.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { BedPicker } from "./BedPicker.jsx";
import { BED, NEO, REA, UUID_TEXT, structure } from "./kabul.testutil.js";

function draw(props = {}) {
  const onUnit = vi.fn();
  const onBed = vi.fn();
  render(<I18nProvider><BedPicker structure={structure()} unitId={REA} bedId={null} onUnit={onUnit} onBed={onBed} {...props} /></I18nProvider>);
  return { onUnit, onBed };
}

describe("BedPicker", () => {
  it("lists the units with their free beds, and a closed unit as closed", () => {
    const { onUnit } = draw({ unitId: null });
    const units = within(screen.getByRole("group", { name: "Şöbə" }));
    expect(units.getByRole("button", { name: /Reanimasiya\s*2 boş/ })).toBeTruthy();
    expect(units.getByRole("button", { name: /Neonatal\s*bağlıdır/ })).toBeTruthy();
    expect(screen.getByText("Əvvəlcə şöbəni seçin.")).toBeTruthy();
    fireEvent.click(units.getByRole("button", { name: /Reanimasiya/ }));
    expect(onUnit).toHaveBeenCalledWith(REA);
  });

  it("offers an open AVAILABLE bed, and names it bed · room · unit", () => {
    const { onBed } = draw();
    fireEvent.click(within(screen.getByRole("group", { name: "Otaq 2" })).getByRole("button", { name: "5" }));
    expect(onBed).toHaveBeenCalledWith({ id: BED(5), unitId: REA, label: "5 · Otaq 2 · Reanimasiya" });
  });

  it("shows every other bed dimmed with its reason, and choosing it does nothing", () => {
    const { onBed } = draw();
    const room = within(screen.getByRole("group", { name: "Otaq 1" }));
    for (const [label, why] of [["2", "Dolu"], ["3", "Təmizlikdədir"], ["4", "Bağlıdır"]]) {
      const bed = room.getByRole("button", { name: `${label} · ${why}` });
      expect(bed.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(bed);
    }
    expect(onBed).not.toHaveBeenCalled();
  });

  it("marks the chosen bed pressed and says which it is", () => {
    draw({ bedId: BED(1) });
    expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Seçilən: 1 · Otaq 1 · Reanimasiya")).toBeTruthy();
  });

  it("says when there is nothing to choose, and never prints a UUID", () => {
    draw({ unitId: NEO });
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    render(<I18nProvider><BedPicker structure={{ sites: [] }} unitId={null} bedId={null} onUnit={() => {}} onBed={() => {}} /></I18nProvider>);
    expect(screen.getByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeTruthy();
  });
});
