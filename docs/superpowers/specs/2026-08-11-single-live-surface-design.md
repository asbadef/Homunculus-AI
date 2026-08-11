# Single Live Surface — Design

**Date:** 2026-08-11
**Status:** approved (design), not yet implemented

## Goal

One address, one deployment, one system: `https://homunculus-ai.vercel.app/` opens the **live**
Homunculus — real login against the Render API, real patients, real alerts from Supabase. The
existing clinical design is preserved exactly; what changes is where its data comes from and how
honestly the screen reports that.

## Why this is not a configuration change

`?live=1` today replaces **only** authentication. `liveStore.js` says so in its own header: it
wraps the simulation store, overrides `attemptLogin` / `completeMfaLogin` / `logout`, and overlays
the session on top of otherwise **simulated state**.

Flipping the root to that as-is would produce the single worst outcome available to this project:
a clinician authenticates with real hospital credentials and is shown **invented patients**.
Everyone who passes a real login gate reasonably assumes what follows is real. A demo that
announces itself is honest; a simulation behind a real password is not, and on a ward it is
dangerous. So "make the root live" means *making it actually live* — wiring the clinical data
path — not redirecting to a screen that looks live.

The backend already exposes what is needed (`app.py`): `/patients`, `/alerts/{patient_id}`,
`/stream` (SSE), `/notifications` (SSE), `/ack`, `/view`, `/audit`, `/health`. The gap is entirely
in the frontend.

## Architecture

### Three data postures, declared per screen

Every screen is one of:

- **live** — data comes from the backend.
- **simulated** — sample data, and the screen **says so** with a visible badge.
- **unavailable** — the backend could not be reached; the screen says that and shows **nothing**.

Mapping, from the `NAV_ITEMS` inventory in `ClinicalDemo.jsx` against the routes in `app.py`:

| Screen | Backend route | Posture |
| --- | --- | --- |
| `board` | `/patients`, `/stream`, `/alerts/{id}`, `/ack` | live |
| `alarms` | `/alerts/{id}`, `/notifications`, `/ack` | live |
| `heatmap` | derived from live patients | live |
| `admission` | none | simulated |
| `care` | none | simulated |
| `results` | none | simulated |
| `admin` | none | simulated |

The mapping is a single exported table, not a per-component decision, so a screen cannot quietly
change posture without the table changing. When an endpoint is later built, one row moves.

### The rule that matters: never fall back silently

The connection has an explicit state: `connecting → live → degraded → unavailable`.

- **degraded** — the SSE stream dropped; data is being polled. The board still shows real data and
  carries a "canlı akış koptu — yenileniyor" notice.
- **unavailable** — no data reached us. The patient list is **suppressed**, replaced by an explicit
  failure notice.

Suppression is the point. An empty patient list reads as **"no patients need attention"** — the
most reassuring possible screen — and it would be a lie told at exactly the moment the system had
stopped watching. The same reasoning forbids falling back to simulated patients on error: the
failure must be visible, never smoothed over.

### Badging

In **live** mode, any screen whose posture is `simulated` renders a badge: *"Örnek veri · canlı
değil"*. In **demo** mode no badges appear — the whole session is a demo and labelling every panel
would be noise.

The badge is a small standalone component, not inline markup in each screen.
`ClinicalDemo.jsx` is already 3981 lines; the live wiring must not add bulk to it. The store
changes go in `liveStore.js`, the posture table and badge in their own modules.

### Routing

`/` → live. `?demo=1` remains reachable and is **not** removed: it is the only thing that works
while Render sleeps, and the only way to show the design to someone without issuing them an
account. One deployment, one canonical URL, with the demo as an explicit opt-in.

The `/` → `/?demo=1` redirect in `vercel.json` is removed.

### Removing the second backend

`api/index.py` and its `functions` / `rewrites` entries in `vercel.json` are deleted. Render now
runs the real API with the escalation loop and durable Postgres audit; the Vercel function is a
weaker duplicate of it — no escalation, in-memory audit discarded on deploy. Two backends for one
system is precisely the confusion this work exists to remove.

## Prerequisite already fixed

`VITE_API_URL` was never set for the Vercel build, so `defaultBaseUrl()` returned `""` and every
API call went to the frontend's own origin, where the static host answered `/auth/login` with
**405**. Login failed without a single request reaching the backend. Fixed in `61a47ed` by
committing `dashboard/.env.production`. Credentials, database, and CORS were all verified sound.

## Known limits, stated rather than designed around

- **Render runs on the free plan and sleeps after ~15 minutes.** While asleep the background
  escalation loop does not run, so an unacknowledged alert waits for an unrelated request to wake
  the service — the exact failure escalation exists to prevent. The upgrade to `starter` was
  attempted and rejected: *"Plan requires payment information on file"*. Until a payment method is
  added, this gap is real. The login screen will show a "sistem uyanıyor" state after ~3s so a cold
  start does not read as a broken app, but that is cosmetic; it does not close the escalation gap.
- **CORS admits only `https://homunculus-ai.vercel.app`.** Branch-preview origins are blocked, so
  live login must be tested on the production URL.
- **TLS to Supabase is encrypted but unverified** until `DATABASE_CA_CERT` is set.
- **Password changes have no flow.** `seed_admin.py` is idempotent and skips existing users, so
  editing `SEED_ADMIN_PASSWORD` does **not** change an existing account's password.

## Testing

- **Vitest** — `unavailable` renders the failure notice and **no** patient list; a backend error
  never yields simulated patients; the badge appears on simulated screens in live mode and is
  absent in demo mode; the store maps a `/patients` payload onto board state; SSE drop moves the
  state to `degraded` and reconnect returns it to `live`.
- **pytest** — unchanged; the backend gains no new routes in this slice.

## Out of scope

Endpoints for admission, care team, results, and admin (those screens stay badged until built);
notification channels beyond the existing SSE; the ML model; NICU.
