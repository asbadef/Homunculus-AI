"""Source-only upgrade packaging and narrowly scoped systemd overrides."""
import importlib.util
from pathlib import Path, PurePosixPath
import zipfile

import pytest


def load(name):
    path = Path(__file__).parents[2] / 'deploy/infinity' / (name+'.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('role', ['hub', 'worker'])
def test_override_preserves_original_keys_storage_and_receiver_port(role, monkeypatch):
    update, activation = load('enable_continuous_research'), load('activate_pilot')
    for name in ('RUNTIME', 'CONFIG', 'STATE'):
        monkeypatch.setattr(activation, name, PurePosixPath(getattr(activation, name).as_posix()))
    monkeypatch.setattr(update, 'PILOT', PurePosixPath(update.PILOT.as_posix()))
    value = update.override_text(activation.unit_text(role), PurePosixPath('/opt/homunculus-infinity/research-test'), role)
    assert '--capture-payload' in value
    assert '--unverified-live-research' in value if role == 'hub' else '--unverified-live-research' not in value
    assert '/opt/homunculus-infinity/pilot/.venv/bin/python' in value
    assert '/opt/homunculus-infinity/research-test/app/run_infinity_transport.py' in value
    assert '/var/lib/homunculus-infinity-pilot/' in value
    assert 'ExecStart=\nExecStart=' in value
    assert 'INFINITY_STORAGE_KEY' not in value and 'INFINITY_COLLECTOR_TOKEN' not in value
    assert '--duration' not in value and '--replay' not in value
    assert 'iptables' not in value and 'netplan' not in value


def test_unexpected_unit_not_silently_replaced():
    update = load('enable_continuous_research')
    with pytest.raises(ValueError):
        update.override_text('ExecStart=/unrelated/server\n', Path('/unused'), 'hub')


def test_allowlisted_source_package_and_tamper_detection(tmp_path):
    builder, update = load('build_pilot_bundle'), load('enable_continuous_research')
    path = tmp_path/'bundle.zip'
    digest = builder.build(path)
    assert len(digest) == 64
    folder = tmp_path/'unpacked'
    with zipfile.ZipFile(path) as archive:
        assert not any(name.endswith(('.pcap', '.pem', '.env', '.sqlite')) for name in archive.namelist())
        assert 'enable_continuous_research.py' in archive.namelist()
        archive.extractall(folder)
    sources = update.verified_sources(folder)
    assert set(sources) == update.SOURCE_FILES
    (folder/'app/src/homunculus/edge/infinity_live.py').write_text('changed')
    with pytest.raises(ValueError, match='hash mismatch'):
        update.verified_sources(folder)
