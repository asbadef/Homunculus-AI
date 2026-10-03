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

  it("keeps the chosen one visible in Windows high-contrast, where its fill is dropped", () => {
    render(<Seg label="Süzgəc" options={FILTERS} value="crit" onChange={() => {}} />);
    const chosen = screen.getByRole("button", { name: "Yalnız kritik" }).className.split(/\s+/);
    const other = screen.getByRole("button", { name: "Açıq · 3" }).className.split(/\s+/);
    expect(chosen).toEqual(expect.arrayContaining(["forced-colors:border-2", "forced-colors:border-[Highlight]"]));
    expect(other.some((c) => c.startsWith("forced-colors:border"))).toBe(false);
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
      <TabPanel id="adm" tabs={TABS} value={tab}>{`panel:${tab}`}</TabPanel>
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

  it("points aria-controls only from the selected tab: the others' panels are not rendered", () => {
    render(<Harness />);
    const selected = screen.getByRole("tab", { name: "İstifadəçilər" });
    expect(selected).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
    expect(screen.getByRole("tab", { name: /Rollar/ })).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("tab", { name: "Audit jurnalı" })).not.toHaveAttribute("aria-controls");
  });

  it("with a value that matches no tab, makes the first tab the Tab stop and selects none", () => {
    const onChange = vi.fn();
    render(<Tabs id="adm" label="İdarə" tabs={TABS} value="gone" onChange={onChange} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs.every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("audit");
  });

  it("ignores the arrows and Home/End with Alt, Ctrl or Meta held", () => {
    const onChange = vi.fn();
    render(<Tabs id="adm" label="İdarə" tabs={TABS} value="users" onChange={onChange} />);
    const first = screen.getByRole("tab", { name: "İstifadəçilər" });
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) {
      fireEvent.keyDown(first, { key: "ArrowRight", [mod]: true });
      fireEvent.keyDown(first, { key: "End", [mod]: true });
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("builds ids from the base and the position, never from the value", () => {
    const quirky = 'c/d"e';
    const odd = [{ value: "a b", label: "Bir" }, { value: quirky, label: "İki" }];
    render(
      <>
        <Tabs id="x" label="Tək" tabs={odd} value={quirky} onChange={() => {}} />
        <TabPanel id="x" tabs={odd} value={quirky}>iki</TabPanel>
      </>,
    );
    expect(screen.getByRole("tab", { name: "Bir" }).id).toBe("x-tab-0");
    expect(screen.getByRole("tab", { name: "İki" }).id).toBe("x-tab-1");
    expect(screen.getByRole("tabpanel", { name: "İki" }).id).toBe("x-panel-1");
  });

  it("without an id, generates one and points at no panel", () => {
    render(<Tabs label="İdarə" tabs={TABS} value="users" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: "İstifadəçilər" });
    expect(tab.id).toMatch(/-tab-0$/);
    expect(tab).not.toHaveAttribute("aria-controls");
  });

  it("reads a count label in place of the bare badge number", () => {
    const tabs = [{ value: "users", label: "İstifadəçilər" }, { value: "roles", label: "Rollar", count: 2, countLabel: "2 gözləyən" }];
    render(<Tabs id="adm" label="İdarə" tabs={tabs} value="users" onChange={() => {}} />);
    const tab = screen.getByRole("tab", { name: "Rollar 2 gözləyən" });
    expect(tab.querySelector("[aria-hidden='true']")).toHaveTextContent("2");
  });
});
