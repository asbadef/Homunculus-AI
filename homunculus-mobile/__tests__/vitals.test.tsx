/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { VitalSparkline } from "../src/ui/VitalSparkline";

describe("VitalSparkline", () => {
  it("renders nothing for a series too short to draw", async () => {
    await render(<VitalSparkline values={[1]} width={100} height={10} tone="safe" />);
    expect(screen.queryByLabelText("sparkline")).toBeNull();
  });

  it("draws the path the geometry function produced", async () => {
    await render(<VitalSparkline values={[0, 1]} width={100} height={10} tone="safe" />);
    expect(screen.getByLabelText("sparkline")).toBeTruthy();
  });
});
