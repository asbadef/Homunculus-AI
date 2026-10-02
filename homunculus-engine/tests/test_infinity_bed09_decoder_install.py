import importlib.util
from pathlib import Path
import sys

import pytest


@pytest.fixture
def installer(monkeypatch):
    directory = Path(__file__).resolve().parents[2]/'deploy/infinity'
    monkeypatch.syspath_prepend(str(directory))
    spec = importlib.util.spec_from_file_location('bed09_decoder_install', directory/'install_bed09_decoder.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_decoder_override_changes_code_and_profile_not_transport(installer):
    command = ['python', '/old/app/run_infinity_transport.py', 'hub', '--capture-payload',
               '--database', '/private/archive.sqlite', '--unverified-live-research', '/old/profile.json']
    copy = list(command)
    text = installer.decoder_override(command, Path('/new'))
    assert 'archive.sqlite' in text and 'PYTHONPATH=' in text
    assert 'research-profile.json' in text
    assert command == copy
    with pytest.raises(ValueError):
        installer.decoder_override(command + ['--replay'], Path('/new'))


@pytest.mark.parametrize('existing', [False, True])
def test_endpoint_failure_restores_previous_override(installer, monkeypatch, tmp_path, existing):
    path = tmp_path/'50-bed09-decoder.conf'
    if existing: path.write_bytes(b'old exact bytes')
    monkeypatch.setattr(installer, 'atomic_write', lambda path,data,*args:path.write_bytes(data))
    monkeypatch.setattr(installer.time, 'sleep', lambda _:None)
    calls = []
    monkeypatch.setattr(installer, 'run', lambda *args,**kwargs:calls.append(args))
    def fail(): raise ValueError('wrong profile')
    with pytest.raises(ValueError, match='health'):
        installer.activate(path,b'new',fail)
    assert (path.read_bytes()==b'old exact bytes') if existing else not path.exists()
    assert sum(call[1]=='restart' for call in calls)==2
    assert all('worker' not in str(call) for call in calls)
