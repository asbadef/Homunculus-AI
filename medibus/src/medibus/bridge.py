"""Session events in, FHIR observations out, everything else counted.

Deliberately thin — no clinical reasoning, only normalisation and bookkeeping. The bookkeeping
matters: a ventilator whose code table is wrong looks exactly like a ventilator that is switched
off. Polls succeed, the link stays up, and nothing reaches the engine. The counters make that
visible, and the discovery report is how a site's mapping file gets written in the first place.

PHI: MEDIBUS carries no patient identity; the operator assigns one per run. Logs and reports carry
codes, counts and value FORMATS ("d.dd") — never values.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from homunculus.canonical import Observation, SignalCode
from homunculus.edge.serialize import observation_to_fhir

from medibus.mapping import Entry, SiteMapping
from medibus.messages import DeviceId, Reading, numeric
from medibus.session import Alarms, CommandSeen, Connected, CorruptFrame, Disconnected, Event, \
    Measured, Settings


@dataclass
class MedibusStats:
    """Operational counters. Holds no measured values."""
    polls: int = 0
    observations: int = 0
    connects: int = 0
    disconnects: int = 0
    corrupt: int = 0
    unmapped: dict[str, int] = field(default_factory=dict)
    non_numeric: dict[str, int] = field(default_factory=dict)
    formats: dict[str, str] = field(default_factory=dict)
    alarms: dict[str, int] = field(default_factory=dict)
    unknown_commands: dict[str, int] = field(default_factory=dict)


def _bump(counter: dict[str, int], key: str) -> None:
    counter[key] = counter.get(key, 0) + 1


def value_format(raw: str) -> str:
    """Shape of a value field with the digits blanked: ' 98 ' -> 'dd', '0.45' -> 'd.dd'."""
    return "".join("d" if c.isdigit() else c for c in raw.strip()) or "blank"


class MedibusBridge:
    def __init__(
        self,
        send: Callable[[dict], None],
        mapping: SiteMapping,
        patient_id: str,
        source_device: str = "medibus",
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not patient_id:
            raise ValueError("patient_id is required: MEDIBUS carries no patient identity")
        self.send = send
        self.mapping = mapping
        self.patient_id = patient_id
        self.source_device = source_device
        self.clock = clock or (lambda: datetime.now(tz=timezone.utc))
        self.stats = MedibusStats()
        self.device: DeviceId | None = None

    @property
    def device_label(self) -> str:
        d = self.device
        if d is None:
            return "unknown device"
        return f"{d.name} ({d.id}) {d.device_revision}/MEDIBUS {d.medibus_revision}"

    def handle(self, event: Event) -> tuple[Observation, ...]:
        if isinstance(event, Measured):
            self.stats.polls += 1
            table = self.mapping.measured(event.codepage)
            obs = self._observations(event.readings, table, f"cp{event.codepage}")
            if event.codepage == 1 and event.readings and self.mapping.on_resp_support:
                obs.append(self._observation(SignalCode.ON_RESP_SUPPORT, 1.0, "boolean"))
            return self._emit(obs)
        if isinstance(event, Settings):
            return self._emit(self._observations(event.readings, self.mapping.settings, "set"))
        if isinstance(event, Alarms):
            for alarm in event.alarms:
                _bump(self.stats.alarms, f"{alarm.code} {alarm.phrase}")
        elif isinstance(event, Connected):
            self.stats.connects += 1
            self.device = event.device
        elif isinstance(event, Disconnected):
            self.stats.disconnects += 1
        elif isinstance(event, CommandSeen):
            _bump(self.stats.unknown_commands, f"{event.code:02X}")
        elif isinstance(event, CorruptFrame):
            self.stats.corrupt += 1
        return ()

    def _observations(self, readings: list[Reading], table: dict[str, Entry], page: str) -> list[Observation]:
        out: list[Observation] = []
        for reading in readings:
            key = f"{page}:{reading.code}"
            self.stats.formats.setdefault(key, value_format(reading.raw))
            entry = table.get(reading.code)
            if entry is None:
                _bump(self.stats.unmapped, key)
                continue
            value = numeric(reading)
            if value is None:
                _bump(self.stats.non_numeric, key)
                continue
            out.append(self._observation(entry.signal, value * entry.scale, entry.unit))
        return out

    def _observation(self, code: SignalCode, value: float, unit: str) -> Observation:
        return Observation(self.patient_id, code, value, unit, self.clock(), self.source_device)

    def _emit(self, observations: list[Observation]) -> tuple[Observation, ...]:
        for obs in observations:
            self.send(observation_to_fhir(obs))
        self.stats.observations += len(observations)
        return tuple(observations)

    def discovery_report(self) -> str:
        """Which codes the device sends that the mapping does not use. Empty when there are none."""
        lines = []
        for key, n in sorted(self.stats.unmapped.items()):
            lines.append(f"{key} x{n} format={self.stats.formats.get(key, '?')}")
        for key, n in sorted(self.stats.non_numeric.items()):
            lines.append(f"{key} x{n} non-numeric format={self.stats.formats.get(key, '?')}")
        if not lines:
            return ""
        return "eşlenmemiş MEDIBUS kodları (mapping'e eklemek için): " + "; ".join(lines)
