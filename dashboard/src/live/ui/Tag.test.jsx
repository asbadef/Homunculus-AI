import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tag, Pill, StatusPill, STATUS_TONES } from "./Tag.jsx";

describe("Tag", () => {
  it.each([
    ["neutral", "border-line2"],
    ["warn", "text-att-ink"],
    ["crit", "text-crit-ink"],
  ])("%s tone uses %s", (tone, cls) => {
    render(<Tag tone={tone}>Məcburi · qurulmayıb</Tag>);
    const tag = screen.getByText("Məcburi · qurulmayıb");
    expect(tag).toHaveAttribute("data-tone", tone);
    expect(tag.className).toContain(cls);
  });

  it("falls back to neutral for a tone it does not have", () => {
    render(<Tag tone="loud">x</Tag>);
    expect(screen.getByText("x")).toHaveAttribute("data-tone", "neutral");
  });
});

describe("Pill", () => {
  it("is a soft label with an optional icon", () => {
    render(<Pill icon="ok">Açıq</Pill>);
    const pill = screen.getByText("Açıq");
    expect(pill.className).toContain("bg-card2");
    expect(pill.querySelector("svg")).not.toBeNull();
  });
});

describe("StatusPill", () => {
  it("knows the five severity tones and neutral", () => {
    expect(STATUS_TONES).toEqual(["crit", "high", "mid", "low", "ok", "neutral"]);
  });

  it.each(["crit", "high", "mid", "low", "ok"])("%s writes its label in the tone's ink", (tone) => {
    render(<StatusPill tone={tone}>etiket</StatusPill>);
    const pill = screen.getByText("etiket");
    expect(pill).toHaveAttribute("data-tone", tone);
    expect(pill.className).toContain(`text-${tone}-ink`);
  });

  it("falls back to neutral, never to a colour, for a tone it does not have", () => {
    render(<StatusPill tone="green">x</StatusPill>);
    expect(screen.getByText("x")).toHaveAttribute("data-tone", "neutral");
  });
});
