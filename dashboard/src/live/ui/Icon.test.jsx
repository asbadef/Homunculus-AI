import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon.jsx";
import { ICONS, ICON_NAMES } from "./icons.js";

afterEach(() => vi.restoreAllMocks());

describe("Icon", () => {
  it("has the prototype's 53 icons plus the top bar's two", () => {
    expect(ICON_NAMES).toHaveLength(55);
    for (const name of ["grid", "bell", "alert", "clock", "ok", "x", "moon", "sun", "fullscreen", "keyboard"]) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  it.each(ICON_NAMES)("draws %s as a 24x24 currentColor stroke drawing", (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.children).toHaveLength(ICONS[name].length);
  });

  it("is hidden from assistive technology unless it is given a label", () => {
    const { container } = render(<Icon name="bell" />);
    expect(container.querySelector("svg").getAttribute("aria-hidden")).toBe("true");
    render(<Icon name="bell" label="Bildirişlər" />);
    expect(screen.getByRole("img", { name: "Bildirişlər" })).toBeInTheDocument();
  });

  it("takes a size in px", () => {
    const { container } = render(<Icon name="bell" size={22} />);
    expect(container.querySelector("svg").getAttribute("width")).toBe("22");
  });

  it("draws the fallback for an unknown name, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Icon name="nope" />);
    expect(container.querySelectorAll("svg rect")).toHaveLength(4); // grid
    expect(warn).toHaveBeenCalled();
  });
});
