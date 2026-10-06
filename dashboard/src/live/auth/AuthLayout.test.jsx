import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nProvider.jsx";
import { AuthLayout, stepOf } from "./AuthLayout.jsx";

describe("AuthLayout", () => {
  it("counts the steps after the password: TOTP 2/3, the password change 3/3", () => {
    expect(stepOf("mfa", { mfa: true, password: true })).toEqual({ current: 2, total: 3 });
    expect(stepOf("password", { mfa: true, password: true })).toEqual({ current: 3, total: 3 });
    expect(stepOf("password", { mfa: false, password: true })).toEqual({ current: 2, total: 2 });
    expect(stepOf("signedOut", { mfa: false, password: false })).toBeUndefined();
  });

  it("keeps the hero out of the accessibility tree; the form's title is the page's h1", () => {
    const { container } = render(<I18nProvider><AuthLayout><h1>Daxil olun</h1></AuthLayout></I18nProvider>);
    const hero = container.querySelector("[data-theme='gece']");
    expect(hero).toHaveAttribute("aria-hidden", "true");
    expect(hero).toHaveTextContent("Hər çarpayı, hər növbə — bir baxışda.");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByRole("button", { name: "AZ · Dil" })).toBeInTheDocument();
  });
});
