/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { WardList } from "../src/ui/WardList";
import type { PatientView } from "../src/store/boardStore";
import type { PatientBoard } from "../src/transport/types";

function view(id: string, risk: PatientBoard["risk"]): PatientView {
  const board: PatientBoard = {
    patient_id: id, risk, alerts: [],
    latest: { heart_rate: null, map: 70, spo2: null, temperature: null, resp_rate: null, lactate: null, sofa: 0 },
  };
  return {
    board, top: null, tone: "muted", escalated: false, unacknowledged: false,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [], sofa: [] },
  };
}

describe("WardList", () => {
  it("shows skeletons while the first frame has not arrived", async () => {
    await render(<WardList ward={[]} loading onSelect={() => {}} />);
    expect(screen.getAllByLabelText("skeleton").length).toBeGreaterThan(0);
  });

  it("says the ward is empty once loading is done and nothing arrived", async () => {
    await render(<WardList ward={[]} loading={false} onSelect={() => {}} />);
    expect(screen.getByText("Koğuşta gösterilecek yatak yok.")).toBeTruthy();
  });

  it("renders one card per bed in the order it was given", async () => {
    await render(
      <WardList
        ward={[view("bed-3", "critical"), view("bed-5", "none")]}
        loading={false}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();
    expect(screen.getByLabelText("patient-card-bed-5")).toBeTruthy();
  });
});
