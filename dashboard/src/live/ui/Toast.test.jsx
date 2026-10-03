import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ToastProvider, useToast, TOAST_MS } from "./Toast.jsx";

function Fire({ message, tone }) {
  const toast = useToast();
  return <button type="button" onClick={() => toast(message, tone)}>{`fire ${message}`}</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const region = () => screen.getByRole("region", { name: "Bildirişlər" });

describe("toasts", () => {
  it("have a named live region before the first toast", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    expect(region().firstChild).toHaveAttribute("aria-live", "polite");
    expect(region().firstChild).toBeEmptyDOMElement();
  });

  it("show the message, and disappear after 3.6 s", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    expect(within(region()).getByText("Yadda saxlanıldı")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(within(region()).getByText("Yadda saxlanıldı")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(within(region()).queryByText("Yadda saxlanıldı")).toBeNull();
  });

  it("close at once from their close button", () => {
    render(<ToastProvider><Fire message="Yadda saxlanıldı" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire Yadda saxlanıldı"));
    fireEvent.click(within(region()).getByRole("button", { name: "Bağla" }));
    expect(within(region()).queryByText("Yadda saxlanıldı")).toBeNull();
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
    expect(within(region()).getByText("xəta").parentElement).toHaveAttribute("data-tone", "error");
    expect(within(region()).getByText("nə").parentElement).toHaveAttribute("data-tone", "ok");
  });
});
