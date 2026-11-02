"""Send one patient query (QBP^Q22) to the bridge, as NCE does, and say what came back.

For the local walk and a bench check (G2-B1d). SYNTHETIC NUMBERS ONLY — never a real patient's:

    python scripts/pdq_probe.py --host 127.0.0.1 --port 2575 --id 202600000001

prints one line, e.g. `MSA=AA QAK=OK PID=evet ad=evet doğum=evet cinsiyet=F`: whether the device
would be shown a name, never the name — unless `--show-name`, which is for synthetic data on a
local stack only. QAK=NF is «not found» (no PID: the nurse corrects the number); PID with ad=yok
is the echo of a bridge that could not ask the API (D8).
"""
from __future__ import annotations

import argparse
import socket
import sys
from datetime import datetime, timezone

VT, FS, CR = b"\x0b", b"\x1c", b"\x0d"


def build_qbp(number: str, control_id: str = "PROBE1") -> str:
    """A QBP^Q22 in the shape NCE sent on the ward (QPD-3 = @PID.3.1^<id>~@PID3.4^X)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return (f"MSH|^~\\&|NCE|HOSP|EMR|HIS|{stamp}||QBP^Q22^QBP_Q21|{control_id}|P|2.6|||AL|NE\r"
            f"QPD|IHE PDQ Query|{control_id}|@PID.3.1^{number}~@PID3.4^X\r"
            "RCP|I|1^RD\r")


def summarise(reply: str, *, show_name: bool = False) -> str:
    """The reply as one line that names no patient (`show_name`: the name, synthetic data only)."""
    seg = {s.split("|", 1)[0]: s.split("|") for s in reply.split("\r") if s}
    at = lambda name, i: seg.get(name, [])[i] if i < len(seg.get(name, [])) else ""  # noqa: E731
    parts = [f"MSA={at('MSA', 1)}", f"QAK={at('QAK', 2)}"]
    if "PID" not in seg:
        return " ".join([*parts, "PID=yok"])
    name = at("PID", 5)
    named = (f"ad={name.replace('^', ' ').strip()}" if show_name and name
             else f"ad={'evet' if name else 'yok'}")
    return " ".join([*parts, "PID=evet", named, f"doğum={'evet' if at('PID', 7) else 'yok'}",
                     f"cinsiyet={at('PID', 8) or '-'}"])


def send(host: str, port: int, message: str, timeout: float = 12.0) -> str:
    """One framed message, one framed answer (NCE waits 10 s; this waits a little longer)."""
    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.sendall(VT + message.encode("utf-8") + FS + CR)
        data = b""
        while not data.endswith(FS + CR):
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
    return data.lstrip(VT).rstrip(CR).rstrip(FS).decode("utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="One synthetic patient query to the bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2575)
    parser.add_argument("--id", required=True, help="a SYNTHETIC number, e.g. 202600000001")
    parser.add_argument("--show-name", action="store_true",
                        help="print the name too — synthetic data on a local stack only")
    args = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    print(summarise(send(args.host, args.port, build_qbp(args.id)), show_name=args.show_name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
