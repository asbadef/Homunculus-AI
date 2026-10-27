"""Aşama B: the bridge from the monitor strip to the SHADOW engine (spec 2026-10-27, D1–D5).

What this module is: the only code that turns a monitor cell into an `Observation`, and the only
code that feeds the shadow engine. What it is not: a path to the real engine. It imports the
engine's classes to drive a second instance of them; it never imports the notifier, the ack
store, the alert lifecycle or the alarm-quality counters (tests/test_infinity_shadow_isolation.py
holds it to that), and the real engine is handed to it read-only: copied at start-up, copied
back for one patient when a link ends, and read for how a finding stands to it.
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
from homunculus.state.timeline import PatientState

log = logging.getLogger(__name__)

SAMPLE_INTERVAL_S = 60.0            # D4: one sample per (patient, code, via) per minute
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
# every clinical reading writes an `ingest` row, so a read of all kinds can pass any cap, and an
# oldest-first cap would drop the newest rows — the findings open now. Per kind, ≈ years of a ward.
_AUDIT_READ_MAX = 100_000
# D5 after a restart: a link seeded from the records waits this long (lane time, from the first
# pass that sees it) for its device to report; a device that reports without it ends it at once.
PROVISIONAL_GRACE_S = 120.0
# A-11: a number discharged here is not linked again for this long. The board's occupants are
# cached for 10 s, so a card may still name the retired number for a few passes.
RETIRED_GRACE_S = 15.0


class Sampler:
    """The 60 s clock per (patient, engine code, `via`) — D4 — and the last sample's stamp.

    A candidate is due when it is not stamped before the link (`since`, D5: forward only), a
    minute has passed on the lane's clock since the last sample of its key, and its stamp is newer
    than that sample's: one cuff measurement shown for an hour is one sample, not sixty. Keyed by
    `via` too, so ART falling to *** hands SBP to an NBP measured before ART's last sample (§5).
    A sample is never back-filled."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, SignalCode, str], tuple[float, float]] = {}   # -> (taken at, stamp)

    def due(self, patient_id: str, candidate: Candidate, *, now: float, since: float) -> bool:
        if candidate.stamp < since:
            return False
        last = self._last.get((patient_id, candidate.code, candidate.via))
        return last is None or (now - last[0] >= SAMPLE_INTERVAL_S and candidate.stamp > last[1])

    def taken(self, patient_id: str, candidate: Candidate, *, now: float) -> None:
        self._last[(patient_id, candidate.code, candidate.via)] = (now, candidate.stamp)

    def seed(self, patient_id: str, code: SignalCode, via: str, *, taken_at: float, stamp: float) -> None:
        """Start-up (D9): a replayed sample — the next is a minute from its RECEIPT and must be
        newer than its stamp. The newest of each wins, whatever order the calls come in."""
        key = (patient_id, code, via)
        last = self._last.get(key)
        self._last[key] = (taken_at, stamp) if last is None else (max(last[0], taken_at), max(last[1], stamp))

    def forget(self, patient_id: str) -> None:
        for key in [k for k in self._last if k[0] == patient_id]:
            del self._last[key]


def relation(finding: Alert, real: Mapping[str, Alert]) -> str:
    """D6: how a shadow finding stands to the real engine's alerts of the same patient."""
    twin = real.get(finding.kind)
    if twin is None:
        return "shadow_only"
    return "same" if twin.severity == finding.severity else "level_differs"


def _device_of(source_device: str) -> str:
    """`infinity:<address>:<via>` -> `<address>`; "" for anything else."""
    if not source_device.startswith(SOURCE_PREFIX) or ":" not in source_device[len(SOURCE_PREFIX):]:
        return ""
    return source_device[len(SOURCE_PREFIX):].rsplit(":", 1)[0]


def _iso(at: datetime | None) -> str | None:
    return None if at is None else at.isoformat()


@dataclass
class Link:
    """A monitor link the lane holds for one patient (D5).

    `since` (lane time, epoch s): the readings stamped from it on are this patient's; a candidate
    stamped before it is never taken — forward only. A new link starts at the pass that first sees
    it; a link whose device changes starts again then. `provisional`: seeded at start-up, from the
    replayed samples or from a finding left open, and not yet confirmed by a card. It hides the
    patient's findings, and ends when its device reports without it or PROVISIONAL_GRACE_S after
    the first pass that saw it (`first_pass_at`); until then it is carried over, pass to pass."""
    source: str
    since: float
    provisional: bool = False
    first_pass_at: float | None = None


@dataclass
class Open:
    """An open shadow finding (D6, D8): the alert as last published, the `shadow_alert` row that
    opened it (its id pairs the clearing row, `opened_id`) and since when it stands at this level
    (ISO, the lane's or the door's clock at the opening; a level change restarts it)."""
    alert: Alert
    row_id: int | None
    since: str


class ShadowLane:
    """The shadow engines, one per hospital, and everything that feeds them (D1).

    `enabled` is the stage `rules`. Below it `install`, the mirror, `forget` and `sample` do
    nothing, `findings` is None and `engines` stays empty, so the stage `shadow` is Aşama A
    exactly; `close_open` still runs — it is how going back below `rules` ends, once, the findings
    a `rules` run left open (D10).

    `install(hospital, real, admitted=)` builds the hospital's shadow engine as `real.copy()` plus
    the last REPLAY_HOURS of samples of the patients still admitted (D9), and seeds the sampler,
    the open findings (from the audit, whatever their age) and provisional links. It builds aside
    and assigns at the end: an install that fails leaves no engine, `state` reads "error", and the
    next `sample` or mirror retries it. The doors call `mirror_*` and `forget` after the real
    engine; the readings route calls `sample` with the strip's bed cards; `findings` builds the
    board's `shadow` key and `recent_findings` the 7-day list. Every call from a door goes through
    `guard`: the lane never fails a clinical request. The real engine is read, never written.

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
        self.linked: dict[str, dict[str, Link]] = {}              # hospital -> patient id -> link
        self._open: dict[tuple[str, str], dict[str, Open]] = {}   # (hospital, pid) -> kind -> open finding
        self._retired: dict[str, dict[str, float]] = {}           # hospital -> pid -> forgotten at (lane clock)
        self._pending: dict[str, tuple[Engine, Callable[[str], bool] | None]] = {}   # installs to retry
        self._kinds: dict[str, str] = {}                          # what -> "ok" | "error"

    # --- the guard and the state --------------------------------------------------------------
    @property
    def state(self) -> str:
        """The device screen's word: "error" while any kind of call is failing or an enabled
        hospital has no shadow engine (its install failed and waits for a retry), else "ok"."""
        return "error" if self._pending or "error" in self._kinds.values() else "ok"

    def guard(self, what: str, call: Callable[[], Any]) -> Any:
        try:
            result = call()
        except Exception:                         # the lane must never fail a clinical request
            self._failed(what)
            return None
        self._recovered(what)
        return result

    def _failed(self, what: str) -> None:
        """Called inside an `except`: one kind of call failed. Logged once per change of state."""
        if self._kinds.get(what) != "error":
            log.exception("gölge motor: %s başarısız; klinik yol etkilenmedi", what)
        self._kinds[what] = "error"

    def _recovered(self, what: str) -> None:
        if self._kinds.get(what, "ok") != "ok":
            log.warning("gölge motor: yeniden çalışıyor (%s)", what)
        self._kinds[what] = "ok"

    # --- start-up -----------------------------------------------------------------------------
    def install(self, hospital: str, real: Engine, *, now: datetime | None = None,
                admitted: Callable[[str], bool] | None = None) -> None:
        """`admitted(pid)`: the patient is admitted now (None: every patient is). A patient who is
        not has no sample replayed, and the findings left open for them close here (`discharged`).
        On failure the install stays pending: `state` is "error" and the next pass or mirror
        retries it."""
        if not self.enabled:
            return
        self._pending[hospital] = (real, admitted)
        self._install(hospital, now or datetime.now(timezone.utc))

    def _install(self, hospital: str, now: datetime) -> None:
        real, admitted = self._pending[hospital]
        is_admitted = admitted if admitted is not None else (lambda pid: True)
        engine = real.copy()
        seeds: dict[tuple[str, SignalCode, str], tuple[float, float]] = {}
        newest: dict[str, Sample] = {}
        for row in self.samples.since(hospital, now - timedelta(hours=REPLAY_HOURS), now=now):
            if not is_admitted(row.patient_id):
                continue
            code = SignalCode(row.code)
            engine.ingest(Observation(row.patient_id, code, row.value, row.unit, row.captured_at,
                                      f"{SOURCE_PREFIX}{row.source}:{row.via}"), now=min(row.captured_at, now))
            key = (row.patient_id, code, row.via)
            taken_at, stamp = row.received_at.timestamp(), row.captured_at.timestamp()
            last = seeds.get(key)
            seeds[key] = (taken_at, stamp) if last is None else (max(last[0], taken_at), max(last[1], stamp))
            if row.patient_id not in newest or row.captured_at >= newest[row.patient_id].captured_at:
                newest[row.patient_id] = row
        # D5 after a restart: the link the samples show, provisional until a card confirms it —
        # the newest sample's device, from that sample's stamp.
        links = {pid: Link(row.source, row.captured_at.timestamp(), provisional=True) for pid, row in newest.items()}
        # The findings left open, whatever their age (spec §5: not opened twice). A discharged
        # patient's close now; one with no replayed sample gets a provisional link from its row's
        # device — from now, nothing earlier is assumed theirs — so it ends the normal way.
        opens, devices = self._open_in_audit(hospital)
        for pid in [p for p in opens if not is_admitted(p)]:
            for kind, found in opens.pop(pid).items():
                self._write_cleared(hospital, pid, kind, found.row_id, now, "discharged")
        for pid in opens:
            links.setdefault(pid, Link(devices[pid], now.timestamp(), provisional=True))
        # Built aside; assigned only now that nothing can fail.
        self.engines[hospital] = engine
        self.linked[hospital] = links
        for key in [k for k in self._open if k[0] == hospital]:
            del self._open[key]
        self._open.update({(hospital, pid): kinds for pid, kinds in opens.items()})
        for (pid, code, via), (taken_at, stamp) in seeds.items():
            self.sampler.seed(pid, code, via, taken_at=taken_at, stamp=stamp)
        del self._pending[hospital]

    def _ready(self, hospital: str, now: datetime | None) -> Engine | None:
        """The hospital's shadow engine — after retrying its install, when the last one failed."""
        if hospital in self._pending:
            self._install(hospital, now or datetime.now(timezone.utc))
            self._recovered("install")
        return self.engines.get(hospital)

    # --- the mirror (D1) ----------------------------------------------------------------------
    def mirror_observation(self, hospital: str, obs: Observation, *, now: datetime, real: Engine) -> None:
        fresh = hospital in self._pending          # a copy made now already holds what `real` was given
        engine = self._ready(hospital, now)
        if engine is None or fresh:
            return
        engine.ingest(obs, now=min(obs.timestamp, now))
        # A charted input can open or end a linked patient's shadow finding; an unlinked patient
        # has none (the class docstring), and a provisional link waits for its card.
        link = self.linked.get(hospital, {}).get(obs.patient_id)
        if link is not None and not link.provisional:
            self._publish(hospital, obs.patient_id, now, real)

    def mirror_profile(self, hospital: str, profile) -> None:
        engine = self._ready(hospital, None)
        if engine is not None:
            engine.set_profile(profile)

    def forget(self, hospital: str, patient_id: str, *, now: datetime) -> None:
        """A discharge made here (A-11): the shadow engine forgets as the real one does, the link
        and the minute clock go, the open findings close (`discharged`), and the number is held
        out of the sampling for RETIRED_GRACE_S. `now` must be on the lane's clock — the one
        `sample` is given — for that hold to mean anything."""
        engine = self._ready(hospital, now)
        if engine is None:
            return
        self._retired.setdefault(hospital, {})[patient_id] = now.timestamp()
        self.linked.get(hospital, {}).pop(patient_id, None)
        engine.forget(patient_id)
        self.sampler.forget(patient_id)
        # Last, as it writes: a row that fails leaves the finding open, and the next pass closes
        # it (a finding never stays open for a patient no link names).
        self._clear(hospital, patient_id, now, reason="discharged")

    # --- the samples (D3, D4, D5) ---------------------------------------------------------------
    def sample(self, hospital: str, views: Mapping[str, DeviceView], cards: Iterable[dict] | None,
               real: Engine, *, now: float) -> list[str]:
        """One pass over the strip's bed cards, on the lane's clock `now` (epoch s). Returns the
        patient ids whose shadow picture changed — a sample taken, or a link ended — for the
        caller to republish. `cards` None (the device table is not valid now) skips the pass and
        touches nothing: no card at all is not "every link ended".

        The links are settled first (D5): a card with `link: "one"` confirms or starts one — from
        `now` when it is new or its device changed; a link no card names ends — at once when
        confirmed, and when provisional once its device reports without it or the grace is over.
        An ended link returns the patient to the real engine's picture (`adopt`) and closes their
        findings (`unlinked`). Then each linked patient takes what is due, each on their own: a
        failure is logged once and the pass goes on with the next patient."""
        if cards is None:
            return []
        wall = datetime.fromtimestamp(now, timezone.utc)
        engine = self._ready(hospital, wall)
        if engine is None:
            return []
        links = self.linked.setdefault(hospital, {})
        retired = self._retired.setdefault(hospital, {})
        for pid in [p for p, at in retired.items() if now - at >= RETIRED_GRACE_S]:
            del retired[pid]
        linked_now = {c["patient_id"]: c for c in cards
                      if c.get("link") == "one" and c.get("patient_id") and c["patient_id"] not in retired}
        for pid, card in linked_now.items():
            link = links.get(pid)
            if link is None:
                links[pid] = Link(card["source"], now)
            elif link.source != card["source"]:      # moved to another monitor: from now, own samples kept
                link.source, link.since, link.provisional = card["source"], now, False
            else:
                link.provisional = False
        ended = []
        for pid, link in list(links.items()):
            if pid in linked_now:
                continue
            if link.provisional:
                if link.first_pass_at is None:
                    link.first_pass_at = now
                if link.source not in views and now - link.first_pass_at < PROVISIONAL_GRACE_S:
                    continue                          # waits, carried over to the next pass
            del links[pid]
            ended.append(pid)
        changed: list[str] = []
        failed = False
        for pid in sorted(ended):                     # back to the real picture (D5)
            try:
                engine.adopt(real, pid)
                self.sampler.forget(pid)
                changed.append(pid)
            except Exception:
                failed = True
                self._failed("sample_patient")
        # Every finding of a patient no link names closes — the ones that ended now, and any left
        # open by a row that failed to write before.
        for pid in sorted({p for (h, p) in self._open if h == hospital and p not in links}):
            try:
                self._clear(hospital, pid, wall, reason="unlinked")
            except Exception:
                failed = True
                self._failed("sample_patient")
        for pid, card in linked_now.items():
            view = views.get(card["source"])
            if view is None:
                continue
            taken = False
            try:
                for cand in pick(view, self.allowed, now=now):
                    if not self.sampler.due(pid, cand, now=now, since=links[pid].since):
                        continue
                    obs = cand.observation(pid)
                    self.sampler.taken(pid, cand, now=now)       # first: a sample is never fed twice
                    engine.state(pid).drop_source(SOURCE_PREFIX, before=obs.timestamp - timedelta(hours=REPLAY_HOURS))
                    engine.ingest(obs, now=min(obs.timestamp, wall))
                    taken = True
                    self._keep(Sample(hospital, pid, str(card.get("bed_id") or ""), cand.source,
                                      cand.code.value, cand.via, obs.value, obs.unit, obs.timestamp, wall))
                if taken:
                    self._publish(hospital, pid, wall, real)
            except Exception:
                failed = True
                self._failed("sample_patient")
            if taken:
                changed.append(pid)
        if not failed:
            self._recovered("sample_patient")
        return changed

    def _keep(self, sample: Sample) -> None:
        """The sample's row (D8). A store that fails is logged once per change of state and the
        pass goes on — the shadow engine has the sample already; only a restart misses it."""
        try:
            self.samples.append(sample)
        except Exception:
            self._failed("samples")
            return
        self._recovered("samples")

    # --- the findings (D6) --------------------------------------------------------------------
    def findings(self, hospital: str, patient_id: str, real: Engine, *, now: datetime,
                 linked: bool | None = None) -> dict | None:
        """The board's `shadow` key: None without a link of the lane's (unless `linked` is True),
        while the link is provisional (nothing is guessed, D5), with `linked` False, and below the
        stage `rules`. A linked patient the shadow engine holds nothing for yet (every cell *** or
        old) gets the picture of nothing — no vitals, no findings, NEWS2 of an empty state — read,
        not created, in the engine. `since` per finding is when it was published at this level;
        None for one not published yet (a mirrored alert from before the link, until its first
        sample)."""
        engine = self.engines.get(hospital)
        if engine is None or linked is False:
            return None
        link = self.linked.get(hospital, {}).get(patient_id)
        if (link is None and linked is not True) or (link is not None and link.provisional):
            return None
        state = engine.state(patient_id) if patient_id in engine.patient_ids() else PatientState(patient_id)
        vitals = {}
        for code in FEEDS:
            obs = state.latest(code)
            if obs is not None and obs.source_device.startswith(SOURCE_PREFIX):
                vitals[code.value] = {"value": obs.value, "unit": obs.unit, "at": obs.timestamp.isoformat(),
                                      "source": obs.source_device, "via": obs.source_device.rsplit(":", 1)[-1]}
        result = news2_score(state, now)
        real_alerts = {a.kind: a for a in real.active_alerts(patient_id)}
        opened = self._open.get((hospital, patient_id), {})
        found = [{"kind": a.kind, "severity": a.severity, "urgency": a.urgency, "summary": a.summary,
                  "evidence": list(a.supporting_evidence), "relation": relation(a, real_alerts),
                  "since": opened[a.kind].since if a.kind in opened else None,
                  "stale_inputs": list(a.stale_inputs), "downgraded": a.downgraded}
                 for a in sorted(engine.active_alerts(patient_id),
                                 key=lambda a: (-(_SEVERITY.index(a.severity) if a.severity in _SEVERITY else 0), a.kind))]
        # board._news2's shape, built here (this module does not import the board). `last_charted`
        # is left out on purpose: the two charted inputs reach the shadow engine only by the
        # mirror, so they are the real engine's, and the real `latest.news2` line beside this one
        # already says what they last read.
        return {"news2": {"total": result.total, "partial": result.partial, "missing": list(result.missing),
                          "red_param": result.red_param, "breakdown": dict(result.breakdown),
                          "stale": list(result.stale), "assumed": list(result.assumed),
                          "measured_at": {name: _iso(at) for name, at in result.measured_at.items()},
                          "fresh_until": {name: _iso(at) for name, at in result.fresh_until.items()}},
                "vitals": vitals, "findings": found}

    def recent_findings(self, hospital: str, *, since: datetime) -> list[dict]:
        """The 7-day list (D7): every `shadow_alert` row since `since`, newest first — its payload
        (`severity`, `summary`, `sources`, `relation`, `at` the lane's clock at opening, ...), then
        `patient_id`, `kind`, `opened_at` (the audit's wall clock) and `cleared_at`, the clearing
        row's time paired by `opened_id`, or None."""
        rows = self._shadow_rows(hospital, since=since)
        cleared = {r.payload.get("opened_id"): r.ts for r in rows if r.event_type == SHADOW_CLEARED}
        return [{**r.payload, "patient_id": r.patient_id, "kind": r.subject, "opened_at": r.ts,
                 "cleared_at": cleared.get(r.id)}
                for r in sorted((r for r in rows if r.event_type == SHADOW_ALERT), key=lambda r: r.id, reverse=True)]

    def close_open(self, hospital: str, *, now: datetime, reason: str = "stage") -> int:
        """D10: one `shadow_alert_cleared` row for every finding the audit leaves open. Run when
        the stage is below `rules` (the lane disabled), so what a `rules` run left open ends, once;
        on a running lane it also forgets what it closed. Returns how many it closed."""
        opens, _ = self._open_in_audit(hospital)
        closed = 0
        for pid, kinds in opens.items():
            for kind, found in kinds.items():
                self._write_cleared(hospital, pid, kind, found.row_id, now, reason)
                held = self._open.get((hospital, pid), {})
                held.pop(kind, None)
                if not held:
                    self._open.pop((hospital, pid), None)
                closed += 1
        return closed

    # --- audit rows ---------------------------------------------------------------------------
    def _shadow_rows(self, hospital: str, *, since: datetime | None) -> list[AuditRecord]:
        """The lane's own rows (`shadow_alert`, `shadow_alert_cleared`) stamped at or after `since`
        on the audit's clock (None: whatever their age), the newest _AUDIT_READ_MAX of each kind,
        oldest first by id."""
        rows = [r for kind in (SHADOW_ALERT, SHADOW_CLEARED)
                for r in self.audit.records(tenant=hospital, event_type=kind, since=since,
                                            limit=_AUDIT_READ_MAX, newest=True)]
        return sorted(rows, key=lambda r: r.id)

    def _open_in_audit(self, hospital: str) -> tuple[dict[str, dict[str, Open]], dict[str, str]]:
        """The findings the audit leaves open, per patient and kind — each `shadow_alert` row not
        followed by a `shadow_alert_cleared` row of the same patient and kind, whatever its age —
        and per such patient the device of their newest opening that named one ("" if none did)."""
        opens: dict[str, dict[str, Open]] = {}
        device: dict[tuple[str, str], str] = {}
        for rec in self._shadow_rows(hospital, since=None):
            if rec.event_type == SHADOW_ALERT:
                p = rec.payload
                alert = Alert(rec.patient_id, rec.subject, p.get("severity", ""), p.get("urgency", ""),
                              p.get("summary", ""), "", list(p.get("evidence", [])), [], "")
                opens.setdefault(rec.patient_id, {})[rec.subject] = Open(alert, rec.id, p.get("at") or rec.ts)
                sources = p.get("sources") or []
                device[(rec.patient_id, rec.subject)] = _device_of(sources[0]) if sources else ""
            elif rec.event_type == SHADOW_CLEARED:
                opens.get(rec.patient_id, {}).pop(rec.subject, None)
        opens = {pid: kinds for pid, kinds in opens.items() if kinds}
        devices = {pid: next((device[(pid, kind)] for kind, _ in sorted(kinds.items(), key=lambda kv: -(kv[1].row_id or 0))
                              if device[(pid, kind)]), "")
                   for pid, kinds in opens.items()}
        return opens, devices

    def _open_row(self, hospital: str, patient_id: str, alert: Alert, now: datetime, sources: list[str],
                  related: str) -> None:
        rec = self.audit.append(AuditEvent(hospital, SHADOW_ALERT, patient_id, alert.kind,
                                           {"severity": alert.severity, "urgency": alert.urgency,
                                            "summary": alert.summary, "evidence": list(alert.supporting_evidence),
                                            "sources": sources, "relation": related, "at": now.isoformat()}))
        self._open.setdefault((hospital, patient_id), {})[alert.kind] = Open(alert, rec.id, now.isoformat())

    def _write_cleared(self, hospital: str, patient_id: str, kind: str, opened_id: int | None, now: datetime,
                       reason: str) -> None:
        self.audit.append(AuditEvent(hospital, SHADOW_CLEARED, patient_id, kind,
                                     {"reason": reason, "at": now.isoformat(), "opened_id": opened_id}))

    def _cleared_row(self, hospital: str, patient_id: str, kind: str, now: datetime, reason: str) -> None:
        """Ends one open finding: the row first, then the memory — a row that fails to write
        leaves the finding open, for a later call to end."""
        held = self._open.get((hospital, patient_id), {})
        found = held.get(kind)
        self._write_cleared(hospital, patient_id, kind, None if found is None else found.row_id, now, reason)
        held.pop(kind, None)
        if not held:
            self._open.pop((hospital, patient_id), None)

    def _publish(self, hospital: str, patient_id: str, now: datetime, real: Engine) -> None:
        """The patient's shadow alerts against the last published set: a new one opens, a gone one
        ends, one at another level closes (`level_changed`) and opens again at the new level, its
        `since` restarting. Each opening says how it stands to the real engine (D6, `relation`)."""
        engine = self.engines[hospital]
        current = {a.kind: a for a in engine.active_alerts(patient_id)}
        before = dict(self._open.get((hospital, patient_id), {}))
        real_alerts = {a.kind: a for a in real.active_alerts(patient_id)}
        state = engine.state(patient_id)
        sources = sorted({o.source_device for o in (state.latest(code) for code in FEEDS)
                          if o is not None and o.source_device.startswith(SOURCE_PREFIX)})
        for kind, alert in current.items():
            prior = before.get(kind)
            if prior is not None and prior.alert.severity == alert.severity:
                prior.alert = alert
                continue
            if prior is not None:
                self._cleared_row(hospital, patient_id, kind, now, "level_changed")
            self._open_row(hospital, patient_id, alert, now, sources, relation(alert, real_alerts))
        for kind in before:
            if kind not in current:
                self._cleared_row(hospital, patient_id, kind, now, "ended")

    def _clear(self, hospital: str, patient_id: str, now: datetime, *, reason: str) -> None:
        for kind in list(self._open.get((hospital, patient_id), {})):
            self._cleared_row(hospital, patient_id, kind, now, reason)
