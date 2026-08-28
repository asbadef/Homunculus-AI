# Mobile M2 — the live ward: the phone sees what the web sees

**Date:** 2026-08-28
**Status:** design approved

## Context

M1 shipped the mobile companion on a recorded ward, behind a `Transport` seam built for exactly
this moment. Meanwhile the auth-bridge slice landed on the same branch: the clinical routes accept
a clinician's JWT (`api/identity.py`, resolver in `prodserver.py`), `POST /stream-ticket` exchanges
it for a single-use ~60-second SSE ticket, and `/stream?ticket=` / `/notifications?ticket=` consume
it. The web dashboard already rides this. M2 makes the phone ride the same stream.

"Sync with the web" is therefore not a synchronisation protocol — it is one source of truth. Both
surfaces subscribe to the same per-hospital broadcaster; the same board JSON reaches both. Nothing
needs reconciling because nothing diverges.

## Decisions locked with the user

| Question | Decision |
| --- | --- |
| Server address | Entered in Settings, kept in secure storage. No address (or no session) → the app stays in replay mode. |
| Login scope | Password only. An account that answers `requires_mfa` gets an honest error — "this account needs a verification code; use the dashboard for now". TOTP arrives in a later slice. |
| SSE client | No third-party EventSource: Expo SDK 52+'s `expo/fetch` streams response bodies on native and web alike. A pure, chunk-boundary-safe SSE parser sits on top, testable without a network. |
| Replay | Stays, as the default and the demo. The "GÖSTERİM VERİSİ" banner shows only in replay — a live screen must not carry a demo disclaimer, and a demo screen must never look live. |

## Architecture

### 1. The second transport

`createSseTransport(options)` implements the same `Transport` interface the screens already
consume; no screen, store selector or UI component changes.

- `start()`: `GET /patients` with the Bearer access token — emit every board as a snapshot — then
  `POST /stream-ticket` and stream `GET /stream?ticket=…` via `expo/fetch`, feeding frames through
  the parser to `onBoard`. A second stream, `/notifications?ticket=…&role=…`, feeds
  `onNotification` (each stream exchanges its own ticket — tickets are single-use).
- Disconnect → reconnect with exponential backoff (1s, 2s, 4s… capped 30s), a fresh ticket each
  attempt, and a resnapshot of `/patients` on every reconnect so missed frames cannot leave a
  stale board.
- `ack(patientId, kind, role)`: `POST /ack`. The server publishes the updated board on the stream;
  the local optimistic ack (M1) covers the gap in between.
- Injected `fetchImpl` and timer functions, like the replay transport — tests drive it with a fake
  fetch that yields scripted chunks.

### 2. The parser is pure

`src/transport/sse.ts`: an incremental parser object — `push(chunk) → BoardEvent[]` — that
accumulates partial lines across chunk boundaries, ignores `: keep-alive` comments, and yields one
parsed JSON payload per `data:` event. Malformed JSON is reported, not thrown mid-stream. This is
where SSE correctness lives, and it is tested exhaustively with no network anywhere near it.

### 3. Sessions

`src/transport/authClient.ts`, mirroring the dashboard's `backendApi.js` in shape: `login(email,
password)` (surfacing `requires_mfa` as its own error type), `refresh()` once on a 401 then give
up, `logout()`. Tokens live in **expo-secure-store** (`src/store/secureTokens.ts`), never
AsyncStorage — they authorise clinical data. Session death (refresh failed) drops the app back to
replay with a visible notice, never a silent blank.

### 4. Mode

The provider owns a `mode: "replay" | "live"`. Live requires both a stored server address and a
live session; everything else is replay. Switching tears down the old transport (`stop()` +
unsubscribe + `loop` reset so the ward never shows a mix of recorded and live beds).

Settings gains a **Sunucu** section: address field, login form (email/password) or logout row, and
a status line — `bağlı` / `yeniden bağlanıyor` / `demo`. Empty-vs-unreachable stays
distinguishable: an empty live ward says the ward is empty; a dead connection says it is
reconnecting. The demo banner, replay controls and the demo escalation threshold are replay-only
UI; in live mode the escalation state arrives from the server.

### 5. Escalation: the server's word in live mode

The recorded frames never set `alert.escalated`, so M1's client-side port never conflicted with the
payload. Live frames do set it. `viewFor` merges: a patient view is escalated when the server says
an alert is (`alert.escalated`) **or** the client rule fires (replay). No behaviour change on M1
data; the server wins on live data because the client clock never stamps first-seen faster than
the server's own loop.

### 6. Honest limits

- No vitals history endpoint exists; live sparklines accumulate from the moment of connection and
  the trend caption already says scenario/observed time, not a fixed window.
- Role goes to `/ack` and `/notifications` from the Settings role picker — role-level attribution,
  as the server records it today.
- HTTP to a LAN address is the pilot's reality; the spec notes it and the on-prem nginx TLS story
  stays a deploy-slice concern, not an app concern.
- TOTP accounts cannot log in from the phone in this slice, by decision.

## Testing

Parser: exhaustive pure tests (split chunks, multiple events per chunk, keep-alives, malformed
JSON). Auth client: fake fetch — login happy path, `requires_mfa`, refresh-once-then-logout.
Transport: scripted fake fetch streams — snapshot then frames, reconnect with fresh ticket and
resnapshot, ack POST shape. Store: the escalation merge (server flag wins). Settings UI: address
entry, login errors, status line, banner only in replay. The 152 M1 tests keep passing untouched —
that is the seam doing its job.

## Out of scope

TOTP login · push notifications · offline queueing of acks · the Audit tab · vitals history ·
certificate pinning.
