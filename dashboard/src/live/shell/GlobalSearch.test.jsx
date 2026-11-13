import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";

const PATIENTS = [
  { patient_id: "S-001", bedLabel: "REA-01 · 2", display_name: "Ayşe Sentetik" },
  { patient_id: "S-002", bedLabel: "REA-01 · 3", display_name: "Kamran Sentetik" },
];
vi.mock("../data/BoardProvider.jsx", () => ({ useBoard: () => ({ patients: PATIENTS }) }));
const { GlobalSearch } = await import("./GlobalSearch.jsx");

const field = () => screen.getByRole("combobox");
const mount = () => render(<I18nProvider><GlobalSearch /></I18nProvider>);

describe("the top bar search", () => {
  afterEach(() => { cleanup(); window.location.hash = ""; });

  it("finds a patient by the HIS name, the bed or the id, and opens the first with Enter", () => {
    mount();
    fireEvent.change(field(), { target: { value: "kamran" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("REA-01 · 3");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(window.location.hash).toBe("#/patients/S-002");
  });

  it("says when nothing matches, with what was typed", () => {
    mount();
    fireEvent.change(field(), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("listbox")).toHaveTextContent("zzz");
  });

  it("Ctrl K puts the cursor in the field", () => {
    mount();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(document.activeElement).toBe(field());
  });
});
