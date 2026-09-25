// dashboard/src/ui.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field, ActionOverlay, inputCls, btnCls } from "./ui.jsx";
import { getTheme } from "./clinicalTheme.js";

const T = getTheme("icu");

describe("ui primitives", () => {
  it("Field renders its label, children and hint", () => {
    render(<Field T={T} label="Ad Soyad" hint="Zorunlu"><input aria-label="ad" /></Field>);
    expect(screen.getByText("Ad Soyad")).toBeInTheDocument();
    expect(screen.getByLabelText("ad")).toBeInTheDocument();
    expect(screen.getByText("Zorunlu")).toBeInTheDocument();
  });

  it("ActionOverlay shows a title and closes from its button", () => {
    const onClose = vi.fn();
    render(<ActionOverlay T={T} title="Başlık" onClose={onClose}><p>içerik</p></ActionOverlay>);
    expect(screen.getByText("Başlık")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("class helpers produce theme-bound class strings", () => {
    expect(inputCls(T)).toContain(T.input);
    expect(btnCls(T, "danger")).toContain(T.danger);
    expect(btnCls(T)).toContain(T.primary);
  });
});
