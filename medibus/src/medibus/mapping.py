"""The per-site table that turns MEDIBUS data codes into engine signals.

A mapping file is written from what a device actually sends (the discovery report), never from
what a manual says it might send. The example file ships the Evita 4 / Savina codes from the
Dräger IFU marked `"verified": false`; the flag is documentation for the operator, the bridge
does not read it.

    {
      "device": "Evita 4",
      "codepage1": {"EB": {"signal": "spo2", "unit": "%"},
                    "F0": {"signal": "fio2", "unit": "fraction", "scale": 0.01}},
      "codepage2": {},
      "settings":  {},
      "derived":   {"on_resp_support": true}
    }

Codes are the two-character hex strings printed in the Dräger tables. The same code can mean
different things on code page 1, code page 2 and in the settings response, hence three tables.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from homunculus.canonical import SignalCode


@dataclass(frozen=True)
class Entry:
    signal: SignalCode
    unit: str
    scale: float = 1.0


def _table(raw: dict, name: str) -> dict[str, Entry]:
    out: dict[str, Entry] = {}
    for code, spec in (raw.get(name) or {}).items():
        code = str(code).upper()
        if len(code) != 2 or any(c not in "0123456789ABCDEF" for c in code):
            raise ValueError(f"{name}: {code!r} is not a two-character hex MEDIBUS code")
        try:
            signal = SignalCode(spec["signal"])
        except (KeyError, ValueError, TypeError):
            raise ValueError(
                f"{name}/{code}: unknown signal {spec.get('signal')!r} — must be one of "
                f"{[s.value for s in SignalCode]}") from None
        out[code] = Entry(signal, str(spec.get("unit", "")), float(spec.get("scale", 1.0)))
    return out


@dataclass
class SiteMapping:
    device: str = ""
    codepage1: dict[str, Entry] = field(default_factory=dict)
    codepage2: dict[str, Entry] = field(default_factory=dict)
    settings: dict[str, Entry] = field(default_factory=dict)
    on_resp_support: bool = False

    @classmethod
    def from_dict(cls, raw: dict) -> SiteMapping:
        derived = raw.get("derived") or {}
        return cls(
            device=str(raw.get("device", "")),
            codepage1=_table(raw, "codepage1"),
            codepage2=_table(raw, "codepage2"),
            settings=_table(raw, "settings"),
            on_resp_support=bool(derived.get("on_resp_support", False)),
        )

    @classmethod
    def load(cls, path: str | Path) -> SiteMapping:
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    def measured(self, codepage: int) -> dict[str, Entry]:
        return self.codepage1 if codepage == 1 else self.codepage2
