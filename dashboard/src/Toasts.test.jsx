import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toasts } from "./Toasts.jsx";

const note = { patient_id: "bed-3", body: "bed-3: Septik şok", trigger: "escalation", ts: "t" };

describe("Toasts", () => {
  it("renders a toast for each notification", () => {
    render(<Toasts toasts={[{ id: 1, note }]} onDismiss={() => {}} onSelect={() => {}} />);
    expect(screen.getByText(/Septik şok/)).toBeInTheDocument();
  });

  it("calls onDismiss when closed", () => {
    const onDismiss = vi.fn();
    render(<Toasts toasts={[{ id: 1, note }]} onDismiss={onDismiss} onSelect={() => {}} />);
    fireEvent.click(screen.getByLabelText("kapat"));
    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it("calls onSelect with the patient when the toast body is clicked", () => {
    const onSelect = vi.fn();
    render(<Toasts toasts={[{ id: 1, note }]} onDismiss={() => {}} onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/Septik şok/));
    expect(onSelect).toHaveBeenCalledWith("bed-3");
  });
});
