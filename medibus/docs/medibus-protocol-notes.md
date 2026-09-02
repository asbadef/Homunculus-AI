# MEDIBUS — distilled protocol notes

Engineering notes behind `src/medibus/`. They summarise two Dräger documents; where a rule
matters for the code, the section of the document it comes from is named so it can be checked.
Nothing here is a clinical claim, so these documents are not in the vault's `raw/`.

## References

- **[PD]** *Dräger RS 232 MEDIBUS — Protocol Definition*, Rev 6.00, document 90 28 258, Dec 2007.
  Chapters: "Command / Response format", "Checksum", "Data Request Commands", "Measured Data",
  "Alarm messages", "Device Settings", appendix "MEDIBUS-Life-Cycle" (p. 40–41), "Frequently
  Asked Questions" (p. 55–57), "Change History" (p. 58).
- **[ICU]** *MEDIBUS for Dräger Intensive Care Devices — Instructions for Use* (Evita, Evita 2,
  Evita 2 dura, Evita 4, Savina, Capnosat). Per-device sections: port specification, device
  identification, transmitted/processed commands, measured-data tables.

Where the two disagree or the IFU is device-specific, the IFU wins for that device.

## 1. Which devices speak MEDIBUS

MEDIBUS is the PC interface of Dräger **ventilators and anaesthesia machines**: Evita family,
Savina, (later) Evita XL / V300 / V500, Fabius, Primus, Perseus, Zeus [PD intro; ICU]. It is *not*
the vitals export of the Infinity patient monitors — a Kappa/Delta bedside exports vitals via the
separate *Infinity RS-232 Export Protocol* (Dräger doc MS28819, connector X5), and its own
"MEDIBUS" support is for pulling ventilator data *into* the monitor. This bridge therefore reads a
ventilator, not a monitor.

Device identities from [ICU]:

| Device       | ID   | Name field     | MEDIBUS rev | Notes                                   |
| ------------ | ---- | -------------- | ----------- | --------------------------------------- |
| Evita        | 8210 | 'Evita'        | 03.00       |                                         |
| Evita 2      | 8200 | 'Evita 2'      | 03.00       |                                         |
| Evita 2 dura | 8230 | 'Evita 2 dura' | 04.00       | same command set as Evita 4             |
| Evita 4      | 8240 | 'Evita 4'      | 04.00       | COM1 rear; COM2/COM3 on "Evita 4 Link"  |
| Savina       | 8250 | 'Savina'       | 04.00       |                                         |

## 2. Physical layer (Evita 4 / Evita 2 dura, [ICU] "Device Connection")

- Connector: RS-232-C, **9-pin Sub-D female** on the device. Pins: 1 housing, **2 RXD, 3 TXD,
  5 GND**. Galvanic isolation 1.5 kV — the ventilator side is isolated; the PC side is not, so
  use a medical-grade or optically isolated adapter for anything beyond a bench test.
- Both ends are DTE, so a **null-modem** (2↔3 crossed, 5 straight) cable is needed between a
  USB-serial adapter and the ventilator.
- Port configuration is set on the ventilator: baud 1200 / 2400 / 4800 / 9600 / **19200**, 8 data
  bits, 1 start bit, 1 or 2 stop bits, parity none / odd / **even**. Factory defaults in the IFU
  examples are 19200, 8, 1, even. The bridge defaults to 19200 8-E-1; `--baud/--parity` override.
- The ventilator must have MEDIBUS selected for that port in its configuration menu (a biomed
  task; the bridge cannot do it).

## 3. Framing [PD "Command / Response format", "Checksum"]

```text
command   ESC(1BH) CODE [ARGUMENT ≤ 251 bytes] CS CS CR(0DH)
response  SOH(01H) ECHO [PAYLOAD]              CS CS CR(0DH)   (whole frame ≤ 3845 bytes)
```

- `CODE` is one byte; `ECHO` repeats the code of the command being answered.
- Checksum: the low byte of the byte-sum of everything from the first byte (ESC or SOH) up to and
  excluding the checksum, written as **two upper-case ASCII hex digits**. Example from [PD]:
  `1B 51 36 43 0D` is ICC — sum 1BH+51H = 6CH → "6C".
- A command with a bad checksum is answered with **NAK**: `SOH 15H CS CR` = `01 15 31 36 0D`.
- Commands may be **embedded inside a response** at any position, with their own checksum; the
  outer response's checksum ignores the embedded bytes [PD FAQ]. Devices really do this: the
  Evita family embeds its "request device identification" (52H) inside its ICC response. The
  parser keeps one open command and one open response simultaneously and closes the innermost
  at CR.
- Bytes ≥ 80H are **realtime data** and are transparent to the checksum and to the frame parser
  (the realtime extension is not used by this bridge; the bytes are simply skipped).
- Control bytes outside frames: **DC1 (11H)** suspend the sender's output, **DC3 (13H)** resume
  (must follow within 3 s or the link is re-initialised), **CAN (18H)** abort the frame in
  progress.
- Only ASCII printable characters appear inside frames apart from the delimiters.

## 4. Commands the bridge uses [PD "Control commands", "Data Request commands"]

| Code    | Name                           | Used how                                        |
| ------- | ------------------------------ | ----------------------------------------------- |
| 51H     | ICC — initialise communication | opens a session; answered by both sides         |
| 30H     | NOP                            | keep-alive when idle ≥ 2 s; always answered     |
| 55H     | STOP                           | ends a session cleanly; sent on shutdown        |
| 52H     | Request device identification  | answered with our identity; asked of the device |
| 24H     | Request measured data, page 1  | the 2 s poll                                    |
| 2BH     | Request measured data, page 2  | optional (`--codepage2`); **Evita 4 lacks it**  |
| 29H     | Request device settings        | optional (`--settings`)                         |
| 27H/2EH | Request alarms, page 1/2       | optional (`--alarms`); counted, not forwarded   |
| 49H     | Time changed (device → PC)     | acknowledged, otherwise ignored                 |

Evita 4 / Evita 2 dura *process* 24H 25H 26H 27H 29H 2AH 2EH 30H 4AH 51H 52H 53H 54H 55H 6AH and
*transmit* 30H 51H 52H on their own [ICU]. Anything else is answered with an empty response of
the same code (the spec's "answer every command" rule) and counted as unknown.

### Device identification payload [PD "Device Identification"]

`NNNN'Name'DD.DD:MM.MM` — four-character ID, quoted name, device revision, colon, MEDIBUS
revision. The [PD] example `0161'My PC'01.00:03.00` reproduces the printed checksum "FC", which
is how this layout was confirmed (the extracted PDF text had lost its spacing). ID **0161 is the
recommended identity for a PC** [PD]; the bridge identifies as `0161'Homunculus'01.00:06.00`.

## 5. Payload formats

- **Measured data** [PD "Measured Data"]: records of **6 bytes** — 2-hex-digit code + 4-char
  value, right-aligned, leading zeros as spaces, a leading `-` for negatives, decimal point
  included in the 4 chars (`" 98 "`, `"7.2 "`, `" 420"`). A value the device cannot deliver is
  spaces. Which codes appear, their units and formats are per device [ICU tables].
- **Settings** [PD "Device Settings"]: records of **7 bytes** — code + 5-char value.
- **Alarms** [PD "Alarm messages"]: records of **15 bytes** — priority char (1..31, encoded by
  adding 30H, 31 highest) + 2-hex code + 12-char text. Text is English regardless of the device
  language [ICU].
- **Date/time** (28H) uses German month abbreviations [PD] — not used by the bridge.

Evita 4 code-page-1 measured data that matter to Homunculus [ICU "Evita 4 — Measured Data"]:

| Code | Meaning                                    | Unit      | Format | Engine signal           |
| ---- | ------------------------------------------ | --------- | ------ | ----------------------- |
| EB   | SpO2 (with SpO2 option)                    | %         | XXX    | spo2                    |
| E1   | Pulse (with SpO2 option)                   | 1/min     | XXX    | heart_rate              |
| D6   | Breathing frequency                        | 1/min     | XXX    | resp_rate               |
| F0   | Inspired O2 concentration                  | %         | XXX    | fio2 (×0.01 → fraction) |
| B5   | Spontaneous breathing frequency            | 1/min     | XXX    | — (no signal yet)       |
| 78   | PEEP                                       | mbar      | *XXX   | —                       |
| 7D   | Peak airway pressure                       | mbar      | *XXX   | —                       |
| 73   | Mean airway pressure                       | mbar      | *XXX   | —                       |
| 74   | Plateau pressure                           | mbar      | *XXX   | —                       |
| 88   | Expiratory tidal volume                    | mL        | XXX    | —                       |
| 82   | Expiratory tidal volume                    | L         | X.XX   | —                       |
| B9   | Minute volume                              | L/min     | XX.X   | —                       |
| E6   | End-tidal CO2 (with CO2 option)            | mmHg      | XXX    | —                       |
| C9   | Rapid shallow breathing index (SW ≥ 04.00) | 1/(L·min) | XXXX   | —                       |
| 8D   | Negative inspiratory force (SW ≥ 04.00)    | mbar      | *XXX   | —                       |

A `*` before a format in the IFU means the value may be negative (`-` precedes the digits). NIF
is not transmitted when the device displays it as "< –45 mbar". Trust the discovery report over
this table: options, software versions and configuration decide what actually arrives.

## 6. Timing — the life-cycle [PD appendix p. 40–41, FAQ p. 56–57]

1. **Start:** send ICC. Repeat every **3 s** while nothing at all is received, or every **10 s**
   if bytes arrive but no complete ICC response. On the ICC response, optionally request the
   device ID; after a correct ID the session is *active*.
2. **Silence time-out:** if **no character for 3 s**, the link is considered broken and must be
   re-initialised with ICC. The device shows a **communication error, optically and
   acoustically**, until re-initialisation succeeds — a crashed or stuck PC program therefore
   raises an alarm on the ventilator. Idle links send **NOP every 2 s** to prevent this.
3. **Response time-out:** a command not answered within **10 s** is repeated; after repeated
   failure the link is re-initialised. The bridge retries 3 times.
4. **One command in flight:** if the PC sends a new command before the previous one is fully
   answered, the device abandons the previous one [PD FAQ]. Responses usually start in well under
   500 ms.
5. **Answer everything:** every command received — including one embedded inside a response —
   must be answered, at any time, in either protocol state [PD FAQ note]. Not answering the
   embedded 52H is the classic way to never reach the active state.
6. **After the device-ID response** hold ~200 ms before the next command [field practice;
   vscapture / Vital Recorder notes] — some devices drop a command sent immediately after.
7. **Stop:** send STOP and wait for its response; only then close the port. Closing without STOP
   leaves the device in the error state of rule 2.

The session implementation maps one-to-one onto these rules (`SessionConfig` field names match).

## 7. What this bridge deliberately does not do

- No realtime waveform requests (realtime configuration, 90H+ framing).
- No trend requests (5.0 extension).
- No settings changes, no alarm-limit changes, no alarm silence — MEDIBUS defines commands for
  them; this code has no encoder for them and never will in a read-only bridge.
- No date/time set on the device.
