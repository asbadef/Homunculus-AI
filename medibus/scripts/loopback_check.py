"""Prove the USB-serial adapter and cable work BEFORE touching a ventilator.

Wire pin 2 (RXD) to pin 3 (TXD) on the adapter's DB-9 (a paper clip or jumper is enough), then:

    python scripts/loopback_check.py COM3

The script sends a MEDIBUS ICC command (1B 51 36 43 0D) and expects the same bytes back. If they
come back, the adapter, driver and port number are right. If nothing comes back, no amount of
ventilator cabling will help: fix the adapter first.

With `--device` the script instead LISTENS on a port for a few seconds without sending anything
(the ventilator sends ICC every 3 s on its own once it is configured for MEDIBUS), which is the
safest possible first contact: read-only.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from medibus.framing import StreamParser, encode_command  # noqa: E402
from medibus.session import ICC  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="MEDIBUS adapter loopback / listen check")
    parser.add_argument("port")
    parser.add_argument("--baud", type=int, default=19200)
    parser.add_argument("--parity", default="E", choices=["N", "E", "O"])
    parser.add_argument("--device", action="store_true",
                        help="listen only — expect the device's own ICC, send nothing")
    parser.add_argument("--seconds", type=float, default=8.0)
    args = parser.parse_args(argv)

    try:
        import serial
    except ImportError:
        print("pyserial yok: pip install pyserial  (veya USB'deki wheel: pip install pyserial-*.whl)")
        return 2

    parity = {"N": serial.PARITY_NONE, "E": serial.PARITY_EVEN, "O": serial.PARITY_ODD}[args.parity]
    try:
        port = serial.Serial(args.port, baudrate=args.baud, bytesize=8, parity=parity,
                             stopbits=1, timeout=0.1)
    except Exception as exc:
        print(f"port açılamadı: {exc}")
        print("ipucu: Aygıt Yöneticisi > Bağlantı Noktaları (COM & LPT) — adaptörün COM numarası")
        return 2

    probe = encode_command(ICC)
    if not args.device:
        port.write(probe)
        print(f"gönderildi: {probe.hex(' ').upper()}")

    received = bytearray()
    deadline = time.monotonic() + args.seconds
    while time.monotonic() < deadline:
        chunk = port.read(64)
        if chunk:
            received += chunk
            if not args.device and probe in received:
                break
    port.close()

    print(f"alınan ({len(received)} bayt): {bytes(received).hex(' ').upper() or '-'}")
    if not args.device:
        ok = probe in received
        print("LOOPBACK TAMAM: adaptör ve port çalışıyor" if ok
              else "LOOPBACK BAŞARISIZ: 2-3 köprüsünü, sürücüyü ve COM numarasını kontrol edin")
        return 0 if ok else 1

    frames = [f for f in StreamParser().feed(bytes(received)) if hasattr(f, "kind")]
    iccs = [f for f in frames if f.kind == "command" and f.code == ICC]
    if iccs:
        print(f"CİHAZ KONUŞUYOR: {len(iccs)} ICC alındı — baud/parity doğru, köprü başlatılabilir")
        return 0
    if received:
        print("bayt geliyor ama ICC çözülemiyor: baud/parity yanlış olabilir (1200-19200, N/E/O)")
    else:
        print("hiç bayt yok: kablo (2-3 çapraz? null-modem), cihazda MEDIBUS seçili mi, doğru COM?")
    return 1


if __name__ == "__main__":
    sys.exit(main())
