import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Seg } from "./Seg.jsx";
import { Tabs, TabPanel } from "./Tabs.jsx";

const FILTERS = [
  { value: "open", label: "Açıq · 3" },
  { value: "crit", label: "Yalnız kritik" },
  { value: "mine", label: "Mənim xəstələrim" },
];

describe("Seg", () => {
  it("is a named group of toggle buttons, the chosen one pressed", () => {
    render(<Seg label="Süzgəc" options={FILTERS} value="crit" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Süzgəc" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yalnız kritik" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Açıq · 3" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports a new choice, and stays quiet on the current one", () => {
    const onChange = vi.fn();
    render(<Seg label="Süzgəc" options={FILTERS} value="open" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Açıq · 3" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mənim xəstələrim" }));
    expect(onChange).toHaveBeenCalledWith("mine");
  });

  it("marks an option written in another language", () => {
    render(<Seg label="Dil" options={[{ value: "ru", label: "Русский", lang: "ru" }]} value="az" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Русский" })).toHaveAttribute("lang", "ru");
  });
});

const TABS = [
  { value: "users", label: "İstifadəçilər" },
  { value: "roles", label: "Rollar və səlahiyyətlər", count: 2 },
  { value: "audit", label: "Audit jurnalı" },
];

function Harness() {
  const [tab, setTab] = useState("users");
  return (
    <>
      <Tabs id="adm" label="İdarə" tabs={TABS} value={tab} onChange={setTab} />
      <TabPanel id="adm" value={tab}>{`panel:${tab}`}</TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("is a named tab list; the selected tab labels its panel", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "İdarə" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "İstifadəçilər" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "İstifadəçilər" })).toHaveTextContent("panel:users");
  });

  it("keeps only the selected tab in the Tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "İstifadəçilər" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Audit jurnalı" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:audit");
  });

  it("moves with the arrow keys, wrapping, and jumps with Home/End", () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "İstifadəçilər" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Rollar/ }));
    fireEvent.keyDown(document.activeElement, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Audit jurnalı" }));
    fireEvent.keyDown(document.activeElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:audit");
    fireEvent.keyDown(document.activeElement, { key: "Home" });
    expect(screen.getByRole("tabpanel")).toHaveTextContent("panel:users");
  });

  it("shows a count badge", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: /Rollar/ })).toHaveTextContent("2");
  });
});
