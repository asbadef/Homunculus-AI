# homunculus-engine/src/homunculus/protocol/fit.py
"""Whether a label of this size holds the protocol's barcode (G2-B1d, spec §3, D6, D10).

Code 128-C encodes digit pairs: twelve digits are START-C (11 modules), six data symbols (66), the
check symbol (11) and STOP (13) — 101 modules — and a quiet zone of 10 modules on each side: 121
(E13). A module is whole printer dots, so every bar edge falls on a dot: 3 dots at 203 dpi
(0.375 mm), 4 at 300 dpi (0.339 mm). The width must hold the 121 modules and 1.5 mm on each side.

The dashboard mirrors this exactly (screens/kabul/label/protocolLabel.js); one case table pins both
(tests/label_fit_cases.json). The refusals are checked in one order: dpi, size, fit (E11)."""
from __future__ import annotations

from homunculus.admission.errors import LABEL_DPI, LABEL_SIZE, LABEL_TOO_NARROW

MM_PER_INCH = 25.4
DOTS_PER_MODULE = {203: 3, 300: 4}
BARCODE_MODULES = 121
SIDE_MARGIN_MM = 1.5
WIDTH_MM = (30, 110)
HEIGHT_MM = (20, 80)


def module_mm(dpi: int) -> float:
    """One bar module at this resolution, in millimetres."""
    return DOTS_PER_MODULE[dpi] * MM_PER_INCH / dpi


def min_width_mm(dpi: int) -> float:
    """The narrowest label that holds the barcode at this resolution."""
    return BARCODE_MODULES * module_mm(dpi) + 2 * SIDE_MARGIN_MM


def label_refusal(width_mm: int, height_mm: int, dpi: int) -> str | None:
    """None when the label is accepted, else the refusal's code."""
    if isinstance(dpi, bool) or dpi not in DOTS_PER_MODULE:
        return LABEL_DPI
    if not (WIDTH_MM[0] <= width_mm <= WIDTH_MM[1] and HEIGHT_MM[0] <= height_mm <= HEIGHT_MM[1]):
        return LABEL_SIZE
    if width_mm < min_width_mm(dpi):
        return LABEL_TOO_NARROW
    return None
