"""A minimal LDAP server on 127.0.0.1, for the tests that need ldap3's real wire: what bytes a
bind carries, and whether a password was sent at all. It speaks simple binds and unbinds only —
plain, or LDAPS with a certificate the test made — and records each bind's DN and the password
BYTES it carried. A bind succeeds when those bytes are exactly the DN's in `passwords`; anything
else is invalidCredentials (49). Synthetic credentials only; it listens on loopback alone."""
from __future__ import annotations

import socket
import ssl
import threading
from dataclasses import dataclass

LDAP_MESSAGE, INTEGER, OCTET_STRING, ENUMERATED = 0x30, 0x02, 0x04, 0x0A
BIND_REQUEST, BIND_RESPONSE, UNBIND_REQUEST = 0x60, 0x61, 0x42
SUCCESS, INVALID_CREDENTIALS = 0, 49


@dataclass(frozen=True)
class Bind:
    dn: str
    password: bytes


def tlv(tag: int, content: bytes) -> bytes:
    """One BER element: tag, definite length, content."""
    n = len(content)
    if n < 0x80:
        length = bytes([n])
    else:
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
        length = bytes([0x80 | len(raw)]) + raw
    return bytes([tag]) + length + content


def elements(data: bytes) -> list[tuple[int, bytes]]:
    """The BER elements in `data`, one level deep, as (tag, content)."""
    out: list[tuple[int, bytes]] = []
    i = 0
    while i < len(data):
        tag, first = data[i], data[i + 1]
        i += 2
        if first & 0x80:
            size = first & 0x7F
            n = int.from_bytes(data[i:i + size], "big")
            i += size
        else:
            n = first
        out.append((tag, data[i:i + n]))
        i += n
    return out


def _recv_exact(conn: socket.socket, n: int) -> bytes | None:
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def _read_message(conn: socket.socket) -> bytes | None:
    """One whole LDAPMessage element, or None at the end of the stream."""
    head = _recv_exact(conn, 2)
    if head is None:
        return None
    if head[1] & 0x80:
        size = head[1] & 0x7F
        raw = _recv_exact(conn, size)
        if raw is None:
            return None
        head += raw
        n = int.from_bytes(raw, "big")
    else:
        n = head[1]
    body = _recv_exact(conn, n)
    return None if body is None else head + body


class LdapStub:
    """Listening from construction until `close`. `context`: a server-side SSLContext for LDAPS
    (None: plain LDAP). `binds` lists every bind request received, in order."""

    def __init__(self, passwords: dict[str, bytes], *,
                 context: ssl.SSLContext | None = None) -> None:
        self.passwords = dict(passwords)
        self.binds: list[Bind] = []
        self._context = context
        self._lock = threading.Lock()
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(16)
        self.port = self._sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def close(self) -> None:
        self._sock.close()

    def _accept(self) -> None:
        while True:
            try:
                raw, _ = self._sock.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(raw,), daemon=True).start()

    def _serve(self, raw: socket.socket) -> None:
        raw.settimeout(5)
        try:
            conn = (self._context.wrap_socket(raw, server_side=True)
                    if self._context is not None else raw)
        except (OSError, ssl.SSLError):          # the client refused the certificate
            raw.close()
            return
        try:
            while (message := _read_message(conn)) is not None:
                [(_, body)] = elements(message)
                (_, message_id), (op_tag, op) = elements(body)[:2]
                if op_tag != BIND_REQUEST:       # an unbind, or something not spoken here
                    return
                _version, (_, name), (_, password) = elements(op)
                bind = Bind(name.decode("utf-8"), password)
                with self._lock:
                    self.binds.append(bind)
                code = (SUCCESS if self.passwords.get(bind.dn) == bind.password
                        else INVALID_CREDENTIALS)
                conn.sendall(tlv(LDAP_MESSAGE, tlv(INTEGER, message_id) + tlv(
                    BIND_RESPONSE, tlv(ENUMERATED, bytes([code])) + tlv(OCTET_STRING, b"")
                    + tlv(OCTET_STRING, b""))))
        except (OSError, ssl.SSLError, ValueError):
            return
        finally:
            conn.close()
