# Homunculus Mobile (M1)

The mobile companion to the Homunculus ward board. M1 runs entirely from a recording: the ward,
its vitals and its alerts are frames the real engine emitted over three synthetic scenarios, merged
into one three-bed ICU by `homunculus-engine/scripts/record_demo.py ward`. There is no backend
connection and no login — the live slice (M2) waits on the auth bridge.

## Run it

```bash
npm install
npx expo start          # scan the QR code with Expo Go
npx expo start --web    # browser preview; blur is flat and haptics are silent there
npm test                # jest-expo suite
npm run typecheck       # tsc --noEmit
```

## Regenerate the ward

```bash
cd ..
homunculus-engine/.venv/Scripts/python.exe homunculus-engine/scripts/record_demo.py ward
```

## What is deliberately absent

- No patient names, identifiers, ages or sexes. Beds only — the recording carries nothing else, and
  nothing is invented for a demo.
- No login screen. One that authenticates against nothing would be worse than none.
- Staleness badges and chronic-context rendering are built and tested, but the current recordings
  produce no stale inputs, so they stay dormant.
- Sparklines cover scenario time, not twelve hours, and are labelled that way.
- The escalation threshold in Settings is a demo acceleration of the server's five minutes.
