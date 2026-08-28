/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { VitalSparkline } from "../src/ui/VitalSparkline";
import { VitalTile } from "../src/ui/VitalTile";

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

describe("VitalTile", () => {
  it("shows the value and unit", async () => {
    await render(<VitalTile label="OAB" value={62} unit="mmHg" values={[]} tone="warning" />);
    expect(screen.getByText("62")).toBeTruthy();
    expect(screen.getByText("mmHg")).toBeTruthy();
  });

  it("says there is no data rather than printing a dash with no explanation", async () => {
    await render(<VitalTile label="Kalp hızı" value={null} unit="/dk" values={[]} tone="muted" />);
    expect(screen.getByText("veri yok")).toBeTruthy();
  });

  it("carries a staleness badge when the finding named stale inputs", async () => {
    await render(
      <VitalTile label="OAB" value={62} unit="mmHg" values={[]} tone="warning" staleInputs={["MAP"]} />,
    );
    expect(screen.getByLabelText("staleness-badge")).toBeTruthy();
  });
});
