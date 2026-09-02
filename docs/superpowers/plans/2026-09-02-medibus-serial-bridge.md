# MEDIBUS serial bridge — implementation plan

Spec: `docs/superpowers/specs/2026-09-02-medibus-serial-bridge-design.md`.
Everything lands in the new top-level `medibus/` folder. Tests run with
`cd medibus && ../homunculus-engine/.venv/Scripts/python.exe -m pytest` (the engine venv already has
pytest; the package itself needs nothing beyond the stdlib until pyserial is used on hardware).

Each task: write the failing test first, implement, run the suite, commit.

## Task 1 — Package skeleton
- `medibus/pyproject.toml` (`homunculus-medibus`, `requires-python >=3.12`, extras `serial`
  = `pyserial>=3.5`, `dev` = `pytest`; pytest `pythonpath = ["src", "../homunculus-engine/src"]`,
  `asyncio_mode = "auto"`).
- `src/medibus/__init__.py`, `tests/__init__.py`, `tests/conftest.py` (nothing yet).
- Smoke test: `import medibus` and `from homunculus.canonical import Observation` both work.

## Task 2 — `framing.py`
- `checksum`, `encode_command`, `encode_response`, `Frame`, `StreamParser`, control constants.
- Tests: every example byte string from the spec; embedded command in response; realtime bytes
  interleaved; garbage prefix; split feeds; bad checksum; DC1/DC3/CAN surfaced.

## Task 3 — `messages.py`
- `DeviceId`, `Reading`, `Alarm`; `parse_device_id`, `parse_measured`, `parse_settings`,
  `parse_alarms`, `numeric(reading) -> float | None`.
- Tests: spec example `EB 98 / E1 70`; negative; non-numeric (`"----"`, blank); settings 5-char;
  alarms; device-id with spaces in the name and the PC example.

## Task 4 — `session.py`
- `SessionConfig(device_name, poll_interval, poll_codepage2, poll_settings, poll_alarms)`,
  events, `Session`.
- Tests with a fake clock (see spec "Testing"). Also: no command is sent while one is in flight;
  device-ID hold of 200 ms; commands embedded in an ICC response are ignored but still answered
  (spec says disregarded — we answer with an empty response anyway, cheap and safe? No: "are
  disregarded" means we do not act on them; answering an unexpected 52H with our ID is harmless
  and prevents the documented re-ICC loop. Decision: answer, do not act.)

## Task 5 — `mapping.py` + `bridge.py`
- `SiteMapping.load(path)`, `SiteMapping.from_dict`, entry validation (signal must be a
  `SignalCode`), `MedibusBridge`, `MedibusStats`, `discovery_report()`.
- Tests: observations built from a `Measured` event; scale; `on_resp_support`; counters; the report
  never contains a numeric value from the readings; unknown signal name in mapping → error at load.

## Task 6 — `fake_device.py`
- Sans-I/O `FakeDevice(clock, readings, embed_device_id_request=True, realtime_noise=False)`.
- Tests: answers ICC per spec bytes; embeds 52H; answers 24H with readings; NOP idle; 3 s timeout.

## Task 7 — end to end (session ⇄ fake device pumped through byte queues)
- `tests/test_end_to_end.py`: full life-cycle produces observations for the mapped codes and a
  discovery report listing the unmapped ones.

## Task 8 — `transport.py` + `run.py` + `scripts/loopback_check.py`
- `SerialTransport` (pyserial lazy import), `QueueTransport` (fake), the asyncio runner with
  buffer/flush/report loops, discovery mode, `--fake`.
- Tests: CLI parsing; discovery mode forwards nothing; `--fake` run for a few seconds yields
  observations into a temp buffer when a mapping and a fake cloud sender are given.

## Task 9 — docs
- `medibus/README.md` (Turkish quick-start + English detail): which devices, cable pinout
  (9-pin: 2 RXD, 3 TXD, 5 GND; null-modem crossed), adapter advice, loopback check, discovery
  run, mapping, production run, safety/biomed rules, offline wheel note.
- `medibus/docs/medibus-protocol-notes.md`, `medibus/medibus-mapping.example.json`.
- Root `README.md` gets one line pointing at `medibus/`; `docs/homunculus-rehber-TR.md` gets a
  short section.

## Task 10 — commit, push, memory
- Commit per task or grouped; push `main`.
- Update memory `hospital-monitoring-landscape.md` (Kappa export ≠ MEDIBUS) and `project-state.md`.
