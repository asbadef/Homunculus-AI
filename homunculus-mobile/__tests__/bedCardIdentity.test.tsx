/// <reference types="jest" />
import { render, screen } from "@testing-library/react-native";

import { BedCard } from "../src/ui/BedCard";
import type { PatientView } from "../src/store/boardStore";
import type { BoardIdentity, PatientBoard } from "../src/transport/types";

const IDENTITY: BoardIdentity = {
  patient_id: "bed-3",
  display_name: "AYSE YILMAZ",
  bed_label: "YB 304-2",
  state: "admitted",
  source: "comed",
  updated_at: "2026-09-04T14:30:00+00:00",
};

function view(identity: BoardIdentity | null): PatientView {
  const board: PatientBoard = {
    patient_id: "bed-3", risk: "none", alerts: [], identity,
    latest: { heart_rate: 84, map: null, spo2: 97, temperature: null, resp_rate: null,
              lactate: null, sofa: null },
  };
  return {
    board, top: null, tone: "safe", escalated: false, unacknowledged: false,
    escalatedKeys: new Set(), acknowledgedKeys: new Set(),
    series: { heart_rate: [], map: [], spo2: [], temperature: [], resp_rate: [], lactate: [],
              sofa: [] },
  };
}

const noop = () => {};

it("shows the patient's name when the HIS sent one", async () => {
  await render(<BedCard view={view(IDENTITY)} onPress={noop} onAck={noop} />);
  expect(screen.getByText("AYSE YILMAZ")).toBeTruthy();
});

it("shows no name when the HIS has said nothing", async () => {
  await render(<BedCard view={view(null)} onPress={noop} onAck={noop} />);
  expect(screen.queryByText("AYSE YILMAZ")).toBeNull();
  expect(screen.getByLabelText("patient-card-bed-3")).toBeTruthy();   // the card is unchanged
});

it("shows the actual bed and discharge state", async () => {
  await render(<BedCard view={view({ ...IDENTITY, state: "discharged" })} onPress={noop} onAck={noop} />);
  expect(screen.getByText("YB 304-2")).toBeTruthy();
  expect(screen.getByText(/Taburcu/)).toBeTruthy();
});
