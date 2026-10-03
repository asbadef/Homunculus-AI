import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button.jsx";
import { FOCUS_RING } from "./focus.js";

const classes = (el) => el.className.split(/\s+/);

describe("Button", () => {
  it("is type=button unless told otherwise", () => {
    render(<><Button>Yadda saxla</Button><Button type="submit">Göndər</Button></>);
    expect(screen.getByRole("button", { name: "Yadda saxla" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Göndər" })).toHaveAttribute("type", "submit");
  });

  it.each([
    ["default", ["bg-card", "text-ink", "border-line2"]],
    ["primary", ["bg-pri", "text-onpri"]],
    ["danger", ["bg-crit", "text-oncrit"]],
    ["ghost", ["bg-transparent", "text-mute"]],
  ])("paints the %s variant from the tokens", (variant, expected) => {
    render(<Button variant={variant}>x</Button>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(expected));
  });

  it.each([["sm", "text-12"], ["md", "text-13"], ["lg", "text-14.5"]])("size %s uses %s", (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(classes(screen.getByRole("button"))).toContain(cls);
  });

  it("shows a keyboard focus outline", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(FOCUS_RING.split(" ")));
  });

  it("names an icon-only button by its label, and hides the icon itself", () => {
    render(<Button variant="ghost" size="sm" icon="edit" label="Düzəliş et" />);
    const button = screen.getByRole("button", { name: "Düzəliş et" });
    expect(button).toHaveAttribute("title", "Düzəliş et");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("does not click while disabled", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards its ref to the <button>", () => {
    const ref = createRef();
    render(<Button ref={ref}>x</Button>);
    expect(ref.current.tagName).toBe("BUTTON");
  });

  it("while busy says so, stays focusable and ignores clicks", () => {
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>Yadda saxla</Button>);
    const button = screen.getByRole("button", { name: "Yadda saxla" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(classes(button)).toEqual(expect.arrayContaining(["aria-disabled:opacity-45", "aria-busy:cursor-wait"]));
  });

  it("while busy does not submit its form", () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit" busy>Göndər</Button></form>);
    fireEvent.click(screen.getByRole("button", { name: "Göndər" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clicks again once no longer busy", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button busy onClick={onClick}>x</Button>);
    rerender(<Button onClick={onClick}>x</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });

  it.each(["sm", "md", "lg"])("draws its icon at 16 px at size %s, as the prototype's .btn svg", (size) => {
    render(<Button size={size} icon="plus">x</Button>);
    const svg = screen.getByRole("button").querySelector("svg");
    expect(svg).toHaveAttribute("width", "16");
    expect(svg).toHaveAttribute("height", "16");
  });

  it("takes a 0 as content, not as an icon-only button", () => {
    render(<Button icon="minus" label="Sayğac">{0}</Button>);
    const button = screen.getByRole("button", { name: "0" });
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("title");
  });
});
