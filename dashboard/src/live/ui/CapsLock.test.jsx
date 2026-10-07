import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { ANNOUNCE_DELAY_MS } from "./Alert.jsx";
import { CapsWarning, useCapsLock } from "./CapsLock.jsx";
import { Input } from "./Field.jsx";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function Form() {
  const caps = useCapsLock();
  return (
    <>
      <Input aria-label="Şifrə" type="password" {...caps.keys} />
      <CapsWarning shown={caps.shown} />
    </>
  );
}

const show = () => render(<I18nProvider><Form /></I18nProvider>);
const field = () => screen.getByLabelText("Şifrə");
const CAPS = "Caps Lock açıqdır";

describe("useCapsLock / CapsWarning", () => {
  it("says nothing until a key says Caps Lock is on, and goes when it is off again", () => {
    show();
    expect(screen.queryByText(CAPS)).toBeNull();
    fireEvent.keyDown(field(), { key: "A", modifierCapsLock: true });
    expect(screen.getByText(CAPS)).toBeInTheDocument();
    fireEvent.keyUp(field(), { key: "a", modifierCapsLock: false });
    expect(screen.queryByText(CAPS)).toBeNull();
  });

  it("shows it hidden from assistive technology and says it in a region that was already there", () => {
    vi.useFakeTimers();
    show();
    const region = screen.getByRole("status");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement();              // mounted empty: a region born with its text is not announced
    act(() => { fireEvent.keyDown(field(), { key: "A", modifierCapsLock: true }); });
    expect(screen.getByText(CAPS)).toHaveAttribute("aria-hidden", "true");
    expect(region).toBeEmptyDOMElement();
    act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS); });
    expect(screen.getByRole("status")).toBe(region);   // the same region, now with the text
    expect(region).toHaveTextContent(CAPS);
    act(() => { fireEvent.keyUp(field(), { key: "a", modifierCapsLock: false }); });
    expect(region).toBeEmptyDOMElement();              // emptied, so the next time is a change again
  });

  it("leaves no timer behind", () => {
    vi.useFakeTimers();
    const { unmount } = show();
    act(() => { fireEvent.keyDown(field(), { key: "A", modifierCapsLock: true }); });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
