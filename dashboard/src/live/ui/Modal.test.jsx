import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal.jsx";

function Harness({ busy = false, onClose = () => {}, empty = false }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Aç</button>
      <Modal
        open={open}
        title="Nümunə pəncərə"
        busy={busy}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        actions={empty ? null : <button type="button">Son</button>}
      >
        {empty ? <p>yalnız mətn</p> : <input aria-label="Birinci" />}
      </Modal>
    </>
  );
}

function openIt() {
  const opener = screen.getByRole("button", { name: "Aç" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its title, with a close button in the current language", () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole("dialog", { name: "Nümunə pəncərə" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Bağla" })).toBeInTheDocument();
  });

  it("moves focus to the body's first control", () => {
    render(<Harness />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText("Birinci"));
  });

  it("focuses the dialog itself when the body has no control", () => {
    render(<Harness empty />);
    openIt();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("keeps Tab and Shift+Tab inside", () => {
    render(<Harness />);
    openIt();
    const close = screen.getByRole("button", { name: "Bağla" });
    const last = screen.getByRole("button", { name: "Son" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes on Escape and gives focus back to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = openIt();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on the ✕ and on a press on the backdrop, not on one inside", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    openIt();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Bağla" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("stays open while busy", () => {
    const onClose = vi.fn();
    render(<Harness busy onClose={onClose} />);
    openIt();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(screen.getByRole("button", { name: "Bağla" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
