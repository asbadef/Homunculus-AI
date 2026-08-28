# Mobile M2 Live Ward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The phone consumes the same live backend the web dashboard does — login, `/patients` snapshot, `/stream` SSE via single-use tickets, `/ack` — behind the existing `Transport` seam, with replay remaining the default and the demo.

**Architecture:** A pure incremental SSE parser under an `expo/fetch`-streamed `sseTransport` that implements M1's `Transport` interface; an auth client with secure token storage; a `mode` switch in the provider; a Sunucu section in Settings. No screen or store selector changes except the escalation merge.

**Spec:** `docs/superpowers/specs/2026-08-28-mobile-live-m2-design.md`. **Conventions:** the M1 plan's "Testing conventions" section (`docs/superpowers/plans/2026-08-28-mobile-app-m1.md`) applies verbatim — jest reference line, async `render`/`act`/`rerender`, three verification commands (`npm test`, `npm run typecheck`, `npx expo export --platform web`), stage by name, branch `feat/mobile-app-m1`.

**Backend:** nothing to build — `/auth/login`, `/auth/refresh`, `/patients`, `/stream-ticket`, `/stream?ticket=`, `/notifications?ticket=&role=`, `/ack` all exist on this branch.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/transport/sse.ts` | Pure incremental SSE parser: `createSseParser()` → `push(chunk): unknown[]` |
| `src/transport/authClient.ts` | login / refresh-once / logout over injected fetch + token store |
| `src/store/secureTokens.ts` | expo-secure-store wrapper (get/set/clear token pair + server address) |
| `src/transport/sseTransport.ts` | `createSseTransport(...)`: Transport impl — snapshot, two ticket streams, backoff reconnect, ack POST |
| `src/store/boardStore.ts` | (modify) escalation merge: server `alert.escalated` OR client keys |
| `src/store/BoardProvider.tsx` | (modify) mode state, transport swap, session lifecycle |
| `src/ui/ServerSection.tsx` | Settings' Sunucu block: address, login/logout, status line |
| `src/i18n/tr.ts` | (modify) +`server.*` and `login.*` strings |

### Task 1: The pure SSE parser

**Files:** create `src/transport/sse.ts`, `__tests__/sse.test.ts`.

TDD. Test contract (verbatim; jest reference line first):

```ts
import { createSseParser } from "../src/transport/sse";

describe("createSseParser", () => {
  it("yields one parsed payload per data event", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("accumulates a payload split across chunk boundaries", () => {
    const p = createSseParser();
    expect(p.push('data: {"a"')).toEqual([]);
    expect(p.push(':1}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ a: 1 }]);
  });

  it("yields multiple events arriving in one chunk", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("ignores keep-alive comments", () => {
    const p = createSseParser();
    expect(p.push(": keep-alive\n\n")).toEqual([]);
  });

  it("joins multi-line data fields with newlines per the SSE spec", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":\ndata: 1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("reports malformed JSON to onError and keeps parsing", () => {
    const errors: string[] = [];
    const p = createSseParser({ onError: (raw) => errors.push(raw) });
    expect(p.push("data: not-json\n\ndata: {\"ok\":true}\n\n")).toEqual([{ ok: true }]);
    expect(errors).toEqual(["not-json"]);
  });
});
```

Implementation: an internal `buffer` string; on `push`, split on `\n` keeping the trailing partial
line in the buffer; collect `data:` lines per event (event ends on empty line); join with `\n`;
`JSON.parse` in try/catch routed to `onError`. Also handle `\r\n`. No timers, no fetch, no types
beyond `unknown` — the transport casts.

Commit: `feat(mobile): incremental SSE parser, pure and chunk-boundary safe`

### Task 2: Secure tokens and the auth client

**Files:** create `src/store/secureTokens.ts`, `src/transport/authClient.ts`, `__tests__/authClient.test.ts`. Install: `npx expo install expo-secure-store`. Add a jest mock for `expo-secure-store` in `jest.setup.js` (in-memory map).

`secureTokens.ts`: `getTokens/setTokens/clearTokens` (`{access, refresh}`), `getServerUrl/setServerUrl`. All async over `expo-secure-store` (`getItemAsync`/`setItemAsync`/`deleteItemAsync`), keys prefixed `homunculus.`.

`authClient.ts` contract (mirror `dashboard/src/backendApi.js`'s shape, injected fetch + injected token store):

```ts
export class MfaRequiredError extends Error {}
export function createAuthClient({ baseUrl, fetchImpl, tokenStore }): {
  login(email: string, password: string): Promise<void>;   // stores tokens; throws MfaRequiredError on requires_mfa
  authedFetch(path: string, init?): Promise<Response>;      // bearer header; on 401 refresh once, retry once, else clearTokens + throw SessionExpiredError
  logout(): Promise<void>;
  hasSession(): Promise<boolean>;
}
```

Tests (fake fetch): login stores the pair; `requires_mfa: true` in the login response → `MfaRequiredError` and NO tokens stored; authedFetch attaches bearer; 401 → `/auth/refresh` with the refresh token → retry succeeds; refresh 401 → tokens cleared + `SessionExpiredError`. TDD, ~7 tests.

Commit: `feat(mobile): password login and refresh-once sessions in secure storage`

### Task 3: The SSE transport

**Files:** create `src/transport/sseTransport.ts`, `__tests__/sseTransport.test.ts`.

`createSseTransport({ baseUrl, authedFetch, role, now?, setTimer?, clearTimer? })` returns
`Transport & { connectionState(): "connecting" | "open" | "reconnecting" }`.

Behaviour (each a test, fake fetch scripted with `ReadableStream`-like async chunk iterables and the M1 fake-clock pattern from `__tests__/replayTransport.test.ts`):
1. `start()` fetches `/patients`, emits each board to subscribers.
2. Then POSTs `/stream-ticket`, GETs `/stream?ticket=<t>`, pipes chunks through `createSseParser`, emits each frame's board (the stream carries single-patient boards — emit as `onBoard`).
3. `/notifications` gets its OWN ticket (`/stream-ticket` again) and `role` query; parsed payloads go to `onNotification`.
4. Stream end/error → backoff (1s, 2s, 4s… cap 30s via injected timers), fresh ticket, and a fresh `/patients` resnapshot before resuming.
5. `ack()` POSTs `/ack` with `{patient_id, kind, role}` body and bearer via `authedFetch`.
6. `stop()` aborts in-flight streams (AbortController) and cancels timers; nothing emits after stop.
7. `SessionExpiredError` from authedFetch → an injected `onSessionExpired()` callback fires and the transport stops.

Use `expo/fetch` as the default `fetchImpl` inside `authedFetch` (Task 2's client takes it injected; the provider passes the real one). The transport never imports React.

Commit: `feat(mobile): live transport — snapshot, ticket streams, backoff, ack`

### Task 4: Escalation merge in the store

**Files:** modify `src/store/boardStore.ts` (`viewFor`), extend `__tests__/boardStore.test.ts`.

`isEscalated = board.alerts.some((a) => a.escalated || escalated.has(alertKey(...)))`. Two new
tests: a board whose alert carries `escalated: true` yields an escalated view with critical tone
even with empty client keys; M1 replay data (all `escalated: false`) behaves exactly as before
(existing tests are the guard). Also merge into `PatientDetail`'s per-alert `escalated` prop the
same way (`view.escalatedKeys.has(...) || alert.escalated`).

Commit: `feat(mobile): the server's escalation flag wins on live data`

### Task 5: Provider mode switch

**Files:** modify `src/store/BoardProvider.tsx`, extend `__tests__/BoardProvider.test.tsx`.

- New state: `mode: "replay" | "live"`, `connection: "demo" | "open" | "reconnecting"`, exposed on the context with `goLive(): Promise<void>` (requires stored address+session; builds authClient + sseTransport, swaps), `goReplay(): void` (stop live, dispatch `loop`, restart replay transport).
- Transport swap tears down the old one (`stop()` + unsubscribe + `dispatch({type:"loop"})`) before starting the new — recorded and live beds must never coexist.
- `onSessionExpired` → `goReplay()` + a `sessionNotice` flag the UI can show.
- Replay controls (`controls`) remain replay-only; expose `mode` so Settings can hide them in live.
- Tests: default stays replay (existing tests untouched, still green); `goReplay` after a (mocked-transport) live session clears the ward; session expiry drops to replay. Mock `sseTransport` module in the provider test — the transport has its own suite.

Commit: `feat(mobile): the provider swaps between replay and the live stream`

### Task 6: Sunucu section in Settings

**Files:** create `src/ui/ServerSection.tsx`, `__tests__/ServerSection.test.tsx`; modify `src/i18n/tr.ts` (+`server.*`, `login.*` keys), `app/(tabs)/settings.tsx` (mount it), `src/ui/DemoBanner` usages stay — but the three screens show the banner ONLY when `mode === "replay"` (thread `mode` from `useBoard()`).

`ServerSection` (presentational, prop-driven): address `TextInput` (+ save), when no session an
email/password form with a login button, when a session exists a logout row, and a status line
mapping `"demo" | "open" | "reconnecting"` to `t("server.status.*")`. Error surface: `MfaRequiredError`
→ `t("login.mfaUnsupported")` ("Bu hesap doğrulama kodu istiyor; şimdilik panodan giriş yapın.");
wrong password → the server's detail string. All new strings in `tr.ts` and scanned by the existing
charter test automatically.

Tests (~6): renders address value; save reports new address; login form submits credentials;
MFA error shows the honest message; logout row when session; status line per state; banner-gating
covered in the screens' quick checks (replay shows, live hides — assert via a rerender with mocked
`useBoard`).

Commit: `feat(mobile): server settings — address, login, and an honest status line`

### Task 7: Final verification and docs

- All three commands green; full engine suite green.
- README: a "Canlı mod" section (address entry, login, TOTP limitation, replay fallback).
- Spec's Known limits already state TOTP/HTTP-LAN; verify nothing drifted.
- TR guide: one sentence appended to the mobile note (M2 canlı bağlantı kuruldu).
- Final review agent over the whole M2 diff (charter: no invented strings; tokens only in secure store; banner-gating correct).

Commit: `feat(mobile): M2 runbook — the live ward documented`

---

## Definition of done

- `npm test` green (M1's 152 + all new suites), `npm run typecheck` zero, `npx expo export --platform web` exit 0, engine pytest green.
- Replay behaviour byte-identical when no server is configured (the M1 suites are the proof).
- A scripted fake backend proves: login → snapshot → frames → ack → reconnect-with-fresh-ticket.
- Live verification against the real on-prem stack is the user's step (phone + LAN); the README says exactly how.
