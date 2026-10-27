"""Aşama B: the bridge from the monitor strip to the SHADOW engine (spec 2026-10-27, D1–D5).

What this module is: the only code that turns a monitor cell into an `Observation`, and the only
code that feeds the shadow engine. What it is not: a path to the real engine. It imports the
engine's classes to drive a second instance of them; it never imports the notifier, the ack
store, the alert lifecycle or the alarm-quality counters (tests/test_infinity_shadow_isolation.py
holds it to that), and the real engine is handed to it read-only, for copying.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from homunculus.api.audit import AuditEvent, AuditLog, AuditRecord
from homunculus.api.infinity_shadow import DeviceView, PARAMETERS
from homunculus.api.monitor_samples import Sample, SampleStore
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.reco.engine import Alert
from homunculus.rules.news2 import score as news2_score

log = logging.getLogger(__name__)

SAMPLE_INTERVAL_S = 60.0            # D4: one sample per (patient, code) per minute
NBP_MAX_FOR_RULES_S = 3600.0        # D3: an NBP measured more than an hour ago feeds nothing
REPLAY_HOURS = 24                   # D9: what the shadow engine is rebuilt from at start-up
DEFAULT_PARAMETERS = ("hr", "pls", "spo2", "art_systolic", "art_mean", "nbp")   # D2 (S1)
SOURCE_PREFIX = "infinity:"
# Engine code -> the monitor cells that may feed it, in priority order (D3): the first cell that
# is a value wins; the rest are ignored for that sample. Names not here (respiration,
# temperature, art_diastolic, etco2) never feed, whatever the allowlist says.
FEEDS: dict[SignalCode, tuple[str, ...]] = {
    SignalCode.HEART_RATE: ("hr", "pls"),
    SignalCode.SPO2: ("spo2",),
    SignalCode.SBP: ("art_systolic", "nbp"),
    SignalCode.MAP: ("art_mean", "nbp"),
}
# The strip's WIRE unit per engine code (infinity_shadow.PARAMETERS). The rules read the raw
# number (rules/news2.py, rules/septic_shock.py), so a cell in this unit feeds as it is; a cell in
# any other unit feeds nothing — the lane never converts. The unit travels on to the audit and
# the card.
ENGINE_UNIT: dict[SignalCode, str] = {
    SignalCode.HEART_RATE: "bpm", SignalCode.SPO2: "%", SignalCode.SBP: "mmHg", SignalCode.MAP: "mmHg",
}
_NBP_FIELD = {SignalCode.SBP: "systolic", SignalCode.MAP: "mean"}
_VIA = {"hr": "hr", "pls": "pls", "spo2": "spo2", "art_systolic": "art", "art_mean": "art", "nbp": "nbp"}
# Every name the allowlist may hold: the strip's parameters, NBP as one name.
ALLOWED_NAMES = frozenset(set(PARAMETERS) - {"nbp_systolic", "nbp_diastolic", "nbp_mean"}) | {"nbp"}
# The names that can feed an engine code at all (FEEDS); the others are allowed and feed nothing.
_FEEDING_NAMES = frozenset(name for names in FEEDS.values() for name in names)


@dataclass(frozen=True)
class RulesSettings:
    allowed: tuple[str, ...] = DEFAULT_PARAMETERS


def rules_from_env(env: Mapping[str, str]) -> RulesSettings:
    """`INFINITY_RULES_PARAMETERS`: comma-separated strip parameter names; empty is the default
    list. A name that is not a strip parameter, or a value that names nothing at all (","), is
    `ValueError("parameters_unknown")` — the caller turns the stage off with that problem code
    rather than guessing. A strip parameter FEEDS has no row for (respiration, temperature,
    art_diastolic, etco2) is accepted and feeds nothing; the log says so, once per read."""
    raw = (env.get("INFINITY_RULES_PARAMETERS", "") or "").strip()
    if not raw:
        return RulesSettings()
    names = tuple(dict.fromkeys(n.strip().lower() for n in raw.split(",") if n.strip()))
    if not names or any(n not in ALLOWED_NAMES for n in names):
        raise ValueError("parameters_unknown")
    idle = [n for n in names if n not in _FEEDING_NAMES]
    if idle:
        log.warning("INFINITY_RULES_PARAMETERS: %s hiçbir motor koduna bağlı değil; bu adlar hiçbir şey beslemez",
                    ",".join(idle))
    return RulesSettings(names)


@dataclass(frozen=True)
class Candidate:
    """One monitor cell that may feed one engine code now."""
    code: SignalCode
    value: float
    unit: str
    stamp: float            # epoch seconds: the cell's `last_at`, or NBP's `changed_at`
    source: str             # the device's address
    via: str                # hr | pls | spo2 | art | nbp — what the card shows

    @property
    def source_device(self) -> str:
        return f"{SOURCE_PREFIX}{self.source}:{self.via}"

    def observation(self, patient_id: str) -> Observation:
        return Observation(patient_id, self.code, float(self.value), self.unit,
                           datetime.fromtimestamp(self.stamp, timezone.utc), self.source_device)


def _epoch(iso: str | None) -> float | None:
    """A cell's ISO time as epoch seconds; None for none, and for a time without an offset — read
    as the server's local time it would move the sample by the server's own offset."""
    if not iso:
        return None
    dt = datetime.fromisoformat(iso)
    return None if dt.tzinfo is None else dt.timestamp()


def pick(view: DeviceView, allowed: tuple[str, ...], *, now: float) -> list[Candidate]:
    """The candidates one device offers now, one per engine code at most (D3). Pure.

    `now` is accepted for signature stability (the sampler passes its clock); this pure step
    judges age from the cells' own `measured_age_s`, so it does not read it yet."""
    cells = {p["parameter"]: p for p in view.parameters}
    out: list[Candidate] = []
    for code, names in FEEDS.items():
        for name in names:
            cell = cells.get(name)
            if name not in allowed or cell is None or cell.get("state") != "value":
                continue
            if name == "nbp":
                measured = cell.get("measured_age_s")
                changed = _epoch(cell.get("changed_at"))
                if measured is None or changed is None or measured > NBP_MAX_FOR_RULES_S:
                    continue
                value, stamp = cell.get(_NBP_FIELD[code]), changed
            else:
                value, stamp = cell.get("value"), _epoch(cell.get("last_at"))
            if value is None or stamp is None or cell.get("unit") != ENGINE_UNIT[code]:
                continue
            out.append(Candidate(code, float(value), cell["unit"], stamp, view.source, _VIA[name]))
            break           # the first value in priority order feeds; the others are ignored
    return out


SHADOW_ALERT, SHADOW_CLEARED = "shadow_alert", "shadow_alert_cleared"
_SEVERITY = ("info", "low", "moderate", "high", "critical")
# The lane reads back only its own two kinds of audit row, the NEWEST first when this cap bites:
# every clinical reading writes an `ingest` row, so a read of all kinds over a day can pass any
# cap, and an oldest-first cap would drop the newest rows — the findings open now.
_AUDIT_READ_MAX = 100_000


class Sampler:
    """The 60 s clock per (patient, engine code) — D4. Monotonic in `now` per key; a sample is
    never back-filled."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, SignalCode], float] = {}

    def due(self, patient_id: str, candidate: Candidate, *, now: float) -> bool:
        last = self._last.get((patient_id, candidate.code))
        return last is None or now - last >= SAMPLE_INTERVAL_S

    def taken(self, patient_id: str, candidate: Candidate, *, now: float) -> None:
        self._last[(patient_id, candidate.code)] = now

    def forget(self, patient_id: str) -> None:
        for key in [k for k in self._last if k[0] == patient_id]:
            del self._last[key]


def relation(finding: Alert, real: Mapping[str, Alert]) -> str:
    """D6: how a shadow finding stands to the real engine's alerts of the same patient."""
    twin = real.get(finding.kind)
    if twin is None:
        return "shadow_only"
    return "same" if twin.severity == finding.severity else "level_differs"


class ShadowLane:
    """The shadow engines, one per hospital, and everything that feeds them (D1).

    `enabled` is the stage `rules`; below it every method is a no-op and `engines` stays empty,
    so the stage `shadow` is Aşama A exactly. `install(hospital, real)` builds the hospital's
    shadow engine as `real.copy()` plus the last REPLAY_HOURS of samples (D9). The doors call
    `mirror_*` after the real engine; `sample` is called by the readings route; `findings` builds
    the board's `shadow` key. Every call from a door goes through `guard`: the lane never fails a
    clinical request.

    A finding is a shadow finding only for a patient a monitor is linked to: the mirror keeps an
    unlinked patient's shadow picture equal to the real one, and writes no `shadow_alert` row for
    it — that row would only repeat a real alert, and the weekly list would show it."""

    def __init__(self, *, allowed: tuple[str, ...], samples: SampleStore, audit: AuditLog, enabled: bool) -> None:
        self.allowed = allowed
        self.samples = samples
        self.audit = audit
        self.enabled = enabled
        self.engines: dict[str, Engine] = {}
        self.sampler = Sampler()
        self.linked: dict[str, set[str]] = {}                 # hospital -> patient ids linked now
        self._open: dict[tuple[str, str], dict[str, Alert]] = {}  # (hospital, pid) -> last published findings
        self._open_ids: dict[tuple[str, str, str], int] = {}  # (hospital, pid, kind) -> the opening row's id
        self.state = "ok"                                     # ok | error — the device screen's word

    # --- the guard --------------------------------------------------------------------------
    def guard(self, what: str, call: Callable[[], Any]) -> Any:
        try:
            result = call()
        except Exception:                         # the lane must never fail a clinical request
            if self.state != "error":
                log.exception("gölge motor: %s başarısız; klinik yol etkilenmedi", what)
            self.state = "error"
            return None
        if self.state != "ok":
            log.warning("gölge motor: yeniden çalışıyor (%s)", what)
            self.state = "ok"
        return result

    # --- start-up ---------------------------------------------------------------------------
    def install(self, hospital: str, real: Engine, *, now: datetime | None = None) -> None:
        if not self.enabled:
            return
        now = now or datetime.now(timezone.utc)
        engine = real.copy()
        since = now - timedelta(hours=REPLAY_HOURS)
        for row in self.samples.since(hospital, since, now=now):
            code = SignalCode(row.code)
            obs = Observation(row.patient_id, code, row.value, row.unit, row.captured_at,
                              f"{SOURCE_PREFIX}{row.source}:{row.via}")
            engine.ingest(obs, now=min(obs.timestamp, now))
            self.sampler._last[(row.patient_id, code)] = row.captured_at.timestamp()   # noqa: SLF001
        self.engines[hospital] = engine
        self.linked[hospital] = set()
        # The findings open before the restart: the audit's last word per (patient, kind) in the
        # replay window, paired by the opening row's id. Seeded so a finding still open is not
        # opened twice (spec §5). The audit stamps its rows with the wall clock (`ts`), never with
        # the lane's `now`, so the window on the audit is taken on the wall clock.
        audit_since = datetime.now(timezone.utc) - timedelta(hours=REPLAY_HOURS)
        opened: dict[tuple[str, str], dict[str, Alert]] = {}
        ids: dict[tuple[str, str, str], int] = {}
        for rec in self._shadow_rows(hospital, since=audit_since):
            key = (hospital, rec.patient_id)
            if rec.event_type == SHADOW_ALERT:
                opened.setdefault(key, {})[rec.subject] = Alert(
                    rec.patient_id, rec.subject, rec.payload.get("severity", ""), rec.payload.get("urgency", ""),
                    rec.payload.get("summary", ""), "", list(rec.payload.get("evidence", [])), [], "")
                ids[(hospital, rec.patient_id, rec.subject)] = rec.id
            elif rec.event_type == SHADOW_CLEARED:
                opened.get(key, {}).pop(rec.subject, None)
                ids.pop((hospital, rec.patient_id, rec.subject), None)
        self._open.update({k: v for k, v in opened.items() if v})
        self._open_ids.update(ids)

    # --- the mirror (D1) ----------------------------------------------------------------------
    def mirror_observation(self, hospital: str, obs: Observation, *, now: datetime) -> None:
        engine = self.engines.get(hospital)
        if engine is None:
            return
        engine.ingest(obs, now=min(obs.timestamp, now))
        # A charted input can open or end a linked patient's shadow finding; an unlinked patient
        # has none (the class docstring).
        if obs.patient_id in self.linked.get(hospital, set()):
            self._publish(hospital, obs.patient_id, now)

    def mirror_profile(self, hospital: str, profile) -> None:
        engine = self.engines.get(hospital)
        if engine is not None:
            engine.set_profile(profile)

    def forget(self, hospital: str, patient_id: str, *, now: datetime) -> None:
        engine = self.engines.get(hospital)
        if engine is None:
            return
        self._clear(hospital, patient_id, now, reason="discharged")
        engine.forget(patient_id)
        self.sampler.forget(patient_id)
        self.linked.get(hospital, set()).discard(patient_id)

    # --- the samples (D3, D4, D5) --------------------------------------------------------------
    def sample(self, hospital: str, views: Mapping[str, DeviceView], cards: Iterable[dict], *, now: float,
               real: Engine | None = None) -> list[str]:
        """One pass over the board's bed cards. Returns the patient ids whose shadow picture
        changed (a sample taken, or a link ended) — the caller republishes their frames."""
        engine = self.engines.get(hospital)
        if engine is None:
            return []
        wall = datetime.fromtimestamp(now, timezone.utc)
        linked_now = {c["patient_id"]: c for c in cards if c.get("link") == "one" and c.get("patient_id")}
        changed: list[str] = []
        # Links that ended since the last pass: back to the real picture (D5).
        for pid in sorted(self.linked.get(hospital, set()) - set(linked_now)):
            self._clear(hospital, pid, wall, reason="unlinked")
            if real is not None:
                engine.adopt(real, pid)
            else:
                engine.state(pid).drop_source(SOURCE_PREFIX)
            self.sampler.forget(pid)
            changed.append(pid)
        for pid, card in linked_now.items():
            view = views.get(card["source"])
            if view is None:
                continue
            taken = False
            for cand in pick(view, self.allowed, now=now):
                if not self.sampler.due(pid, cand, now=now):
                    continue
                obs = cand.observation(pid)
                engine.state(pid).drop_source(SOURCE_PREFIX, before=obs.timestamp - timedelta(hours=REPLAY_HOURS))
                engine.ingest(obs, now=min(obs.timestamp, wall))
                self.samples.append(Sample(hospital, pid, str(card.get("bed_id") or ""), cand.source,
                                           cand.code.value, cand.via, obs.value, obs.unit, obs.timestamp, wall))
                self.sampler.taken(pid, cand, now=now)
                taken = True
            if taken:
                self._publish(hospital, pid, wall)
                changed.append(pid)
        self.linked[hospital] = set(linked_now)
        return changed

    # --- the findings (D6) --------------------------------------------------------------------
    def findings(self, hospital: str, patient_id: str, real: Engine, *, now: datetime,
                 linked: bool | None = None) -> dict | None:
        engine = self.engines.get(hospital)
        if engine is None or patient_id not in engine.patient_ids():
            return None
        if linked is False or (linked is None and patient_id not in self.linked.get(hospital, set())):
            return None
        state = engine.state(patient_id)
        vitals = {}
        for code in FEEDS:
            obs = state.latest(code)
            if obs is not None and obs.source_device.startswith(SOURCE_PREFIX):
                vitals[code.value] = {"value": obs.value, "unit": obs.unit, "at": obs.timestamp.isoformat(),
                                      "source": obs.source_device, "via": obs.source_device.rsplit(":", 1)[-1]}
        result = news2_score(state, now)
        real_alerts = {a.kind: a for a in real.active_alerts(patient_id)}
        found = [{"kind": a.kind, "severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                  "evidence": list(a.supporting_evidence), "relation": relation(a, real_alerts),
                  "stale_inputs": list(a.stale_inputs), "downgraded": a.downgraded}
                 for a in sorted(engine.active_alerts(patient_id),
                                 key=lambda a: (-(_SEVERITY.index(a.severity) if a.severity in _SEVERITY else 0), a.kind))]
        return {"news2": {"total": result.total, "partial": result.partial, "missing": list(result.missing),
                          "stale": list(result.stale), "assumed": list(result.assumed),
                          "breakdown": dict(result.breakdown)},
                "vitals": vitals, "findings": found}

    def recent_findings(self, hospital: str, *, since: datetime) -> list[dict]:
        """The 7-day list (D7): every `shadow_alert` row since `since`, newest first, with its
        clearing row's time when it has one (paired by the opening row's id, `opened_id`)."""
        rows = self._shadow_rows(hospital, since=since)
        cleared = {r.payload.get("opened_id"): r.ts for r in rows if r.event_type == SHADOW_CLEARED}
        out = []
        for r in sorted((r for r in rows if r.event_type == SHADOW_ALERT), key=lambda r: r.id, reverse=True):
            out.append({"patient_id": r.patient_id, "kind": r.subject, "opened_at": r.ts,
                        "cleared_at": cleared.get(r.id), **r.payload})
        return out

    # --- audit rows -------------------------------------------------------------------------
    def _shadow_rows(self, hospital: str, *, since: datetime) -> list[AuditRecord]:
        """The lane's own rows (`shadow_alert`, `shadow_alert_cleared`) stamped at or after
        `since` on the audit's clock, oldest first by id."""
        rows = [r for kind in (SHADOW_ALERT, SHADOW_CLEARED)
                for r in self.audit.records(tenant=hospital, event_type=kind, since=since,
                                            limit=_AUDIT_READ_MAX, newest=True)]
        return sorted(rows, key=lambda r: r.id)

    def _open_row(self, hospital: str, patient_id: str, alert: Alert, now: datetime, sources: list[str]) -> None:
        rec = self.audit.append(AuditEvent(hospital, SHADOW_ALERT, patient_id, alert.kind,
                                           {"severity": alert.severity, "urgency": alert.urgency,
                                            "summary": alert.summary, "evidence": list(alert.supporting_evidence),
                                            "sources": sources, "at": now.isoformat()}))
        self._open_ids[(hospital, patient_id, alert.kind)] = rec.id

    def _cleared_row(self, hospital: str, patient_id: str, kind: str, now: datetime, reason: str) -> None:
        opened_id = self._open_ids.pop((hospital, patient_id, kind), None)
        self.audit.append(AuditEvent(hospital, SHADOW_CLEARED, patient_id, kind,
                                     {"reason": reason, "at": now.isoformat(), "opened_id": opened_id}))

    def _publish(self, hospital: str, patient_id: str, now: datetime) -> None:
        engine = self.engines[hospital]
        current = {a.kind: a for a in engine.active_alerts(patient_id)}
        key = (hospital, patient_id)
        before = self._open.get(key, {})
        sources = sorted({o.source_device for code in FEEDS
                          for o in [engine.state(patient_id).latest(code)]
                          if o is not None and o.source_device.startswith(SOURCE_PREFIX)})
        for kind, alert in current.items():
            prior = before.get(kind)
            if prior is None or prior.severity != alert.severity:
                if prior is not None:
                    self._cleared_row(hospital, patient_id, kind, now, "level_changed")
                self._open_row(hospital, patient_id, alert, now, sources)
        for kind in before:
            if kind not in current:
                self._cleared_row(hospital, patient_id, kind, now, "ended")
        if current:
            self._open[key] = current
        else:
            self._open.pop(key, None)

    def _clear(self, hospital: str, patient_id: str, now: datetime, *, reason: str) -> None:
        key = (hospital, patient_id)
        for kind in self._open.pop(key, {}):
            self._cleared_row(hospital, patient_id, kind, now, reason)

    def clear_all(self, hospital: str, *, now: datetime, reason: str = "stage") -> None:
        """D10: going back below `rules` ends every open finding with one row each."""
        for key in [k for k in self._open if k[0] == hospital]:
            self._clear(hospital, key[1], now, reason=reason)
