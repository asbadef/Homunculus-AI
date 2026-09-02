"""Byte transports: a real serial port (pyserial, imported lazily) and the in-process fake.

Both are polled, non-blocking: `read()` returns whatever has arrived, `write()` sends. The runner
polls at ~20 Hz, which is far finer than any MEDIBUS timing (the tightest rule is the 200 ms
hold after a device-ID response).
"""
from __future__ import annotations

import time
from collections.abc import Callable
from typing import Protocol

from medibus.fake_device import FakeDevice

_PARITY = {"N": "N", "E": "E", "O": "O", "NONE": "N", "EVEN": "E", "ODD": "O"}


class Transport(Protocol):
    def read(self) -> bytes: ...
    def write(self, data: bytes) -> None: ...
    def close(self) -> None: ...


class SerialTransport:
    """An RS-232 port. Defaults are the Dräger Evita / Savina factory settings: 19200 8-E-1."""

    def __init__(self, port: str, baud: int = 19200, parity: str = "E", stopbits: int = 1) -> None:
        import serial  # pyserial — only needed on the bedside machine, never for tests

        self.port = port
        self.settings = f"{baud} 8-{_PARITY[parity.upper()]}-{stopbits}"
        self._serial = serial.Serial(
            port, baudrate=baud, bytesize=serial.EIGHTBITS,
            parity={"N": serial.PARITY_NONE, "E": serial.PARITY_EVEN, "O": serial.PARITY_ODD}[
                _PARITY[parity.upper()]],
            stopbits={1: serial.STOPBITS_ONE, 2: serial.STOPBITS_TWO}[stopbits],
            timeout=0, write_timeout=2.0,
        )

    def read(self) -> bytes:
        waiting = self._serial.in_waiting
        return self._serial.read(waiting) if waiting else b""

    def write(self, data: bytes) -> None:
        self._serial.write(data)

    def close(self) -> None:
        self._serial.close()


class FakeTransport:
    """The scripted device driven by the wall clock, for `--fake` demo runs."""

    def __init__(self, device: FakeDevice | None = None,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.device = device or FakeDevice()
        self.clock = clock
        self.port = "fake"
        self.settings = "in-process"

    def read(self) -> bytes:
        self.device.tick(self.clock())
        return self.device.outgoing()

    def write(self, data: bytes) -> None:
        self.device.receive(data, self.clock())

    def close(self) -> None:
        pass
