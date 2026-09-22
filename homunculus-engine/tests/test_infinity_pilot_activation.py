"""Synthetic activation checks; no hospital access, root actions, or real keys."""
import importlib.util
import json
from pathlib import Path
import secrets
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from cryptography import x509
from cryptography.fernet import Fernet

SPEC = importlib.util.spec_from_file_location(
    'pilot_activation', Path(__file__).resolve().parents[2] / 'deploy/infinity/activate_pilot.py')
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)


@pytest.fixture(scope='module')
def certificates():
    return pilot.issue_tls('127.0.0.1')


@pytest.fixture
def fixture_dir(tmp_path_factory):
    # Synthetic keys still stay outside source control.
    import tempfile
    path = Path(tempfile.mkdtemp(prefix='homunculus-pilot-activation-test-')).resolve()
    assert path.is_relative_to(Path(tempfile.gettempdir()).resolve())
    yield path
    for child in path.iterdir():
        assert child.is_file() and child.resolve().parent == path
        child.unlink()
    path.rmdir()


def test_generated_ca_and_leaf_enforce_real_tls_hostname_and_trust(certificates, fixture_dir, monkeypatch):
    cert_path, key_path = fixture_dir / 'server.pem', fixture_dir / 'server-key.pem'
    cert_path.write_bytes(certificates['server.pem'])
    key_path.write_bytes(certificates['server-key.pem'])
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/redirect':
                self.send_response(302)
                self.send_header('Location', '/must-not-follow')
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"synthetic":true}')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert_path, key_path)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setattr(pilot, 'ENDPOINT', f'https://127.0.0.1:{server.server_port}')
    monkeypatch.setenv('HTTPS_PROXY', 'http://127.0.0.1:1')
    try:
        assert json.loads(pilot.fetch(certificates['ca.pem'].decode())) == {'synthetic': True}
        with pytest.raises(pilot.urllib.error.HTTPError) as rejection:
            pilot.fetch(certificates['ca.pem'].decode(), path='/redirect')
        assert rejection.value.code == 302
        monkeypatch.setattr(pilot, 'ENDPOINT', f'https://localhost:{server.server_port}')
        with pytest.raises(pilot.urllib.error.URLError):
            pilot.fetch(certificates['ca.pem'].decode())
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
    ca = x509.load_pem_x509_certificate(certificates['ca.pem'])
    leaf = x509.load_pem_x509_certificate(certificates['server.pem'])
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    assert not leaf.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    assert leaf.not_valid_after_utc < ca.not_valid_after_utc


def test_enrollment_rejects_foreign_target_and_unexpected_secrets(certificates):
    row = {'schema': 'infinity.pilot.enrollment.v1', 'endpoint': pilot.ENDPOINT,
           'inventory': pilot.INVENTORY, 'collector_token': secrets.token_urlsafe(48),
           'ca_pem': certificates['ca.pem'].decode()}
    assert pilot.validate_enrollment(row) == row
    for invalid in [dict(row, endpoint='https://example.invalid'),
                    dict(row, collector_token='short'), dict(row, viewer_token='must-not-export'),
                    dict(row, ca_pem=certificates['server.pem'].decode()),
                    dict(row, inventory={})]:
        with pytest.raises(ValueError):
            pilot.validate_enrollment(invalid)


def test_secrets_are_reused_on_retry_and_changed_enrollment_rejected(certificates, fixture_dir, monkeypatch):
    token = secrets.token_urlsafe(48)
    key = Fernet.generate_key().decode()
    (fixture_dir / 'role.json').write_text(json.dumps({'role': 'worker', 'schema': 1}))
    env = fixture_dir / 'worker.env'
    env.write_text(f'INFINITY_STORAGE_KEY={key}\nINFINITY_COLLECTOR_TOKEN={token}\n')
    (fixture_dir / 'inventory.json').write_text(json.dumps(pilot.INVENTORY))
    (fixture_dir / 'ca.pem').write_bytes(certificates['ca.pem'])
    monkeypatch.setattr(pilot, 'CONFIG', fixture_dir)
    original = env.read_bytes()
    enrollment = {'collector_token': token, 'ca_pem': certificates['ca.pem'].decode()}
    pilot.initialize('worker', None, enrollment)
    assert env.read_bytes() == original
    with pytest.raises(ValueError):
        pilot.initialize('worker', None, dict(enrollment, collector_token=secrets.token_urlsafe(48)))
    assert env.read_bytes() == original


def test_existing_export_not_overwritten(fixture_dir):
    path = fixture_dir / 'secret'
    path.write_bytes(b'synthetic-secret')
    with pytest.raises(FileExistsError):
        pilot.private_write(path, b'replacement')
    assert path.read_bytes() == b'synthetic-secret'


def test_units_use_prepared_runtime_without_payload_or_clinical_paths():
    for role in ('worker', 'hub'):
        text = pilot.unit_text(role)
        assert f'{pilot.RUNTIME}/.venv/bin/python' in text
        assert f'Environment=PYTHONPATH={pilot.RUNTIME}/app/src' in text
        assert '--capture-payload' not in text
        assert '/ingest' not in text and '2575' not in text
        assert 'User=root' not in text
        assert 'StateDirectory=homunculus-infinity-pilot' in text
        assert f'EnvironmentFile={pilot.CONFIG}/{role}.env' in text


@pytest.mark.parametrize('state_code,expect_reset', [(1, False), (4, False), (0, True)])
def test_start_fresh_unloaded_and_previously_failed_units(monkeypatch, state_code, expect_reset):
    calls = []
    def fake_run(args, **kwargs):
        calls.append(tuple(args))
        code = state_code if args[1] == 'is-failed' else 0
        return pilot.subprocess.CompletedProcess(args, code)
    monkeypatch.setattr(pilot.subprocess, 'run', fake_run)
    name = 'synthetic-pilot.service'
    pilot.start_unit(name, Path('/synthetic/unit.service'))
    assert (('systemctl', 'reset-failed', name) in calls) == expect_reset
    assert calls[-1] == ('systemctl', 'enable', '--now', name)


def test_command_failure_identifies_step_without_arguments_or_output(monkeypatch):
    def fail(args, **kwargs):
        raise pilot.subprocess.CalledProcessError(7, args, output='secret-output', stderr='secret-error')
    monkeypatch.setattr(pilot.subprocess, 'run', fail)
    with pytest.raises(pilot.PilotError) as failure:
        pilot.command('systemctl', 'enable', '--now', 'private-argument')
    assert str(failure.value) == 'Command failed: systemctl enable; exit=7'
    assert 'private-argument' not in str(failure.value)
    assert 'secret' not in str(failure.value)
