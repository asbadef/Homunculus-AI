"""Renewing the research hub's TLS leaf under its existing CA. Synthetic keys only."""
import datetime as dt
import importlib.util
import json
from pathlib import Path

import pytest
from cryptography import x509

ROOT = Path(__file__).resolve().parents[2]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = _load("pilot_activation_for_renewal", "deploy/infinity/activate_pilot.py")
renewal = _load("renew_hub_certificate", "deploy/infinity/renew_hub_certificate.py")


@pytest.fixture(scope="module")
def authority():
    return pilot.issue_tls("127.0.0.1")       # a CA and a first leaf, as activation made them


def test_a_renewed_leaf_is_trusted_through_the_same_ca(authority, tmp_path, monkeypatch):
    from test_infinity_pilot_activation import BaseHTTPRequestHandler, ThreadingHTTPServer, ssl, threading
    now = dt.datetime.now(dt.timezone.utc)
    cert_pem, key_pem = renewal.issue_leaf(authority["ca.pem"], authority["ca-key.pem"], "127.0.0.1", now)
    (tmp_path / "server.pem").write_bytes(cert_pem)
    (tmp_path / "server-key.pem").write_bytes(key_pem)
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"renewed":true}')
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(tmp_path / "server.pem", tmp_path / "server-key.pem")
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(pilot, "ENDPOINT", f"https://127.0.0.1:{server.server_port}")
    try:
        # The worker and the API hold the CA, never the leaf: the old CA must trust the new leaf.
        assert json.loads(pilot.fetch(authority["ca.pem"].decode())) == {"renewed": True}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    ca = x509.load_pem_x509_certificate(authority["ca.pem"])
    leaf = x509.load_pem_x509_certificate(cert_pem)
    old = x509.load_pem_x509_certificate(authority["server.pem"])
    assert leaf.not_valid_after_utc <= ca.not_valid_after_utc - dt.timedelta(days=1)
    assert leaf.not_valid_after_utc > now + dt.timedelta(days=300)
    assert leaf.public_key().public_numbers() != old.public_key().public_numbers()


def test_a_ca_at_its_end_is_not_renewed_under(authority):
    ca = x509.load_pem_x509_certificate(authority["ca.pem"])
    with pytest.raises(ValueError, match="CA"):
        renewal.issue_leaf(authority["ca.pem"], authority["ca-key.pem"], "127.0.0.1",
                           ca.not_valid_after_utc - dt.timedelta(hours=12))


def test_install_keeps_the_current_pair_and_never_overwrites_a_backup(tmp_path):
    (tmp_path / "server.pem").write_bytes(b"old certificate")
    (tmp_path / "server-key.pem").write_bytes(b"old key")
    renewal.install(tmp_path, b"new certificate", b"new key", "20261201T000000Z")
    assert (tmp_path / "server.pem").read_bytes() == b"new certificate"
    assert (tmp_path / "server-key.pem").read_bytes() == b"new key"
    assert (tmp_path / "server.pem.bak-20261201T000000Z").read_bytes() == b"old certificate"
    assert (tmp_path / "server-key.pem.bak-20261201T000000Z").read_bytes() == b"old key"
    with pytest.raises(ValueError):
        renewal.install(tmp_path, b"third", b"third key", "20261201T000000Z")
    assert (tmp_path / "server.pem").read_bytes() == b"new certificate"
    assert not list(tmp_path.glob("*.new"))


def test_install_creates_every_file_exclusively_owner_only_and_synced(tmp_path, monkeypatch):
    # Review of R2, M5: the new key and its backup were written under the default umask and
    # never synced, so a key could sit readable, or a power loss leave half a pair.
    import os
    (tmp_path / "server.pem").write_bytes(b"old certificate")
    (tmp_path / "server-key.pem").write_bytes(b"old key")
    opened, synced = {}, []
    real_open, real_fsync = os.open, os.fsync
    def recording_open(path, flags, mode=0o777, *args, **kwargs):
        opened[Path(path).name] = (bool(flags & os.O_EXCL), mode)
        return real_open(path, flags, mode, *args, **kwargs)
    def recording_fsync(fd):
        synced.append(fd)
        return real_fsync(fd)
    monkeypatch.setattr(renewal.os, "open", recording_open)
    monkeypatch.setattr(renewal.os, "fsync", recording_fsync)
    renewal.install(tmp_path, b"new certificate", b"new key", "20261201T000000Z")
    for name in ("server-key.pem.new", "server-key.pem.bak-20261201T000000Z",
                 "server.pem.new", "server.pem.bak-20261201T000000Z"):
        assert opened.get(name) == (True, 0o600), name
    assert len(synced) >= 4


def test_a_stale_staged_file_stops_the_install_before_anything_changes(tmp_path):
    (tmp_path / "server.pem").write_bytes(b"old certificate")
    (tmp_path / "server-key.pem").write_bytes(b"old key")
    (tmp_path / "server.pem.new").write_bytes(b"left by an interrupted run")
    with pytest.raises(ValueError):
        renewal.install(tmp_path, b"new certificate", b"new key", "20261201T000000Z")
    assert (tmp_path / "server-key.pem").read_bytes() == b"old key"
    assert not list(tmp_path.glob("*.bak-*")) and not (tmp_path / "server-key.pem.new").exists()


def test_the_renewal_prints_the_one_stamp_that_names_both_backups(authority, tmp_path, monkeypatch, capsys):
    # Review of R2, M5: C-2 found its backups with "ls | tail -2", which a second renewal breaks.
    for name in ("ca.pem", "ca-key.pem", "server.pem", "server-key.pem"):
        (tmp_path / name).write_bytes(authority[name])
    monkeypatch.setattr(renewal, "CONFIG", tmp_path)
    monkeypatch.setattr(renewal, "ADDRESS", "127.0.0.1")
    monkeypatch.setattr(renewal.sys, "platform", "linux")
    monkeypatch.setattr(renewal.os, "geteuid", lambda: 0, raising=False)
    monkeypatch.setattr("sys.argv", ["renew_hub_certificate.py", "--apply"])
    assert renewal.main() == 0
    lines = capsys.readouterr().out.splitlines()
    stamp = next(line.split(": ", 1)[1] for line in lines if line.startswith("backup stamp: "))
    assert (tmp_path / f"server.pem.bak-{stamp}").read_bytes() == authority["server.pem"]
    assert (tmp_path / f"server-key.pem.bak-{stamp}").read_bytes() == authority["server-key.pem"]
