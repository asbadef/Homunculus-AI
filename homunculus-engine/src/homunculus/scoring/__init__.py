"""Severity scoring: prognostic scores computed from the record, for a clinician to confirm.

Deliberately separate from `rules/`. The rules层 answers "is this patient deteriorating right
now?" and raises alerts. This one answers "how sick was this patient in the last 24 hours?" and
raises nothing at all — it produces a form and a printable document.

Keeping them apart is a clinical decision, not a filing one: PRISM, APACHE II, SNAP II and MOD are
prognostic instruments, calibrated to predict mortality across a population over a whole admission.
Using one as an alarm source is a documented failure mode (qSOFA, adopted as a screening tool,
missed three quarters of the patients it was asked to find). This module reports; it never alerts.
"""
