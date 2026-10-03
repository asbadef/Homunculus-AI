import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskPill } from "./RiskPill.jsx";
import { I18nProvider } from "../i18n/I18nProvider.jsx";

afterEach(() => localStorage.clear());

describe("RiskPill", () => {
  it("labels the risk in Azerbaijani by default, in its tone, with an icon", () => {
    render(<><RiskPill risk="moderate" /><RiskPill risk="high" /></>);
    expect(screen.getByText("Orta")).toHaveAttribute("data-tone", "mid");
    expect(screen.getByText("Yüksək")).toHaveAttribute("data-tone", "high");
    expect(screen.getByText("Orta").querySelector("svg")).not.toBeNull();
  });

  it("follows the chosen language", () => {
    localStorage.setItem("hmc.lang", "ru");
    render(<I18nProvider><RiskPill risk="moderate" /></I18nProvider>);
    expect(screen.getByText("Средний")).toBeInTheDocument();
  });

  it("says when nothing was measured", () => {
    render(<RiskPill risk="none" measured={false} />);
    expect(screen.getByText("Ölçülməyib")).toHaveAttribute("data-tone", "neutral");
  });

  it("shows an unrecognised value as it came, neutral", () => {
    render(<RiskPill risk="stable" />);
    expect(screen.getByText("Naməlum risk: stable")).toHaveAttribute("data-tone", "neutral");
  });
});
