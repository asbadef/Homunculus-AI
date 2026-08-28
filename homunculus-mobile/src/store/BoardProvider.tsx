import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";

import recording from "../../assets/demo/icu-ward.json";
import { createReplayTransport } from "../transport/replayTransport";
import type { ReplayControls } from "../transport/replayTransport";
import type { BoardNotification, Recording, Role } from "../transport/types";
import { boardReducer, initialBoardState, selectPatient, selectWard } from "./boardStore";
import type { PatientView } from "./boardStore";

/** Demo acceleration. The server escalates at five minutes; a 28-second replay never would. */
export const DEFAULT_THRESHOLD_MS = 20_000;
const TICK_MS = 1000;

export interface Settings {
  role: Role;
  haptics: boolean;
  thresholdMs: number;
  speed: number;
}

export interface BoardContextValue {
  ward: PatientView[];
  patient(id: string): PatientView | undefined;
  notifications: BoardNotification[];
  latestNotification: BoardNotification | null;
  acknowledge(patientId: string, kind: string): void;
  controls: ReplayControls;
  settings: Settings;
  setRole(role: Role): void;
  setHaptics(enabled: boolean): void;
  setThresholdMs(ms: number): void;
  setSpeed(speed: number): void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function BoardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, initialBoardState);
  const [now, setNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<Settings>({
    role: "nurse",
    haptics: true,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    speed: 1,
  });
  const transport = useRef(createReplayTransport({ recording: recording as Recording })).current;

  useEffect(() => {
    const unsubscribe = transport.subscribe({
      onBoard: (board) => dispatch({ type: "board", board, now: Date.now() }),
      onNotification: (note) => dispatch({ type: "notification", note }),
      onLoop: () => dispatch({ type: "loop" }),
    });
    transport.start();
    return () => {
      transport.stop();
      unsubscribe();
    };
  }, [transport]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const options = { now, thresholdMs: settings.thresholdMs };

  const value = useMemo<BoardContextValue>(
    () => ({
      ward: selectWard(state, options),
      patient: (id: string) => selectPatient(state, id, options),
      notifications: state.notifications,
      latestNotification: state.notifications[0] ?? null,
      acknowledge: (patientId: string, kind: string) => {
        void transport.ack(patientId, kind, settings.role);
        dispatch({ type: "ack", patientId, kind, role: settings.role, now: Date.now() });
      },
      controls: transport,
      settings,
      setRole: (role: Role) => setSettings((s) => ({ ...s, role })),
      setHaptics: (haptics: boolean) => setSettings((s) => ({ ...s, haptics })),
      setThresholdMs: (thresholdMs: number) => setSettings((s) => ({ ...s, thresholdMs })),
      setSpeed: (speed: number) => {
        transport.setSpeed(speed);
        setSettings((s) => ({ ...s, speed }));
      },
    }),
    [state, now, settings, transport],
  );

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}

export function useBoard(): BoardContextValue {
  const value = useContext(BoardContext);
  if (!value) throw new Error("useBoard must be used inside a BoardProvider");
  return value;
}
