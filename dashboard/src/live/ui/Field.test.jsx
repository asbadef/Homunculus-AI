import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { Field, Input, Select } from "./Field.jsx";

describe("Field", () => {
  it("ties its label to the control", () => {
    render(<Field label="İstifadəçi adı"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı").tagName).toBe("INPUT");
  });

  it("reads the hint with the control", () => {
    render(<Field label="İstifadəçi adı" hint="Kiçik hərf, rəqəm, nöqtə"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı")).toHaveAccessibleDescription("Kiçik hərf, rəqəm, nöqtə");
  });

  it("marks a required field on the label and on the control", () => {
    const { container } = render(<Field label="Rol" required><Select><option>Hekim</option></Select></Field>);
    expect(screen.getByRole("combobox")).toBeRequired();
    expect(container.querySelector("label [aria-hidden='true']")).toHaveTextContent("*");
  });

  it("keeps the control's own id and description", () => {
    render(
      <Field label="E-poçt" hint="korporativ ünvan">
        <Input id="email" aria-describedby="elsewhere" />
      </Field>,
    );
    const input = screen.getByLabelText("E-poçt");
    expect(input).toHaveAttribute("id", "email");
    expect(input.getAttribute("aria-describedby")).toBe("elsewhere email-hint");
  });

  it("puts the label above the control in the col layout", () => {
    const { container } = render(<Field label="Ad" layout="col"><Input /></Field>);
    expect(container.firstChild.className).toContain("grid-cols-1");
    expect(container.firstChild.className).not.toContain("grid-cols-[150px_1fr]");
  });
});

describe("Input and Select", () => {
  it("forward their refs and props", () => {
    const input = createRef();
    const select = createRef();
    render(<><Input ref={input} placeholder="ör. hs.aygun" /><Select ref={select} defaultValue="b"><option value="a">A</option><option value="b">B</option></Select></>);
    expect(input.current).toHaveAttribute("placeholder", "ör. hs.aygun");
    expect(select.current.value).toBe("b");
  });
});
