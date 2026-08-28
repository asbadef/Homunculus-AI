/// <reference types="jest" />
import { createSseTransport, type ConnectionState } from "../src/transport/sseTransport";
import { SessionExpiredError } from "../src/transport/authClient";
import type { BoardNotification, PatientBoard, Role } from "../src/transport/types";

function board(id: string, sofa: number): PatientBoard {
  return {
    patient_id: id,
    risk: "none",
    alerts: [],
    latest: {
      heart_rate: null, map: null, spo2: null, temperature: null, resp_rate: null,
      lactate: null, sofa,
    },
  };
}

function note(patientId: string, kind: string): BoardNotification {
  return {
    tenant: "DEMO", patient_id: patientId, kind, severity: "critical", urgency: "immediate",
    audience: "nurse", trigger: "new", title: "Yeni uyarı", body: `${patientId}: ${kind}`,
    ts: "2026-08-28T00:00:00+00:00",
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const nurse: () => Role = () => "nurse";

/** A fixed list of raw SSE chunks; the reader yields them one at a time, then closes. Good for
 * "does a frame reach the listener" tests that don't care what happens once the stream ends. */
function fakeStreamResponse(chunks: string[]): Response {
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = new TextEncoder().encode(chunks[i]);
            i += 1;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

/** A stream the test can drive by hand: push a chunk, end it, or error it, whenever the test
 * chooses. Reader.read() suspends on a real (but timer-free) Promise until the next event lands,
 * so nothing here depends on real time. Needed for the reconnect tests, where the exact moment
 * the stream ends has to be under the test's control. */
interface ControllableStream {
  response: Response;
  push(chunk: string): void;
  end(): void;
  error(err: Error): void;
}

type StreamEvent = { kind: "chunk"; value: string } | { kind: "end" } | { kind: "error"; err: Error };

function controllableStreamResponse(): ControllableStream {
  const queue: StreamEvent[] = [];
  const waiters: Array<(event: StreamEvent) => void> = [];

  function enqueue(event: StreamEvent): void {
    const waiter = waiters.shift();
    if (waiter) waiter(event);
    else queue.push(event);
  }
  function nextEvent(): Promise<StreamEvent> {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => waiters.push(resolve));
  }

  const response = {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          const event = await nextEvent();
          if (event.kind === "chunk") return { done: false, value: new TextEncoder().encode(event.value) };
          if (event.kind === "end") return { done: true, value: undefined };
          throw event.err;
        },
        cancel: async () => {},
      }),
    },
  } as unknown as Response;

  return {
    response,
    push: (chunk) => enqueue({ kind: "chunk", value: chunk }),
    end: () => enqueue({ kind: "end" }),
    error: (err) => enqueue({ kind: "error", err }),
  };
}

/** Deterministic scheduler — same shape as replayTransport.test.ts's fakeClock, plus a peek at
 * what's still pending so the backoff tests can assert on delays without guessing call counts. */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  let queue: { id: number; at: number; fn: () => void }[] = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      queue.push({ id, at: time + ms, fn });
      return id;
    },
    clearTimer: (id: number) => {
      queue = queue.filter((entry) => entry.id !== id);
    },
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const next = queue[0];
        if (!next || next.at > target) break;
        queue.shift();
        time = next.at;
        next.fn();
      }
      time = target;
    },
    pendingDelays(): number[] {
      return queue.map((entry) => entry.at - time);
    },
  };
}

/** Flushes queued microtasks so the transport's chained `await`s (fetch -> json -> emit -> next
 * fetch...) settle before assertions run. Nothing here waits on real time. */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
}

/** Routes authedFetch calls by base path (query string stripped) to a per-test handler, and
 * records every call so tests can inspect paths, bodies, and abort signals. */
function fakeAuthedFetch() {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const routes = new Map<string, (path: string, init?: RequestInit) => Response | Promise<Response>>();
  const authedFetch = jest.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const base = path.split("?")[0];
    const handler = routes.get(base);
    if (!handler) throw new Error(`no fake route configured for ${base}`);
    return handler(path, init);
  });
  return {
    authedFetch,
    calls,
    on(base: string, handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
      routes.set(base, handler);
    },
  };
}

describe("createSseTransport", () => {
  it("start() fetches the snapshot, emits every board, and moves connecting -> open", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [board("bed-3", 0), board("bed-5", 1)] }));
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t1", expires_in: 60 }));
    const boardStream = controllableStreamResponse();
    const notifStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    api.on("/notifications", () => notifStream.response);

    const boards: PatientBoard[] = [];
    const states: ConnectionState[] = [];
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      onConnectionChange: (s) => states.push(s),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.subscribe({ onBoard: (b) => boards.push(b), onNotification: () => {} });

    expect(transport.connectionState()).toBe("connecting");
    transport.start();
    await flush();

    expect(boards.map((b) => b.patient_id)).toEqual(["bed-3", "bed-5"]);
    expect(transport.connectionState()).toBe("open");
    expect(states).toEqual(["open"]);
    transport.stop();
  });

  it("delivers board stream frames to onBoard as they arrive", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [] }));
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t-board", expires_in: 60 }));
    const streamed = board("bed-7", 5);
    api.on("/stream", () => fakeStreamResponse([`data: ${JSON.stringify(streamed)}\n\n`]));
    const notifStream = controllableStreamResponse();
    api.on("/notifications", () => notifStream.response);

    const boards: PatientBoard[] = [];
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.subscribe({ onBoard: (b) => boards.push(b), onNotification: () => {} });
    transport.start();
    await flush();

    expect(boards).toEqual([streamed]);
    transport.stop();
  });

  it("delivers notification stream frames to onNotification, with role() reflected in the query", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [] }));
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t-notif", expires_in: 60 }));
    const boardStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    const n = note("bed-3", "septic_shock");
    api.on("/notifications", () => fakeStreamResponse([`data: ${JSON.stringify(n)}\n\n`]));

    const notes: BoardNotification[] = [];
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: () => "doctor",
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.subscribe({ onBoard: () => {}, onNotification: (nn) => notes.push(nn) });
    transport.start();
    await flush();

    expect(notes).toEqual([n]);
    const notifCall = api.calls.find((c) => c.path.startsWith("/notifications?"));
    expect(notifCall?.path).toContain("role=doctor");
    transport.stop();
  });

  it("requests one single-use ticket per stream, and the two tickets differ", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [] }));
    let ticketN = 0;
    api.on("/stream-ticket", () => {
      ticketN += 1;
      return jsonResponse(200, { ticket: `ticket-${ticketN}`, expires_in: 60 });
    });
    const boardStream = controllableStreamResponse();
    const notifStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    api.on("/notifications", () => notifStream.response);

    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.start();
    await flush();

    const ticketCalls = api.calls.filter((c) => c.path === "/stream-ticket");
    expect(ticketCalls).toHaveLength(2);

    const streamCall = api.calls.find((c) => c.path.startsWith("/stream?"));
    const notifCall = api.calls.find((c) => c.path.startsWith("/notifications?"));
    const streamTicket = new URLSearchParams(streamCall!.path.split("?")[1]).get("ticket");
    const notifTicket = new URLSearchParams(notifCall!.path.split("?")[1]).get("ticket");
    expect(streamTicket).toMatch(/^ticket-/);
    expect(notifTicket).toMatch(/^ticket-/);
    expect(streamTicket).not.toBe(notifTicket);
    transport.stop();
  });

  it("reconnects after a stream ends: backs off, then resnapshots and opens fresh streams with new tickets", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    let patientsCalls = 0;
    api.on("/patients", () => {
      patientsCalls += 1;
      return jsonResponse(200, { patients: [board("bed-3", patientsCalls)] });
    });
    let ticketN = 0;
    api.on("/stream-ticket", () => {
      ticketN += 1;
      return jsonResponse(200, { ticket: `ticket-${ticketN}`, expires_in: 60 });
    });
    const boardStreams: ControllableStream[] = [];
    api.on("/stream", () => {
      const cs = controllableStreamResponse();
      boardStreams.push(cs);
      return cs.response;
    });
    const notifStream = controllableStreamResponse();
    api.on("/notifications", () => notifStream.response);

    const boards: PatientBoard[] = [];
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.subscribe({ onBoard: (b) => boards.push(b), onNotification: () => {} });
    transport.start();
    await flush();

    expect(patientsCalls).toBe(1);
    expect(boardStreams).toHaveLength(1);
    expect(transport.connectionState()).toBe("open");

    boardStreams[0].end();
    await flush();
    expect(transport.connectionState()).toBe("reconnecting");
    expect(patientsCalls).toBe(1); // still waiting out the backoff — no resnapshot yet

    clock.advance(999);
    await flush();
    expect(patientsCalls).toBe(1);

    clock.advance(1);
    await flush();

    expect(patientsCalls).toBe(2);
    expect(boards.at(-1)!.latest.sofa).toBe(2); // the resnapshot's board reached listeners
    expect(boardStreams).toHaveLength(2); // a fresh /stream connection was opened
    expect(transport.connectionState()).toBe("open");

    const paths = api.calls.map((c) => c.path);
    const patientsIndices = paths.reduce<number[]>((acc, p, i) => (p === "/patients" ? [...acc, i] : acc), []);
    const ticketIndices = paths.reduce<number[]>((acc, p, i) => (p === "/stream-ticket" ? [...acc, i] : acc), []);
    expect(ticketIndices).toHaveLength(4); // 2 before, 2 more after reconnecting
    // Missed frames must be impossible: the resnapshot precedes the reconnect's new tickets.
    expect(patientsIndices[1]).toBeLessThan(ticketIndices[2]);
    transport.stop();
  });

  it("doubles the backoff on each consecutive failure, capping at 30s", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [] }));
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t", expires_in: 60 }));
    api.on("/stream", () => fakeStreamResponse([])); // closes immediately -> forces a reconnect, every time
    const notifStream = controllableStreamResponse();
    api.on("/notifications", () => notifStream.response);

    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.start();
    await flush();

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const delay of expectedDelays) {
      expect(clock.pendingDelays()).toEqual([delay]);
      clock.advance(delay);
      await flush();
    }
    transport.stop();
  });

  it("ack POSTs {patient_id, kind, role} and resolves on ok; rejects with the server detail on non-ok", async () => {
    const api = fakeAuthedFetch();
    api.on("/ack", (_path, init) => {
      const parsed = JSON.parse(String(init?.body));
      if (parsed.patient_id === "bed-3") return jsonResponse(200, board("bed-3", 4));
      return jsonResponse(404, { detail: "no such active alert" });
    });
    const transport = createSseTransport({ authedFetch: api.authedFetch, role: nurse, onSessionExpired: jest.fn() });

    await expect(transport.ack("bed-3", "septic_shock", "nurse")).resolves.toBeUndefined();
    const [{ path, init }] = api.calls;
    expect(path).toBe("/ack");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ patient_id: "bed-3", kind: "septic_shock", role: "nurse" });

    await expect(transport.ack("bed-9", "septic_shock", "nurse")).rejects.toThrow("no such active alert");
  });

  it("stop() aborts the open stream connections and silences further emissions", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    api.on("/patients", () => jsonResponse(200, { patients: [board("bed-3", 0)] }));
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t1", expires_in: 60 }));
    const boardStream = controllableStreamResponse();
    const notifStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    api.on("/notifications", () => notifStream.response);

    const boards: PatientBoard[] = [];
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.subscribe({ onBoard: (b) => boards.push(b), onNotification: () => {} });
    transport.start();
    await flush();
    expect(boards).toHaveLength(1);

    transport.stop();
    await flush();

    const streamCall = api.calls.find((c) => c.path.startsWith("/stream?"));
    const notifCall = api.calls.find((c) => c.path.startsWith("/notifications?"));
    expect((streamCall?.init?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect((notifCall?.init?.signal as AbortSignal | undefined)?.aborted).toBe(true);

    boardStream.push(
      'data: {"patient_id":"bed-3","risk":"critical","alerts":[],' +
        '"latest":{"heart_rate":null,"map":null,"spo2":null,"temperature":null,"resp_rate":null,"lactate":null,"sofa":9}}\n\n'
    );
    await flush();
    expect(boards).toHaveLength(1); // unchanged — stop() silenced further emission
  });

  it("stop() cancels a pending reconnect timer so it never fires", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    let patientsCalls = 0;
    api.on("/patients", () => {
      patientsCalls += 1;
      return jsonResponse(200, { patients: [] });
    });
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t1", expires_in: 60 }));
    const boardStream = controllableStreamResponse();
    const notifStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    api.on("/notifications", () => notifStream.response);

    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired: jest.fn(),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.start();
    await flush();
    expect(patientsCalls).toBe(1);

    boardStream.end();
    await flush();
    expect(clock.pendingDelays()).toEqual([1000]);

    transport.stop();

    expect(clock.pendingDelays()).toEqual([]);
    clock.advance(60_000);
    await flush();
    expect(patientsCalls).toBe(1); // the reconnect never happened
  });

  it("a SessionExpiredError from any authedFetch call fires onSessionExpired exactly once and stops", async () => {
    const clock = fakeClock();
    const api = fakeAuthedFetch();
    let patientsCalls = 0;
    api.on("/patients", () => {
      patientsCalls += 1;
      if (patientsCalls === 1) return jsonResponse(200, { patients: [] });
      throw new SessionExpiredError();
    });
    api.on("/stream-ticket", () => jsonResponse(200, { ticket: "t1", expires_in: 60 }));
    const boardStream = controllableStreamResponse();
    const notifStream = controllableStreamResponse();
    api.on("/stream", () => boardStream.response);
    api.on("/notifications", () => notifStream.response);

    const onSessionExpired = jest.fn();
    const transport = createSseTransport({
      authedFetch: api.authedFetch,
      role: nurse,
      onSessionExpired,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    transport.start();
    await flush();
    expect(transport.connectionState()).toBe("open");

    boardStream.end(); // force a reconnect; the resnapshot this time throws SessionExpiredError
    await flush();
    clock.advance(1000);
    await flush();

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(transport.connectionState()).toBe("reconnecting"); // never reaches open again

    const callsBefore = api.calls.length;
    clock.advance(60_000);
    await flush();
    expect(api.calls.length).toBe(callsBefore);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});
