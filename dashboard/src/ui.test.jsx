// dashboard/src/ui.test.jsx
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Field, ActionOverlay, inputCls, btnCls } from "./ui.jsx";
import { getTheme } from "./clinicalTheme.js";

const T = getTheme("icu");

describe("ui primitives", () => {
  it("Field renders its label, children and hint", () => {
    render(<Field T={T} label="Ad Soyad" hint="Zorunlu"><input aria-label="ad" /></Field>);
    expect(screen.getByText("Ad Soyad")).toBeInTheDocument();
    expect(screen.getByLabelText("ad")).toBeInTheDocument();
    expect(screen.getByText("Zorunlu")).toBeInTheDocument();
  });

  it("ActionOverlay shows a title and closes from its button", () => {
    const onClose = vi.fn();
    render(<ActionOverlay T={T} title="Başlık" onClose={onClose}><p>içerik</p></ActionOverlay>);
    expect(screen.getByText("Başlık")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("ActionOverlay is a modal dialog named by its title", () => {
    render(<ActionOverlay T={T} title="Başlık" onClose={() => {}}><p>içerik</p></ActionOverlay>);
    const dialog = screen.getByRole("dialog", { name: "Başlık" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("içerik")).toBeInTheDocument();
  });

  it("ActionOverlay names its close button, in the caller's language", () => {
    const { unmount } = render(<ActionOverlay T={T} title="Başlık" onClose={() => {}}><p>x</p></ActionOverlay>);
    expect(screen.getByRole("button", { name: "Kapat" })).toBeInTheDocument();
    unmount();
    render(<ActionOverlay T={T} title="Title" closeLabel="Close" onClose={() => {}}><p>x</p></ActionOverlay>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("ActionOverlay closes on Escape and from its backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(<ActionOverlay T={T} title="Başlık" onClose={onClose}><p>x</p></ActionOverlay>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.firstChild.firstChild);                 // the backdrop
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ActionOverlay does not close while busy: not by Escape, the backdrop nor the X", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionOverlay T={T} title="Başlık" busy onClose={onClose}><p>x</p></ActionOverlay>);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstChild.firstChild);
    const x = screen.getByRole("button", { name: "Kapat" });
    expect(x).toBeDisabled();
    fireEvent.click(x);
    expect(onClose).not.toHaveBeenCalled();
  });

  function Opener({ children }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>aç</button>
        {open && <ActionOverlay T={T} title="Başlık" onClose={() => setOpen(false)}>{children}</ActionOverlay>}
      </>
    );
  }

  it("ActionOverlay moves focus to its first control and gives it back on close", () => {
    render(<Opener><button>tamam</button></Opener>);
    const opener = screen.getByText("aç");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByText("tamam")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("ActionOverlay focuses its title when it holds no control, and leaves autoFocus alone", () => {
    const { unmount } = render(<Opener><p>metin</p></Opener>);
    fireEvent.click(screen.getByText("aç"));
    expect(screen.getByText("Başlık")).toHaveFocus();
    unmount();
    render(<Opener><button>önce</button><input aria-label="ad" autoFocus /></Opener>);
    fireEvent.click(screen.getByText("aç"));
    expect(screen.getByLabelText("ad")).toHaveFocus();
  });

  it("class helpers produce theme-bound class strings", () => {
    expect(inputCls(T)).toContain(T.input);
    expect(btnCls(T, "danger")).toContain(T.danger);
    expect(btnCls(T)).toContain(T.primary);
  });
});
