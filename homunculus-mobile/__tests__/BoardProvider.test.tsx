/// <reference types="jest" />
import { act, render, screen } from "@testing-library/react-native";
import { Text, View } from "react-native";

import { BoardProvider, useBoard } from "../src/store/BoardProvider";

jest.useFakeTimers();

function Probe() {
  const { ward, settings, setRole } = useBoard();
  return (
    <View>
      <Text accessibilityLabel="count">{String(ward.length)}</Text>
      <Text accessibilityLabel="top">{ward[0]?.board.patient_id ?? "-"}</Text>
      <Text accessibilityLabel="role">{settings.role}</Text>
      <Text accessibilityLabel="setter" onPress={() => setRole("doctor")}>
        set
      </Text>
    </View>
  );
}

describe("BoardProvider", () => {
  it("fills the ward from the bundled recording", async () => {
    await render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    expect(Number(screen.getByLabelText("count").props.children)).toBeGreaterThan(0);
  });

  it("advances the replay over time and keeps the worst bed first", async () => {
    await render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    // The merged ward is 28 frames at one second each. Stop at 24 — bed-3 is in septic shock by
    // then, and we have not yet looped back to the empty first frame.
    // RNTL 14's `act` is always async and must be awaited (see node_modules/@testing-library/
    // react-native/docs/guides/understanding-act.md) — an un-awaited `act()` here leaves the
    // timer-driven dispatches queued but never flushed to the rendered tree.
    await act(() => {
      jest.advanceTimersByTime(24_000);
    });
    expect(screen.getByLabelText("top").props.children).toBe("bed-3");
  });

  it("exposes settings and lets a screen change the role", async () => {
    await render(
      <BoardProvider>
        <Probe />
      </BoardProvider>,
    );
    expect(screen.getByLabelText("role").props.children).toBe("nurse");
    await act(() => {
      screen.getByLabelText("setter").props.onPress();
    });
    expect(screen.getByLabelText("role").props.children).toBe("doctor");
  });
});
