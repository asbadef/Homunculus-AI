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
  it("renders all six cell labels", async () => {
    await render(<VitalsRow latest={latest()} />);
    expect(screen.getByText("NABIZ")).toBeTruthy();
    expect(screen.getByText("OAB")).toBeTruthy();
    expect(screen.getByText("LAKTAT")).toBeTruthy();
    expect(screen.getByText("SpO2")).toBeTruthy();
    expect(screen.getByText("Ateş")).toBeTruthy();
    expect(screen.getByText("SOFA")).toBeTruthy();
  });

  it("shows an em dash for every null vital", async () => {
    await render(<VitalsRow latest={latest()} />);
    expect(screen.getAllByText("—").length).toBe(6);
  });

  it("renders a present value alongside its unit", async () => {
    await render(<VitalsRow latest={latest({ map: 70 })} />);
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("mmHg")).toBeTruthy();
  });

  it("shows each cell's unit line, and none for the unitless SOFA score", async () => {
    await render(<VitalsRow latest={latest({ sofa: 4 })} />);
    expect(screen.getByText("/dk")).toBeTruthy(); // HR only — RR isn't one of the six slots
    expect(screen.getByText("mmol/L")).toBeTruthy(); // LAKTAT
    expect(screen.getByText("%")).toBeTruthy();
    expect(screen.getByText("°C")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });
});
