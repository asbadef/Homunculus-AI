import type { Recording, Role, Transport, TransportListener } from "./types";

export interface ReplayControls {
  play(): void;
  pause(): void;
  restart(): void;
  setSpeed(speed: number): void;
  isPlaying(): boolean;
  speed(): number;
  frameIndex(): number;
  frameCount(): number;
}

export type ReplayTransport = Transport & ReplayControls;

export interface ReplayOptions {
  recording: Recording;
  speed?: number;
  /** Injected so tests drive the replay with a fake clock instead of waiting on real time. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

export function createReplayTransport(options: ReplayOptions): ReplayTransport {
  const { recording } = options;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  const listeners = new Set<TransportListener>();
  let index = 0;
  let speed = options.speed ?? 1;
  let playing = false;
  let timer: number | null = null;

  const intervalMs = () => (recording.step_seconds * 1000) / speed;

  function cancel(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function emitCurrentFrame(): void {
    const frame = recording.frames[index];
    if (!frame) return;
    for (const listener of listeners) {
      for (const board of frame.boards) listener.onBoard(board);
      for (const note of frame.notifications) listener.onNotification(note);
    }
  }

  function announceLoop(): void {
    for (const listener of listeners) listener.onLoop?.();
  }

  function scheduleNext(): void {
    cancel();
    if (!playing) return;
    timer = setTimer(() => {
      index += 1;
      if (index >= recording.frames.length) {
        index = 0;
        announceLoop();
      }
      emitCurrentFrame();
      scheduleNext();
    }, intervalMs());
  }

  return {
    start() {
      playing = true;
      emitCurrentFrame();
      scheduleNext();
    },
    stop() {
      playing = false;
      cancel();
    },
    play() {
      if (playing) return;
      playing = true;
      scheduleNext();
    },
    pause() {
      playing = false;
      cancel();
    },
    restart() {
      index = 0;
      announceLoop();
      emitCurrentFrame();
      scheduleNext();
    },
    setSpeed(next: number) {
      speed = next <= 0 ? 1 : next;
      scheduleNext();
    },
    isPlaying: () => playing,
    speed: () => speed,
    frameIndex: () => index,
    frameCount: () => recording.frames.length,
    subscribe(listener: TransportListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async ack(_patientId: string, _kind: string, _role: Role) {
      // Replay has no server. The store owns the acknowledgement; this resolves so the caller's
      // code path is identical to the one the live transport will take.
    },
  };
}
