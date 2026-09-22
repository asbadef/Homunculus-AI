"""Move the existing continuous research pilot to BED09; never enables clinical ingest.

Apply hub first, worker second. Keeps keys, journals, routes and source releases.
The existing decoder layout remains an UNVERIFIED hypothesis for the new source.
Current BED09 captures do not match it; packet delivery is the first success check.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone

CONFIG = Path('/etc/homunculus-infinity-pilot')
UNITS = Path('/etc/systemd/system')
MARKER = '# Homunculus BED09 research target v1\n'
OLD = dict(id='infinity-monitor-28', source='10.10.203.28', group='224.0.2.28', port=2050)
NEW = dict(id='infinity-monitor-26', source='10.10.203.26', group='224.0.2.26', port=2050)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, timeout=45, **kwargs)


def move_inventory(data, role):
    if (set(data) != {'collector_id', 'interface', 'devices'}
            or data['collector_id'] != 'infinity-worker-01'
            or data['interface'] != '10.10.203.101/24'
            or data['devices'] not in ([OLD], [NEW], [OLD, NEW])):
        raise ValueError('Unexpected inventory; no changes made')
    # Hub still accepts any already queued old-source events without mixing devices.
    return dict(data, devices=[OLD, NEW] if role == 'hub' else [NEW])


def target_command(text, role):
    if not text.startswith('# Homunculus continuous research v1\n'):
        raise ValueError('Unexpected continuous research override')
    commands = [line[10:] for line in text.splitlines() if line.startswith('ExecStart=') and line[10:]]
    if len(commands) != 1:
        raise ValueError('Expected one research command')
    args = shlex.split(commands[0])
    if (len(args) < 3 or args[0] != '/opt/homunculus-infinity/pilot/.venv/bin/python'
            or not args[1].startswith('/opt/homunculus-infinity/research-')
            or not args[1].endswith('/app/run_infinity_transport.py')
            or args[2] != ('hub' if role == 'hub' else 'collector')
            or '--capture-payload' not in args or '--replay' in args
            or args[args.index('--inventory')+1] != str(CONFIG/'inventory.json')):
        raise ValueError('Unexpected research command or role')
    profile = None
    if role == 'hub':
        i = args.index('--unverified-live-research') + 1
        profile = Path(args[i])
        release = Path(args[1]).parent.parent
        if profile != release/'research-profile.json':
            raise ValueError('Unexpected source profile path')
        args[i] = str(CONFIG/'bed09-unverified-profile.json')
    return MARKER+'[Service]\nExecStart=\nExecStart='+shlex.join(args)+'\n', profile, args


def atomic_write(path, data, mode, uid, gid):
    descriptor, temporary = tempfile.mkstemp(prefix='.bed09-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def hub_health():
    env = dict(line.split('=', 1) for line in (CONFIG/'hub.env').read_text().splitlines() if line)
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(CONFIG/'ca.pem'))))
    request = urllib.request.Request('https://172.100.101.72:8766/infinity-research/state',
        headers={'Authorization': 'Bearer '+env['INFINITY_VIEWER_TOKEN']})
    with opener.open(request, timeout=3) as response:
        data = json.loads(response.read(65536))
    if (data.get('source_ip') != NEW['source'] or data.get('mode') != 'live'
            or data.get('clinical_ingest_enabled') is not False):
        raise ValueError('Hub target check failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('role', choices=('hub', 'worker'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise ValueError('Run with sudo on the intended Ubuntu VM')
    network = json.loads(run('ip', '-j', '-4', 'address', 'show', capture_output=True, text=True).stdout)
    ips = {a.get('local') for nic in network for a in nic.get('addr_info', [])}
    expected = {'172.100.101.72'} if args.role == 'hub' else {'172.100.101.74', '10.10.203.101'}
    if not expected <= ips:
        raise ValueError('Wrong VM for selected role')
    service = 'homunculus-infinity-pilot-'+args.role+'.service'
    directory = UNITS/(service+'.d')
    original = directory/'30-continuous-research.conf'
    override = directory/'40-bed09-target.conf'
    inventory_path = CONFIG/'inventory.json'
    profile_path = CONFIG/'bed09-unverified-profile.json'
    for path in (CONFIG, directory, original, override, inventory_path, profile_path):
        if path.is_symlink():
            raise ValueError('Symlinked configuration refused')
    if any(p.name not in (original.name, override.name) for p in directory.iterdir()):
        raise ValueError('Additional overrides require inspection')
    if override.exists() and not override.read_text().startswith(MARKER):
        raise ValueError('Foreign target override refused')
    run('systemctl', 'is-active', '--quiet', service)
    run('systemctl', 'is-enabled', '--quiet', service)
    inventory = move_inventory(json.loads(inventory_path.read_text()), args.role)
    text, source_profile, command = target_command(original.read_text(), args.role)
    release = Path(command[1]).parent.parent
    sys.path.insert(0, str(release/'app/src'))
    from homunculus.edge.infinity_stream import Inventory
    parsed = Inventory.parse(inventory)
    changes = {inventory_path: (json.dumps(inventory, indent=2)+'\n').encode(), override: text.encode()}
    if args.role == 'hub':
        if source_profile.is_symlink() or source_profile.stat().st_size > 65536:
            raise ValueError('Invalid original profile')
        from homunculus.edge.infinity_decoder import read_profile
        from homunculus.edge.infinity_live import LiveResearchView
        profile = read_profile(source_profile)
        if profile['source_ip'] != OLD['source'] or profile['group'] != OLD['group']:
            raise ValueError('Expected original .28 hypothesis')
        profile.update(id='bed09-unverified-layout-from-28', source_ip=NEW['source'], group=NEW['group'])
        # Preserve original evidence hash and guards. Do NOT invent offsets for BED09.
        LiveResearchView(profile, parsed)
        changes[profile_path] = (json.dumps(profile, indent=2)+'\n').encode()
    if all(path.exists() and path.read_bytes() == data for path, data in changes.items()):
        if args.role == 'hub': hub_health()
        print('Already configured for BED09; no restart performed.')
        return
    print('CHECK OK: '+args.role+' target BED09 10.10.203.26 -> 224.0.2.26:2050', flush=True)
    print('No duration limit. Clinical forwarding=false; BED09 numeric layout remains unsupported.', flush=True)
    if not args.apply:
        print('Apply hub first, worker second, using --apply.')
        return
    import grp
    gid = grp.getgrnam('homunculus-infinity-pilot').gr_gid
    backup = CONFIG/('bed09-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700)
    before = {}
    for path in changes:
        if path.exists():
            stat = path.stat()
            before[path] = (path.read_bytes(), stat.st_mode & 0o777, stat.st_uid, stat.st_gid)
            (backup/path.name).write_bytes(before[path][0])
        else:
            before[path] = None
    try:
        for path, data in changes.items():
            atomic_write(path, data, 0o644 if path == override else 0o640, 0, 0 if path == override else gid)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', service)
        good = 0
        for _ in range(12):
            time.sleep(1)
            try:
                run('systemctl', 'is-active', '--quiet', service)
                if args.role == 'hub': hub_health()
                good += 1
                if good == 3: break
            except (OSError, ValueError, subprocess.SubprocessError):
                good = 0
        if good < 3:
            raise ValueError('Service target health check failed')
    except BaseException:
        for path, previous in before.items():
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, *previous)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'restart', service)
        print('Activation failed; previous configuration restored.', file=sys.stderr)
        raise
    print('ACTIVE: '+args.role+' BED09; verify increasing hub packets separately.')
    print('Backup: '+str(backup))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, IndexError, subprocess.SubprocessError) as error:
        print('BED09 switch stopped: '+type(error).__name__+'; credentials not printed.', file=sys.stderr)
        raise SystemExit(2)
