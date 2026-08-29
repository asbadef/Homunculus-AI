/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { VitalsRow } from "../src/ui/VitalsRow";
import type { LatestVitals } from "../src/transport/types";

function latest(overrides: Partial<LatestVitals> = {}): LatestVitals {
  return {
    heart_rate: null,
    map: null,
    spo2: null,
    temperature: null,
    resp_rate: null,
    lactate: null,
    sofa: null,
    ...overrides,
  };
}

describe("VitalsRow", () => {
  it("renders all five cell labels", async () => {
    await render(<VitalsRow latest={latest()} />);
    expect(screen.getByText("NB")).toBeTruthy();
    expect(screen.getByText("OAB")).toBeTruthy();
    expect(screen.getByText("SpO2")).toBeTruthy();
    expect(screen.getByText("Ateş")).toBeTruthy();
    expect(screen.getByText("SS")).toBeTruthy();
  });

  it("shows an em dash for every null vital", async () => {
    await render(<VitalsRow latest={latest()} />);
    expect(screen.getAllByText("—").length).toBe(5);
  });

  it("renders a present value alongside its unit", async () => {
    await render(<VitalsRow latest={latest({ map: 70 })} />);
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("mmHg")).toBeTruthy();
  });

  it("shows each cell's unit line", async () => {
    await render(<VitalsRow latest={latest()} />);
    expect(screen.getAllByText("/dk").length).toBe(2); // HR + RR
    expect(screen.getByText("%")).toBeTruthy();
    expect(screen.getByText("°C")).toBeTruthy();
  });
});
