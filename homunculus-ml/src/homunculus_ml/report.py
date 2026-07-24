# src/homunculus_ml/report.py
"""Render the committed metrics report. Contains only aggregate numbers + provenance — never PHI."""
from __future__ import annotations


def render_report(*, data_dir, n_patients, n_hours, splits, test_metrics, ablation) -> str:
    m = test_metrics
    return f"""# Early Sepsis Model — Metrics Report

**Data (out of repo):** `{data_dir}` — {n_patients} patients, {n_hours} patient-hours.
**Split (patient-level, no leakage):** {splits}

## Test-set performance
- **AUROC:** {m['auroc']}
- **Brier (calibration):** {m['brier']}
- **Prevalence:** {m['prevalence']}

## Intervention-feature ablation
- **AUROC delta (full - ablated):** {ablation['auroc_delta']}
  A large positive delta means the model leans on treatment-adjacent features (the Epic Sepsis Model
  caution); a small delta means it stands on physiology.

## Generalisation caveat
This model was trained on the PhysioNet/CinC 2019 ICU cohort (specific US hospitals). Performance is
**not** a universal constant - cf. the Phoenix 7.1% vs 28.5% cross-setting mortality gap. Treat the
score as a setting-specific early-warning signal, revalidate before use elsewhere, and never as a
diagnosis.
"""
