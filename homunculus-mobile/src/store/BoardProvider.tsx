import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, ReactNode } from "react";

import recording from "../../assets/demo/icu-ward.json";
import { createAuthClient } from "../transport/authClient";
import { createReplayTransport } from "../transport/replayTransport";
import type { ReplayControls, ReplayTransport } from "../transport/replayTransport";
import { createSseTransport } from "../transport/sseTransport";
import type { ConnectionState } from "../transport/sseTransport";
import type { BoardNotification, Recording, Role, Transport, TransportListener } from "../transport/types";
import * as secureTokens from "./secureTokens";
import { boardReducer, initialBoardState, selectPatient, selectWard } from "./boardStore";
import type { BoardAction, PatientView } from "./boardStore";

/** Demo acceleration. The server escalates at five minutes; a 28-second replay never would. */
export const DEFAULT_THRESHOLD_MS = 20_000;
const TICK_MS = 1000;

export interface Settings {
  role: Role;
  haptics: boolean;
  thresholdMs: number;
  speed: number;
}

export type Mode = "replay" | "live";
/** "demo" only ever applies in replay; the three others come straight from the live transport's
 * onConnectionChange (see ../transport/sseTransport.ts's ConnectionState). */
export type Connection = "demo" | ConnectionState;

export interface BoardContextValue {
  ward: PatientView[];
  patient(id: string): PatientView | undefined;
  notifications: BoardNotification[];
  latestNotification: BoardNotification | null;
  acknowledge(patientId: string, kind: string): void;
  /** Always the current replay transport's controls, even in live mode — where it refers to a
   * stopped instance. Settings hides these controls by `mode`; this provider does not. */
  controls: ReplayControls;
  settings: Settings;
  setRole(role: Role): void;
  setHaptics(enabled: boolean): void;
  setThresholdMs(ms: number): void;
  setSpeed(speed: number): void;
  mode: Mode;
  connection: Connection;
  /** True once a live session has died and the app fell back to replay. Cleared on the next
   * successful goLive(). */
  sessionNotice: boolean;
  /** Requires a stored server address and an existing session; throws otherwise. Swaps the
   * active transport to the live stream and clears the ward first, so recorded and live beds
   * never coexist on screen. */
  goLive(): Promise<void>;
  /** Tears down the live transport (if any) and returns to a freshly-restarted replay. */
  goReplay(): void;
  serverUrl: string | null;
  setServerUrl(url: string): Promise<void>;
  auth: {
    login(email: string, password: string): Promise<void>;
    logout(): Promise<void>;
    hasSession(): Promise<boolean>;
  };
}

const BoardContext = createContext<BoardContextValue | null>(null);

function makeListener(dispatch: Dispatch<BoardAction>): TransportListener {
  return {
    onBoard: (board) => dispatch({ type: "board", board, now: Date.now() }),
    onNotification: (note) => dispatch({ type: "notification", note }),
    onLoop: () => dispatch({ type: "loop" }),
  };
}

export function BoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, initialBoardState);
  const [now, setNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<Settings>({
    role: "nurse",
    haptics: true,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    speed: 1,
  });
  // The live transport is long-lived across renders and reads `role` lazily (on connect/
  // reconnect), well after the render that created it. A plain closure over `settings` would go
  // stale; the ref mirrors every render's latest settings for that read-at-call-time need.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [mode, setMode] = useState<Mode>("replay");
  const [connection, setConnection] = useState<Connection>("demo");
  const [sessionNotice, setSessionNotice] = useState(false);
  const [serverUrl, setServerUrlState] = useState<string | null>(null);
  // Bumped whenever goReplay() rebuilds the replay transport, so the `controls` field in the
  // memoized context value below is guaranteed to pick up the fresh instance even on the
  // (unlikely but possible) call where mode was already "replay" and setMode is a no-op render.
  const [replayGeneration, setReplayGeneration] = useState(0);

  // Lazy init: useRef(create(...)) would build and discard a fresh transport on every render —
  // the argument expression runs eagerly even though React keeps only the first .current.
  // `transportRef` holds whichever transport is currently active (replay or live); `replayRef`
  // always holds the current replay transport specifically, even while live is active, because
  // `controls` must keep exposing ReplayControls regardless of mode.
  const transportRef = useRef<Transport | null>(null);
  const replayRef = useRef<ReplayTransport | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  if (transportRef.current === null) {
    const initial = createReplayTransport({ recording: recording as Recording });
    transportRef.current = initial;
    replayRef.current = initial;
  }

  function attach(next: Transport): void {
    transportRef.current = next;
    unsubscribeRef.current = next.subscribe(makeListener(dispatch));
    next.start();
  }

  function detach(): void {
    transportRef.current?.stop();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }

  useEffect(() => {
    attach(transportRef.current as Transport);
    return () => detach();
    // Mount-only: swapping transports afterwards is the explicit job of goLive/goReplay below,
    // not of this effect re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void secureTokens.getServerUrl().then((url) => {
      if (!cancelled) setServerUrlState(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function goReplay(): void {
    detach();
    dispatch({ type: "loop" });
    const fresh = createReplayTransport({ recording: recording as Recording });
    replayRef.current = fresh;
    attach(fresh);
    setMode("replay");
    setConnection("demo");
    setReplayGeneration((g) => g + 1);
  }

  function handleSessionExpired(): void {
    goReplay();
    setSessionNotice(true);
  }

  async function goLive(): Promise<void> {
    if (!serverUrl) throw new Error("No server address is configured yet.");
    const client = createAuthClient({ baseUrl: serverUrl });
    const has = await client.hasSession();
    if (!has) throw new Error("No active session. Log in first.");

    const live = createSseTransport({
      authedFetch: client.authedFetch,
      role: () => settingsRef.current.role,
      onSessionExpired: handleSessionExpired,
      onConnectionChange: setConnection,
    });

    detach();
    dispatch({ type: "loop" });
    attach(live);
    setMode("live");
    setSessionNotice(false);
  }

  // `now` ticks every second, so the memo below recomputes selectWard at 1Hz — sort plus
  // escalation over every bed. Fine for a ward this size; revisit if M2 grows the ward.
  const options = { now, thresholdMs: settings.thresholdMs };

  const value = useMemo<BoardContextValue>(
    () => ({
      ward: selectWard(state, options),
      patient: (id: string) => selectPatient(state, id, options),
      notifications: state.notifications,
      latestNotification: state.notifications[0] ?? null,
      acknowledge: (patientId: string, kind: string) => {
        void transportRef.current?.ack(patientId, kind, settings.role);
        dispatch({ type: "ack", patientId, kind, role: settings.role, now: Date.now() });
      },
      controls: replayRef.current as ReplayTransport,
      settings,
      setRole: (role: Role) => setSettings((s) => ({ ...s, role })),
      setHaptics: (haptics: boolean) => setSettings((s) => ({ ...s, haptics })),
      setThresholdMs: (thresholdMs: number) => setSettings((s) => ({ ...s, thresholdMs })),
      setSpeed: (speed: number) => {
        replayRef.current?.setSpeed(speed);
        setSettings((s) => ({ ...s, speed }));
      },
      mode,
      connection,
      sessionNotice,
      goLive,
      goReplay,
      serverUrl,
      setServerUrl: async (url: string) => {
        await secureTokens.setServerUrl(url);
        setServerUrlState(url);
      },
      auth: {
        login: async (email: string, password: string) => {
          if (!serverUrl) throw new Error("No server address is configured yet.");
          const client = createAuthClient({ baseUrl: serverUrl });
          await client.login(email, password);
        },
        logout: async () => {
          const client = createAuthClient({ baseUrl: serverUrl ?? "" });
          await client.logout();
        },
        hasSession: async () => {
          const client = createAuthClient({ baseUrl: serverUrl ?? "" });
          return client.hasSession();
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, now, settings, mode, connection, sessionNotice, serverUrl, replayGeneration],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard must be used inside a BoardProvider");
  return value;
}
