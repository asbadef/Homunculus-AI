import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import React from "react";
import { ToastProvider, useToast, TOAST_MS, TOAST_WARN_MS, TOAST_MAX } from "./Toast.jsx";
import { MODAL_OPEN } from "./Modal.jsx";

function Fire({ message, tone }) {
  const toast = useToast();
  return <button type="button" onClick={() => toast(message, tone)}>{`fire ${message}`}</button>;
}

let api;
function Grab() {
  api = useToast();
  return <button type="button">kənarda</button>;
}
const mount = () => render(<ToastProvider><Grab /></ToastProvider>);
const show = (message, tone) => act(() => {
  api(message, tone);
});

// The project's fake-timer recipe: installed before mount, these five only, nothing advancing alone.
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
afterEach(() => vi.useRealTimers());

/** The lock screen's stand-in. It takes focus in a PASSIVE effect, as LockScreen.jsx does: so at
 *  a lock the provider's layout effect runs while focus is still where it was — in a toast, maybe. */
function Locked() {
  const input = React.useRef(null);
  React.useEffect(() => { input.current.focus(); }, []);
  return <input ref={input} aria-label="kilid" />;
}

/** A provider behind the live shell's two facts (LiveApp): open, and whose session. Returns the
 *  function that moves them, as a lock, an unlock, a sign-out or a sign-in does. Closed, the
 *  screen under it is the lock screen's stand-in. */
function gated() {
  const at = (props) => (
    <ToastProvider open={props.open ?? true} session={props.session ?? "s1"}>
      {props.open ?? true ? <Grab /> : <Locked />}
    </ToastProvider>
  );
  const view = render(at({}));
  return (props) => view.rerender(at(props));
}

const region = () => screen.getByRole("region", { name: "Bildirişlər" });
const cards = () => [...region().querySelectorAll("[data-toast]")];
const card = (text) => cards().find((el) => el.textContent.includes(text)) || null;
const polite = () => region().querySelector('[aria-live="polite"]');
const alerts = () => within(region()).getByRole("alert");

describe("toasts", () => {
  it("have a named live region before the first toast", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    expect(region().firstChild).toHaveAttribute("aria-live", "polite");
    expect(region().firstChild).toBeEmptyDOMElement();
    expect(alerts()).toBeEmptyDOMElement();
  });

  it("show the message, and disappear after 3.6 s", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Yadda saxlanıldı")).toBeNull();
    expect(polite()).toBeEmptyDOMElement();
  });

  it("close at once from their close button", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    fireEvent.click(within(region()).getByRole("button", { name: "Bağla" }));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  it("carry their tone, ok for one they do not know", () => {
    render(
      <ToastProvider>
        <Fire message="xəta" tone="error" />
        <Fire message="nə" tone="loud" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire xəta"));
    fireEvent.click(screen.getByText("fire nə"));
    expect(card("xəta")).toHaveAttribute("data-tone", "error");
    expect(card("nə")).toHaveAttribute("data-tone", "ok");
  });
});

describe("toast lifetimes", () => {
  it("a warning stays at least 10 s", () => {
    expect(TOAST_WARN_MS).toBeGreaterThanOrEqual(10000);
    mount();
    show("Bağlantı yavaşdır", "warn");
    act(() => vi.advanceTimersByTime(TOAST_WARN_MS - 1));
    expect(card("Bağlantı yavaşdır")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Bağlantı yavaşdır")).toBeNull();
  });

  it("an error stays until it is dismissed", () => {
    mount();
    show("Saxlanılmadı", "error");
    act(() => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(card("Saxlanılmadı")).not.toBeNull();
    fireEvent.click(within(card("Saxlanılmadı")).getByRole("button", { name: "Bağla" }));
    expect(card("Saxlanılmadı")).toBeNull();
  });

  it("pause while the pointer is over them, and resume with the time they had left", () => {
    mount();
    show("Yadda saxlanıldı");
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(card("Yadda saxlanıldı"));
    act(() => vi.advanceTimersByTime(60000));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    fireEvent.mouseLeave(card("Yadda saxlanıldı"));
    act(() => vi.advanceTimersByTime(TOAST_MS - 2000 - 1));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  it("pause while focus is inside them, and resume when it leaves", () => {
    mount();
    show("Yadda saxlanıldı");
    within(region()).getByRole("button", { name: "Bağla" }).focus();
    act(() => vi.advanceTimersByTime(60000));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    screen.getByRole("button", { name: "kənarda" }).focus();
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });
});

describe("toasts for a screen reader", () => {
  it("announce errors in an alert, the rest politely — never the close button's name", () => {
    mount();
    show("Yadda saxlanıldı");
    show("Bağlantı yavaşdır", "warn");
    show("Saxlanılmadı", "error");
    expect(polite()).toHaveTextContent(/^Yadda saxlanıldı\s*Xəbərdarlıq: Bağlantı yavaşdır$/);
    expect(alerts()).toHaveTextContent(/^Xəta: Saxlanılmadı$/);
    expect(alerts()).toHaveAttribute("aria-atomic", "false");
    expect(region().querySelector('[aria-live="polite"] button, [role="alert"] button')).toBeNull();
  });

  it("do not tell their tone by colour alone: a tone icon on each", () => {
    mount();
    show("Yadda saxlanıldı");
    show("Bağlantı yavaşdır", "warn");
    show("Saxlanılmadı", "error");
    const icon = (text) => card(text).querySelector("svg").getAttribute("data-icon");
    expect(icon("Yadda saxlanıldı")).toBe("ok");
    expect(icon("Bağlantı yavaşdır")).toBe("alert");
    expect(icon("Saxlanılmadı")).toBe("alert");
  });

  it("label the close button in the current language and hide its ✕ glyph", () => {
    mount();
    show("Yadda saxlanıldı");
    const button = within(card("Yadda saxlanıldı")).getByRole("button", { name: "Bağla" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(button).toHaveAccessibleDescription("Yadda saxlanıldı");
  });
});

describe("toasts and focus", () => {
  it("give focus back to where it was when the focused toast is closed", () => {
    mount();
    show("Saxlanılmadı", "error");
    const before = screen.getByRole("button", { name: "kənarda" });
    before.focus();
    within(card("Saxlanılmadı")).getByRole("button", { name: "Bağla" }).focus();
    fireEvent.click(document.activeElement);
    expect(document.activeElement).toBe(before);
  });

  it("…or to <body> when that element is gone", () => {
    mount();
    show("Saxlanılmadı", "error");
    const gone = document.createElement("button");
    document.body.append(gone);
    gone.focus();
    within(card("Saxlanılmadı")).getByRole("button", { name: "Bağla" }).focus();
    gone.remove();
    fireEvent.click(document.activeElement);
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the toast stack", () => {
  it(`holds at most ${TOAST_MAX}; the oldest that is not an error goes first`, () => {
    mount();
    show("xəta 1", "error");
    for (let i = 1; i <= TOAST_MAX; i += 1) show(`qeyd ${i}`);
    expect(cards()).toHaveLength(TOAST_MAX);
    expect(card("xəta 1")).not.toBeNull();
    expect(card("qeyd 1")).toBeNull();
    expect(card(`qeyd ${TOAST_MAX}`)).not.toBeNull();
  });

  it("drops the oldest error only when every toast is an error", () => {
    mount();
    for (let i = 1; i <= TOAST_MAX + 1; i += 1) show(`xəta ${i}`, "error");
    expect(cards()).toHaveLength(TOAST_MAX);
    expect(card("xəta 1")).toBeNull();
    expect(cards()[0]).toHaveTextContent("xəta 2");
  });
});

// G2-B1a walk (M-6): a refusal pressed twice stacked two identical error toasts, which stay until
// dismissed — the screen filled with copies. The same words in the same tone are one toast.
describe("a toast raised again", () => {
  const REFUSED = "Otaq 1 · Reanimasiya: Əvvəlcə altındakı bütün çarpayıları bağlayın.";

  it("replaces the copy on screen: an identical message never shows twice, nor is it said twice at once", () => {
    mount();
    show(REFUSED, "error");
    show(REFUSED, "error");
    expect(cards()).toHaveLength(1);
    expect(alerts().querySelectorAll("p")).toHaveLength(1);
  });

  it("comes last, as the newest, and the copy it replaces leaves its place", () => {
    mount();
    show("birinci", "error");
    show("ikinci", "error");
    show("birinci", "error");
    expect(cards().map((el) => el.textContent)).toEqual(["ikinci", "birinci"]);
  });

  it("restarts a confirmation's clock instead of adding a second", () => {
    mount();
    show("Yadda saxlanıldı");
    act(() => vi.advanceTimersByTime(TOAST_MS - 100));
    show("Yadda saxlanıldı");
    expect(cards()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200));
    expect(card("Yadda saxlanıldı")).not.toBeNull();          // the newest one's own 3.6 s
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  it("keeps another message, or the same words in another tone, as a toast of its own", () => {
    mount();
    show("Saxlanılmadı", "error");
    show("Saxlanılmadı", "warn");
    show("Başqa bir xəta", "error");
    expect(cards()).toHaveLength(3);
  });

  it("replaces a copy held behind the lock too", () => {
    const gate = gated();
    show(REFUSED, "error");
    gate({ open: false });                                 // locked: the one on screen is held
    show(REFUSED, "error");                                // answered behind the lock
    gate({ open: true });
    expect(cards()).toHaveLength(1);
  });
});

describe("the toast stack over a dialog", () => {
  // At 390 x 380 a dialog fills the screen and its sticky footer (Save, Cancel) sits where the
  // stack does. While one is open the stack moves to the top — a rule keyed on <body>'s mark.
  it("moves to the top while a dialog is open", () => {
    mount();
    expect(MODAL_OPEN).toBe("data-modal-open");
    expect(region().className.split(/\s+/)).toEqual(expect.arrayContaining([
      "bottom-4", "[body[data-modal-open]_&]:bottom-auto", "[body[data-modal-open]_&]:top-4",
    ]));
  });
});

// The live shell closes the provider while the screen is locked (and on every step screen), and
// moves its session at every sign-out and sign-in. A write that began before the lock answers
// whenever the server does — and its refusal names a bed or an account.
describe("toasts behind a closed shell", () => {
  /** Nothing of any toast anywhere in the region: the stack and both live regions. */
  const nothingDrawn = () => {
    expect(cards()).toHaveLength(0);
    expect(polite()).toBeEmptyDOMElement();
    expect(alerts()).toBeEmptyDOMElement();
  };

  it("draw nothing raised while closed — not even in a live region — and show it on reopening the same session", () => {
    const gate = gated();
    const spoken = polite();
    const alarm = alerts();
    gate({ open: false });
    show("Çarpayı 4 · news2: icazə yoxdur", "error");
    show("Yadda saxlanıldı");
    nothingDrawn();
    expect(document.body).not.toHaveTextContent("Çarpayı 4");
    gate({ open: true });
    expect(card("Çarpayı 4 · news2: icazə yoxdur")).not.toBeNull();
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    // Announced from the regions that stood empty through the lock — never one born with its text.
    expect(polite()).toBe(spoken);
    expect(alerts()).toBe(alarm);
    expect(alerts()).toHaveTextContent(/^Xəta: Çarpayı 4 · news2: icazə yoxdur$/);
    expect(polite()).toHaveTextContent(/^Yadda saxlanıldı$/);
  });

  it("take the ones on screen at closing out of sight, and bring them back on reopening", () => {
    const gate = gated();
    show("Yadda saxlanıldı");
    show("Bağlantı yavaşdır", "warn");
    gate({ open: false });
    nothingDrawn();
    gate({ open: true });
    expect(cards().map((el) => el.textContent)).toEqual(["Yadda saxlanıldı", "Bağlantı yavaşdır"]);
  });

  it("keep an error through a lock and an unlock, however long the lock", () => {
    const gate = gated();
    show("Saxlanılmadı", "error");
    gate({ open: false });
    nothingDrawn();
    act(() => vi.advanceTimersByTime(60 * 60 * 1000));
    gate({ open: true });
    expect(alerts()).toHaveTextContent(/^Xəta: Saxlanılmadı$/);
    fireEvent.click(within(card("Saxlanılmadı")).getByRole("button", { name: "Bağla" }));
    expect(card("Saxlanılmadı")).toBeNull();
  });

  it("do not spend a confirmation's time while closed: it resumes with what it had left", () => {
    const gate = gated();
    show("Yadda saxlanıldı");
    act(() => vi.advanceTimersByTime(2000));
    gate({ open: false });
    act(() => vi.advanceTimersByTime(60000));
    nothingDrawn();
    gate({ open: true });
    act(() => vi.advanceTimersByTime(TOAST_MS - 2000 - 1));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  // Focus in a toast pauses it. The lock moves focus out of it while it is being held — first the
  // provider's own blur, then the lock screen's passive effect — and that blur must not restart
  // the clock behind the lock: it would run out there, and the toast come back with none.
  it("keep the time of one that had focus at the lock, and close it on time after the unlock", () => {
    const gate = gated();
    show("Yadda saxlanıldı");
    act(() => vi.advanceTimersByTime(1000));
    within(card("Yadda saxlanıldı")).getByRole("button", { name: "Bağla" }).focus();
    act(() => vi.advanceTimersByTime(5000));                // paused: focus is in it
    gate({ open: false });
    expect(document.activeElement).toBe(screen.getByLabelText("kilid"));
    act(() => vi.advanceTimersByTime(60000));
    nothingDrawn();
    gate({ open: true });
    act(() => vi.advanceTimersByTime(TOAST_MS - 1000 - 1));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  // The pointer on a toast pauses it too, and no mouseleave ever comes for a card the lock took
  // away: letting go of it must not restart the clock of a toast that is now held.
  it("keep the time of one under the pointer at the lock, and close it on time after the unlock", () => {
    const gate = gated();
    show("Yadda saxlanıldı");
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.mouseEnter(card("Yadda saxlanıldı"));
    act(() => vi.advanceTimersByTime(5000));                // paused: the pointer is on it
    gate({ open: false });
    act(() => vi.advanceTimersByTime(60000));
    nothingDrawn();
    gate({ open: true });
    act(() => vi.advanceTimersByTime(TOAST_MS - 1000 - 1));
    expect(card("Yadda saxlanıldı")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(card("Yadda saxlanıldı")).toBeNull();
  });

  it("drop every toast at a new session, on screen and held alike", () => {
    const gate = gated();
    show("birinci");
    gate({ open: true, session: "s2" });                 // another account, straight in
    nothingDrawn();
    show("ikinci", "error");
    gate({ open: false, session: "s2" });                // locked: held
    show("üçüncü", "error");                             // answered behind the lock: held
    gate({ open: false, session: "s3" });                // signed out from the lock screen
    gate({ open: true, session: "s3" });                 // the next session opens
    nothingDrawn();
  });

  it("never show one raised through an earlier session's useToast()", () => {
    const gate = gated();
    const earlier = api;                                 // a screen's toast, captured mid-write
    gate({ open: false, session: "s2" });                // signed out and back in...
    gate({ open: true, session: "s2" });
    act(() => { earlier("Çarpayı 4 · news2: icazə yoxdur", "error"); }); // ...then it answers
    nothingDrawn();
    gate({ open: false, session: "s2" });
    gate({ open: true, session: "s2" });
    nothingDrawn();
  });

  it(`keep at most ${TOAST_MAX} when held ones come back, errors outliving confirmations`, () => {
    const gate = gated();
    show("xəta 1", "error");
    show("qeyd 1");
    show("qeyd 2");
    gate({ open: false });
    for (let i = 3; i <= TOAST_MAX + 1; i += 1) show(`qeyd ${i}`);
    nothingDrawn();
    gate({ open: true });
    // TOAST_MAX + 2 raised, so two go: the two oldest confirmations, never the error.
    const kept = ["xəta 1"];
    for (let i = 3; i <= TOAST_MAX + 1; i += 1) kept.push(`qeyd ${i}`);
    expect(cards().map((el) => el.textContent)).toEqual(kept);
  });
});
