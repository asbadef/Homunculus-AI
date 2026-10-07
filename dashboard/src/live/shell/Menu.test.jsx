import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { MenuButton, Popover } from "./Menu.jsx";

function Account({ onLock = vi.fn(), onOut = vi.fn() }) {
  return (
    <>
      <MenuButton
        label="Hesab menyusu"
        button="AS"
        header={<p>Ayşe Sentetik</p>}
        items={[
          { key: "lock", label: "Ekranı kilidlə", icon: "lock", onSelect: onLock },
          "separator",
          { key: "out", label: "Çıxış", icon: "out", onSelect: onOut },
        ]}
      />
      <button type="button">kənarda</button>
    </>
  );
}

describe("MenuButton", () => {
  it("is a closed menu button until pressed; then the first item has focus", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Hesab menyusu" })).toBeInTheDocument();
    expect(screen.getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
  });

  it("moves with the arrows, wrapping, and jumps with Home/End", () => {
    render(<Account />);
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    const menu = screen.getByRole("menu");
    const [lock, out] = screen.getAllByRole("menuitem");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(lock);
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(out);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(lock);
  });

  it("runs an item, closes, and gives focus back to its button", () => {
    const onOut = vi.fn();
    render(<Account onOut={onOut} />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Çıxış" }));
    expect(onOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape (focus back) and on a press outside", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole("button", { name: "kənarda" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape pressed on the button itself while open (focus put back there by a script)", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    button.focus();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
  });

  it("a press outside closes it and leaves focus where the press landed", () => {
    render(<Account />);
    fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
    const outside = screen.getByRole("button", { name: "kənarda" });
    act(() => outside.focus());            // what the browser does on the press
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("closes when focus leaves it by any means, and stays open while focus moves inside it", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    const [lock] = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(lock);
    act(() => screen.getByText("Ayşe Sentetik").closest("[tabindex]").focus());   // a press on its own header
    expect(screen.getByRole("menu")).toBeInTheDocument();
    act(() => lock.focus());
    act(() => screen.getByRole("button", { name: "kənarda" }).focus());           // a script, a virtual cursor
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "kənarda" }));
  });

  it("answers Escape and the arrows with focus on the panel itself (a press on its header)", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    const panel = screen.getByText("Ayşe Sentetik").closest("[tabindex]");
    act(() => panel.focus());
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
    act(() => panel.focus());
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("ArrowDown on the open button enters the menu at its first item; ArrowUp on the closed button opens it at the last", () => {
    render(<Account />);
    const button = screen.getByRole("button", { name: "Hesab menyusu" });
    fireEvent.click(button);
    const [lock, out] = screen.getAllByRole("menuitem");
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(document.activeElement).toBe(lock);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[1]);
    expect(document.activeElement).toHaveTextContent(out.textContent);
  });

  it("opens from the keyboard with ArrowDown, and marks the chosen radio item", () => {
    render(<MenuButton label="Dil" button="AZ" items={[
      { key: "az", label: "Azərbaycan", checked: true, onSelect: () => {} },
      { key: "tr", label: "Türkçe", checked: false, onSelect: () => {} },
    ]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Dil" }), { key: "ArrowDown" });
    const chosen = screen.getByRole("menuitemradio", { name: "Azərbaycan" });
    expect(chosen).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Türkçe" })).toHaveAttribute("aria-checked", "false");
    expect(document.activeElement).toBe(chosen);
  });
});

describe("Popover", () => {
  it("opens a named panel that takes focus, and closes on Escape back to its button", () => {
    render(<Popover label="Klaviatura qısayolları" button="⌨">{() => <p>Alt L</p>}</Popover>);
    const button = screen.getByRole("button", { name: "Klaviatura qısayolları" });
    fireEvent.click(button);
    const panel = screen.getByRole("region", { name: "Klaviatura qısayolları" });
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes when Tab leaves the panel, so Escape never has a panel it cannot reach", () => {
    render(
      <>
        <Popover label="Zəng" button="B">{() => <button type="button">Hamısını gör</button>}</Popover>
        <button type="button">sonrakı</button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Zəng" });
    fireEvent.click(button);
    const inner = screen.getByRole("button", { name: "Hamısını gör" });
    act(() => inner.focus());               // Tab from the panel to its button: still inside
    expect(screen.getByRole("region")).toBeInTheDocument();
    fireEvent.keyDown(inner, { key: "Tab" });
    act(() => screen.getByRole("button", { name: "sonrakı" }).focus());   // the browser's default for that Tab
    expect(screen.queryByRole("region")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "sonrakı" }));
  });
});
