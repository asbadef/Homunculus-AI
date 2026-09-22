"""Target isolation and rollback for the existing deployed research services."""
import importlib.util
import json
import shlex
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest


@pytest.fixture
def helper():
    path = Path(__file__).resolve().parents[2]/'deploy/infinity/switch_bed09.py'
    spec = importlib.util.spec_from_file_location('bed09_switch', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inventory(h):
    return dict(collector_id='infinity-worker-01', interface='10.10.203.101/24', devices=[h.OLD.copy()])


def override(h, role):
    return ('# Homunculus continuous research v1\n[Service]\nExecStart=\nExecStart='
            '/opt/homunculus-infinity/pilot/.venv/bin/python '
            '/opt/homunculus-infinity/research-test/app/run_infinity_transport.py '
            + ('hub' if role == 'hub' else 'collector')
            + ' --inventory '+shlex.quote(str(h.CONFIG/'inventory.json'))+' --capture-payload'
            + (' --unverified-live-research /opt/homunculus-infinity/research-test/research-profile.json'
               if role == 'hub' else '')+'\n')


def test_old_queued_packets_remain_acceptable_only_on_hub(helper):
    h = helper
    original = inventory(h)
    assert h.move_inventory(original, 'hub')['devices'] == [h.OLD, h.NEW]
    assert h.move_inventory(original, 'worker')['devices'] == [h.NEW]
    assert original['devices'] == [h.OLD]
    assert h.move_inventory(h.move_inventory(original, 'worker'), 'worker')['devices'] == [h.NEW]


def test_unexpected_inventory_is_not_silently_replaced(helper):
    original = inventory(helper)
    original['devices'][0]['source'] = '10.10.203.99'
    with pytest.raises(ValueError):
        helper.move_inventory(original, 'worker')


def test_new_hub_profile_does_not_overwrite_release_evidence(helper):
    h = helper
    text, source, command = h.target_command(override(h, 'hub'), 'hub')
    assert source.as_posix() == '/opt/homunculus-infinity/research-test/research-profile.json'
    assert command[command.index('--unverified-live-research')+1] == str(h.CONFIG/'bed09-unverified-profile.json')
    assert '--capture-payload' in text
    assert '--duration' not in text
    with pytest.raises(ValueError):
        h.target_command(override(h, 'hub'), 'worker')


@pytest.mark.parametrize('fail_health', [False, True])
def test_worker_activation_or_restore_without_touching_keys(helper, monkeypatch, tmp_path, fail_health):
    h = helper
    h.CONFIG = tmp_path/'config'
    h.UNITS = tmp_path/'units'
    h.CONFIG.mkdir()
    directory = h.UNITS/'homunculus-infinity-pilot-worker.service.d'
    directory.mkdir(parents=True)
    original = json.dumps(inventory(h)).encode()
    (h.CONFIG/'inventory.json').write_bytes(original)
    (h.CONFIG/'worker.env').write_text('secret untouched')
    (directory/'30-continuous-research.conf').write_text(override(h, 'worker'))
    monkeypatch.setattr(sys, 'argv', ['switch_bed09.py', 'worker', '--apply'])
    monkeypatch.setattr(sys, 'platform', 'linux')
    monkeypatch.setattr(h.os, 'geteuid', lambda: 0, raising=False)
    monkeypatch.setitem(sys.modules, 'grp', SimpleNamespace(getgrnam=lambda _: SimpleNamespace(gr_gid=123)))
    monkeypatch.setattr(h.time, 'sleep', lambda _: None)
    monkeypatch.setattr(h, 'atomic_write', lambda path, data, *unused: path.write_bytes(data))
    calls = []
    def run(*args, **kwargs):
        calls.append(args)
        if args[0] == 'ip':
            return SimpleNamespace(stdout=json.dumps([{'addr_info':[
                {'local':'172.100.101.74'}, {'local':'10.10.203.101'}]}]))
        if fail_health and args[1] == 'is-active' and any(c[1] == 'restart' for c in calls if len(c)>1):
            raise h.subprocess.CalledProcessError(1, args)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(h, 'run', run)
    if fail_health:
        with pytest.raises(ValueError, match='health'):
            h.main()
        assert (h.CONFIG/'inventory.json').read_bytes() == original
        assert not (directory/'40-bed09-target.conf').exists()
        assert sum(c[1] == 'restart' for c in calls if len(c)>1) == 2
    else:
        h.main()
        assert json.loads((h.CONFIG/'inventory.json').read_text())['devices'] == [h.NEW]
        assert (directory/'40-bed09-target.conf').read_text().startswith(h.MARKER)
        # A second apply leaves an already matching, running service alone.
        before = len(calls)
        h.main()
        assert not any(c[1] == 'restart' for c in calls[before:] if len(c)>1)
    assert (h.CONFIG/'worker.env').read_text() == 'secret untouched'
