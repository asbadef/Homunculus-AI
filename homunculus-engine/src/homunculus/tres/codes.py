# homunculus-engine/src/homunculus/tres/codes.py
"""The codes the national e-health feed writes from outside the ministry's own lists (TRƏS-01, spec
D10, D12, §5) — every one CHECKED against an official terminology source when it was written, and
the check recorded beside it. No code, display or unit here is from memory (D12).

THE CHECK. On 2026-11-12 each LOINC code was looked up with `CodeSystem/$lookup` on the HL7
terminology server `https://tx.fhir.org/r4` (LOINC version 2.83 as served there); `display` below
is the display it answered (LOINC's LONG_COMMON_NAME for every code here), and every code's STATUS
was ACTIVE. Each UCUM unit was looked up the same day on the same server
(`system=http://unitsofmeasure.org`, UCUM 2.2) and is a valid UCUM code. The two HL7 codings
(observation-category `vital-signs`, v3-ActCode `IMP`) were looked up there too, and `display` is
the server's. A code changed here is looked up again, and its line's record changed with it.

THE SIGNALS (D10). The six hand-charted bedside signals, by the engine's own slug
(`canonical.SignalCode`), each with the unit the bedside door records it in (`api/clinical.py`
CHARTABLE) — a chart row in any other unit is not sent, never converted — and the UCUM code the
value goes out with. Weight and height come from the admission, not from a chart row (D10). The
codes the reference sender used and the platform accepted (spec §5) are the starting point; the
two it did not use (respiratory rate, mean arterial pressure) are LOINC's own for the measurement.

SpO2 goes as `2708-6` «Oxygen saturation in Arterial blood», the code the platform accepted from
the reference sender. A bedside SpO2 is a pulse oximetry reading, which LOINC also codes:
`59408-5` «Oxygen saturation in Arterial blood by Pulse oximetry» (looked up the same day, ACTIVE).
Which one the ministry wants is ITS question to answer before live (spec O7); until then nothing
here changes.

`code.text` carries the LOINC display, not a local label: the module holds no reviewed Azerbaijani
name for a signal, and an unreviewed one would go into the national record (plan F1, amendment)."""
from __future__ import annotations

from dataclasses import dataclass

LOINC = "http://loinc.org"
UCUM = "http://unitsofmeasure.org"
OBSERVATION_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category"
ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode"

#: Where and when the codes below were checked (D12).
CHECKED_AT = "2026-11-12"
CHECKED_WITH = "https://tx.fhir.org/r4 CodeSystem/$lookup (LOINC 2.83, UCUM 2.2)"


@dataclass(frozen=True)
class Coded:
    """One coding the feed writes: its system, code and display as the terminology server answered."""
    system: str
    code: str
    display: str

    def coding(self) -> dict:
        return {"system": self.system, "code": self.code, "display": self.display}


@dataclass(frozen=True)
class Signal:
    """A vital sign as it is sent: its LOINC coding, the unit the engine charts it in, its UCUM code and
    the key its local id carries.

    `id_key` is what `ids.vital` puts in the id (`hmn-v-{root}-{id_key}-{first|last}.`), NEVER the LOINC
    code: a sent local id never changes (plan F1, amendment 1) and a code may (SpO2 — O7: `2708-6` now,
    perhaps `59408-5`), and then the same resource must be PUT again under the same id. The key is
    lower-case words joined by single hyphens (a FHIR id allows no `_`), and no two signals share one."""
    loinc: Coded
    charted_unit: str | None          # the chart row's `unit`; None: not a chart row (weight, height)
    ucum: str
    id_key: str


#: observation-category `vital-signs` — checked 2026-11-12, display «Vital Signs».
VITAL_SIGNS = Coded(OBSERVATION_CATEGORY, "vital-signs", "Vital Signs")
#: v3-ActCode `IMP` (an Encounter's class) — checked 2026-11-12, display «inpatient encounter».
INPATIENT = Coded(ACT_CODE, "IMP", "inpatient encounter")

#: The bedside signals (D10) by the engine's slug, in the order they are sent. Each checked
#: 2026-11-12 (CHECKED_WITH); the UCUM codes `/min`, `%`, `Cel`, `mm[Hg]` likewise.
SIGNALS: dict[str, Signal] = {
    "heart_rate": Signal(Coded(LOINC, "8867-4", "Heart rate"), "/min", "/min", "heart-rate"),
    "resp_rate": Signal(Coded(LOINC, "9279-1", "Respiratory rate"), "/min", "/min", "resp-rate"),
    "spo2": Signal(Coded(LOINC, "2708-6", "Oxygen saturation in Arterial blood"), "%", "%", "spo2"),   # O7
    "temperature": Signal(Coded(LOINC, "8310-5", "Body temperature"), "°C", "Cel", "temperature"),
    "sbp": Signal(Coded(LOINC, "8480-6", "Systolic blood pressure"), "mmHg", "mm[Hg]", "sbp"),
    "map": Signal(Coded(LOINC, "8478-0", "Mean blood pressure"), "mmHg", "mm[Hg]", "map"),
}

#: The admission's measurements (D10): one value each, at the admission. Checked 2026-11-12; UCUM
#: `kg`, `cm`.
WEIGHT = Signal(Coded(LOINC, "29463-7", "Body weight"), None, "kg", "weight")
HEIGHT = Signal(Coded(LOINC, "8302-2", "Body height"), None, "cm", "height")

#: The record of each check, per code, as the plan and the guide print it.
CHECKS: tuple[tuple[str, str, str, str], ...] = tuple(
    (signal.loinc.code, signal.loinc.display, signal.ucum, CHECKED_AT)
    for signal in (*SIGNALS.values(), WEIGHT, HEIGHT))
