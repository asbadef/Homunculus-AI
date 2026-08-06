"""A stand-in central station: sends HL7 ORU over MLLP at the bridge.

Lets the whole chain be exercised before Monday, without touching a real device. On the day, only
an IP changes.

    # bridge in one terminal (capture only)
    python scripts/run_bridge.py --db bridge.db

    # simulated station in another
    python scripts/hl7_simulator.py --port 2575 --patients bed-1,bed-2 --interval 2

Use --vendor-codes to emit Mindray-style identifiers instead of our slugs — that is what an
unmapped station looks like, and it is how you can see the bridge's discovery report working before
you ever plug into the real one.

Synthetic data only: the vitals are generated, and the "patients" are bed labels.
"""
from __future__ import annotations

import argparse
import random
import socket
import sys
import time
from datetime import datetime, timezone

VT, FS, CR = b"\x0b", b"\x1c", b"\x0d"

# Our own slugs vs. the vendor-style identifiers a real station is likelier to send.
OUR_CODES = {"heart_rate": "bpm", "map": "mmHg", "spo2": "%", "resp_rate": "/min",
             "temperature": "Cel"}
VENDOR_CODES = {"MDC_ECG_HEART_RATE": "bpm", "MDC_PRESS_BLD_NONINV_MEAN": "mmHg",
                "MDC_PULS_OXIM_SAT_O2": "%", "MDC_RESP_RATE": "/min",
                "MDC_TEMP_BLD": "Cel"}

_RANGES = {"bpm": (60, 130), "mmHg": (55, 95), "%": (88, 100), "/min": (12, 28), "Cel": (36, 39)}


def _value_for(unit: str) -> str:
    low, high = _RANGES[unit]
    return f"{random.uniform(low, high):.1f}"


def build_oru(patient: str, codes: dict[str, str], control_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    segments = [
        f"MSH|^~\\&|MINDRAY|ICU|HOMUNCULUS|HOSP|{stamp}||ORU^R01|{control_id}|P|2.5",
        f"PID|||{patient}",
    ]
    for index, (code, unit) in enumerate(codes.items(), start=1):
        segments.append(
            f"OBX|{index}|NM|{code}||{_value_for(unit)}|{unit}|||||F|||{stamp}"
        )
    return "\r".join(segments) + "\r"


def send_message(sock: socket.socket, message: str) -> str:
    sock.sendall(VT + message.encode("utf-8") + FS + CR)
    reply = sock.recv(4096)
    return reply.decode("utf-8", errors="replace").strip("\x0b\x1c\x0d")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Simulated HL7 central station")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2575)
    parser.add_argument("--patients", default="bed-1,bed-2,bed-3")
    parser.add_argument("--interval", type=float, default=2.0, help="seconds between messages")
    parser.add_argument("--count", type=int, default=0, help="messages to send (0 = forever)")
    parser.add_argument("--vendor-codes", action="store_true",
                        help="send Mindray-style OBX identifiers (i.e. an unmapped station)")
    args = parser.parse_args(argv)

    # Windows consoles default to a legacy code page that cannot encode Turkish characters, which
    # would crash on the first status line. Force UTF-8 so this runs on the pilot laptop.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    codes = VENDOR_CODES if args.vendor_codes else OUR_CODES
    patients = [p.strip() for p in args.patients.split(",") if p.strip()]

    print(f"bağlanılıyor {args.host}:{args.port} — kodlar: "
          f"{'vendor (eşlenmemiş)' if args.vendor_codes else 'bizim slug'}")
    with socket.create_connection((args.host, args.port), timeout=10) as sock:
        sent = 0
        while args.count == 0 or sent < args.count:
            patient = patients[sent % len(patients)]
            ack = send_message(sock, build_oru(patient, codes, f"SIM{sent:05d}"))
            status = "AA" if "MSA|AA" in ack else ("AE" if "MSA|AE" in ack else "?")
            print(f"  -> {patient}  {len(codes)} gözlem  ACK={status}")
            sent += 1
            if args.count == 0 or sent < args.count:
                time.sleep(args.interval)
    print(f"bitti: {sent} mesaj gönderildi")
    return 0


if __name__ == "__main__":
    sys.exit(main())
