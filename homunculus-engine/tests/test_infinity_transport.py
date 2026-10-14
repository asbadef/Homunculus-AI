"""Synthetic transport tests; no monitor traffic and no inferred clinical values."""
import json
from pathlib import Path
import socket
import struct
import tempfile

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import pytest

from homunculus.edge.infinity_stream import Inventory, packet_event, validate_event
from homunculus.edge.infinity_journal import Journal, CapacityError, external_path
from homunculus.edge.infinity_collector import (
    Sender, MulticastReceiver, collect, flush_once, forward_loop, membership_capacity,
    raw_pcap_events, save_batch,
)
from homunculus.edge.infinity_hub import create_hub

TOKEN = "synthetic-collector-token-" + "a" * 32
VIEW = "synthetic-viewer-token-" + "b" * 32


def inventory(count=1):
    return Inventory.parse({"collector_id": "collector-a", "interface": "192.0.2.220/24", "devices": [
        {"id": f"monitor-{i}", "source": f"192.0.2.{i}", "group": f"239.10.2.{i}", "port": 2050}
        for i in range(1, count+1)]})


@pytest.fixture
def factory():
    journals = []
    with tempfile.TemporaryDirectory(prefix="homunculus-synthetic-transport-") as folder:
        def make(**kwargs):
            path = Path(folder) / f"journal-{len(journals)}.sqlite"
            result = Journal(path, Fernet.generate_key(), **kwargs)
            journals.append(result)
            return result
        yield make
        for journal in journals:
            try:
                journal.close()
            except Exception:
                pass


def event(inv=None, stamp=1000, raw=False, index=0, mode="live"):
    inv = inv or inventory()
    return packet_event(inv, inv.devices[index], b"SYNTHETIC-NOT-A-PATIENT-" + bytes([index]), 2564,
                        received_at=stamp, retain_payload=raw, mode=mode)


def client(inv, journal, now=lambda: 1000, raw=False):
    return TestClient(create_hub(inv, journal, TOKEN, VIEW, clock=now, accept_payload=raw))


def post(c, events):
    return c.post("/v1/packets", json={"events": events}, headers={"Authorization": "Bearer " + TOKEN})


def status(c):
    return c.get("/v1/status", headers={"Authorization": "Bearer " + VIEW}).json()


def test_hundred_devices_remain_separate_and_values_never_invented(factory):
    inv = inventory(100)
    outbox, archive = factory(), factory()
    c = client(inv, archive, raw=True)
    class LocalSender:
        def post(self, path, body):
            response = c.post(path, json=body, headers={"Authorization": "Bearer " + TOKEN})
            assert response.status_code == 200
            return response.json()
    for tick in range(5):
        for start in range(0, 100, 25):
            outbox.append([event(inv, stamp=996+tick, index=i, raw=True) for i in range(start, start+25)])
    while flush_once(outbox, LocalSender()):
        pass
    result = status(c)
    assert len(result["devices"]) == 100
    assert all(d["packets"] == 5 and d["status"] == "streaming" and d["measurements"] == {} for d in result["devices"])
    assert len({d["source_ip"] for d in result["devices"]}) == 100
    assert not result["clinical_forwarding"] and result["kernel_drop_count"] is None
    assert outbox.snapshot()["rows"] == 0 and archive.snapshot()["rows"] == 500
    assert b"SYNTHETIC-NOT-A-PATIENT" not in archive.path.read_bytes()


def test_retry_after_lost_ack_is_idempotent(factory):
    inv = inventory()
    outbox, archive = factory(), factory()
    c = client(inv, archive)
    outbox.append([event(inv)])
    class LostAck:
        fail = True
        def post(self, path, body):
            response = post(c, body["events"])
            if self.fail:
                self.fail = False
                raise OSError("simulated lost response")
            return response.json()
    sender = LostAck()
    with pytest.raises(OSError):
        flush_once(outbox, sender)
    assert outbox.snapshot()["rows"] == 1
    assert flush_once(outbox, sender) == 1
    assert status(c)["devices"][0]["packets"] == 1


def test_mismatched_ack_keeps_outbox(factory):
    queue = factory()
    queue.append([event()])
    class BadAck:
        def post(self, *_):
            return {"ack": []}
    with pytest.raises(OSError):
        flush_once(queue, BadAck())
    assert queue.snapshot()["rows"] == 1


def test_fatal_queue_error_stops_capture_instead_of_silent_sender_death():
    import sqlite3
    import threading
    class BrokenQueue:
        def snapshot(self):
            raise sqlite3.DatabaseError("synthetic corruption")
    stop, failure = threading.Event(), threading.Event()
    forward_loop(BrokenQueue(), None, inventory(), stop, "live", failure)
    assert stop.is_set() and failure.is_set()


def test_queue_failure_counter_failure_also_stops_capture():
    import threading
    class BrokenQueue:
        def snapshot(self):
            raise OSError("synthetic disk failure")
        def count(self, *_):
            raise OSError("synthetic disk failure")
    stop, failure = threading.Event(), threading.Event()
    forward_loop(BrokenQueue(), None, inventory(), stop, "live", failure)
    assert stop.is_set() and failure.is_set()


def test_dashboard_renders_hundred_devices_and_clears_on_logout():
    import shutil
    import subprocess
    from homunculus.edge.infinity_hub import PAGE, JS
    root = Path(__file__).resolve().parents[2]
    if not shutil.which("node") or not (root / "dashboard/node_modules/jsdom").exists():
        pytest.skip("Node and dashboard jsdom required")
    check = r"""
const {JSDOM}=require('./dashboard/node_modules/jsdom');
const fs=require('fs');const {page,js}=JSON.parse(fs.readFileSync(0,'utf8'));
const dom=new JSDOM(page,{url:'http://127.0.0.1:8766',runScripts:'outside-only'});
const w=dom.window;const devices=Array.from({length:100},(_,i)=>({id:'monitor-'+i,source_ip:'192.0.2.'+(i+1),status:'replay',packet_age_seconds:100,packets:5}));
w.fetch=async(url,opts)=>{if(opts.headers.Authorization!=='Bearer test-token')throw Error('missing authorization');return {ok:true,json:async()=>({devices,collector:{connected:true,heartbeat:{queue:{rows:0,counters:{}}}}})};};
w.eval(js);w.document.getElementById('token').value='test-token';
w.document.getElementById('login').dispatchEvent(new w.Event('submit',{cancelable:true}));
setImmediate(()=>{try{
 const rows=w.document.querySelectorAll('tbody tr');if(rows.length!==100)throw Error('wrong row count');
 if(!rows[0].textContent.includes('Kayıt tekrarı'))throw Error('replay not labelled');
 if(w.document.getElementById('token').value!=='')throw Error('token not cleared');
 if(w.localStorage.length!==0)throw Error('token persisted');
 w.document.getElementById('logout').click();
 if(w.document.querySelectorAll('tbody tr').length)throw Error('logout did not clear rows');
 console.log('100 rows, replay label, memory-only token, logout verified');
 }catch(e){console.error(e);process.exitCode=1;}finally{w.close();}});
"""
    result = subprocess.run([shutil.which("node"), "-e", check], input=json.dumps({"page": PAGE, "js": JS}),
                            cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=15)
    assert result.returncode == 0, result.stderr


def test_restart_encryption_and_wrong_key(factory):
    journal = factory()
    key = journal.fernet._signing_key + journal.fernet._encryption_key
    import base64
    key = base64.urlsafe_b64encode(key)
    item = event(raw=True)
    journal.append([item])
    path = journal.path
    journal.close()
    with pytest.raises(ValueError, match="key"):
        Journal(path, Fernet.generate_key())
    reopened = Journal(path, key)
    try:
        assert reopened.pending() == [item]
    finally:
        reopened.close()


def test_capacity_is_atomic_and_drops_explicit(factory):
    journal = factory(max_rows=1)
    first = event()
    with pytest.raises(CapacityError):
        journal.append([first, event()])
    assert journal.snapshot()["rows"] == 0
    journal.append([first])
    batch = [event()]
    save_batch(journal, batch)
    assert not batch and journal.pending() == [first]
    assert journal.snapshot()["counters"]["queue_full_dropped"] == 1


def test_hub_capacity_507_and_conflict_do_not_partially_ack(factory):
    inv = inventory()
    journal = factory(max_rows=1)
    c = client(inv, journal)
    first = event(inv)
    assert post(c, [first]).status_code == 200
    assert post(c, [event(inv)]).status_code == 507
    conflict = dict(first, source_port=3000)
    assert post(c, [conflict]).status_code == 409
    assert status(c)["devices"][0]["packets"] == 1


def test_expiry_persisted_and_old_arrivals_never_refresh_live(factory):
    now = [1000]
    journal = factory(clock=lambda: now[0], retention=60)
    c = client(inventory(), journal, now=lambda: now[0])
    assert post(c, [event(stamp=999)]).status_code == 200
    now[0] = 1010
    assert post(c, [event(stamp=900)]).status_code == 200
    row = status(c)["devices"][0]
    assert row["last_packet_at"] == 999 and row["status"] == "stale"
    now[0] = 1100
    assert journal.snapshot()["rows"] == 0
    assert journal.snapshot()["counters"]["expired"] == 2


def test_replay_is_never_live_and_future_clock_rejected(factory):
    c = client(inventory(), factory())
    assert post(c, [event(mode="replay")]).status_code == 200
    assert status(c)["devices"][0]["status"] == "replay"
    # Refused, but not for good (503): a clock ahead of the hub's is fixed by the clock, not the event.
    assert post(c, [event(stamp=1100)]).status_code == 503


def test_roles_body_limits_and_no_payload_or_patient_in_status(factory):
    inv = inventory()
    c = client(inv, factory())
    assert c.get("/v1/status").status_code == 401
    assert c.get("/v1/status", headers={"Authorization": "Bearer " + TOKEN}).status_code == 401
    assert c.post("/v1/packets", json={"events": [event()]}, headers={"Authorization": "Bearer " + VIEW}).status_code == 401
    assert post(c, [event(raw=True)]).status_code == 503       # payload policy: refused, not for good
    dirty = dict(event(), patient_id="MUST-NOT-BE-ACCEPTED")
    response = post(c, [dirty])
    assert response.status_code == 400 and "MUST-NOT" not in response.text
    assert c.post("/v1/packets", content=b"x"*3_000_001, headers={"Authorization": "Bearer " + TOKEN}).status_code == 413
    assert c.get("/").headers["cache-control"] == "no-store"
    assert "localStorage" not in c.get("/app.js").text


def test_heartbeat_validated_and_expires(factory):
    now = [1000]
    journal = factory()
    c = client(inventory(), journal, now=lambda: now[0])
    data = {"collector_id": "collector-a", "mode": "live", "queue": journal.snapshot(), "clinical_forwarding": False}
    headers = {"Authorization": "Bearer " + TOKEN}
    assert c.post("/v1/heartbeat", json=data, headers=headers).status_code == 200
    assert status(c)["collector"]["connected"]
    now[0] += 16
    assert not status(c)["collector"]["connected"]
    data["queue"]["counters"]["patient_name"] = "no"
    assert c.post("/v1/heartbeat", json=data, headers=headers).status_code == 400


@pytest.mark.parametrize("change", [
    {"source_ip": "192.0.2.2"}, {"group": "239.10.2.2"}, {"device_id": "other"},
    {"received_at": float("nan")}, {"payload_bytes": True}, {"payload_base64": "!!!"},
    {"sha256": "0"*64, "payload_base64": "YWJj"}, {"port": True}, {"source_port": 0},
])
def test_event_contract_rejects_ambiguous_data(change):
    with pytest.raises(ValueError):
        validate_event(dict(event(), **change), inventory())


def test_inventory_and_remote_transport_fail_closed():
    assert len(inventory(100).devices) == 100
    with pytest.raises(ValueError):
        inventory(101)
    for endpoint in ("http://192.0.2.1", "https://user:pw@example.test", "https://example.test/ingest", "https://example.test/?token=x"):
        with pytest.raises(ValueError):
            Sender(endpoint, TOKEN, allow_loopback_http=True)
    Sender("http://127.0.0.1:8766", TOKEN, allow_loopback_http=True)
    with pytest.raises(ValueError, match="repositories"):
        external_path(Path(__file__).resolve().parent / "clinical.sqlite")


def test_host_membership_preflight_does_not_change_configuration(tmp_path):
    setting = tmp_path / "igmp_max_memberships"
    setting.write_text("20\n")
    result = membership_capacity(inventory(100), proc_path=setting)
    assert result == {"required_groups": 100, "host_membership_limit": 20, "sufficient": False}
    assert setting.read_text() == "20\n"
    setting.write_text("128\n")
    assert membership_capacity(inventory(100), proc_path=setting)["sufficient"]


class FakeSocket:
    def __init__(self, fail_at=None):
        self.options, self.closed, self.fail_at = [], False, fail_at
        self.message = None
    def setsockopt(self, level, kind, value):
        if kind == socket.IP_ADD_MEMBERSHIP and sum(k == kind for _, k, _ in self.options) == self.fail_at:
            raise OSError("simulated membership limit")
        self.options.append((level, kind, value))
    def bind(self, address):
        self.bound = address
    def setblocking(self, value):
        pass
    def close(self):
        self.closed = True
    def recvmsg(self, *_):
        return self.message


def test_linux_multicast_hundred_joins_cleanup_and_destination_filter(monkeypatch):
    monkeypatch.setattr("homunculus.edge.infinity_collector.sys.platform", "linux")
    inv = inventory(100)
    fake = FakeSocket()
    receiver = MulticastReceiver(inv, socket_factory=lambda *_: fake)
    joins = [v for _, k, v in fake.options if k == socket.IP_ADD_MEMBERSHIP]
    assert len(joins) == 100 and all(v[4:] == socket.inet_aton("192.0.2.220") for v in joins)
    assert not any(k == socket.SO_REUSEADDR and level == socket.SOL_SOCKET for level, k, _ in fake.options)
    # MSG_TRUNC/CTRUNC are Linux values; Windows may not expose them.
    monkeypatch.setattr(socket, "MSG_TRUNC", 32, raising=False)
    monkeypatch.setattr(socket, "MSG_CTRUNC", 8, raising=False)
    monkeypatch.setattr(socket, "CMSG_SPACE", lambda n: n+16, raising=False)
    ancillary = (socket.IPPROTO_IP, 8, struct.pack("=I4s4s", 2, socket.inet_aton("192.0.2.220"), socket.inet_aton("239.10.2.1")))
    fake.message = (b"sample", [ancillary], 0, ("192.0.2.1", 2564))
    assert receiver.receive()[0].id == "monitor-1"
    fake.message = (b"sample", [ancillary], 0, ("192.0.2.2", 2564))
    assert receiver.receive() is None
    fake.message = (b"sample", [ancillary], 32, ("192.0.2.1", 2564))
    assert receiver.receive() is None
    receiver.close()
    assert fake.closed and sum(k == socket.IP_DROP_MEMBERSHIP for _, k, _ in fake.options) == 100


def test_membership_failure_closes_and_drops_previous_groups(monkeypatch):
    monkeypatch.setattr("homunculus.edge.infinity_collector.sys.platform", "linux")
    fake = FakeSocket(fail_at=2)
    with pytest.raises(OSError):
        MulticastReceiver(inventory(3), socket_factory=lambda *_: fake)
    assert fake.closed and sum(k == socket.IP_DROP_MEMBERSHIP for _, k, _ in fake.options) == 2


def test_raw_pcap_replay_preserves_time_and_rejects_truncation(tmp_path):
    payload = b"synthetic"
    udp = struct.pack("!HHHH", 2564, 2050, len(payload)+8, 0) + payload
    ipv4 = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20+len(udp), 1, 0, 64, 17, 0,
                       socket.inet_aton("192.0.2.1"), socket.inet_aton("239.10.2.1")) + udp
    raw = struct.pack("<IHHIIII", 0xa1b2c3d4, 2, 4, 0, 0, 65535, 101) + struct.pack("<IIII", 123, 250000, len(ipv4), len(ipv4)) + ipv4
    path = tmp_path / "synthetic.pcap"
    path.write_bytes(raw)
    events = list(raw_pcap_events(path, inventory(), retain_payload=True))
    assert len(events) == 1 and events[0]["received_at"] == 123.25 and events[0]["mode"] == "replay"
    path.write_bytes(raw[:-1])
    with pytest.raises(ValueError):
        list(raw_pcap_events(path, inventory()))


def test_real_https_delivery_validates_certificate_and_token(factory):
    """Real loopback TLS, socket HTTP and encryption; no fake Sender/TestClient."""
    import datetime
    import ipaddress
    import threading
    import time
    import uvicorn
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    inv = inventory(100)
    archive, outbox = factory(), factory()
    with tempfile.TemporaryDirectory(prefix="homunculus-synthetic-tls-") as folder:
        folder = Path(folder)
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Synthetic loopback")])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                .public_key(private_key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(hours=1))
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
                .sign(private_key, hashes.SHA256()))
        certfile, keyfile = folder / "cert.pem", folder / "key.pem"
        certfile.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        keyfile.write_bytes(private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                     serialization.NoEncryption()))
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        endpoint = f"https://127.0.0.1:{listener.getsockname()[1]}"
        server = uvicorn.Server(uvicorn.Config(create_hub(inv, archive, TOKEN, VIEW, accept_payload=True),
                                ssl_certfile=str(certfile), ssl_keyfile=str(keyfile), access_log=False, log_level="error"))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic()+10
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            assert server.started
            good = Sender(endpoint, TOKEN, ca_file=str(certfile))
            with pytest.raises(OSError):
                Sender(endpoint, TOKEN).post("/v1/packets", {"events": [event(inv)]})
            with pytest.raises(OSError):
                Sender(endpoint, VIEW, ca_file=str(certfile)).post("/v1/packets", {"events": [event(inv)]})
            for start in range(0, 100, 25):
                outbox.append([event(inv, index=i, raw=True, mode="replay") for i in range(start, start+25)])
            while flush_once(outbox, good):
                pass
            assert outbox.snapshot()["rows"] == 0 and archive.snapshot()["rows"] == 100
            assert all(state["packets"] == 1 for state in archive.device_states().values())
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
            assert not thread.is_alive()


class LoopControl:
    """Drives `collect` deterministically: one clock step per pass, then stop.

    The collector reads the clock several times per pass, so the clock advances on
    `is_set` rather than on each read — otherwise the refresh instants would depend on
    how many times the loop happens to look at the time.
    """
    def __init__(self, passes, step):
        self.left, self.step, self.now = passes, step, 0.0

    def is_set(self):
        if self.left <= 0:
            return True
        self.left -= 1
        self.now += self.step
        return False

    def monotonic(self):
        return self.now


class RefreshReceiver:
    """Counts rejoins. With `control`, delivers one datagram per loop pass.

    Delivering per pass rather than all at once matters: the collector drains the
    socket in an inner loop, so a fixed number of datagrams would all arrive in the
    first pass and leave the rest of the run silent — testing the opposite case.
    """
    def __init__(self, rejoin=True, control=None):
        self.sock, self.refreshes, self.rejoins, self.closed = object(), 0, 0, False
        self.rejoin, self.control, self.served = rejoin, control, None

    def leave_memberships(self):
        self.refreshes += 1

    def join_memberships(self):
        self.rejoins += 1
        return self.rejoin

    def receive(self):
        if self.control is None or self.served == self.control.now:
            raise BlockingIOError
        self.served = self.control.now
        return None      # a wrong-source datagram still proves delivery

    def close(self):
        self.closed = True


def run_collect(journal, control, monkeypatch, receiver, **kwargs):
    monkeypatch.setattr("homunculus.edge.infinity_collector.select.select",
                        lambda *_: ([receiver.sock], [], []))
    collect(inventory(2), journal, control, receiver_factory=lambda _: receiver,
            monotonic=control.monotonic, **kwargs)


def test_scheduled_refresh_reannounces_membership_on_its_own_cadence(factory, monkeypatch):
    # The prune is a certainty, not an error, so the stream is kept up by the clock —
    # a watchdog alone would lose data on every cycle.
    journal, control, receiver = factory(), LoopControl(30, 5.0), RefreshReceiver()
    run_collect(journal, control, monkeypatch, receiver, refresh_interval=60.0, silence_after=1e9)
    assert receiver.refreshes == 2      # at t=60 and t=120
    assert journal.snapshot()["counters"]["membership_refresh_scheduled"] == 2
    assert "membership_refresh_silence" not in journal.snapshot()["counters"]
    assert receiver.closed


def test_silence_refresh_is_rate_limited_so_a_quiet_device_cannot_flood_joins(factory, monkeypatch):
    # A monitor in standby transmits nothing at all; the backstop must not turn that
    # into an endless stream of joins.
    journal, control, receiver = factory(), LoopControl(30, 5.0), RefreshReceiver()
    run_collect(journal, control, monkeypatch, receiver,
                refresh_interval=1e9, silence_after=10.0, min_silence_gap=30.0)
    assert receiver.refreshes == 5      # t=30,60,90,120,150 — never every 10 s
    assert journal.snapshot()["counters"]["membership_refresh_silence"] == 5


def test_arriving_datagrams_hold_the_silence_watchdog_off(factory, monkeypatch):
    journal, control = factory(), LoopControl(20, 5.0)
    receiver = RefreshReceiver(control=control)
    run_collect(journal, control, monkeypatch, receiver,
                refresh_interval=1e9, silence_after=10.0, min_silence_gap=30.0)
    assert receiver.refreshes == 0
    assert journal.snapshot()["counters"]["rejected_datagrams"] == 20


def test_a_failed_rejoin_is_counted_and_does_not_stop_collection(factory, monkeypatch):
    journal, control = factory(), LoopControl(30, 5.0)
    receiver = RefreshReceiver(rejoin=False)
    run_collect(journal, control, monkeypatch, receiver, refresh_interval=60.0, silence_after=1e9)
    counters = journal.snapshot()["counters"]
    assert counters["membership_refresh_scheduled"] == 2 and counters["membership_refresh_failed"] == 2
    assert receiver.closed      # the loop ran to its normal end, not to an exception


def test_receiver_refresh_is_two_steps_so_a_gap_can_sit_between_them(monkeypatch):
    monkeypatch.setattr("homunculus.edge.infinity_collector.sys.platform", "linux")
    fake = FakeSocket()
    receiver = MulticastReceiver(inventory(3), socket_factory=lambda *_: fake)
    before = len(fake.options)
    receiver.leave_memberships()
    # Every group must be released before any is rejoined. Interleaving them would put
    # each group's own join right after its own leave, which is the no-gap pairing that
    # was measured not to recover the stream.
    assert [k for _, k, _ in fake.options[before:]] == [socket.IP_DROP_MEMBERSHIP] * 3
    assert receiver.join_memberships() is True
    assert [k for _, k, _ in fake.options[before+3:]] == [socket.IP_ADD_MEMBERSHIP] * 3


def test_hub_accepts_membership_counters_and_still_rejects_unknown_ones(factory):
    journal = factory()
    client = TestClient(create_hub(inventory(), journal, TOKEN, VIEW))
    def beat(counters):
        return client.post("/v1/heartbeat", headers={"Authorization": "Bearer " + TOKEN}, json={
            "collector_id": "collector-a", "mode": "live", "clinical_forwarding": False,
            "queue": {"rows": 0, "encrypted_bytes": 0, "oldest_age_seconds": None,
                      "counters": counters, "retention_seconds": 3600}})
    assert beat({"accepted": 5, "membership_refresh_scheduled": 2,
                 "membership_refresh_silence": 1, "membership_refresh_failed": 0}).status_code == 200
    assert beat({"accepted": 5, "membership_refresh_unknown": 1}).status_code == 400


def test_a_refresh_in_progress_is_not_restarted_before_its_rejoin(factory, monkeypatch):
    # The gap is the whole point of the two-step refresh, so a scheduled refresh falling
    # due inside it must wait. Leaving again from an already-left state would reset the
    # gap forever and the groups would never be rejoined.
    journal, control, receiver = factory(), LoopControl(30, 5.0), RefreshReceiver()
    run_collect(journal, control, monkeypatch, receiver,
                refresh_interval=60.0, silence_after=1e9, rejoin_gap=70.0)
    assert receiver.refreshes == 2 and receiver.rejoins == 1
    assert journal.snapshot()["counters"]["membership_refresh_scheduled"] == 2
