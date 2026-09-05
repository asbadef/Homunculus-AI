"""The MEDIBUS "slow" protocol life-cycle as a sans-I/O state machine.

No sockets, no serial port, no threads, no sleeps. The transport feeds received bytes in with
`receive(data, now)`, calls `tick(now)` regularly (a few times per second is plenty), writes
whatever `outgoing()` returns to the wire, and hands `events()` to the bridge.

Rules, each from the Dräger protocol definition Rev 6.00:

- Communication starts with ICC; repeat it every 3 s while nothing is heard, every 10 s while
  bytes arrive but no complete response does. A session is initialised on the ICC echo OR on an
  ICC received from the device ("Initializing Communication").
- Every command received must be answered — known or not — with at least an empty response;
  unanswered commands are what break links in practice (FAQ). A corrupt command gets NAK.
- A device-ID request is answered with the PC identification Dräger recommends: ID 0161, any
  name, and the MEDIBUS revision this code implements. After that response the device needs
  ~200 ms before it will process the next command (FAQ), so we hold.
- One command in flight at a time; a new one only after the response, or after 10 s. A command
  unanswered after 10 s is repeated up to three times, then the link is re-initialised.
- 3 s of silence terminates the link; re-initialise with ICC.
- NOP every 2 s when idle keeps the link alive.
- DC1 suspends our transmission until DC3, or for at most 3 s; CAN aborts what is in flight.
- STOP ends the session; the device may then ignore us until the next ICC.

The bridge only READS. The commands this machine can ever emit are ICC, NOP, STOP, the
device-ID request and the data requests listed below — never a configuration command.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import Enum

from medibus.framing import CAN, DC1, DC3, NAK, Control, Frame, StreamParser, encode_command, \
    encode_response
from medibus.messages import Alarm, DeviceId, Reading, parse_alarms, parse_device_id, \
    parse_measured, parse_settings

# Command codes (protocol definition, "Control commands" / "Data request commands").
NOP = 0x30
ICC = 0x51
DEVICE_ID = 0x52
STOP = 0x55
DATA_CP1 = 0x24
DATA_CP2 = 0x2B
SETTINGS = 0x29
ALARMS_CP1 = 0x27
ALARMS_CP2 = 0x2E
TIME_CHANGED = 0x49

PC_DEVICE_ID = "0161"       # the identification number Dräger recommends for a PC


class State(Enum):
    IDLE = "idle"
    INITIALISING = "initialising"
    ACTIVE = "active"


@dataclass(frozen=True)
class SessionConfig:
    device_name: str = "Homunculus"
    device_revision: str = "01.00"
    medibus_revision: str = "06.00"     # the protocol-definition revision implemented here
    poll_interval: float = 2.0
    poll_codepage2: bool = False
    poll_settings: bool = False
    poll_alarms: bool = False
    request_device_id: bool = True
    icc_retry: float = 3.0
    silence_timeout: float = 3.0
    response_timeout: float = 10.0
    max_retries: int = 3
    nop_interval: float = 2.0
    device_id_hold: float = 0.2
    suspend_timeout: float = 3.0


# ---- events -------------------------------------------------------------------------------

@dataclass(frozen=True)
class Connected:
    device: DeviceId | None


@dataclass(frozen=True)
class Disconnected:
    reason: str


@dataclass(frozen=True)
class Measured:
    codepage: int
    readings: list[Reading]
    at: float


@dataclass(frozen=True)
class Settings:
    readings: list[Reading]
    at: float


@dataclass(frozen=True)
class Alarms:
    codepage: int
    alarms: list[Alarm]
    at: float


@dataclass(frozen=True)
class CommandSeen:
    code: int


@dataclass(frozen=True)
class CorruptFrame:
    kind: str


Event = Connected | Disconnected | Measured | Settings | Alarms | CommandSeen | CorruptFrame


@dataclass
class _InFlight:
    code: int
    sent_at: float
    retries: int = 0


@dataclass
class Session:
    config: SessionConfig = field(default_factory=SessionConfig)
    state: State = State.IDLE
    device: DeviceId | None = None

    def __post_init__(self) -> None:
        self._parser = StreamParser()
        self._out = bytearray()
        self._events: list[Event] = []
        self._queue: deque[int] = deque()
        self._inflight: _InFlight | None = None
        self._last_rx: float | None = None
        self._last_tx: float = float("-inf")
        self._icc_not_before: float = float("-inf")
        self._hold_until: float = float("-inf")
        self._next_poll: float = float("inf")
        self._suspended_at: float | None = None
        self._stopped = False

    # ---- public surface ----------------------------------------------------------------

    def receive(self, data: bytes, now: float) -> None:
        if data:
            self._last_rx = now
        for item in self._parser.feed(data):
            if isinstance(item, Control):
                self._on_control(item.byte, now)
            elif item.kind == "command":
                self._on_command(item, now)
            else:
                self._on_response(item, now)

    def tick(self, now: float) -> None:
        if self._suspended_at is not None and now - self._suspended_at >= self.config.suspend_timeout:
            self._suspended_at = None

        if self.state is State.ACTIVE and self._last_rx is not None \
                and now - self._last_rx >= self.config.silence_timeout:
            self._drop("silence", now, reinit_at=now)

        if self.state is State.IDLE:
            if not self._stopped and now >= self._icc_not_before:
                self._send_icc(now)
            return

        if self.state is State.INITIALISING:
            assert self._inflight is not None
            age = now - self._inflight.sent_at
            heard = self._last_rx is not None and self._last_rx >= self._inflight.sent_at
            if age >= self.config.response_timeout or (age >= self.config.icc_retry and not heard):
                self._send_icc(now)
            return

        # ACTIVE
        if self._inflight is not None and now - self._inflight.sent_at >= self.config.response_timeout:
            self._retry(now)
            if self.state is not State.ACTIVE:
                return
        if self._inflight is None and not self._queue and now >= self._next_poll:
            self._queue.extend(self._poll_commands())
            self._next_poll = now + self.config.poll_interval
        self._pump(now)
        if self._inflight is None and not self._queue and now >= self._hold_until \
                and now - self._last_tx >= self.config.nop_interval:
            self._send_command(NOP, now)

    def outgoing(self) -> bytes:
        if self._suspended_at is not None:
            return b""
        data, self._out = bytes(self._out), bytearray()
        return data

    def events(self) -> list[Event]:
        events, self._events = self._events, []
        return events

    def stop(self, now: float) -> None:
        """Ask the device to end the session. Once it answers, the session stays down."""
        self._queue.clear()
        self._inflight = None
        self._send_command(STOP, now)

    # ---- inbound ---------------------------------------------------------------------------

    def _on_control(self, byte: int, now: float) -> None:
        if byte == DC1[0]:
            self._suspended_at = now
        elif byte == DC3[0]:
            self._suspended_at = None
        elif byte == CAN[0]:
            self._inflight = None
            if self.state is State.INITIALISING:
                # The cancelled ICC cannot receive an answer. Return to the retry path;
                # INITIALISING requires a pending command on every tick.
                self.state = State.IDLE
                self._icc_not_before = now + self.config.icc_retry

    def _on_command(self, frame: Frame, now: float) -> None:
        if not frame.checksum_ok:
            self._events.append(CorruptFrame("command"))
            self._write(encode_response(NAK), now)
            return
        if frame.code == DEVICE_ID:
            cfg = self.config
            ident = f"{PC_DEVICE_ID}'{cfg.device_name}'{cfg.device_revision}:{cfg.medibus_revision}"
            self._write(encode_response(DEVICE_ID, ident.encode("ascii")), now)
            self._hold_until = now + cfg.device_id_hold
        else:
            self._write(encode_response(frame.code), now)

        if frame.code == ICC:
            if self.state is State.ACTIVE:
                self._events.append(Disconnected("device re-initialised"))
            self._activate(now)
        elif frame.code == STOP:
            self._drop("stop", now, reinit_at=now + self.config.icc_retry)
        elif frame.code not in (NOP, DEVICE_ID):
            self._events.append(CommandSeen(frame.code))

    def _on_response(self, frame: Frame, now: float) -> None:
        if not frame.checksum_ok:
            self._events.append(CorruptFrame("response"))
            if self._inflight is not None:
                self._retry(now)
            return
        inflight = self._inflight
        if frame.code == NAK and inflight is not None:
            self._retry(now)
            return
        if inflight is not None and frame.code == inflight.code:
            self._inflight = None

        if frame.code == ICC:
            if self.state is not State.ACTIVE:
                self._activate(now)
        elif frame.code == DEVICE_ID:
            self.device = parse_device_id(frame.payload)
            self._events.append(Connected(self.device))
        elif frame.code == STOP:
            self._stopped = True
            self._drop("stopped", now, reinit_at=float("inf"))
        elif frame.code in (DATA_CP1, DATA_CP2):
            page = 1 if frame.code == DATA_CP1 else 2
            self._events.append(Measured(page, parse_measured(frame.payload), now))
        elif frame.code == SETTINGS:
            self._events.append(Settings(parse_settings(frame.payload), now))
        elif frame.code in (ALARMS_CP1, ALARMS_CP2):
            page = 1 if frame.code == ALARMS_CP1 else 2
            self._events.append(Alarms(page, parse_alarms(frame.payload), now))

    # ---- transitions -----------------------------------------------------------------------

    def _activate(self, now: float) -> None:
        # A (re-)initialisation wipes everything the device knew about us, and anything we had
        # in flight with it — start the polling cycle afresh.
        self.state = State.ACTIVE
        self._inflight = None
        self._queue.clear()
        self._next_poll = now
        if self.config.request_device_id:
            self._queue.append(DEVICE_ID)
        else:
            self._events.append(Connected(None))
        self._pump(now)

    def _drop(self, reason: str, now: float, *, reinit_at: float) -> None:
        self._events.append(Disconnected(reason))
        self.state = State.IDLE
        self.device = None
        self._inflight = None
        self._queue.clear()
        self._next_poll = float("inf")
        self._icc_not_before = reinit_at
        if now >= reinit_at and not self._stopped:
            self._send_icc(now)

    def _retry(self, now: float) -> None:
        inflight = self._inflight
        assert inflight is not None
        if inflight.retries >= self.config.max_retries:
            self._drop("no response", now, reinit_at=now)
            return
        self._inflight = None
        self._send_command(inflight.code, now, retries=inflight.retries + 1)

    # ---- outbound --------------------------------------------------------------------------

    def _poll_commands(self) -> list[int]:
        commands = [DATA_CP1]
        if self.config.poll_codepage2:
            commands.append(DATA_CP2)
        if self.config.poll_settings:
            commands.append(SETTINGS)
        if self.config.poll_alarms:
            commands.append(ALARMS_CP1)
            if self.config.poll_codepage2:
                commands.append(ALARMS_CP2)
        return commands

    def _pump(self, now: float) -> None:
        if self._inflight is None and self._queue and now >= self._hold_until:
            self._send_command(self._queue.popleft(), now)

    def _send_icc(self, now: float) -> None:
        self.state = State.INITIALISING
        self._inflight = None
        self._send_command(ICC, now)

    def _send_command(self, code: int, now: float, retries: int = 0) -> None:
        assert self._inflight is None
        self._inflight = _InFlight(code, now, retries)
        self._write(encode_command(code), now)

    def _write(self, data: bytes, now: float) -> None:
        self._out += data
        self._last_tx = now
