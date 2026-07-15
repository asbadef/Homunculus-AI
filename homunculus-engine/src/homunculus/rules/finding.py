# src/homunculus/rules/finding.py
"""Structured findings emitted by rules. Every finding cites the vault."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum


class Severity(IntEnum):
    INFO = 0
    LOW = 1
    MODERATE = 2
    HIGH = 3
    CRITICAL = 4


class Urgency(IntEnum):
    ROUTINE = 0
    SOON = 1
    IMMEDIATE = 2


@dataclass(frozen=True)
class Citation:
    """Points at a note in Homunculus/wiki/sources/ (basename, no extension)."""
    source: str
    note: str = ""


@dataclass(frozen=True)
class Finding:
    kind: str
    severity: Severity
    urgency: Urgency
    summary: str
    reasoning: str
    citations: list[Citation] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.citations:
            raise ValueError(f"finding {self.kind!r} must carry at least one citation")
