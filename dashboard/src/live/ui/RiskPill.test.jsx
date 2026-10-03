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

  it("never claims 'no finding' for a card it was not told was measured (identity-only card)", () => {
    render(<RiskPill risk="none" />);
    expect(screen.getByText("Ölçülməyib")).toBeInTheDocument();
    expect(screen.queryByText("Tapıntı yoxdur")).toBeNull();
  });

  it("says 'no finding' on a measured card", () => {
    render(<RiskPill risk="none" measured />);
    expect(screen.getByText("Tapıntı yoxdur")).toHaveAttribute("data-tone", "neutral");
  });

  it("shows an unrecognised value as it came, in the attention look", () => {
    render(<RiskPill risk="stable" />);
    expect(screen.getByText("Naməlum risk: stable")).toHaveAttribute("data-tone", "att");
  });

  it("says so, in the attention look, when the engine sent no risk", () => {
    render(<><RiskPill risk={null} /><RiskPill /></>);
    const pills = screen.getAllByText("Risk bildirilməyib");
    expect(pills).toHaveLength(2);
    for (const pill of pills) expect(pill).toHaveAttribute("data-tone", "att");
  });

  it("names the missing risk in every language", () => {
    localStorage.setItem("hmc.lang", "ru");
    render(<I18nProvider><RiskPill risk="" /></I18nProvider>);
    expect(screen.getByText("Риск не передан")).toHaveAttribute("data-tone", "att");
  });
});
