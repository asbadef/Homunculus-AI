import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PatientList } from "./PatientList.jsx";

const patients = [
  { patient_id: "bed-3", risk: "critical", alerts: [], latest: {} },
  { patient_id: "bed-5", risk: "none", alerts: [], latest: {} },
];

describe("PatientList", () => {
  it("renders a row per patient with its risk label", () => {
    render(<PatientList patients={patients} selected={null} onSelect={() => {}} />);
    expect(screen.getByText("bed-3")).toBeInTheDocument();
    expect(screen.getByText("Kritik")).toBeInTheDocument();
    expect(screen.getByText("Stabil")).toBeInTheDocument();
  });

  it("calls onSelect with the patient id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<PatientList patients={patients} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("bed-3"));
    expect(onSelect).toHaveBeenCalledWith("bed-3");
  });
});
