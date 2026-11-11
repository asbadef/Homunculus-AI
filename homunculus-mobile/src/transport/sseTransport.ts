// The live counterpart to replayTransport.ts: drives the two screens from
// homunculus-engine/src/homunculus/api/app.py instead of a recording.
//
// Sequencing on connect (initial or reconnect) is always: GET /patients (a full snapshot) THEN
// mint a fresh single-use ticket and open each of the two SSE streams. That order is load-
// bearing — it is what makes "missed frames" impossible: whatever changed while we were
// disconnected is folded into the resnapshot, and the streams that come up after it only need to
// carry what happens from that instant on. "Folded in" includes what LEFT: the snapshot is handed
// on whole (`onSnapshot`, G2 borç 1c), and the board becomes exactly it — a patient discharged in
// the gap, or outside the scope the new ticket carries, leaves the screen instead of staying as a
// card no frame will ever update.
//
// Reconnect coupling: the two streams (board, notifications) share ONE reconnect cycle. If
// either ends or errors, both are torn down and both are rebuilt together, behind a single
// resnapshot. They could in principle reconnect independently, but a shared cycle is simpler to
// reason about and the resnapshot already covers whatever gap either stream left — there is no
// benefit to keeping the other stream's now-stale connection alive while its sibling recovers.
//
// Planned rotation (G2 borç 1b, owner: «Süre sınırı»): the server ends every stream after
// STREAM_MAX_AGE (15 minutes) with a named `rotate` event, because each stream's scope is the one
// its ticket fixed at open. That is not a failure: the cycle is rebuilt AT ONCE — no backoff, the
// state stays "open" — through the same resnapshot and fresh tickets. If that cycle fails, the
// ordinary reconnect (backoff, "reconnecting") takes over.
import { createSseParser } from "./sse";
import { PasswordChangeRequiredError, readDetail, SessionExpiredError } from "./authClient";
import type { BoardNotification, PatientBoard, Role, Transport, TransportListener } from "./types";

export type ConnectionState = "connecting" | "open" | "reconnecting";

/** Why a live session ended: the refresh was refused, or the account must replace a temporary
 * password first (the dashboard does that; this app has no password form). */
export type SessionEndReason = "expired" | "passwordChangeRequired";

/** The errors from authedFetch that end the session for good — no reconnect can repair them. */
function sessionEndReason(err: unknown): SessionEndReason | null {
  if (err instanceof SessionExpiredError) return "expired";
  if (err instanceof PasswordChangeRequiredError) return "passwordChangeRequired";
  return null;
}

export interface SseTransportOptions {
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Read at call time (not cached) so a Settings change takes effect on the next connect. */
  role: () => Role;
  onSessionExpired: (reason: SessionEndReason) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  /** Injected so tests drive reconnect backoff with a fake clock instead of real time. */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export function createSseTransport(
  options: SseTransportOptions
): Transport & { connectionState(): ConnectionState } {
  const { authedFetch, role, onSessionExpired, onConnectionChange } = options;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  const listeners = new Set<TransportListener>();

  let stopped = true;
  let sessionExpiredFired = false;
  // Bumped on every (re)connect attempt. Any async work tagged with a stale generation is a
  // late-resolving promise from a superseded cycle and must be a no-op when it finally settles.
  let generation = 0;
  let state: ConnectionState = "connecting";
  let backoffMs = INITIAL_BACKOFF_MS;
  let reconnectTimer: number | null = null;
  let reconnectScheduled = false;
  let controllers: AbortController[] = [];

  function setState(next: ConnectionState): void {
    if (state === next) return;
    state = next;
    onConnectionChange?.(next);
  }

  // The `stopped` checks here duplicate the caller-side generation guards on purpose — a second,
  // independent line of defense on the one path that reaches a clinician's screen. Not dead code.
  function emitBoard(board: PatientBoard): void {
    if (stopped) return;
    for (const listener of listeners) listener.onBoard(board);
  }

  /** A cycle's snapshot, whole (G2 borç 1c): to a listener that takes it as the board
   * (`onSnapshot`), in one call; to any other, one board at a time, as before. */
  function emitSnapshot(boards: PatientBoard[]): void {
    if (stopped) return;
    for (const listener of listeners) {
      if (listener.onSnapshot) listener.onSnapshot(boards);
      else for (const board of boards) listener.onBoard(board);
    }
  }

  function emitNotification(note: BoardNotification): void {
    if (stopped) return;
    for (const listener of listeners) listener.onNotification(note);
  }

  function newController(): AbortController {
    const controller = new AbortController();
    controllers.push(controller);
    return controller;
  }

  function abortAll(): void {
    for (const controller of controllers) controller.abort();
    controllers = [];
  }

  function handleSessionExpired(reason: SessionEndReason): void {
    if (sessionExpiredFired) return;
    sessionExpiredFired = true;
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
    abortAll();
    onSessionExpired(reason);
  }

  /** Wraps authedFetch so a session-ending error (SessionExpiredError, PasswordChangeRequiredError)
   * anywhere routes to the single-fire handler above. Always rethrows: callers distinguish
   * "already handled" (`sessionEndReason(err)` is set) from a plain failure that should instead
   * trigger a reconnect. */
  async function guardedFetch(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await authedFetch(path, init);
    } catch (err) {
      const reason = sessionEndReason(err);
      if (reason) handleSessionExpired(reason);
      throw err;
    }
  }

  function scheduleReconnect(gen: number): void {
    if (stopped || gen !== generation) return;
    if (reconnectScheduled) return; // the sibling stream already triggered this cycle's teardown
    reconnectScheduled = true;
    abortAll(); // tear down both streams together — see the module comment
    setState("reconnecting");
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      reconnectScheduled = false;
      generation += 1;
      void runCycle(generation, false);
    }, delay);
  }

  /** The server ended a stream at its age (`rotate`): rebuild both streams now, behind a
   * resnapshot, without the backoff or the "reconnecting" state of a failure. A stream of a cycle
   * already torn down (its sibling rotated first) starts nothing. */
  function rotate(gen: number): void {
    if (stopped || gen !== generation) return;
    if (reconnectScheduled) return; // a failure's reconnect is already on its way
    generation += 1;
    abortAll();
    void runCycle(generation, false, true);
  }

  async function safeCancel(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      await reader.cancel();
    } catch {
      // best effort — the connection is already going away
    }
  }

  /** Reads one SSE stream to completion, feeding each parsed payload to `onPayload`. Returns once
   * the stream closes, is superseded by a later generation, or the transport stops — the caller
   * decides what "returned" means for reconnection — or as soon as the server says `rotate`, which
   * is the one end it reports apart ("rotated"). */
  async function pump(
    response: Response,
    gen: number,
    onPayload: (payload: unknown) => void
  ): Promise<"ended" | "rotated"> {
    const body = response.body;
    if (!body) return "ended";
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let rotated = false;
    const parser = createSseParser({
      onNamedEvent: (name) => {
        if (name === "rotate") rotated = true;
      },
    });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (stopped || gen !== generation) {
          await safeCancel(reader);
          return "ended";
        }
        if (done) return "ended";
        // Any bytes at all — even a keep-alive comment the parser discards — are proof this
        // connection is genuinely alive, which is a better "successful reconnect" signal than the
        // HTTP handshake succeeding: a stream that reconnects and closes again before delivering
        // anything must keep the backoff climbing, not reset it back to 1s every cycle.
        backoffMs = INITIAL_BACKOFF_MS;
        const chunk = decoder.decode(value, { stream: true });
        for (const payload of parser.push(chunk)) {
          if (stopped || gen !== generation) {
            await safeCancel(reader);
            return "ended";
          }
          onPayload(payload);
        }
        if (rotated) {
          // The server's last frame: the end follows it. Not waited for — the caller rebuilds now.
          await safeCancel(reader);
          return "rotated";
        }
      }
    } catch {
      // reader.read() rejected (network error, aborted fetch) — treated as a clean stream end;
      // the caller schedules a reconnect the same as a natural close.
    }
    return "ended";
  }

  /** Mints a single-use ticket and opens one SSE stream. `path` is the ticketed endpoint
   * (`/stream` or `/notifications?role=...`); `onPayload` routes parsed frames to the right
   * listener callback. */
  async function openStream(
    gen: number,
    path: string,
    onPayload: (payload: unknown) => void
  ): Promise<void> {
    let response: Response;
    try {
      const ticketRes = await guardedFetch("/stream-ticket", { method: "POST" });
      if (stopped || gen !== generation) return;
      if (!ticketRes.ok) throw new Error(`stream-ticket failed (${ticketRes.status})`);
      const { ticket } = (await ticketRes.json()) as { ticket: string };
      if (stopped || gen !== generation) return;

      const controller = newController();
      const sep = path.includes("?") ? "&" : "?";
      response = await guardedFetch(`${path}${sep}ticket=${encodeURIComponent(ticket)}`, {
        signal: controller.signal,
      });
    } catch (err) {
      if (sessionEndReason(err)) return; // already handled
      if ((err as { name?: string } | null)?.name === "AbortError") return; // intentional teardown
      scheduleReconnect(gen);
      return;
    }
    if (stopped || gen !== generation) return;
    if (!response.ok) {
      scheduleReconnect(gen);
      return;
    }
    const end = await pump(response, gen, onPayload);
    // The server rotated it (planned: rebuild now), or the stream ended (server closed it, or
    // pump() absorbed a read error as a clean close).
    if (end === "rotated") rotate(gen);
    else scheduleReconnect(gen);
  }

  /** `planned`: a rotation's cycle, which keeps the state it found ("open") — only a failure in it
   * (through scheduleReconnect) says "reconnecting". */
  async function runCycle(gen: number, isFirst: boolean, planned = false): Promise<void> {
    if (!planned) setState(isFirst ? "connecting" : "reconnecting");

    let res: Response;
    try {
      res = await guardedFetch("/patients");
    } catch (err) {
      if (sessionEndReason(err)) return; // already handled
      scheduleReconnect(gen);
      return;
    }
    if (stopped || gen !== generation) return;
    if (!res.ok) {
      scheduleReconnect(gen);
      return;
    }

    let body: { patients: PatientBoard[] };
    try {
      body = (await res.json()) as { patients: PatientBoard[] };
    } catch {
      scheduleReconnect(gen);
      return;
    }
    if (stopped || gen !== generation) return;

    // The whole board, not boards to merge: a patient missing from it has left this screen.
    emitSnapshot(body.patients);
    setState("open");

    // Both streams open concurrently, each behind its own single-use ticket. Backoff resets when
    // a stream actually delivers bytes (see pump()) — not here, since the snapshot alone doesn't
    // prove the *stream* connection is healthy.
    // The parser hands back `unknown`; cast here at the emit boundary — the shape is pinned by
    // the server-side recording contract test (__tests__/recording.test.ts), not re-validated here.
    void openStream(gen, "/stream", (payload) => emitBoard(payload as PatientBoard));
    void openStream(gen, `/notifications?role=${encodeURIComponent(role())}`, (payload) =>
      emitNotification(payload as BoardNotification)
    );
  }

  return {
    start() {
      if (!stopped) return; // already running
      stopped = false;
      sessionExpiredFired = false;
      backoffMs = INITIAL_BACKOFF_MS;
      reconnectScheduled = false;
      generation += 1;
      void runCycle(generation, true);
    },

    stop() {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimer(reconnectTimer);
        reconnectTimer = null;
      }
      abortAll();
    },

    subscribe(listener: TransportListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async ack(patientId: string, kind: string, ackRole: Role): Promise<void> {
      const res = await guardedFetch("/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, kind, role: ackRole }),
      });
      if (!res.ok) {
        throw new Error(await readDetail(res, `ack failed (${res.status})`));
      }
    },

    connectionState: () => state,
  };
}
