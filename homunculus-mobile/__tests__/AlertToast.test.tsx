/// <reference types="jest" />
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { AlertToast, useToastQueue } from "../src/ui/AlertToast";
import type { BoardNotification } from "../src/transport/types";

function note(overrides: Partial<BoardNotification> = {}): BoardNotification {
  return {
    tenant: "DEMO", patient_id: "bed-3", kind: "septic_shock", severity: "critical",
    urgency: "immediate", audience: "nurse", trigger: "new", title: "Yeni uyarı",
    body: "bed-3: shock", ts: "2026-07-26T17:23:25.878950+00:00",
    ...overrides,
  };
}

// Presentational + hook pair, driven directly — the provider's replay loop would fight the fake
// timers used to exercise the auto-dismiss below.
function Probe({
  latest,
  onPress,
}: {
  latest: BoardNotification | null;
  onPress: (patientId: string) => void;
}) {
  const { visible, dismiss } = useToastQueue(latest, 5000);
  if (visible === null) return null;
  return <AlertToast note={visible} onPress={onPress} onDismiss={dismiss} />;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("AlertToast", () => {
  it("renders nothing when there is no notification", async () => {
    await render(<Probe latest={null} onPress={jest.fn()} />);
    expect(screen.queryByLabelText("alert-toast")).toBeNull();
  });

  it("shows title and body for an immediate notification", async () => {
    await render(<Probe latest={note()} onPress={jest.fn()} />);
    expect(screen.getByLabelText("alert-toast")).toBeTruthy();
    expect(screen.getByText("Yeni uyarı")).toBeTruthy();
    expect(screen.getByText("bed-3: shock")).toBeTruthy();
  });

  it("does not show a routine or soon notification", async () => {
    await render(<Probe latest={note({ urgency: "soon" })} onPress={jest.fn()} />);
    expect(screen.queryByLabelText("alert-toast")).toBeNull();

    await render(
      <Probe latest={note({ urgency: "routine", ts: "2026-07-26T17:24:00+00:00" })} onPress={jest.fn()} />,
    );
    expect(screen.queryByLabelText("alert-toast")).toBeNull();
  });

  it("auto-dismisses after the timeout", async () => {
    await render(<Probe latest={note()} onPress={jest.fn()} />);
    expect(screen.getByLabelText("alert-toast")).toBeTruthy();

    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByLabelText("alert-toast")).toBeNull();
  });

  it("does not re-show the same notification once it has been dismissed", async () => {
    const first = note();
    const { rerender } = await render(<Probe latest={first} onPress={jest.fn()} />);
    await act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByLabelText("alert-toast")).toBeNull();

    await rerender(<Probe latest={note()} onPress={jest.fn()} />); // fresh object, same ts
    expect(screen.queryByLabelText("alert-toast")).toBeNull();
  });

  it("tapping reports the bed", async () => {
    const onPress = jest.fn();
    await render(<Probe latest={note()} onPress={onPress} />);
    await act(() => {
      fireEvent.press(screen.getByLabelText("alert-toast"));
    });
    expect(onPress).toHaveBeenCalledWith("bed-3");
  });
});
