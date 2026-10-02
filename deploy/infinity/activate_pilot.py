"""Activate the prepared, metadata-only Infinity pilot on the two site VMs.

Run with the prepared venv's Python using sudo. No clinical ingest, raw payload,
Docker changes, routing changes or global trust-store changes are performed.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

RUNTIME = Path('/opt/homunculus-infinity/pilot')
CONFIG = Path('/etc/homunculus-infinity-pilot')
STATE = Path('/var/lib/homunculus-infinity-pilot')
ACCOUNT = 'homunculus-infinity-pilot'
ENDPOINT = 'https://172.100.101.72:8766'
INVENTORY = {'collector_id': 'infinity-worker-01', 'interface': '10.10.203.101/24',
             'devices': [{'id': 'infinity-monitor-28', 'source': '10.10.203.28',
                          'group': '224.0.2.28', 'port': 2050}]}
TOKEN = re.compile(r'[A-Za-z0-9_-]{43,128}\Z')


class PilotError(ValueError):
    """A diagnostic message that never contains credentials or payloads."""


def command(*args, **kw):
    try:
        return subprocess.run(args, check=True, **kw)
    except subprocess.CalledProcessError as exc:
        # Only the fixed executable/action, never arbitrary arguments or output.
        action = ' '.join(str(x) for x in args[:2])
        raise PilotError(f'Command failed: {action}; exit={exc.returncode}') from None


def start_unit(name, unit):
    command('systemd-analyze', 'verify', str(unit))
    command('systemctl', 'daemon-reload')
    failed = subprocess.run(['systemctl', 'is-failed', '--quiet', name],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # A fresh unit may not have been loaded yet. Reset only an actual failed unit;
    # reset-failed on an unloaded unit must not block its first start.
    if failed.returncode == 0:
        command('systemctl', 'reset-failed', name)
    command('systemctl', 'enable', '--now', name)


def private_write(path, value, mode=0o600, uid=0, gid=0):
    """Exclusive creation: never follow or overwrite an existing key or export."""
    value = value.encode() if isinstance(value, str) else value
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'wb') as out:
        out.write(value)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(path, mode)
    os.chown(path, uid, gid)


def issue_tls(address='172.100.101.72'):
    now = dt.datetime.now(dt.timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Homunculus Infinity pilot CA')])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now-dt.timedelta(minutes=5)).not_valid_after(now+dt.timedelta(days=365))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, None, None), critical=True)
          .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
          .sign(ca_key, hashes.SHA256()))
    server = (x509.CertificateBuilder()
              .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Infinity research hub')]))
              .issuer_name(ca_name).public_key(server_key.public_key()).serial_number(x509.random_serial_number())
              .not_valid_before(now-dt.timedelta(minutes=5)).not_valid_after(now+dt.timedelta(days=90))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(address))]), critical=False)
              .add_extension(x509.KeyUsage(True, False, True, False, False, False, False, None, None), critical=True)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(server_key.public_key()), critical=False)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
              .sign(ca_key, hashes.SHA256()))
    pem = lambda c: c.public_bytes(serialization.Encoding.PEM)
    key = lambda k: k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
    return {'ca.pem': pem(ca), 'ca-key.pem': key(ca_key),
            'server.pem': pem(server), 'server-key.pem': key(server_key)}


def validate_enrollment(value):
    if (not isinstance(value, dict) or set(value) != {'schema', 'endpoint', 'inventory', 'collector_token', 'ca_pem'}
            or value['schema'] != 'infinity.pilot.enrollment.v1' or value['endpoint'] != ENDPOINT
            or value['inventory'] != INVENTORY or not isinstance(value['collector_token'], str)
            or not TOKEN.fullmatch(value['collector_token']) or not isinstance(value['ca_pem'], str)
            or len(value['ca_pem']) > 8192):
        raise PilotError('Invalid enrollment')
    ca = x509.load_pem_x509_certificate(value['ca_pem'].encode())
    if not ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
        raise PilotError('Enrollment does not contain a CA')
    now = dt.datetime.now(dt.timezone.utc)
    if not ca.not_valid_before_utc <= now < ca.not_valid_after_utc:
        raise PilotError('Enrollment CA is expired or not yet valid')
    return value


def fetch(ca_pem, token=None, path='/'):
    context = ssl.create_default_context(cadata=ca_pem)
    # No proxy/redirect may reroute the pilot credential to another endpoint.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                        urllib.request.HTTPSHandler(context=context), NoRedirect())
    req = urllib.request.Request(ENDPOINT + path)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    with opener.open(req, timeout=5) as response:
        result = response.read(1_000_001)
        if len(result) > 1_000_000:
            raise PilotError('Oversized response')
        return result


def unit_text(role):
    base = f'{RUNTIME}/.venv/bin/python {RUNTIME}/app/run_infinity_transport.py'
    shared = (f' --inventory {CONFIG}/inventory.json --database {STATE}/'
              + ('archive.sqlite' if role == 'hub' else 'outbox.sqlite')
              + ' --max-mib 128 --max-rows 100000 --retention-seconds 3600')
    extra = (f' --host 172.100.101.72 --port 8766 --tls-cert {CONFIG}/server.pem --tls-key {CONFIG}/server-key.pem'
             if role == 'hub' else f' --endpoint {ENDPOINT} --ca-file {CONFIG}/ca.pem')
    return f'''[Unit]
Description=Homunculus Infinity pilot {role} (metadata only)
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User={ACCOUNT}
Group={ACCOUNT}
EnvironmentFile={CONFIG}/{role}.env
Environment=PYTHONPATH={RUNTIME}/app/src
Environment=PYTHONDONTWRITEBYTECODE=1
WorkingDirectory={RUNTIME}
ExecStart={base} {'hub' if role == 'hub' else 'collector'}{shared}{extra}
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
StateDirectory={ACCOUNT}
StateDirectoryMode=0700
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
MemoryMax=512M
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
'''


def read_env(role):
    values = dict(line.split('=', 1) for line in (CONFIG / f'{role}.env').read_text().splitlines() if line)
    Fernet(values['INFINITY_STORAGE_KEY'].encode())
    if not TOKEN.fullmatch(values['INFINITY_COLLECTOR_TOKEN']):
        raise PilotError('Invalid stored credential')
    if role == 'hub' and (not TOKEN.fullmatch(values['INFINITY_VIEWER_TOKEN'])
                          or values['INFINITY_VIEWER_TOKEN'] == values['INFINITY_COLLECTOR_TOKEN']):
        raise PilotError('Invalid viewer credential')
    return values


def preflight(role):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise PilotError('Use sudo and the prepared venv Python on the intended Ubuntu VM')
    actual = json.loads(command('ip', '-j', '-4', 'address', 'show', capture_output=True, text=True).stdout)
    ips = {a.get('local') for nic in actual for a in nic.get('addr_info', [])}
    required = {'172.100.101.72'} if role == 'hub' else {'172.100.101.74', '10.10.203.101'}
    if not required <= ips:
        raise PilotError('Wrong host/IP for this role')
    if json.loads((RUNTIME / 'inventory.json').read_text()) != INVENTORY:
        raise PilotError('Prepared inventory differs from the single-device pilot')
    manifest = json.loads((RUNTIME / 'manifest.json').read_text())
    for name, digest in manifest.items():
        file = RUNTIME / name
        if (Path(name).is_absolute() or '..' in Path(name).parts or file.is_symlink()
                or not file.resolve().is_relative_to(RUNTIME.resolve())
                or hashlib.sha256(file.read_bytes()).hexdigest() != digest):
            raise PilotError('Prepared runtime changed; review before activation')
    # Protect persistent secrets and state against a reused/symlinked location.
    for path in (CONFIG, STATE):
        if path.is_symlink():
            raise PilotError('Refusing a symlinked configuration/state directory')


def service_account():
    import pwd
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        command('useradd', '--system', '--user-group', '--home-dir', str(STATE),
                '--shell', '/usr/sbin/nologin', ACCOUNT)
        account = pwd.getpwnam(ACCOUNT)
    if account.pw_uid == 0 or account.pw_dir != str(STATE) or account.pw_shell not in ('/usr/sbin/nologin', '/bin/false'):
        raise PilotError('Existing service account is unsuitable')
    return account


def initialize(role, account, enrollment=None):
    marker = CONFIG / 'role.json'
    if CONFIG.exists():
        if not marker.is_file() or json.loads(marker.read_text()) != {'role': role, 'schema': 1}:
            raise PilotError('Existing/partial pilot configuration requires inspection; not overwriting')
        values = read_env(role)
        if json.loads((CONFIG / 'inventory.json').read_text()) != INVENTORY:
            raise PilotError('Stored inventory changed')
        if enrollment and (values['INFINITY_COLLECTOR_TOKEN'] != enrollment['collector_token']
                           or (CONFIG / 'ca.pem').read_text() != enrollment['ca_pem']):
            raise PilotError('Enrollment differs from existing keys; refusing silent rotation')
        return
    if STATE.exists():
        raise PilotError('State exists without matching configuration; preserve it for inspection')
    CONFIG.mkdir(mode=0o750)
    os.chown(CONFIG, 0, account.pw_gid)
    STATE.mkdir(mode=0o700)
    os.chown(STATE, account.pw_uid, account.pw_gid)
    values = {'INFINITY_STORAGE_KEY': Fernet.generate_key().decode(),
              'INFINITY_COLLECTOR_TOKEN': secrets.token_urlsafe(48) if role == 'hub' else enrollment['collector_token']}
    if role == 'hub':
        values['INFINITY_VIEWER_TOKEN'] = secrets.token_urlsafe(48)
        for name, data in issue_tls().items():
            private_write(CONFIG / name, data, 0o600 if name == 'ca-key.pem' else 0o640, gid=account.pw_gid)
    else:
        private_write(CONFIG / 'ca.pem', enrollment['ca_pem'], 0o640, gid=account.pw_gid)
    private_write(CONFIG / 'inventory.json', json.dumps(INVENTORY, indent=2), 0o640, gid=account.pw_gid)
    private_write(CONFIG / f'{role}.env', ''.join(f'{k}={v}\n' for k, v in values.items()))
    private_write(marker, json.dumps({'role': role, 'schema': 1}))


def export_hub_credentials():
    import pwd
    # Fixed site admin, never an arbitrary path supplied by remote input.
    admin = pwd.getpwnam('sysadmin')
    home = Path(admin.pw_dir)
    if home != Path('/home/sysadmin') or home.is_symlink():
        raise PilotError('Unexpected sysadmin home')
    values = read_env('hub')
    enrollment = {'schema': 'infinity.pilot.enrollment.v1', 'endpoint': ENDPOINT,
                  'inventory': INVENTORY, 'collector_token': values['INFINITY_COLLECTOR_TOKEN'],
                  'ca_pem': (CONFIG / 'ca.pem').read_text()}
    validate_enrollment(enrollment)
    exports = {'infinity-worker-enrollment.json': json.dumps(enrollment, indent=2),
               'infinity-viewer-token.txt': values['INFINITY_VIEWER_TOKEN'] + '\n'}
    for name, value in exports.items():
        path = home / name
        if path.exists() or path.is_symlink():
            if path.is_symlink() or path.read_text() != value or path.stat().st_uid != admin.pw_uid:
                raise PilotError('Existing export differs; not overwriting')
            path.chmod(0o600)
        else:
            private_write(path, value, uid=admin.pw_uid, gid=admin.pw_gid)
    print('Protected worker enrollment and viewer token saved in /home/sysadmin; contents not printed.')


def status(role):
    name = f'homunculus-infinity-pilot-{role}.service'
    result = subprocess.run(['systemctl', 'is-active', name], capture_output=True, text=True)
    if role == 'hub':
        values = read_env(role)
        data = json.loads(fetch((CONFIG / 'ca.pem').read_text(), values['INFINITY_VIEWER_TOKEN'], '/v1/status'))
        print(json.dumps({'role': role, 'service': result.stdout.strip(),
                          'collector_connected': data['collector']['connected'],
                          'devices': data['devices'], 'clinical_forwarding': data['clinical_forwarding']}))
    else:
        print(json.dumps({'role': role, 'service': result.stdout.strip(), 'clinical_forwarding': False,
                          'note': 'Check hub status to verify packet delivery, not only process health.'}))
    if result.returncode:
        raise PilotError('Pilot service is not active')


def activate(role, enrollment):
    preflight(role)
    name = f'homunculus-infinity-pilot-{role}.service'
    unit = Path('/etc/systemd/system') / name
    text = unit_text(role)
    if unit.is_symlink() or (unit.exists() and unit.read_text() != text):
        raise PilotError('Existing unit differs; refusing replacement')
    was_active = subprocess.run(['systemctl', 'is-active', '--quiet', name]).returncode == 0
    if was_active and not (CONFIG / 'role.json').is_file():
        raise PilotError('Unrecognized existing active service')
    if not was_active:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM if role == 'hub' else socket.SOCK_DGRAM) as probe:
            probe.bind(('0.0.0.0', 8766 if role == 'hub' else 2050))
    if role == 'worker':
        if enrollment:
            file = Path(enrollment)
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 16384:
                raise PilotError('Invalid enrollment file')
            file.chmod(0o600)
            enrollment = validate_enrollment(json.loads(file.read_text()))
        elif not (CONFIG / 'role.json').exists():
            raise PilotError('Worker enrollment file is required for first activation')
        ca = enrollment['ca_pem'] if enrollment else (CONFIG / 'ca.pem').read_text()
        fetch(ca)  # verify route, CA, server IP/SAN and expiry before starting collection
    account = service_account()
    initialize(role, account, enrollment)
    if not unit.exists():
        private_write(unit, text, 0o644)
    # Validate syntax before enabling; no alteration of existing clinical units.
    start_unit(name, unit)
    try:
        deadline = time.monotonic() + 15
        while True:
            try:
                if role == 'hub':
                    values = read_env(role)
                    json.loads(fetch((CONFIG / 'ca.pem').read_text(), values['INFINITY_VIEWER_TOKEN'], '/v1/status'))
                else:
                    time.sleep(2)
                    command('systemctl', 'is-active', '--quiet', name)
                break
            except (OSError, ValueError, subprocess.CalledProcessError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.5)
    except Exception:
        if not was_active:
            subprocess.run(['systemctl', 'disable', '--now', name], check=False)
        raise
    if role == 'hub':
        export_hub_credentials()
        certificate = x509.load_pem_x509_certificate((CONFIG / 'server.pem').read_bytes())
        print('Pilot server certificate expires: ' + certificate.not_valid_after_utc.isoformat())
    print(f'ACTIVE: {role}; metadata_only=true; clinical_forwarding=false')
    status(role)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=('hub', 'worker'))
    parser.add_argument('--enrollment', type=Path)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    if args.status:
        preflight(args.role)
        status(args.role)
    else:
        activate(args.role, args.enrollment)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        # Never print tokens, env content, enrollment JSON or certificate private keys.
        detail = str(exc) if isinstance(exc, PilotError) else type(exc).__name__
        print('Pilot activation/status stopped: ' + detail +
              '. Inspect the role, connectivity and pilot service journal; existing keys were not rotated.', file=sys.stderr)
        raise SystemExit(2)
