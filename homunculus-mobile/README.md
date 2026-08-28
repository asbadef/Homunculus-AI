# Homunculus Mobile

The mobile companion to the Homunculus ward board. The app can stream the live ward over
single-use SSE tickets, or run entirely from a recording. Live mode (M2) authenticates with
password, acks alerts, and falls back to replay when the session dies.

## Run it

```bash
npm install
npx expo start          # scan the QR code with Expo Go
npx expo start --web    # browser preview; blur is flat and haptics are silent there
npm test                # jest-expo suite
npm run typecheck       # tsc --noEmit
```

## Canlı mod (M2)

To connect to the live ward:

1. **Ayarlar** (Settings) → **Sunucu** (Server)
2. Enter the server address (e.g., `http://<sunucu-adresi>`)
3. Sign in with email and password
4. Tap **Canlı moda geç** (Go live)

The phone must be on the same network as the server. When you sign out or the session dies,
the app falls back to the recording with a notice. The demo banner shows only in replay mode.

**Limitations:** TOTP (authenticator app) accounts cannot yet log in from the phone —
use the dashboard for now.

## Regenerate the ward

```bash
cd ..
homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/record_demo.py ward
```

## What is deliberately absent

- No patient names, identifiers, ages or sexes. Beds only — the recording carries nothing else, and
  nothing is invented for a demo.
- No TOTP (authenticator app) support yet. Password login works; TOTP accounts must use the dashboard.
- Staleness badges and chronic-context rendering are built and tested, but the current recordings
  produce no stale inputs, so they stay dormant.
- Sparklines cover scenario time, not twelve hours, and are labelled that way.
- The escalation threshold in Settings is a demo acceleration of the server's five minutes.
