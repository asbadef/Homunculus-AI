# Homunculus Engine

Real-time clinical intelligence engine — adult ICU sepsis vertical.
See `docs/superpowers/specs/2026-07-14-realtime-engine-design.md` for the design.

## Dev setup

    cd homunculus-engine
    python -m venv .venv
    .venv/Scripts/activate        # Windows;  source .venv/bin/activate on Unix
    pip install -e ".[dev]"
    pytest

No patient data. Synthetic scenarios only.
