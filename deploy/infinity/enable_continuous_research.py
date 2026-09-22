"""Side-by-side opt-in live research upgrade. Existing keys, journals and NICs stay intact."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import ssl
import subprocess
import sys
import time
import urllib.request

class UpgradeError(ValueError):
    pass


PILOT = Path('/opt/homunculus-infinity/pilot')
CONFIG = Path('/etc/homunculus-infinity-pilot')
MARKER = '# Homunculus continuous research v1\n'
MODULES = ('infinity_stream', 'infinity_journal', 'infinity_collector', 'infinity_hub',
           'infinity_decoder', 'infinity_live')
SOURCE_FILES = {'app/run_infinity_transport.py', 'app/src/homunculus/__init__.py',
                'app/src/homunculus/edge/__init__.py'} | {
                    'app/src/homunculus/edge/' + name + '.py' for name in MODULES}


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def verified_sources(bundle):
    manifest = json.loads((bundle / 'manifest.json').read_text())
    if not isinstance(manifest, dict) or not SOURCE_FILES <= manifest.keys():
        raise UpgradeError('Missing research source files')
    result = {}
    for name in sorted(SOURCE_FILES):
        path = bundle / name
        if path.is_symlink() or not path.resolve().is_relative_to(bundle.resolve()) or path.stat().st_size > 200000:
            raise UpgradeError('Unsafe source file')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest[name]:
            raise UpgradeError('Source hash mismatch')
        result[name] = data
    return result


def override_text(base_unit, release, role):
    lines = [line[len('ExecStart='):] for line in base_unit.splitlines() if line.startswith('ExecStart=')]
    if len(lines) != 1:
        raise UpgradeError('Unexpected base unit')
    args = shlex.split(lines[0])
    expected = [str(PILOT / '.venv/bin/python'), str(PILOT / 'app/run_infinity_transport.py'),
                'hub' if role == 'hub' else 'collector']
    if args[:3] != expected or any(x in args for x in ('--capture-payload', '--unverified-live-research', '--replay')):
        raise UpgradeError('Base unit is not the existing metadata pilot')
    args[1] = str(release / 'app/run_infinity_transport.py')
    args.append('--capture-payload')
    if role == 'hub':
        args.extend(['--unverified-live-research', str(release / 'research-profile.json')])
    return (MARKER + '[Unit]\nDescription=Homunculus Infinity continuous research ' + role +
            '\n\n[Service]\nEnvironment=PYTHONPATH=' + str(release / 'app/src') +
            '\nExecStart=\nExecStart=' + shlex.join(args) + '\n')


def hub_health():
    values = dict(line.split('=', 1) for line in (CONFIG/'hub.env').read_text().splitlines() if line)
    context = ssl.create_default_context(cafile=str(CONFIG/'ca.pem'))
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=context), NoRedirect())
    request = urllib.request.Request('https://172.100.101.72:8766/infinity-research/state',
        headers={'Authorization': 'Bearer ' + values['INFINITY_VIEWER_TOKEN']})
    with opener.open(request, timeout=3) as response:
        raw = response.read(32769)
        if len(raw) > 32768:
            raise UpgradeError('Oversized research status')
        data = json.loads(raw)
    if (data.get('schema') != 'homunculus.infinity-preview.v2' or data.get('mode') != 'live'
            or data.get('source_ip') != '10.10.203.28' or data.get('evidence') != 'unverified_layout'
            or data.get('clinical_ingest_enabled') is not False):
        raise UpgradeError('Unexpected research status')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=('hub', 'worker'))
    parser.add_argument('--profile', type=Path, help='hub: externally held research profile')
    parser.add_argument('--apply', action='store_true', help='restart this pilot role with continuous research')
    parser.add_argument('--rollback', action='store_true', help='remove only this helper\'s override and restore metadata service')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise UpgradeError('Use sudo on the intended Ubuntu VM')
    if args.apply and args.rollback:
        raise UpgradeError('Choose apply or rollback')
    actual = json.loads(run('ip', '-j', '-4', 'address', 'show', capture_output=True, text=True).stdout)
    ips = {a.get('local') for nic in actual for a in nic.get('addr_info', [])}
    required = {'172.100.101.72'} if args.role == 'hub' else {'172.100.101.74', '10.10.203.101'}
    if not required <= ips:
        raise UpgradeError('Wrong host for this role')
    name = 'homunculus-infinity-pilot-' + args.role + '.service'
    unit = Path('/etc/systemd/system') / name
    directory = Path(str(unit) + '.d')
    dropin = directory / '30-continuous-research.conf'
    for path in (PILOT, CONFIG, unit, directory, dropin):
        if path.is_symlink():
            raise UpgradeError('Refusing a symlinked pilot path')
    if args.rollback:
        if not dropin.exists() or not dropin.read_text().startswith(MARKER):
            raise UpgradeError('No owned research override to roll back')
        dropin.unlink()
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', name)
        print('Restored metadata unit; keys, archive and source release preserved.')
        return 0
    run('systemctl', 'is-active', '--quiet', name)
    run('systemctl', 'is-enabled', '--quiet', name)
    if directory.exists() and any(p != dropin for p in directory.iterdir()):
        raise UpgradeError('Other service overrides require review')
    bundle = Path(__file__).resolve().parent
    sources = verified_sources(bundle)
    if json.loads((CONFIG/'inventory.json').read_text()) != json.loads((bundle/'inventory.json').read_text()):
        raise UpgradeError('Inventory differs from this single-device pilot')
    env = dict(os.environ, PYTHONPATH=str(bundle/'app/src'), PYTHONDONTWRITEBYTECODE='1')
    run(str(PILOT/'.venv/bin/python'), str(bundle/'app/run_infinity_transport.py'), '--help',
        env=env, stdout=subprocess.DEVNULL)
    profile_data = b''
    if args.role == 'hub':
        if not args.profile or args.profile.is_symlink() or args.profile.stat().st_size > 65536:
            raise UpgradeError('Hub requires a bounded external profile')
        run(str(PILOT/'.venv/bin/python'), '-c',
            'import sys; from pathlib import Path; from homunculus.edge.infinity_decoder import read_profile; '
            'from homunculus.edge.infinity_stream import Inventory; from homunculus.edge.infinity_live import LiveResearchView; '
            'LiveResearchView(read_profile(Path(sys.argv[1])), Inventory.read(Path(sys.argv[2])))',
            str(args.profile.resolve()), str(CONFIG/'inventory.json'), env=env, stdout=subprocess.DEVNULL)
        profile_data = args.profile.read_bytes()
    fingerprints = {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}
    release_hash = hashlib.sha256(json.dumps(fingerprints, sort_keys=True).encode() + profile_data).hexdigest()[:16]
    release = PILOT.parent / ('research-' + release_hash)
    text = override_text(unit.read_text(), release, args.role)
    if dropin.exists():
        if dropin.read_text() != text:
            raise UpgradeError('Existing research override differs; inspect before replacing it')
        if args.role == 'hub': hub_health()
        print('Research override already active; no keys rotated and no restart performed.')
        return 0
    if not args.apply:
        print('CHECK OK: side-by-side source release; restart only ' + name)
        print('Live candidates remain unverified; payload journal encrypted and bounded by existing retention.')
        print('Run the same command with --apply when ready. Apply hub first, then worker.')
        return 0
    import grp
    group = grp.getgrnam('homunculus-infinity-pilot').gr_gid
    if release.exists():
        expected_files = dict(sources)
        if args.role == 'hub':
            expected_files['research-profile.json'] = profile_data
        if release.is_symlink() or any((release/n).is_symlink() or (release/n).read_bytes() != data
                                       for n, data in expected_files.items()):
            raise UpgradeError('Existing release differs; refusing overwrite')
    else:
        release.mkdir(mode=0o755)
        for name_in_release, data in sources.items():
            target = release/name_in_release
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
        if args.role == 'hub':
            target = release/'research-profile.json'
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(profile_data)
            target.chmod(0o640)
            os.chown(target, 0, group)
    directory.mkdir(mode=0o755, exist_ok=True)
    dropin.write_text(text)
    dropin.chmod(0o644)
    try:
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', name)
        healthy = False
        consecutive = 0
        for _ in range(10):
            time.sleep(1)
            try:
                run('systemctl', 'is-active', '--quiet', name)
                if args.role == 'hub': hub_health()
                consecutive += 1
                if consecutive >= 3:
                    healthy = True
                    break
            except (OSError, ValueError, subprocess.CalledProcessError):
                consecutive = 0
        if not healthy:
            raise UpgradeError('Research role health check failed')
    except Exception:
        dropin.unlink()
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', name)
        raise UpgradeError('Research activation failed; metadata unit restored') from None
    print('ACTIVE: continuous research ' + args.role + '; no duration limit; clinical_forwarding=false')
    print('Process health checked. Confirm fresh candidates and monitor screen separately.')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        detail = str(error) if isinstance(error, UpgradeError) else type(error).__name__
        print('Research upgrade stopped: ' + detail + '; no keys rotated.', file=sys.stderr)
        raise SystemExit(2)
