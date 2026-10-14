"""Linux multicast collector and portable offline RAW-PCAP replay transport."""
from __future__ import annotations

import http.client
import ipaddress
import json
from pathlib import Path
import select
import socket
import ssl
import struct
import sys
import time
from urllib.parse import urlsplit

from .infinity_journal import CapacityError
from .infinity_stream import MAX_BATCH, canonical, packet_event

IP_PKTINFO = 8  # Linux UAPI, not a portable Winsock constant
IP_MULTICAST_ALL = 49
# After less than a full batch the queue is drained: let the next packets gather this long.
# Well inside the hub's 3 s live window, and the same pause an empty queue already took.
LINGER = 0.25


def membership_capacity(inventory, *, proc_path=Path("/proc/sys/net/ipv4/igmp_max_memberships")):
    """Read only. Never silently change a host's multicast or routing settings."""
    required = len({d.group for d in inventory.devices})
    available = int(proc_path.read_text().strip())
    return {"required_groups": required, "host_membership_limit": available, "sufficient": available >= required}


class Refused(OSError):
    """The hub answered, and will answer the same batch the same way every time.

    400 (an event its policy rejects), 409 (an id it holds with other content) and 413 (too
    large). Anything else, 401, 5xx and 507 (archive full) included, may pass on a retry.
    """
    FINAL = (400, 409, 413)

    def __init__(self, status):
        super().__init__(f"Receiver refused the batch ({status}).")
        self.status = status


class Sender:
    def __init__(self, endpoint, token, *, ca_file=None, allow_loopback_http=False, timings=None):
        target = urlsplit(endpoint)
        if (target.username or target.password or target.query or target.fragment or target.path not in ("", "/")
                or not target.hostname or target.scheme not in ("http", "https") or len(token) < 32):
            raise ValueError("Invalid receiver endpoint or token.")
        if target.scheme == "http" and not (allow_loopback_http and target.hostname in ("127.0.0.1", "::1", "localhost")):
            raise ValueError("Remote forwarding requires HTTPS.")
        self.target, self.token, self.timings = target, token, timings
        self.context = ssl.create_default_context(cafile=ca_file) if target.scheme == "https" else None

    def post(self, path, body):
        cls = http.client.HTTPSConnection if self.context else http.client.HTTPConnection
        kwargs = {"context": self.context} if self.context else {}
        connection = cls(self.target.hostname, self.target.port, timeout=5, **kwargs)
        try:
            # TCP and the TLS handshake on their own line: one new connection per request is
            # a suspect for the batch cycle, and request() alone would hide it.
            started = time.perf_counter()
            connection.connect()
            if self.timings is not None:
                self.timings.since("connect_ms", started)
            connection.request("POST", path, canonical(body),
                               {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
            response = connection.getresponse()
            data = response.read(65537)
            if response.status in Refused.FINAL:
                raise Refused(response.status)
            if response.status != 200 or len(data) > 65536:
                raise OSError("Receiver refused delivery.")
            return json.loads(data)
        finally:
            connection.close()


def flush_once(journal, sender, timings=None):
    started = time.perf_counter()
    batch = journal.pending(MAX_BATCH)
    if not batch:
        return 0
    posting = time.perf_counter()
    try:
        result = sender.post("/v1/packets", {"events": batch})
    except Refused as refusal:
        # This hub will refuse this batch every time. Retried, it held the head of the queue
        # for good (22.09: 7,006 rows, none delivered). Set it aside, counted, and move on.
        journal.quarantine([event["id"] for event in batch], refusal.status)
        # Nothing was delivered, so the loop pauses as after a part batch: a hub refusing
        # everything must not be sent full batches back to back.
        return 0
    if timings is not None:
        timings.since("post_ms", posting)
    expected = [event["id"] for event in batch]
    if not isinstance(result, dict) or result.get("ack") != expected:
        raise OSError("Invalid receiver acknowledgment.")
    journal.ack(expected)
    if timings is not None:
        timings.since("flush_ms", started)
        timings.add("batch_events", len(expected))
    return len(expected)


def forward_loop(journal, sender, inventory, stop, mode, failure=None, timings=None):
    next_heartbeat = 0
    backoff = 0.25
    while not stop.is_set():
        try:
            if time.monotonic() >= next_heartbeat:
                # Scheduled before it is sent: a refused heartbeat is counted below and tried
                # again in five seconds, but it must never hold delivery up. Retried at once,
                # it starved the queue, so a worker deployed ahead of its hub stopped
                # delivering altogether instead of merely going unseen.
                next_heartbeat = time.monotonic() + 5
                beat = {"collector_id": inventory.collector_id, "mode": mode,
                        "queue": journal.snapshot(), "clinical_forwarding": False}
                if timings is not None:
                    beat["timings"] = timings.snapshot()
                sender.post("/v1/heartbeat", beat)
            sent = flush_once(journal, sender, timings)
            backoff = 0.25
            if sent < MAX_BATCH:
                # Sent at once, a drained queue went out as a stream of one- and two-event
                # requests, each costing the hub a TLS handshake and a commit. A full batch
                # means a backlog, and that goes straight on.
                stop.wait(LINGER)
        except (OSError, ValueError, http.client.HTTPException):
            try:
                journal.count("forward_errors")
            except Exception:
                if failure is not None:
                    failure.set()
                stop.set()
                return
            stop.wait(backoff)
            backoff = min(10, backoff * 2)
        except Exception:
            # A corrupt/unreadable queue must not leave an apparently running receiver
            # collecting indefinitely while its forwarding thread has died.
            if failure is not None:
                failure.set()
            stop.set()
            return


class MulticastReceiver:
    """One exclusive socket, explicit interface membership and destination validation.

    No SO_REUSEADDR: a second collector in the same network namespace must fail.
    Membership is IGMP signaling, not a command to the monitor.
    """
    def __init__(self, inventory, *, socket_factory=socket.socket):
        if sys.platform != "linux":
            raise ValueError("Live collector requires Linux; use replay mode on Windows.")
        self.inventory = inventory
        self.memberships = []
        self.sock = socket_factory(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        try:
            self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
            self.sock.setsockopt(socket.IPPROTO_IP, IP_PKTINFO, 1)
            self.sock.setsockopt(socket.IPPROTO_IP, IP_MULTICAST_ALL, 0)
            self.sock.bind(("0.0.0.0", 2050))
            local = socket.inet_aton(str(ipaddress.IPv4Interface(inventory.interface).ip))
            for group in sorted({d.group for d in inventory.devices}):
                membership = socket.inet_aton(group) + local
                self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
                self.memberships.append(membership)
            self.sock.setblocking(False)
        except Exception:
            self.close()
            raise

    def receive(self):
        payload, control, flags, address = self.sock.recvmsg(65535, socket.CMSG_SPACE(12))
        if flags & (socket.MSG_TRUNC | socket.MSG_CTRUNC):
            return None
        group = None
        for level, kind, data in control:
            if level == socket.IPPROTO_IP and kind == IP_PKTINFO and len(data) == 12:
                _, local, destination = struct.unpack("=I4s4s", data)
                if socket.inet_ntoa(local) != str(ipaddress.IPv4Interface(self.inventory.interface).ip):
                    return None
                group = socket.inet_ntoa(destination)
        device = self.inventory.lookup(address[0], group, 2050)
        return (device, payload, address[1]) if device and payload else None

    def leave_memberships(self):
        """First half of a refresh: drop every group, leaving the socket joined to none.

        Measured on site 22.09.2026: the upstream snooping path prunes this port between
        89 and 193 seconds after a join and never restores it, although the querier's
        queries arrive and this host's IGMPv2 responses are on the wire. A drop followed
        IMMEDIATELY by an add does not bring the stream back — seven attempts, none
        recovered. Both recoveries that did work had the membership absent for a few
        seconds first, so the gap is the active ingredient and the rejoin is deliberately
        a separate step the caller makes later.

        This keeps collection alive. It does not fix the network, and the counters the
        caller records are the evidence that it is still broken.
        """
        for membership in self.memberships:
            try:
                self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_DROP_MEMBERSHIP, membership)
            except OSError:
                pass

    def join_memberships(self):
        """Second half of a refresh: rejoin every group; True if all of them took."""
        rejoined = True
        for membership in self.memberships:
            try:
                self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
            except OSError:
                # The group stays unjoined and the next refresh retries it. Never raise
                # here: a transient rejoin failure must not take the whole collector down.
                rejoined = False
        return rejoined

    def close(self):
        for membership in self.memberships:
            try:
                self.sock.setsockopt(socket.IPPROTO_IP, socket.IP_DROP_MEMBERSHIP, membership)
            except OSError:
                pass
        self.memberships.clear()
        self.sock.close()


def save_batch(journal, batch):
    if not batch:
        return
    try:
        journal.append(batch)
    except CapacityError:
        # Old queued packets remain. New packet loss is explicit and durable.
        journal.count("queue_full_dropped", len(batch))
    batch.clear()


def collect(inventory, journal, stop, *, retain_payload=False, receiver_factory=MulticastReceiver,
            refresh_interval=45.0, silence_after=10.0, min_silence_gap=30.0, rejoin_gap=2.0,
            monotonic=time.monotonic):
    """Receive joined groups, and keep the memberships announced against upstream pruning.

    Two refresh paths, counted separately. The scheduled one runs every `refresh_interval`
    and is what actually keeps the stream continuous, because on this site the prune is
    not an error condition but a certainty arriving 89-193 s after a join. The silence one
    is the backstop: `silence_after` without a datagram means delivery already stopped, and
    `min_silence_gap` rate-limits it so a genuinely quiet device — a monitor in standby
    transmits nothing at all — cannot turn the watchdog into a stream of pointless joins.

    A refresh is two steps `rejoin_gap` apart rather than one call, because a drop followed
    immediately by an add was measured not to recover the stream. The loop keeps running
    between the two, so the gap costs no reception the prune was not already costing.
    """
    receiver = receiver_factory(inventory)
    batch = []
    now = monotonic()
    deadline = now + 0.1
    last_datagram = last_refresh = now
    next_scheduled = now + refresh_interval
    rejoin_at = None
    try:
        while not stop.is_set():
            if select.select([receiver.sock], [], [], 0.1)[0]:
                for _ in range(MAX_BATCH):
                    try:
                        item = receiver.receive()
                    except BlockingIOError:
                        break
                    # A datagram that reaches the socket proves delivery, even when the
                    # source is wrong and the event itself is rejected below.
                    last_datagram = monotonic()
                    if item is None:
                        journal.count("rejected_datagrams")
                        continue
                    device, payload, source_port = item
                    batch.append(packet_event(inventory, device, payload, source_port, retain_payload=retain_payload))
                    if len(batch) >= MAX_BATCH:
                        save_batch(journal, batch)
            now = monotonic()
            if now >= deadline:
                save_batch(journal, batch)
                deadline = now + 0.1
            if rejoin_at is not None:
                if now >= rejoin_at:
                    if not receiver.join_memberships():
                        journal.count("membership_refresh_failed")
                    rejoin_at = None
                continue      # one refresh at a time; never leave and re-leave
            reason = ("scheduled" if now >= next_scheduled else
                      "silence" if now - last_datagram >= silence_after and now - last_refresh >= min_silence_gap
                      else None)
            if reason is not None:
                receiver.leave_memberships()
                journal.count("membership_refresh_" + reason)
                rejoin_at = now + rejoin_gap
                last_refresh = now
                next_scheduled = now + refresh_interval
    finally:
        receiver.close()
        save_batch(journal, batch)


def raw_pcap_events(path, inventory, *, retain_payload=False):
    """Stream classic IPv4 LINKTYPE_RAW 101 captures; never retime old data as live."""
    if path.stat().st_size > 256 * 1024 * 1024:
        raise ValueError("Replay exceeds 256 MiB.")
    with path.open("rb") as source:
        header = source.read(24)
        if len(header) != 24 or header[:4] not in (b"\xd4\xc3\xb2\xa1", b"\xa1\xb2\xc3\xd4"):
            raise ValueError("Replay requires classic microsecond RAW IPv4 PCAP.")
        endian = "<" if header[:4] == b"\xd4\xc3\xb2\xa1" else ">"
        major, minor, _, _, snaplen, link = struct.unpack(endian + "HHiiii", header[4:])
        if (major, minor) != (2, 4) or link != 101 or not 20 <= snaplen <= 65535:
            raise ValueError("Unsupported PCAP format.")
        count = 0
        while record := source.read(16):
            count += 1
            if len(record) != 16 or count > 1_000_000:
                raise ValueError("Invalid PCAP record limit/header.")
            sec, micro, caplen, wirelen = struct.unpack(endian + "IIII", record)
            if not 20 <= caplen <= snaplen or caplen != wirelen or micro >= 1_000_000:
                raise ValueError("Incomplete PCAP packet.")
            raw = source.read(caplen)
            ihl = (raw[0] & 15) * 4 if raw else 0
            if (len(raw) != caplen or raw[0] >> 4 != 4 or ihl < 20 or ihl + 8 > caplen
                    or int.from_bytes(raw[2:4], "big") != caplen):
                raise ValueError("Invalid IPv4 packet.")
            if raw[9] != 17 or int.from_bytes(raw[6:8], "big") & 0x3FFF:
                continue
            sport, port, length, _ = struct.unpack("!HHHH", raw[ihl:ihl + 8])
            if length != caplen - ihl or length < 8:
                raise ValueError("Invalid UDP packet.")
            device = inventory.lookup(socket.inet_ntoa(raw[12:16]), socket.inet_ntoa(raw[16:20]), port)
            if device and length > 8:
                yield packet_event(inventory, device, raw[ihl+8:], sport, received_at=sec+micro/1e6,
                                   retain_payload=retain_payload, mode="replay")
