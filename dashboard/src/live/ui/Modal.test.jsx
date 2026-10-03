import { describe, it, expect, vi, afterEach } from "vitest";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { Modal } from "./Modal.jsx";
import { ToastProvider, useToast } from "./Toast.jsx";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

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

  it("draws its backdrop with the scrim token, not a colour of its own", () => {
    render(<Harness />);
    openIt();
    const backdrop = screen.getByTestId("modal-backdrop");
    expect(backdrop.className.split(/\s+/)).toContain("bg-scrim");
    expect(backdrop.className).not.toMatch(/rgba|#[0-9a-f]{3}/i);
  });

  it("keeps a press on the backdrop from taking focus, busy or not", () => {
    render(<Harness busy />);
    openIt();
    expect(fireEvent.mouseDown(screen.getByTestId("modal-backdrop"))).toBe(false);
  });
});

describe("Modal: the page behind it", () => {
  it("is inert while the dialog is open, and given back on close", () => {
    const { container } = render(<Harness />);
    const opener = openIt();
    expect(container).toHaveAttribute("inert");
    expect(screen.getByTestId("modal-backdrop")).not.toHaveAttribute("inert");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(container).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(opener);
  });

  it("leaves alone an element that was inert before", () => {
    const own = document.createElement("div");
    own.setAttribute("inert", "");
    document.body.append(own);
    render(<Harness />);
    openIt();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(own).toHaveAttribute("inert");
    own.remove();
  });

  it("cannot scroll while a dialog is open; its overflow comes back exactly", () => {
    document.body.style.overflow = "scroll";
    render(<Harness />);
    openIt();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.documentElement.hasAttribute("style")).toBe(false);
  });
});

describe("Modal: keyboard when focus has left the dialog", () => {
  it("Escape from <body> closes it — not while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness busy onClose={onClose} />);
    openIt();
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Harness onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tab and Shift+Tab from <body> go back into the dialog", () => {
    render(<Harness />);
    openIt();
    const dialog = screen.getByRole("dialog");
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Bağla" }));
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Son" }));
  });

  it("Tab stays inside when the focused footer button turns disabled while busy", () => {
    function Busy() {
      const [busy, setBusy] = useState(false);
      return (
        <Modal
          open
          title="Saxlanılır"
          busy={busy}
          onClose={() => {}}
          actions={<button type="button" disabled={busy} onClick={() => setBusy(true)}>Son</button>}
        >
          <input aria-label="Birinci" />
        </Modal>
      );
    }
    render(<Busy />);
    const last = screen.getByRole("button", { name: "Son" });
    last.focus();
    fireEvent.click(last);
    expect(last).toBeDisabled();
    fireEvent.keyDown(document.activeElement, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("Birinci"));
    last.focus();
    fireEvent.keyDown(document.activeElement, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("Birinci"));
  });

  it("a toast stays live and reachable while a dialog is open; Tab from it returns to the dialog", () => {
    function WithToast() {
      const toast = useToast();
      return (
        <Modal open title="Pəncərə" onClose={() => {}}>
          <button type="button" onClick={() => toast("Göndərildi")}>Göndər</button>
        </Modal>
      );
    }
    render(<ToastProvider><WithToast /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Göndər" }));
    const region = screen.getByRole("region", { name: "Bildirişlər" });
    expect(region.closest("[inert]")).toBeNull();
    within(region).getByRole("button").focus();
    fireEvent.keyDown(document.activeElement, { key: "Tab" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});

describe("Modal: focus on opening", () => {
  it("leaves focus on a child that took it with autoFocus", () => {
    render(
      <Modal open title="Axtarış" onClose={() => {}}>
        <input aria-label="Birinci" />
        <input aria-label="İkinci" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("İkinci"));
  });

  it("skips hidden and disabled controls, and finds summary and contenteditable", () => {
    render(
      <Modal open title="Seçim" onClose={() => {}}>
        <input type="hidden" />
        <button type="button" disabled>yox</button>
        <div hidden><button type="button">gizli</button></div>
        <details><summary>Ətraflı</summary>mətn</details>
        <div contentEditable suppressContentEditableWarning aria-label="Qeyd">x</div>
      </Modal>,
    );
    expect(document.activeElement).toHaveTextContent("Ətraflı");
    const note = screen.getByLabelText("Qeyd");
    note.focus();
    fireEvent.keyDown(note, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bağla" }));
  });
});

function Nested() {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>Aç</button>
      <Modal open={outer} title="Xarici" onClose={() => setOuter(false)}>
        <button type="button" onClick={() => setInner(true)}>Daxili aç</button>
        <Modal open={inner} title="Daxili" onClose={() => setInner(false)}>
          <input aria-label="Daxili sahə" />
        </Modal>
      </Modal>
    </>
  );
}

describe("Modal: nested dialogs", () => {
  it("only the topmost is interactive, and Escape closes the topmost first", () => {
    const { container } = render(<Nested />);
    openIt();
    const innerOpener = screen.getByRole("button", { name: "Daxili aç" });
    innerOpener.focus();
    fireEvent.click(innerOpener);
    const [outerBackdrop, innerBackdrop] = screen.getAllByTestId("modal-backdrop");
    expect(outerBackdrop).toHaveAttribute("inert");
    expect(innerBackdrop).not.toHaveAttribute("inert");
    expect(container).toHaveAttribute("inert");
    expect(document.activeElement).toBe(screen.getByLabelText("Daxili sahə"));

    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(innerBackdrop.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Daxili" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Xarici" })).toBeInTheDocument();
    expect(outerBackdrop).not.toHaveAttribute("inert");
    expect(container).toHaveAttribute("inert");
    expect(document.activeElement).toBe(innerOpener);

    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container).not.toHaveAttribute("inert");
    expect(document.documentElement.style.overflow).toBe("");
  });
});

// Focus goes back to the opener one microtask after the dialog closes, when nothing else took it.
const settle = () => act(async () => {});

function Stacked({ closeParentOnly = false }) {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>Aç</button>
      <Modal open={outer} title="Xarici" onClose={() => setOuter(false)}>
        <button type="button" onClick={() => setInner(true)}>Daxili aç</button>
        <Modal open={inner} title="Təsdiq" onClose={() => setInner(false)}>
          <button
            type="button"
            onClick={() => {
              if (!closeParentOnly) setInner(false);
              setOuter(false);
            }}
          >
            Hamısını bağla
          </button>
        </Modal>
      </Modal>
    </>
  );
}

describe("Modal: focus on closing", () => {
  it.each([
    ["an inner \"close all\"", false],
    ["a confirm that closes its parent", true],
  ])("two dialogs closed at once (%s) give focus back to the outer opener", async (_, closeParentOnly) => {
    render(<Stacked closeParentOnly={closeParentOnly} />);
    const opener = openIt();
    const innerOpener = screen.getByRole("button", { name: "Daxili aç" });
    innerOpener.focus();
    fireEvent.click(innerOpener);
    const all = screen.getByRole("button", { name: "Hamısını bağla" });
    all.focus();
    fireEvent.click(all);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("leaves focus where the caller put it on purpose", async () => {
    function Moves() {
      const [open, setOpen] = useState(false);
      const next = useRef(null);
      const was = useRef(false);
      useLayoutEffect(() => {
        if (was.current && !open) next.current.focus();
        was.current = open;
      }, [open]);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <button type="button" ref={next}>Növbəti</button>
          <Modal open={open} title="Pəncərə" onClose={() => setOpen(false)}>
            <input aria-label="Birinci" />
          </Modal>
        </>
      );
    }
    render(<Moves />);
    openIt();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Növbəti" }));
  });

  it("keeps a child's autoFocus under StrictMode", async () => {
    function Auto() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Aç</button>
          <Modal open={open} title="Axtarış" onClose={() => setOpen(false)}>
            <input aria-label="Birinci" />
            <input aria-label="İkinci" autoFocus />
          </Modal>
        </>
      );
    }
    render(<StrictMode><Auto /></StrictMode>);
    const opener = openIt();
    await settle();
    expect(document.activeElement).toBe(screen.getByLabelText("İkinci"));
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    await settle();
    expect(document.activeElement).toBe(opener);
  });
});
