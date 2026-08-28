/// <reference types="jest" />
import { act, render, screen } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import * as SecureStore from "expo-secure-store";

import { BoardProvider, useBoard } from "../src/store/BoardProvider";
import type { BoardContextValue } from "../src/store/BoardProvider";

jest.useFakeTimers();

// Captured-options holders for the mocked modules below. `var` (not `let`/`const`) because
// jest.mock factories are hoisted above these declarations — babel-plugin-jest-hoist only allows
// a factory to close over an out-of-scope identifier when it's `var`-hoisted (or "mock"-prefixed).
var mockSseInstances: MockSseTransport[] = [];
var mockAuthClients: Array<{ baseUrl: string }> = [];
var mockAuthBehavior = {
  hasSession: jest.fn<Promise<boolean>, []>(),
  login: jest.fn<Promise<void>, [string, string]>(),
  logout: jest.fn<Promise<void>, []>(),
};

interface MockSseTransport {
  opts: {
    authedFetch: unknown;
    role: () => string;
    onSessionExpired: () => void;
    onConnectionChange?: (state: string) => void;
  };
  start: jest.Mock;
  stop: jest.Mock;
  subscribe: jest.Mock;
  ack: jest.Mock;
  connectionState: jest.Mock;
}

jest.mock("../src/transport/sseTransport", () => ({
  createSseTransport: jest.fn((opts: MockSseTransport["opts"]) => {
    const instance: MockSseTransport = {
      opts,
      start: jest.fn(),
      stop: jest.fn(),
      subscribe: jest.fn(() => jest.fn()),
      ack: jest.fn(() => Promise.resolve()),
      connectionState: jest.fn(() => "connecting"),
    };
    mockSseInstances.push(instance);
    return instance;
  }),
}));

jest.mock("../src/transport/authClient", () => ({
  createAuthClient: jest.fn((opts: { baseUrl: string }) => {
    mockAuthClients.push(opts);
    return {
      login: mockAuthBehavior.login,
      logout: mockAuthBehavior.logout,
      hasSession: mockAuthBehavior.hasSession,
      authedFetch: jest.fn(),
    };
  }),
}));

/** Runs a callback with the freshest context value after every commit, so a test can call
 * goLive/goReplay/setServerUrl directly instead of round-tripping through pressable text nodes. */
function Probe({ onReady }: { onReady: (value: BoardContextValue) => void }) {
  const value = useBoard();
  useEffect(() => {
    onReady(value);
  });
  const { ward, settings, setRole } = value;
  return (
    <View>
      <Text accessibilityLabel="count">{String(ward.length)}</Text>
      <Text accessibilityLabel="top">{ward[0]?.board.patient_id ?? "-"}</Text>
      <Text accessibilityLabel="role">{settings.role}</Text>
      <Text accessibilityLabel="setter" onPress={() => setRole("doctor")}>
        set
      </Text>
      <Text accessibilityLabel="mode">{value.mode}</Text>
      <Text accessibilityLabel="connection">{value.connection}</Text>
      <Text accessibilityLabel="sessionNotice">{String(value.sessionNotice)}</Text>
      <Text accessibilityLabel="serverUrl">{value.serverUrl ?? "-"}</Text>
    </View>
  );
}

async function renderProbe(): Promise<{ current(): BoardContextValue }> {
  let latest: BoardContextValue | null = null;
  await render(
    <BoardProvider>
      <Probe onReady={(value) => (latest = value)} />
    </BoardProvider>,
  );
  return { current: () => latest as unknown as BoardContextValue };
}

beforeEach(() => {
  (SecureStore as typeof SecureStore & { __reset(): void }).__reset();
  mockSseInstances = [];
  mockAuthClients = [];
  mockAuthBehavior.hasSession.mockReset().mockResolvedValue(false);
  mockAuthBehavior.login.mockReset().mockResolvedValue(undefined);
  mockAuthBehavior.logout.mockReset().mockResolvedValue(undefined);
});

describe("BoardProvider", () => {
  it("fills the ward from the bundled recording", async () => {
    await render(
      <BoardProvider>
        <Probe onReady={() => {}} />
      </BoardProvider>,
    );
    expect(Number(screen.getByLabelText("count").props.children)).toBeGreaterThan(0);
  });

  it("advances the replay over time and keeps the worst bed first", async () => {
    await render(
      <BoardProvider>
        <Probe onReady={() => {}} />
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
        <Probe onReady={() => {}} />
      </BoardProvider>,
    );
    expect(screen.getByLabelText("role").props.children).toBe("nurse");
    await act(() => {
      screen.getByLabelText("setter").props.onPress();
    });
    expect(screen.getByLabelText("role").props.children).toBe("doctor");
  });

  it("defaults to replay mode with a demo connection and no server address", async () => {
    await render(
      <BoardProvider>
        <Probe onReady={() => {}} />
      </BoardProvider>,
    );
    expect(screen.getByLabelText("mode").props.children).toBe("replay");
    expect(screen.getByLabelText("connection").props.children).toBe("demo");
    expect(screen.getByLabelText("serverUrl").props.children).toBe("-");
  });

  it("persists a server address and surfaces it in context", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    expect(screen.getByLabelText("serverUrl").props.children).toBe("http://10.0.0.5");
    expect(await SecureStore.getItemAsync("homunculus.server-url")).toBe("http://10.0.0.5");
  });

  it("rejects goLive when there is no session, and stays in replay", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(false);

    let error: unknown = null;
    await act(async () => {
      try {
        await probe.current().goLive();
      } catch (err) {
        error = err;
      }
    });

    expect(error).toBeInstanceOf(Error);
    expect(screen.getByLabelText("mode").props.children).toBe("replay");
    expect(mockSseInstances).toHaveLength(0);
  });

  it("rejects goLive when no server address is stored at all", async () => {
    const probe = await renderProbe();
    let error: unknown = null;
    await act(async () => {
      try {
        await probe.current().goLive();
      } catch (err) {
        error = err;
      }
    });
    expect(error).toBeInstanceOf(Error);
    expect(screen.getByLabelText("mode").props.children).toBe("replay");
  });

  it("swaps to the live transport when a session exists, resetting the board first", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);

    // Let the ward fill from the replay before swapping, so the reset is observable.
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(Number(screen.getByLabelText("count").props.children)).toBeGreaterThan(0);

    await act(async () => {
      await probe.current().goLive();
    });

    expect(screen.getByLabelText("mode").props.children).toBe("live");
    // The old (replay) transport's beds are gone; the mocked live transport hasn't emitted
    // anything yet, so the ward is empty until it does.
    expect(screen.getByLabelText("count").props.children).toBe("0");
    expect(mockSseInstances).toHaveLength(1);
    expect(mockSseInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it("falls back to replay with a session notice when the live session expires", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);
    await act(async () => {
      await probe.current().goLive();
    });
    expect(screen.getByLabelText("mode").props.children).toBe("live");
    expect(screen.getByLabelText("sessionNotice").props.children).toBe("false");

    const live = mockSseInstances[0];
    await act(() => {
      live.opts.onSessionExpired();
    });

    expect(screen.getByLabelText("mode").props.children).toBe("replay");
    expect(screen.getByLabelText("sessionNotice").props.children).toBe("true");
    expect(live.stop).toHaveBeenCalled();

    // The replay transport was rebuilt and restarted — advancing the fake clock should refill
    // the ward from the recording again, proving it is genuinely running and not just reset.
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(Number(screen.getByLabelText("count").props.children)).toBeGreaterThan(0);
  });

  it("clears the session notice on the next successful goLive", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);
    await act(async () => {
      await probe.current().goLive();
    });
    await act(() => {
      mockSseInstances[0].opts.onSessionExpired();
    });
    expect(screen.getByLabelText("sessionNotice").props.children).toBe("true");

    await act(async () => {
      await probe.current().goLive();
    });
    expect(screen.getByLabelText("sessionNotice").props.children).toBe("false");
  });

  it("goReplay from live mode stops the live transport and returns to replay", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);
    await act(async () => {
      await probe.current().goLive();
    });
    const live = mockSseInstances[0];

    await act(() => {
      probe.current().goReplay();
    });

    expect(screen.getByLabelText("mode").props.children).toBe("replay");
    expect(screen.getByLabelText("connection").props.children).toBe("demo");
    expect(live.stop).toHaveBeenCalled();
  });

  it("mirrors connection state from the live transport's onConnectionChange", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);
    await act(async () => {
      await probe.current().goLive();
    });

    await act(() => {
      mockSseInstances[0].opts.onConnectionChange?.("open");
    });
    expect(screen.getByLabelText("connection").props.children).toBe("open");

    await act(() => {
      mockSseInstances[0].opts.onConnectionChange?.("reconnecting");
    });
    expect(screen.getByLabelText("connection").props.children).toBe("reconnecting");
  });

  it("passes the current role to the live transport read-at-call-time, not the role at goLive", async () => {
    const probe = await renderProbe();
    await act(async () => {
      await probe.current().setServerUrl("http://10.0.0.5");
    });
    mockAuthBehavior.hasSession.mockResolvedValue(true);
    await act(async () => {
      await probe.current().goLive();
    });
    expect(mockSseInstances[0].opts.role()).toBe("nurse");

    await act(async () => {
      probe.current().setRole("doctor");
    });
    expect(mockSseInstances[0].opts.role()).toBe("doctor");
  });
});
