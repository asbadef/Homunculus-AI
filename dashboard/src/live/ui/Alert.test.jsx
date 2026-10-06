import { describe, it, expect, vi, afterEach } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { renderToString } from "react-dom/server";
import { act, render, screen } from "@testing-library/react";
import { Alert, ANNOUNCE_DELAY_MS } from "./Alert.jsx";

afterEach(() => vi.useRealTimers());

describe("Alert", () => {
  it("announces a refusal at once (role=alert), with an icon", () => {
    const { container } = render(<Alert>İstifadəçi adı və ya şifrə səhvdir.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("İstifadəçi adı və ya şifrə səhvdir.");
    expect(alert).toHaveAttribute("data-tone", "crit");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("treats a tone it does not have as a refusal", () => {
    render(<Alert tone="green">Kod səhvdir.</Alert>);
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "crit");
  });

  it("a refusal is rendered with its text at once", () => {
    expect(renderToString(<Alert>Kod səhvdir.</Alert>)).toContain("Kod səhvdir.");
  });
});

describe("Alert as a polite notice", () => {
  const TEXT = "Təhlükəsiz çıxış edildi.";

  it("shows its text at once, and keeps the box out of the accessibility tree", () => {
    const { container } = render(<Alert tone="info">{TEXT}</Alert>);
    const box = container.querySelector('[data-tone="info"]');
    expect(box).toHaveTextContent(TEXT);
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // the only live region is the hidden one: nothing is announced twice
    expect(container.querySelectorAll("[role]")).toHaveLength(1);
  });

  it("its hidden status region is empty until the delay has passed, then holds the text", () => {
    vi.useFakeTimers();
    render(<Alert tone="info">{TEXT}</Alert>);
    const region = screen.getByRole("status");
    expect(region).toHaveClass("sr-only");
    expect(region).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS - 1));
    expect(region).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent(TEXT);
  });

  it("is on the page empty in the first commit, and in server markup", () => {
    expect(renderToString(<Alert tone="info">{TEXT}</Alert>)).toMatch(/role="status"[^>]*><\/div>/);
    let during = null;
    function Spy({ children }) {
      const ref = useRef(null);
      useLayoutEffect(() => { during = ref.current.querySelector('[role="status"]').textContent; });
      return <div ref={ref}>{children}</div>;
    }
    render(<Spy><Alert tone="info">{TEXT}</Alert></Spy>);
    expect(during).toBe("");
  });

  it("unmounting before the delay says nothing and leaves no timer", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Alert tone="info">{TEXT}</Alert>);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the same region while its text changes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Alert tone="info">bir</Alert>);
    const region = screen.getByRole("status");
    act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
    expect(region).toHaveTextContent("bir");
    rerender(<Alert tone="info">iki</Alert>);
    act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("iki");
  });
});
