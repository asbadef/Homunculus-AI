# homunculus-engine/src/homunculus/quality/__init__.py
"""G4-03 «Kalite göstergeleri» (spec docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md): per-unit
care-process indicators. `indicators` builds the answer from what was read (pure); `router` reads it (`GET /quality`,
the board key → unit map). Counts and times only: no patient key, no person and no free text leaves this package."""
