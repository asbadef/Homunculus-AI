import { describe, it, expect } from "vitest";
import { useLayoutEffect, useRef } from "react";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { Alert } from "./Alert.jsx";

describe("Alert", () => {
  it("announces a refusal at once (role=alert), with an icon", () => {
    const { container } = render(<Alert>İstifadəçi adı və ya şifrə səhvdir.</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("İstifadəçi adı və ya şifrə səhvdir.");
    expect(alert).toHaveAttribute("data-tone", "crit");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("announces a confirmation politely (role=status)", () => {
    render(<Alert tone="info">Təhlükəsiz çıxış edildi.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("Təhlükəsiz çıxış edildi.");
  });

  it("treats a tone it does not have as a refusal", () => {
    render(<Alert tone="green">Kod səhvdir.</Alert>);
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "crit");
  });
});

describe("Alert as a live region", () => {
  it("a notice's status region is on the page empty first, and holds its text after mount", () => {
    // Markup before any effect has run (what a screen reader meets when the region is inserted).
    const first = renderToString(<Alert tone="info">Təhlükəsiz çıxış edildi.</Alert>);
    expect(first).toContain('role="status"');
    expect(first).not.toContain("Təhlükəsiz");

    // And in the DOM: empty when the layout effects of the first commit run, filled after.
    let during = null;
    function Spy({ children }) {
      const ref = useRef(null);
      useLayoutEffect(() => { during = ref.current.querySelector('[role="status"]').textContent; });
      return <div ref={ref}>{children}</div>;
    }
    render(<Spy><Alert tone="info">Təhlükəsiz çıxış edildi.</Alert></Spy>);
    expect(during).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Təhlükəsiz çıxış edildi.");
  });

  it("keeps the same region while its text changes", () => {
    const { rerender } = render(<Alert tone="info">bir</Alert>);
    const region = screen.getByRole("status");
    rerender(<Alert tone="info">iki</Alert>);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("iki");
  });

  it("a refusal is rendered with its text at once", () => {
    expect(renderToString(<Alert>Kod səhvdir.</Alert>)).toContain("Kod səhvdir.");
  });
});
