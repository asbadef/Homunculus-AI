import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
