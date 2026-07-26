# Deploying the Homunculus demo (Vercel)

The demo is a pure static PWA — no backend. Real engine output is pre-recorded into
`dashboard/public/demo/*.json`; the browser replays it. Synthetic data only.

## One-time
1. Push to GitHub (done).
2. In Vercel: **New Project → import `asbadef/Homunculus-AI`**. Vercel reads `vercel.json`
   (build `dashboard`, output `dashboard/dist`, Vite framework, SPA rewrite). Deploy.
3. Share the URL — open it (auto-lands on `/?demo=1`), pick a role, watch the scenario. Installable
   via the browser's "Add to Home Screen".

## Re-recording the demo data (after engine changes)
    cd homunculus-engine
    for s in septic_shock stable_control under_resuscitated; do \
      .venv/Scripts/python.exe scripts/record_demo.py $s.yaml; done
    git add dashboard/public/demo && git commit -m "chore(demo): refresh recorded timelines"

Vercel redeploys on push.

## CLI alternative
`npm i -g vercel && vercel` from the repo root (uses `vercel.json`).

## Notes
- Landing on `/` shows the live-mode Board (which expects a backend and will just show an empty
  board when hosted statically). Share the **`/?demo=1`** URL for the demo; the PWA `start_url`
  is already `/?demo=1` so installed instances open straight into the demo.
