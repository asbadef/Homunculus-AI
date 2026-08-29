/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { Waveform } from "../src/ui/Waveform";

describe("Waveform", () => {
  it("exposes one accessible label for the whole strip", async () => {
    await render(<Waveform hr={82} />);
    expect(screen.getByLabelText("waveform")).toBeTruthy();
  });

  it("shows the current bpm readout", async () => {
    await render(<Waveform hr={82} />);
    expect(screen.getByText("82")).toBeTruthy();
  });
});
