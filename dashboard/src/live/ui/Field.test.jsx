import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { Field, Input, Select, Textarea } from "./Field.jsx";

describe("Field", () => {
  it("ties its label to the control", () => {
    render(<Field label="İstifadəçi adı"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı").tagName).toBe("INPUT");
  });

  it("reads the hint with the control", () => {
    render(<Field label="İstifadəçi adı" hint="Kiçik hərf, rəqəm, nöqtə"><Input /></Field>);
    expect(screen.getByLabelText("İstifadəçi adı")).toHaveAccessibleDescription("Kiçik hərf, rəqəm, nöqtə");
  });

  it("marks a required field on the label and, for assistive tech, on the control", () => {
    const { container } = render(<Field label="Rol" required><Select><option>Hekim</option></Select></Field>);
    const control = screen.getByRole("combobox");
    expect(control).toHaveAttribute("aria-required", "true");
    expect(control).not.toHaveAttribute("required");
    expect(container.querySelector("label [aria-hidden='true']")).toHaveTextContent("*");
  });

  it("keeps the native required when the caller sets it on the control", () => {
    render(<Field label="Rol" required><Select required><option>Hekim</option></Select></Field>);
    expect(screen.getByRole("combobox")).toHaveAttribute("required");
  });

  it("shows an error: invalid control, the message read first, in critical ink with an icon", () => {
    render(
      <Field label="E-poçt" hint="korporativ ünvan" error="Ünvan yanlışdır">
        <Input id="email" aria-describedby="elsewhere" />
      </Field>,
    );
    const input = screen.getByLabelText("E-poçt");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("email-error elsewhere email-hint");
    const message = document.getElementById("email-error");
    expect(message).toHaveTextContent("Ünvan yanlışdır");
    expect(message.className).toContain("text-crit-ink");
    expect(message.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("without an error leaves aria-invalid alone", () => {
    render(<Field label="Ad"><Input /></Field>);
    expect(screen.getByLabelText("Ad")).not.toHaveAttribute("aria-invalid");
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
  it("draw a critical border when invalid", () => {
    render(<><Input aria-label="a" /><Select aria-label="b" /></>);
    expect(screen.getByLabelText("a").className).toContain("aria-[invalid=true]:border-crit");
    expect(screen.getByLabelText("b").className).toContain("aria-[invalid=true]:border-crit");
  });

  it("forward their refs and props", () => {
    const input = createRef();
    const select = createRef();
    render(<><Input ref={input} placeholder="ör. hs.aygun" /><Select ref={select} defaultValue="b"><option value="a">A</option><option value="b">B</option></Select></>);
    expect(input.current).toHaveAttribute("placeholder", "ör. hs.aygun");
    expect(select.current.value).toBe("b");
  });
});

// G2-B3b: the handover note's four parts — a Field ties its label, hint and error to it as to an Input.
describe("Textarea", () => {
  it("is labelled, described and marked invalid by its Field, with the controls' critical border", () => {
    render(<Field label="D · Durum" hint="ad yazmayın" error="Notu yazın"><Textarea id="part" /></Field>);
    const box = screen.getByRole("textbox", { name: "D · Durum" });
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box.getAttribute("aria-describedby")).toBe("part-error part-hint");
    expect(box.className).toContain("aria-[invalid=true]:border-crit");
    expect(box).toHaveAttribute("rows", "3");
  });

  it("forwards its ref and props", () => {
    const ref = createRef();
    render(<Textarea ref={ref} aria-label="n" maxLength={2000} rows={5} />);
    expect(ref.current).toHaveAttribute("maxlength", "2000");
    expect(ref.current).toHaveAttribute("rows", "5");
  });
});
