"""Listen on several ports at once and report what a device actually sends.

The edge bridge answers "what codes arrive on 2575?". This answers the question that comes before
it: **is the device sending anything at all, and where?** On a first site visit the destination
port is often unknown, undocumented, or configured differently from the manual, and the difference
between "the device is misconfigured" and "we are listening on the wrong port" is invisible until
something accepts the connection.

    python scripts/listen_probe.py

Listens on the usual HL7 candidates. Point the device's export at this machine, then read the log:

    BAĞLANTI  port=2575  kaynak=10.0.0.42
    HL7  port=2575  tip=ORU^R01  OBX kodları: MDC_ECG_HEART_RATE, MDC_PULS_OXIM_SAT_O2
    HAM   port=5000  120 bayt  MLLP değil  ilk baytlar: 47 45 54 20 2f ...

A connection with no data means the device opened a socket and said nothing — usually a handshake
this probe does not speak. HL7-looking traffic is reported by message type and OBX identifier.

**PHI.** This never logs measurements, patient identifiers, names, or message bodies: only
connection events, byte counts, message types, and OBX-3 identifiers, which are device metadata.
`--raw-dir` exists for the case where a vendor needs a sample to diagnose a proprietary protocol,
and it writes **real patient data to disk** — see the warning it prints. Prefer running discovery
against a device with no real patient connected, or in its own demo mode; then there is no PHI to
protect in the first place.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from homunculus.edge.mllp import FS, VT, MllpFramer, ack_for

_log = logging.getLogger("probe")

# The ports a monitor or central station is usually pointed at. 2575 is the IANA registration for
# HL7 over MLLP; the rest are common vendor defaults seen in the wild.
DEFAULT_PORTS = (2575, 2576, 3001, 5000, 6661, 8080)

# Enough to carry a small proprietary handshake in full — the Welch Allyn WACP rendezvous is a few
# dozen bytes, and truncating it to a dozen throws away the part that identifies it.
_HEX_PREVIEW_BYTES = 64

# What to look for on the device itself when it sends us nothing. An open web port is the useful
# find: it often means the HL7 destination can be set from a browser, without the vendor's signed
# configuration file.
SCAN_PORTS: tuple[tuple[int, str], ...] = (
    (80, "HTTP — web arayüzü olabilir, hedefi burada ayarlayabilirsin"),
    (443, "HTTPS — web arayüzü olabilir, hedefi burada ayarlayabilirsin"),
    (8080, "HTTP (alternatif)"),
    (8443, "HTTPS (alternatif)"),
    (2575, "HL7 MLLP"),
    (2576, "HL7 MLLP (alternatif)"),
    (281, "Welch Allyn / vendor servisi"),
    (4001, "vendor servisi"),
    (5000, "vendor servisi"),
    (6661, "vendor servisi"),
    (22, "SSH"),
    (23, "Telnet — eski cihazlarda konsol"),
    (21, "FTP — bazı cihazlar yapılandırmayı buradan alır"),
)


def _obx_codes(message: str) -> list[str]:
    """OBX-3 identifiers only (``CODE^text`` -> ``CODE``). Never the value in OBX-5."""
    codes: list[str] = []
    for segment in message.replace("\n", "\r").split("\r"):
        if segment.startswith("OBX"):
            fields = segment.split("|")
            if len(fields) > 3:
                codes.append(fields[3].split("^")[0].strip())
    return codes


def _message_type(message: str) -> str:
    """MSH-9, e.g. ``ORU^R01``. Empty when the message has no readable MSH."""
    for segment in message.replace("\n", "\r").split("\r"):
        if segment.startswith("MSH"):
            fields = segment.split("|")
            if len(fields) > 8:
                return fields[8].strip()
            return ""
    return ""


class ProbeStats:
    """Counts only — deliberately holds nothing that could carry PHI."""

    def __init__(self) -> None:
        self.connections: Counter[int] = Counter()
        self.messages: Counter[int] = Counter()
        self.bytes: Counter[int] = Counter()
        self.codes: Counter[str] = Counter()
        self.types: Counter[str] = Counter()

    def report(self) -> str:
        if not self.connections:
            return "henüz bağlantı yok — cihaz bu makineye hiçbir şey yollamadı"
        parts = [
            f"port {port}: {self.connections[port]} bağlantı, "
            f"{self.messages[port]} mesaj, {self.bytes[port]} bayt"
            for port in sorted(self.connections)
        ]
        line = " | ".join(parts)
        if self.types:
            line += "\n  mesaj tipleri: " + ", ".join(
                f"{t} ({n})" for t, n in self.types.most_common()
            )
        if self.codes:
            line += "\n  OBX kodları: " + ", ".join(
                f"{c} ({n})" for c, n in self.codes.most_common()
            )
        return line


def _hex_preview(chunk: bytes) -> str:
    head = chunk[:_HEX_PREVIEW_BYTES]
    return " ".join(f"{b:02x}" for b in head) + (" ..." if len(chunk) > len(head) else "")


def _ascii_preview(chunk: bytes) -> str:
    """Printable characters, others as '.'. Proprietary handshakes usually carry a protocol name or
    version string in the clear, which names the protocol faster than any hex dump."""
    head = chunk[:_HEX_PREVIEW_BYTES]
    return "".join(chr(b) if 32 <= b < 127 else "." for b in head) + (
        " ..." if len(chunk) > len(head) else ""
    )


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *,
                  port: int, stats: ProbeStats, raw_dir: Path | None) -> None:
    peer = writer.get_extra_info("peername")
    source = f"{peer[0]}:{peer[1]}" if peer else "bilinmiyor"
    stats.connections[port] += 1
    _log.info("BAĞLANTI  port=%s  kaynak=%s", port, source)

    framer = MllpFramer()
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            stats.bytes[port] += len(chunk)

            if raw_dir is not None:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
                (raw_dir / f"port{port}-{stamp}.bin").write_bytes(chunk)

            # MLLP-framed HL7 is the expected case; anything else is reported as raw so a wrong
            # guess about the protocol is visible rather than silently discarded.
            messages = framer.feed(chunk)
            if messages:
                for message in messages:
                    stats.messages[port] += 1
                    mtype = _message_type(message) or "(MSH yok)"
                    stats.types[mtype] += 1
                    codes = _obx_codes(message)
                    for code in codes:
                        stats.codes[code] += 1
                    _log.info(
                        "HL7  port=%s  tip=%s  OBX kodları: %s",
                        port, mtype, ", ".join(codes) if codes else "(OBX yok)",
                    )
                    # ACK every HL7 message. A sender that gets no acknowledgement either retries
                    # the same message forever or stops sending — a discovery tool that silences
                    # the device it was pointed at tells you nothing.
                    writer.write(VT + ack_for(message).encode("utf-8") + FS + b"\x0d")
                    await writer.drain()
            else:
                # No complete HL7 message in this chunk. Show what actually arrived.
                #
                # This used to stay silent whenever the bytes contained VT or FS, on the theory
                # that a partial MLLP frame was still being assembled. That reasoning fails for the
                # case this tool exists to diagnose: a binary protocol contains 0x0B and 0x1C by
                # chance, so the probe went quiet on precisely the traffic that identifies which
                # protocol the device speaks. Report it either way, and say which case it looks
                # like rather than deciding on the operator's behalf.
                hint = ("MLLP çerçevesi olabilir, devamı bekleniyor"
                        if (VT in chunk or FS in chunk) else "MLLP değil")
                _log.info(
                    "HAM   port=%s  %s bayt  %s\n"
                    "        hex  : %s\n"
                    "        ascii: %s",
                    port, len(chunk), hint, _hex_preview(chunk), _ascii_preview(chunk),
                )
    except (ConnectionResetError, asyncio.IncompleteReadError):
        pass
    finally:
        _log.info("KAPANDI   port=%s  kaynak=%s", port, source)
        writer.close()


async def _probe_port(host: str, port: int, timeout: float) -> bool:
    """True when a TCP connection is accepted. Connect-and-close only — nothing is sent."""
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
    except (OSError, asyncio.TimeoutError):
        return False
    writer.close()
    try:
        await writer.wait_closed()
    except OSError:
        pass
    return True


async def scan(host: str, timeout: float) -> None:
    """Report which ports the device accepts connections on.

    Run this when the probe says nothing arrived: it separates "the device is unreachable" from
    "the device is fine but was never told where to send", which look identical from the listener
    side and have completely different fixes.
    """
    _log.info("taranıyor: %s (%s port)", host, len(SCAN_PORTS))
    results = await asyncio.gather(
        *(_probe_port(host, port, timeout) for port, _ in SCAN_PORTS)
    )

    open_ports = [(port, note) for (port, note), is_open in zip(SCAN_PORTS, results) if is_open]
    if not open_ports:
        _log.info(
            "hiçbir port açık değil. Cihaz ya bu ağdan erişilemiyor, ya güvenlik duvarı "
            "arkasında, ya da hiçbir servis çalıştırmıyor. Ping geçiyorsa cihaz ayakta ama "
            "hiçbir şey dinlemiyor demektir."
        )
        return

    _log.info("AÇIK PORTLAR:")
    for port, note in open_ports:
        _log.info("  %s/tcp — %s", port, note)
    if any(port in (80, 443, 8080, 8443) for port, _ in open_ports):
        _log.info(
            "Web portu açık: tarayıcıdan http://%s adresine gir. HL7/ORU export hedefini "
            "oradan ayarlayabiliyorsan imzalı yapılandırma dosyasına gerek kalmaz.", host,
        )


async def _report_loop(stats: ProbeStats, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        _log.info("DURUM: %s", stats.report())


async def run(ports: list[int], host: str, raw_dir: Path | None, interval: float) -> None:
    stats = ProbeStats()
    servers = []
    for port in ports:
        try:
            server = await asyncio.start_server(
                lambda r, w, p=port: _handle(r, w, port=p, stats=stats, raw_dir=raw_dir),
                host, port,
            )
        except OSError as exc:
            # One taken port must not stop the probe: the others are the point.
            _log.warning("port %s dinlenemedi (%s) — atlanıyor", port, exc)
            continue
        servers.append(server)

    if not servers:
        raise SystemExit("hiçbir port dinlenemedi — yönetici hakkı veya port çakışması olabilir")

    _log.info("dinleniyor: %s (durdurmak için Ctrl+C)", ", ".join(str(p) for p in ports))
    _log.info("cihazın HL7 export hedefini bu makinenin IP'sine ve bu portlardan birine yönlendirin")
    await _report_loop(stats, interval)


def _ask(args: argparse.Namespace) -> None:
    """Ask what to do when started with no arguments.

    This is run on a ward by someone holding a laptop, not from a shell session with the flags to
    hand. Started with no arguments it asks; started with flags it behaves exactly as before, so
    scripting it stays possible.
    """
    print("\n  HOMUNCULUS — CİHAZ KEŞİF ARACI\n")
    print("  1) Dinle       — cihaz bu bilgisayara bir şey yolluyor mu?")
    print("  2) Cihazı tara — cihaz hangi portları açık tutuyor?")
    print("  3) Dinle + ham mesajı kaydet  (şema tasarımı için)\n")
    try:
        choice = input("  Seçim [1]: ").strip()
    except EOFError:
        choice = ""

    if choice == "3":
        # The full message is what a schema has to be designed against — segment layout, whether
        # PV1-3 carries a location, how the identifiers are spelled. Counts cannot answer that.
        # It is also the one mode that writes patient data to disk, so it says so first.
        args.raw_dir = "ham-mesajlar"
        print("\n  UYARI: ham mesajlar 'ham-mesajlar' klasörüne yazılacak ve GERÇEK HASTA")
        print("  VERİSİ içerebilir. Mümkünse hasta bağlı değilken, test ölçümüyle çalış.")
        print("  İşin bitince klasörü sil.\n")
        return

    if choice == "2":
        while True:
            try:
                host = input("  Cihazın IP adresi (ör. 10.10.96.203): ").strip()
            except EOFError:
                host = ""
            if host:
                args.scan = host
                return
            print("  IP adresi gerekli.")
    print()


def _pause() -> None:
    """Hold the window open. A double-clicked console closes the instant it exits, taking the
    answer with it."""
    try:
        input("\n  Kapatmak için Enter'a bas...")
    except EOFError:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ports", default=",".join(str(p) for p in DEFAULT_PORTS),
                        help="virgülle ayrılmış port listesi")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--report-interval", type=float, default=15.0)
    parser.add_argument("--raw-dir", default=None,
                        help="ham baytları buraya yaz — GERÇEK HASTA VERİSİ içerir")
    parser.add_argument("--scan", default=None, metavar="IP",
                        help="dinlemek yerine cihazı tara: hangi portları açık")
    parser.add_argument("--scan-timeout", type=float, default=2.0)
    args = parser.parse_args()

    # Windows consoles default to cp1252 and would mangle (or crash on) the Turkish text below.
    # logging writes to STDERR, so reconfiguring stdout alone leaves every log line broken — which
    # is exactly how the operator reads this tool's output.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

    # No flags means it was double-clicked or run bare: ask rather than silently pick a mode.
    # This runs BEFORE raw_dir is resolved, because the menu can turn raw capture on.
    interactive = len(sys.argv) == 1 and sys.stdin is not None and sys.stdin.isatty()
    if interactive:
        _ask(args)

    raw_dir = None
    if args.raw_dir:
        raw_dir = Path(args.raw_dir)
        raw_dir.mkdir(parents=True, exist_ok=True)
        _log.warning(
            "HAM KAYIT AÇIK (%s): bu dosyalar gerçek hasta verisi içerir. Şifreli diskte tutun, "
            "depoya commit etmeyin, işiniz bitince silin.", raw_dir,
        )

    try:
        if args.scan:
            asyncio.run(scan(args.scan, args.scan_timeout))
            if interactive:
                _pause()
            return
        ports = [int(p.strip()) for p in args.ports.split(",") if p.strip()]
        asyncio.run(run(ports, args.host, raw_dir, args.report_interval))
    except KeyboardInterrupt:
        _log.info("durduruldu")
    except SystemExit as exc:
        # A bind failure is the common one; without the pause the message vanishes with the window.
        _log.error("%s", exc)
        if interactive:
            _pause()
        raise


if __name__ == "__main__":
    main()
