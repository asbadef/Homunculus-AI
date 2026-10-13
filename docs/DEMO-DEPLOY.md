# The Homunculus demo (Vercel) — removed

The public demo was a static PWA: `/?demo=1` opened an in-browser simulation, and `/?mode=replay`
/ `/?scenario=…` replayed pre-recorded engine output (`dashboard/public/demo/*.json`). Both were
removed from the dashboard in **G1-16** (roadmap
`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, decision D1): the
dashboard is the live system only. Every address the demo used — `/?demo=1`, `/#/demo`,
`/?mode=replay`, `/?scenario=…` — now opens the live system (its sign-in, for anyone not signed
in), and the parameter is taken out of the address bar.

- The removed code and the recorded scenarios can be read at commit `e4cdf15`
  (`git show e4cdf15:dashboard/src/clinicalDemo.js`, `git show e4cdf15:dashboard/public/demo/septic_shock.json`).
- `homunculus-engine/scripts/record_demo.py` still exists and still writes those files when run;
  nothing in the dashboard reads them any more.
- **The Vercel project itself is not removed by any commit.** Taking the public deployment down
  — and the Render API behind it — is done in the Vercel and Render dashboards. Until then,
  `vercel.json`, `dashboard/.env.production` and `render.yaml` describe that deployment, and
  `docs/DEPLOY-SUPABASE.md` is its runbook.
