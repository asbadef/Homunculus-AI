"""Fill the local dev ward with synthetic patients that actually demonstrate something.

An empty board proves the server is up and nothing else. Each bed here exists to show one thing
that was built and could not previously be looked at, and each is chosen so that a person clicking
through can check the claim rather than take it on trust.

ALL DATA IS SYNTHETIC. No name, identifier or value here came from a patient. This talks to the
dev server over its tenant token, so it works without a login — but it writes through the same
`/clinical` door a clinician uses, which means everything it does is audited, sealed into the hash
chain, and visible in the alarm-quality report exactly as real charting would be.

Run (cmd, from homunculus-engine\\, with the dev server already listening on 8000):

    .venv\\Scripts\\python.exe scripts\\dev_seed_ward.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

BASE = os.getenv("DEV_API", "http://localhost:8000")
TOKEN = os.getenv("DEV_TOKEN", "dev-token")
NOW = datetime.now(timezone.utc)


def _get(path: str) -> dict:
    request = urllib.request.Request(
        f"{BASE}{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"{}")


def _post(path: str, body: dict, method: str = "POST") -> dict:
    request = urllib.request.Request(
        f"{BASE}{path}", data=json.dumps(body).encode("utf-8"), method=method,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read() or b"{}")


# Channels a monitor produces. `/clinical` refuses these on purpose — a hand-typed heart rate
# would be indistinguishable from a measured one the moment it landed — so they go in through
# `/ingest` as FHIR Observations, which is the door a real bridge uses.
DEVICE_UNITS = {
    "heart_rate": "bpm", "spo2": "%", "sbp": "mmHg", "map": "mmHg",
    "resp_rate": "/min", "temperature": "Cel",
}


def measure(bed: str, entries: list[tuple[str, float]], minutes_ago: float = 0) -> None:
    """Device readings, through /ingest — the same path the ward's monitors use."""
    when = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    for code, value in entries:
        _post("/ingest", {
            "resourceType": "Observation",
            "code": {"coding": [{"system": "homunculus", "code": code}]},
            "subject": {"reference": f"Patient/{bed}"},
            "effectiveDateTime": when,
            "valueQuantity": {"value": value, "unit": DEVICE_UNITS.get(code, "1")},
        })


def chart(bed: str, entries: list[tuple[str, float]], minutes_ago: float = 0) -> dict:
    """What a clinician observes — infection, weight, infusions, fluids, labs."""
    when = NOW - timedelta(minutes=minutes_ago)
    return _post(f"/clinical/{bed}", {
        "entries": [{"code": code, "value": value} for code, value in entries],
        "recorded_at": when.isoformat(),
    })


def bed(name: str, *, device: list[tuple[str, float]] = (), charted: list[tuple[str, float]] = (),
        minutes_ago: float = 0) -> None:
    """One bed's worth of state, each half through its own door."""
    if device:
        measure(name, list(device), minutes_ago)
    if charted:
        chart(name, list(charted), minutes_ago)


def profile(bed: str, body: dict) -> dict:
    return _post(f"/clinical/{bed}/profile", body, method="PUT")


def ack(bed: str, kind: str, role: str) -> dict:
    return _post("/ack", {"patient_id": bed, "kind": kind, "role": role})


def main() -> int:
    try:
        # A read, not a write. An earlier version probed with a fake chart and left a patient
        # called "__probe__" sitting on the ward board — a bed that exists only because the
        # script checked whether the server was up.
        _get("/patients")
    except urllib.error.URLError as exc:
        print(f"Motor {BASE} adresinde yanıt vermiyor ({exc}).\n"
              f"Önce şunu çalıştır:\n"
              f"  .venv\\Scripts\\python.exe -m uvicorn homunculus.api.devserver:app --port 8000",
              file=sys.stderr)
        return 1

    # --- Yatak 1: kronik diyaliz hastası, bazal SOFA girilmiş ------------------------------------
    # The K1 fix, visible. Creatinine 3.5 scores 3 renal points every day of this patient's life.
    # Before the fix, ticking "suspected infection" raised a sepsis alert that never went away.
    # With a charted baseline of 3 it correctly stays quiet — and the Sepsis panel shows why.
    bed("yatak-01", minutes_ago=20,
        device=[("heart_rate", 88), ("spo2", 96), ("sbp", 128), ("temperature", 36.8),
                ("resp_rate", 16)],
        charted=[("creatinine", 3.5), ("weight_kg", 78)])
    profile("yatak-01", {"comorbidities": ["kronik böbrek yetmezliği", "HT"], "baseline_sofa": 3})
    chart("yatak-01", [("suspected_infection", 1)], minutes_ago=15)

    # --- Yatak 2: aynı tablo, bazal GİRİLMEMİŞ ---------------------------------------------------
    # The honest half of the same fix: behaviour is unchanged (Sepsis-3 assumes a baseline of 0),
    # but the reasoning now says the assumption out loud, so a physician can correct it.
    bed("yatak-02", minutes_ago=18,
        device=[("heart_rate", 96), ("spo2", 94), ("sbp", 118), ("temperature", 37.4),
                ("resp_rate", 18)],
        charted=[("creatinine", 3.4), ("weight_kg", 65)])
    chart("yatak-02", [("suspected_infection", 1)], minutes_ago=12)

    # --- Yatak 3: septik şok, antibiyotik ZAMANINDA verildi --------------------------------------
    # The pharmacy screen's good case: the clock ran and was met.
    bed("yatak-03", minutes_ago=95,
        device=[("heart_rate", 124), ("spo2", 91), ("sbp", 82), ("map", 58),
                ("temperature", 38.9), ("resp_rate", 24)],
        charted=[("weight_kg", 80), ("platelets", 74), ("bilirubin", 2.4), ("creatinine", 1.9)])
    chart("yatak-03", [("suspected_infection", 1), ("lactate", 3.6)], minutes_ago=90)
    chart("yatak-03", [("crystalloid_bolus_ml", 2400)], minutes_ago=75)
    chart("yatak-03", [("norepinephrine_rate", 0.14)], minutes_ago=60)
    chart("yatak-03", [("antibiotic_administered", 1)], minutes_ago=55)
    ack("yatak-03", "sepsis", "ATTENDING")

    # --- Yatak 4: sepsis tanındı, antibiyotik kaydı YOK ------------------------------------------
    # The pharmacy screen's whole reason to exist: the clock is running NOW, and it is visible
    # while there is still time to act rather than only after the alert has fired. The card says
    # "kayıt yok" and not "verilmedi", because the system genuinely cannot tell those apart.
    bed("yatak-04", minutes_ago=40,
        device=[("heart_rate", 112), ("spo2", 93), ("sbp", 96), ("map", 68),
                ("temperature", 38.4), ("resp_rate", 22)],
        charted=[("weight_kg", 71), ("platelets", 88), ("creatinine", 2.1)])
    chart("yatak-04", [("suspected_infection", 1), ("lactate", 2.4)], minutes_ago=35)

    # --- Yatak 5: sakin hasta, cihaz akışı canlı -------------------------------------------------
    # A control. Not every bed is on fire, and a board where every card is red teaches nothing.
    bed("yatak-05", minutes_ago=4,
        device=[("heart_rate", 74), ("spo2", 98), ("sbp", 122), ("resp_rate", 14),
                ("temperature", 36.6)],
        charted=[("weight_kg", 62)])

    # --- Yatak 6: cevapsız kalmış alarm ----------------------------------------------------------
    # So the alarm-quality panel has something other than a perfect score to report. Raised three
    # hours ago and never acknowledged: it is past the settle window, so it counts against us —
    # which is the point of measuring at all.
    bed("yatak-06", minutes_ago=180,
        device=[("heart_rate", 131), ("spo2", 88), ("sbp", 88), ("resp_rate", 26),
                ("temperature", 39.1)],
        charted=[("platelets", 62)])
    chart("yatak-06", [("suspected_infection", 1)], minutes_ago=178)

    print("Sentetik koğuş kuruldu — 6 yatak:\n")
    for line in [
        "  yatak-01  kronik diyaliz · bazal SOFA 3 girilmiş  → sepsis alarmı SUSUYOR (K1 düzeltmesi)",
        "  yatak-02  aynı tablo · bazal girilmemiş           → alarm var, gerekçe varsayımı söylüyor",
        "  yatak-03  septik şok · antibiyotik zamanında      → Eczane: saat tutuldu, onaylandı",
        "  yatak-04  sepsis · antibiyotik kaydı YOK          → Eczane: saat İŞLİYOR (asıl gösterim)",
        "  yatak-05  sakin hasta                             → kontrol yatağı",
        "  yatak-06  3 saattir cevapsız alarm                → Alarm Kalitesi: cevapsız oranı",
    ]:
        print(line)
    print("\nBakılacak yerler:")
    print("  Yatak kartı → Sepsis Değerlendirmesi kutusu")
    print("  Sol menü → Eczane")
    print("  Sistem Ayarları → Alarm Kalitesi")
    print("  Sistem Ayarları → Denetim → 'Bütünlüğü doğrula'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
