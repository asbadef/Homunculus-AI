# Live board — bridging JWT identity to the tenant-scoped clinical routes

**Date:** 2026-08-27
**Status:** design approved

## Context

The on-prem stack now runs on the hospital server: Postgres, the API with the clinical engine and
escalation loop, nginx serving the dashboard same-origin, and the HL7 bridge. A clinician can reach
it, and an administrator account exists.

They still cannot log in to anything real. The address the dashboard serves opens the **simulation**,
whose login is a simulated function with no connection to the backend. The real login lives only at
`?live=1`, and even there `liveStore.js` replaces **only** the authentication actions — every
patient, vital and alert on the board still comes from the simulation.

The reason it stops at authentication is a genuine gap, not an oversight in the frontend:

| Routes | Credential |
| --- | --- |
| `/patients`, `/alerts/{patient_id}`, `/ack`, `/view`, `/audit`, `/ingest` | static tenant token from the `TENANTS` env var, resolved by `_tenant_from_token` in `api/app.py` |
| `/stream`, `/notifications` | the same tenant token, passed as a **query parameter** (`EventSource` cannot set headers) |
| `/auth/*` | JWT — `get_current_user` decodes it and loads the `User` row |

The two schemes do not know about each other. A logged-in user's JWT is not a tenant token, so the
board routes reject it. That bridge is what this design builds.

Shipping the tenant token to the browser instead is not an option: it also authorises `/ingest`, so
anyone who read it could inject fabricated observations and manufacture alerts.

## Architecture

### 1. The hospital key becomes the tenant slug

The engine keys its per-hospital state by a string (`HOSP1` today). A JWT user belongs to a
`Tenant`, and `Tenant.slug` is already unique and indexed (`tenant/models.py`). Making the engine's
hospital key *be* the tenant slug lets both credentials arrive at the same engine instance with no
extra mapping table: the bridge is configured as `TENANTS=<bridge-token>:demo-hastanesi`, and a JWT
user resolves through their `TenantMembership` to the same slug.

**The failure this invites, and its guard.** If the operator sets a slug that matches no tenant, the
device writes to a hospital key no user can read: data arrives, alerts fire, and every screen stays
empty — with nothing reporting a problem. At startup the API compares each configured `TENANTS`
hospital key against the tenant slugs in the database and logs a loud warning for any that does not
match. A warning rather than a fatal error, because failing to boot would be a worse outcome on a
ward than running with a diagnosable misconfiguration.

### 2. One resolver, two credentials

A single dependency resolves the hospital for every board route:

1. If the bearer value matches a `TENANTS` entry → that hospital key. This is the device path; it
   costs no database round-trip and is unchanged.
2. Otherwise decode it as a JWT → user → membership → tenant slug.
3. Otherwise 401.

Order matters: the static lookup is tried first so the ingest path never depends on the database
being reachable for authentication.

### 3. SSE without putting a JWT in a URL

`EventSource` cannot send headers, which is why `/stream` takes its credential as a query parameter
today. A JWT there would be written into server logs, browser history and referrer headers — a
long-lived credential leaked into three places that are routinely copied around.

Instead the browser exchanges its JWT for a **stream ticket**: `POST /stream-ticket` returns a
single-use, ~60-second random value bound to the resolved hospital, and `/stream?ticket=…` and
`/notifications?ticket=…` consume it. A leaked ticket is expired and already spent. Tickets live in
process memory alongside the broadcaster, which is where the SSE subscriptions already are.

The existing `?token=` path stays for the legacy `?board=1` screen, which is not part of this slice.

### 4. What the live board can actually show

`board.py` returns per patient: `patient_id`, `risk`, `alerts` (each carrying `acknowledged`,
`acknowledged_by`, `acknowledged_at`, `first_seen_at`, `escalated`), and `latest` with heart rate,
MAP, lactate and total SOFA.

That is all it returns. Patient names, bed assignments and vitals history are **not** in this
payload, so the live board shows fewer fields than the demo does. Those fields render as *no data*,
never as a plausible-looking value — an invented name on a clinical board is worse than a blank one.
(`/admissions` exists and could supply identity later; it is out of scope here.)

An adapter module maps the API payload onto the shape the existing components expect, so the mapping
is one tested unit rather than conditionals scattered through a 4000-line component.

### 5. Empty and unreachable must never look alike

The connection has an explicit state: `connecting → live → degraded → unavailable`.

- **live, no patients** — the board says there are no patients. This is a real answer.
- **degraded** — the stream dropped; data is being polled, and the screen says so.
- **unavailable** — the backend could not be reached. The patient list is **suppressed** and
  replaced by an explicit failure notice.

Suppression is the point. An empty list reads as *nobody needs attention* — the most reassuring
screen the system can draw — and rendering it while the system has actually stopped watching would
be a lie told at exactly the wrong moment. For the same reason, falling back to simulated data on
error is forbidden.

### 6. Routing and the banner

The root address becomes the live system. `?demo=1` keeps the simulation, and the "ÖRNEK VERİ"
banner appears **only there** — in live mode it is removed, because it would no longer be true.

Live and simulated data stay on separate addresses. They are never mixed on one screen: a clinician
arriving mid-shift at a screen someone else opened has no way to tell which mode it is in beyond
what the screen says, so the modes must not be switchable in place.

## Testing

**Backend (pytest).** The resolver: tenant-token path, JWT path, unknown credential → 401, and a JWT
whose tenant has no matching hospital key. The startup check: a `TENANTS` key with no matching slug
warns. Tickets: issued, single-use, expire, and are scoped to the issuing hospital.

**Frontend (Vitest).** The adapter maps a real `/patients` payload onto board state, and leaves
absent fields absent. The four connection states render distinctly; `unavailable` suppresses the
list and never yields simulated patients.

## Known limits, stated rather than designed around

- **No device is sending data yet.** The Welch Allyn unit speaks WACP and needs a Connex server that
  does not exist here. Until an HL7 source is connected the live board will be legitimately empty —
  which is the correct display, and the reason the empty state has to be trustworthy.
- Tickets are in-process, so they do not survive a restart and would not work across replicas. Both
  are true of the broadcaster already; a second replica needs shared state regardless.
- A user with memberships in several tenants resolves to the lowest slug in alphabetical order, and
  the API logs that it chose. Deterministic rather than arbitrary: a user who sees the wrong
  hospital's board must see the *same* wrong board every time, or the bug is unreportable. On-prem
  is single-hospital; letting the user pick is a cloud concern.

## Out of scope

Patient identity from `/admissions`; role-based filtering of the board; the `admission`, `care`,
`results` and `admin` screens (they stay simulated and badged); WACP; multi-replica deployment.
