import { describe, it, expect } from "vitest";
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
