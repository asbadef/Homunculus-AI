"""A scripted Dräger device for tests and `--fake` runs. Sans-I/O like the session.

It behaves the way the protocol definition and its FAQ say a Dräger device behaves, including
the traps: it embeds its device-ID request inside the ICC response, sends NOPs when the PC is
quiet, and re-initialises after 3 s of silence. Optional knobs inject realtime bytes and corrupt
frames so the parser's tolerance is exercised end to end.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from medibus.framing import Control, Frame, StreamParser, checksum, encode_command, encode_response
from medibus.session import ALARMS_CP1, ALARMS_CP2, DATA_CP1, DATA_CP2, DEVICE_ID, ICC, NOP, \
    SETTINGS, STOP

EVITA4_IDENTITY = "8240'Evita 4'04.00:04.00"

# A plausible Evita 4 code-page-1 table (codes from the Dräger ICU-devices IFU). Values are
# invented demo numbers, not clinical data.
DEMO_READINGS = {
    "EB": " 96 ",   # SpO2 %
    "E1": " 84 ",   # pulse /min
    "D6": " 18 ",   # breathing frequency /min
    "F0": " 40 ",   # inspired O2 %
    "78": "  5 ",   # PEEP mbar
    "7D": " 24 ",   # peak airway pressure mbar
    "B9": "7.2 ",   # minute volume L/min
    "88": " 420",   # expiratory tidal volume mL
    "E6": " 38 ",   # etCO2 mmHg
}


@dataclass
class FakeDevice:
    readings: dict[str, str] = field(default_factory=lambda: dict(DEMO_READINGS))
    readings_cp2: dict[str, str] = field(default_factory=dict)
    settings: dict[str, str] = field(default_factory=lambda: {"01": "  40 ", "0B": "  5.0"})
    alarms: list[tuple[int, str, str]] = field(default_factory=list)
    identity: str = EVITA4_IDENTITY
    embed_device_id_request: bool = True
    realtime_noise: bool = False
    corrupt_every: int = 0          # every n-th data response gets a wrong checksum (0 = never)
    icc_interval: float = 3.0
    nop_interval: float = 2.0
    silence_timeout: float = 3.0

    def __post_init__(self) -> None:
        self._parser = StreamParser()
        self._out = bytearray()
        self.active = False
        self.pc_identity: str | None = None
        self.commands_seen: list[int] = []
        self.data_polls = 0
        self._last_rx: float | None = None
        self._last_tx: float = float("-inf")
        self._awaiting: int | None = None        # our command awaiting the PC's response
        self._icc_sent_at: float = float("-inf")

    # ---- surface -----------------------------------------------------------------------

    def receive(self, data: bytes, now: float) -> None:
        if data:
            self._last_rx = now
        for item in self._parser.feed(data):
            if isinstance(item, Control):
                continue
            if item.kind == "command":
                self._on_command(item, now)
            else:
                self._on_response(item, now)

    def tick(self, now: float) -> None:
        if not self.active:
            if now - self._icc_sent_at >= self.icc_interval:
                self._send_command(ICC, now)
            return
        if self._last_rx is not None and now - self._last_rx >= self.silence_timeout:
            self.active = False
            self._send_command(ICC, now)
            return
        if self._awaiting is None and now - self._last_rx >= self.nop_interval \
                and now - self._last_tx >= self.nop_interval:
            self._send_command(NOP, now)

    def outgoing(self) -> bytes:
        data, self._out = bytes(self._out), bytearray()
        return data

    # ---- behaviour ---------------------------------------------------------------------

    def _on_command(self, frame: Frame, now: float) -> None:
        self.commands_seen.append(frame.code)
        if not frame.checksum_ok:
            self._write(encode_response(0x15), now)
            return
        code = frame.code
        if code == ICC:
            self.active = True
            embedded = b""
            if self.embed_device_id_request:
                embedded = encode_command(DEVICE_ID)
                self._awaiting = DEVICE_ID
            # the outer checksum ignores the embedded command (FAQ)
            self._write(b"\x01\x51" + embedded + checksum(b"\x01\x51") + b"\x0d", now)
        elif code == DEVICE_ID:
            self._write(encode_response(DEVICE_ID, self.identity.encode("ascii")), now)
        elif code == DATA_CP1:
            self.data_polls += 1
            self._data_response(code, self.readings, now)
        elif code == DATA_CP2:
            self._data_response(code, self.readings_cp2, now)
        elif code == SETTINGS:
            payload = "".join(f"{c}{v:5.5}" for c, v in self.settings.items())
            self._write(encode_response(code, payload.encode("ascii")), now)
        elif code in (ALARMS_CP1, ALARMS_CP2):
            payload = "".join(f"{chr(0x30 + p)}{c}{phrase:<12.12}" for p, c, phrase in self.alarms)
            self._write(encode_response(code, payload.encode("ascii")), now)
        elif code == STOP:
            self._write(encode_response(code), now)
            self.active = False
            self._icc_sent_at = float("inf")     # a stopped device stays quiet
        else:
            self._write(encode_response(code), now)

    def _data_response(self, code: int, table: dict[str, str], now: float) -> None:
        payload = "".join(f"{c}{v:4.4}" for c, v in table.items()).encode("ascii")
        frame = encode_response(code, payload)
        if self.corrupt_every and self.data_polls % self.corrupt_every == 0:
            frame = frame[:-3] + b"00\x0d"
        if self.realtime_noise:
            frame = b"\xc6\xc0" + frame[:4] + b"\x81\x9f" + frame[4:]
        self._write(frame, now)

    def _on_response(self, frame: Frame, now: float) -> None:
        if frame.code == self._awaiting:
            self._awaiting = None
        if frame.code == ICC:
            self.active = True
            if self.embed_device_id_request and self.pc_identity is None \
                    and self._awaiting != DEVICE_ID:
                self._send_command(DEVICE_ID, now)
        elif frame.code == DEVICE_ID:
            self.pc_identity = frame.payload.decode("ascii", errors="replace") or None

    def _send_command(self, code: int, now: float) -> None:
        if code == ICC:
            self._icc_sent_at = now
        self._awaiting = code
        self._write(encode_command(code), now)

    def _write(self, data: bytes, now: float) -> None:
        self._out += data
        self._last_tx = now
