"""Install a guarded partial research decoder on the already switched BED09 hub.

No worker restart, key rotation, clinical ingest, database reset or network change.
Bundle/profile stay separate from the immutable prior source release.
"""
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

from enable_continuous_research import verified_sources
from switch_bed09 import atomic_write, target_command

CONFIG = Path('/etc/homunculus-infinity-pilot')
UNIT = 'homunculus-infinity-pilot-hub.service'
DIRECTORY = Path('/etc/systemd/system')/(UNIT+'.d')
MARKER = '# Homunculus BED09 partial decoder v3\n'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=45, **kwargs)


def decoder_override(command, release):
    args = list(command)
    if args[2] != 'hub' or '--capture-payload' not in args or '--replay' in args:
        raise ValueError('Expected live research hub')
    args[1] = str(release/'app/run_infinity_transport.py')
    args[args.index('--unverified-live-research')+1] = str(release/'research-profile.json')
    return (MARKER+'[Service]\nEnvironment=PYTHONPATH='+str(release/'app/src')+
            '\nExecStart=\nExecStart='+shlex.join(args)+'\n')


def health(profile_id):
    env = dict(line.split('=', 1) for line in (CONFIG/'hub.env').read_text().splitlines() if line)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(CONFIG/'ca.pem'))))
    request = urllib.request.Request('https://172.100.101.72:8766/infinity-research/state',
        headers={'Authorization': 'Bearer '+env['INFINITY_VIEWER_TOKEN']})
    with opener.open(request, timeout=3) as response:
        state = json.loads(response.read(65536))
    if (state.get('profile_id') != profile_id or state.get('source_ip') != '10.10.203.26'
            or state.get('mode') != 'live' or state.get('clinical_ingest_enabled') is not False
            or state.get('clinical_mapping_verified') is not False):
        raise ValueError('Unexpected research endpoint')


def activate(override, data, check):
    """Restore the exact previous override if startup/endpoint checks fail."""
    old = override.read_bytes() if override.exists() else None
    try:
        atomic_write(override, data, 0o644, 0, 0)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', UNIT)
        consecutive = 0
        for _ in range(12):
            time.sleep(1)
            try:
                run('systemctl', 'is-active', '--quiet', UNIT)
                check()
                consecutive += 1
                if consecutive == 3: return
            except (OSError, ValueError, subprocess.SubprocessError):
                consecutive = 0
        raise ValueError('Decoder health check failed')
    except BaseException:
        if old is None:
            override.unlink(missing_ok=True)
        else:
            atomic_write(override, old, 0o644, 0, 0)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', UNIT)
        print('Previous hub configuration restored.', file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise ValueError('Run with sudo on the Homunculus hub')
    network = json.loads(run('ip', '-j', '-4', 'address', 'show', capture_output=True, text=True).stdout)
    if '172.100.101.72' not in {a.get('local') for nic in network for a in nic.get('addr_info', [])}:
        raise ValueError('Wrong VM')
    original, target, override = [DIRECTORY/name for name in (
        '30-continuous-research.conf', '40-bed09-target.conf', '50-bed09-decoder.conf')]
    for path in (CONFIG, DIRECTORY, original, target, override):
        if path.is_symlink(): raise ValueError('Symlinked config refused')
    if any(p not in (original, target, override) for p in DIRECTORY.iterdir()):
        raise ValueError('Unexpected service overrides')
    expected, _, command = target_command(original.read_text(), 'hub')
    if target.read_text() != expected:
        raise ValueError('Apply the BED09 hub switch first')
    if override.exists() and not override.read_text().startswith(MARKER):
        raise ValueError('Foreign decoder override refused')
    run('systemctl', 'is-active', '--quiet', UNIT)
    bundle = Path(__file__).resolve().parent
    files = verified_sources(bundle)
    profile_path = bundle/'research-profile.json'
    if profile_path.is_symlink() or profile_path.stat().st_size > 65536:
        raise ValueError('Invalid profile file')
    profile_data = profile_path.read_bytes()
    manifest = json.loads((bundle/'manifest.json').read_text())
    if hashlib.sha256(profile_data).hexdigest() != manifest['research-profile.json']:
        raise ValueError('Profile digest mismatch')
    profile = json.loads(profile_data)
    if (profile.get('source_ip') != '10.10.203.26' or profile.get('group') != '224.0.2.26'
            or profile.get('schema') != 'homunculus.infinity.decoder-profile.v3'
            or profile.get('unmapped_fields') != ['hr_candidate', 'resp_candidate']):
        raise ValueError('Unexpected BED09 partial profile')
    run(command[0], '-c',
        'import sys; from pathlib import Path; from homunculus.edge.infinity_decoder import read_profile; '
        'from homunculus.edge.infinity_stream import Inventory; from homunculus.edge.infinity_live import LiveResearchView; '
        'LiveResearchView(read_profile(Path(sys.argv[1])), Inventory.read(Path(sys.argv[2])))',
        str(profile_path), str(CONFIG/'inventory.json'),
        env=dict(os.environ, PYTHONPATH=str(bundle/'app/src'), PYTHONDONTWRITEBYTECODE='1'),
        stdout=subprocess.DEVNULL)
    files['research-profile.json'] = profile_data
    fingerprints = {name:hashlib.sha256(data).hexdigest() for name,data in files.items()}
    digest = hashlib.sha256(json.dumps(fingerprints,sort_keys=True).encode()).hexdigest()[:16]
    release = Path('/opt/homunculus-infinity')/('decoder-bed09-'+digest)
    text = decoder_override(command, release).encode()
    if override.exists() and override.read_bytes() == text:
        health(profile['id'])
        print('BED09 partial decoder already active; no restart.')
        return
    print('CHECK OK: hub only; SpO2/PLS raw candidates, HR/RESP unmapped.', flush=True)
    if not args.apply:
        print('Use --apply to activate. Clinical forwarding remains disabled.')
        return
    import grp
    gid = grp.getgrnam('homunculus-infinity-pilot').gr_gid
    if release.exists():
        if release.is_symlink() or any((release/name).is_symlink() or (release/name).read_bytes()!=data
                                      for name,data in files.items()):
            raise ValueError('Existing release differs')
    else:
        release.mkdir(mode=0o755)
        release.chmod(0o755)
        for name,data in files.items():
            path = release/name
            path.parent.mkdir(parents=True,exist_ok=True)
            parent = path.parent
            while parent != release:
                parent.chmod(0o755)
                parent = parent.parent
            atomic_write(path,data,0o640 if name=='research-profile.json' else 0o644,0,gid)
    activate(override,text,lambda:health(profile['id']))
    print('ACTIVE: BED09 partial research decoder; worker unchanged; no duration limit.')
    print('Confirm fresh candidates against the monitor. Units and validity remain unverified.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        print('Decoder activation stopped: '+type(error).__name__+'; credentials not printed.',file=sys.stderr)
        raise SystemExit(2)
