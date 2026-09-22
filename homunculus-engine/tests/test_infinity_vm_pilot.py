"""Synthetic PowerShell parser/PCAP transport tests; never connect to a VM."""
import base64
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
POWERSHELL = shutil.which("powershell.exe")
pytestmark = pytest.mark.skipif(not POWERSHELL, reason="Windows PowerShell required")


def packet(body=b"synthetic", *, flags=0, options=b""):
    udp = struct.pack("!HHHH", 1234, 2050, len(body) + 8, 0) + body
    return (struct.pack("!BBHHHBBH4s4s", 0x45 + len(options)//4, 0,
                        20 + len(options) + len(udp), 1, flags, 64, 17, 0,
                        bytes([192, 0, 2, 10]), bytes([239, 2, 3, 4])) + options + udp)


def run_ps(tmp_path, source, extra_env=None):
    script = tmp_path / "synthetic-test.ps1"
    script.write_text("$ErrorActionPreference='Stop'\n" + source, encoding="utf-8-sig")
    env = dict(os.environ, PILOT_WORKER=str(SCRIPTS / "infinity_vm_worker.ps1"),
               PILOT_WRAPPER=str(SCRIPTS / "start_infinity_vm_pilot.ps1"))
    env.update(extra_env or {})
    result = subprocess.run([POWERSHELL, "-NoProfile", "-NonInteractive", "-File", str(script)],
                            capture_output=True, text=True, timeout=20, env=env)
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_actual_powershell_ipv4_parser(tmp_path):
    good = packet()
    malformed_udp = bytearray(good)
    malformed_udp[25] = 7  # illegal UDP length
    ipv6 = bytearray(good)
    ipv6[0] = 0x65
    fixtures = [good, packet(options=b"\x00" * 4), packet(flags=0x2000),
                good[:15], good[:-1], bytes(malformed_udp), bytes(ipv6), good + b"trailer"]
    source = tmp_path / "headers.json"
    source.write_text(json.dumps([base64.b64encode(p).decode() for p in fixtures]))
    output = run_ps(tmp_path, r"""
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:PILOT_WORKER,[ref]$tokens,[ref]$errors)
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
$results=@(foreach ($encoded in (Get-Content -LiteralPath $env:FIXTURE -Raw | ConvertFrom-Json)) {
    $bytes=[Convert]::FromBase64String($encoded)
    $header=Get-InfinityIPv4Header $bytes $bytes.Length
    [pscustomobject]@{header=$header}
})
$results | ConvertTo-Json -Depth 4 -Compress
""", {"FIXTURE": str(source)})
    rows = [entry['header'] for entry in json.loads(output)]
    assert len(rows) == 8
    for row in rows[:2]:
        assert row["Source"] == "192.0.2.10" and row["DestinationPort"] == 2050
        assert "data" not in row and not row["Fragmented"]
    assert rows[2]["Fragmented"] and rows[2]["DestinationPort"] is None
    assert all(not row for row in rows[3:])  # PowerShell AutomationNull serializes as {}.


def test_wrapper_writes_valid_raw_pcap_and_closes_session(tmp_path):
    payload = packet()
    fixture = tmp_path / "remote.json"
    fixture.write_text(json.dumps({
        "summary": {"schema": "homunculus.infinity-vm-pilot.v1", "payload_packets": 1,
                    "payload_bytes": len(payload), "capture_status": "completed",
                    "selected_packets": 1, "clinical_ingest_enabled": False,
                    "clinical_mapping_verified": False},
        "packet_records": [{"seconds": 42, "microseconds": 123456,
                            "data": base64.b64encode(payload).decode()}]}))
    with tempfile.TemporaryDirectory(prefix="homunculus-synthetic-pilot-") as external:
        output = run_ps(tmp_path, r"""
function New-PSSession { [pscustomobject]@{Synthetic=$true} }
function Invoke-Command { Get-Content -LiteralPath $env:FIXTURE -Raw | ConvertFrom-Json }
function Remove-PSSession { $global:pilotTestClosed=$true }
$credential=[pscredential]::new('synthetic-user',(ConvertTo-SecureString 'synthetic-only' -AsPlainText -Force))
& $env:PILOT_WRAPPER -DeviceIp '192.0.2.10' -CapturePayload -Credential $credential
if (-not $global:pilotTestClosed) { throw 'Session leaked' }
""", {"FIXTURE": str(fixture), "TEMP": external, "TMP": external})
        assert "Report saved:" in output
        summaries = list(Path(external).rglob("summary.json"))
        assert len(summaries) == 1
        summary = json.loads(summaries[0].read_text())
        capture = summaries[0].with_name("infinity-ipv4.pcap")
        raw = capture.read_bytes()
        assert struct.unpack("<IHHIIII", raw[:24]) == (0xA1B2C3D4, 2, 4, 0, 0, 65535, 101)
        assert struct.unpack("<IIII", raw[24:40]) == (42, 123456, len(payload), len(payload))
        assert raw[40:] == payload
        assert not summary["clinical_ingest_enabled"] and not summary["clinical_mapping_verified"]
        assert "packet_records" not in summary and "synthetic-only" not in output
        tshark = Path("C:/Program Files/Wireshark/tshark.exe")
        if tshark.is_file():
            parsed = subprocess.run([str(tshark), "-n", "-r", str(capture), "-T", "fields",
                                     "-e", "ip.src", "-e", "udp.dstport"],
                                    capture_output=True, text=True, timeout=10, check=True)
            assert parsed.stdout.strip() == "192.0.2.10\t2050"


@pytest.mark.parametrize("option", ["CapturePayload", "ProbeDevices"])
def test_payload_or_probes_without_allowlist_fail_before_signin(tmp_path, option):
    output = run_ps(tmp_path, r"""
function Get-Credential { throw 'Unexpected credential request' }
try { $options=@{}; $options[$env:TEST_OPTION]=$true; & $env:PILOT_WRAPPER @options; throw 'Unexpected success' }
catch { if ($_.Exception.Message -notmatch 'Select 1 to 13') { throw }; 'Rejected without connection' }
""", {"TEST_OPTION": option})
    assert "Rejected without connection" in output


def test_failed_remote_worker_always_closes_session(tmp_path):
    output = run_ps(tmp_path, r"""
function New-PSSession { [pscustomobject]@{Synthetic=$true} }
function Invoke-Command { throw 'Synthetic remoting failure' }
function Remove-PSSession { $global:pilotTestClosed=$true }
$credential=[pscredential]::new('synthetic-user',(ConvertTo-SecureString 'synthetic-only' -AsPlainText -Force))
try { & $env:PILOT_WRAPPER -Credential $credential; throw 'Unexpected success' }
catch { if ($_.Exception.Message -ne 'Synthetic remoting failure') { throw } }
if (-not $global:pilotTestClosed) { throw 'Session leaked' }
'Session closed after failure'
""")
    assert "Session closed after failure" in output


def test_default_mode_saves_only_metadata_even_if_remote_contains_payload(tmp_path):
    with tempfile.TemporaryDirectory(prefix="homunculus-synthetic-pilot-") as external:
        run_ps(tmp_path, r"""
function New-PSSession { [pscustomobject]@{Synthetic=$true} }
function Invoke-Command {
    [pscustomobject]@{summary=[pscustomobject]@{
        schema='homunculus.infinity-vm-pilot.v1';capture_status='capture_unavailable'
        selected_packets=0;clinical_ingest_enabled=$false;capture_error_code='AccessDenied'
    };packet_records=@([pscustomobject]@{data='DO-NOT-SAVE-SYNTHETIC-PAYLOAD'})}
}
function Remove-PSSession {}
$credential=[pscredential]::new('synthetic-user',(ConvertTo-SecureString 'synthetic-only' -AsPlainText -Force))
& $env:PILOT_WRAPPER -Credential $credential
""", {"TEMP": external, "TMP": external})
        files = [p for p in Path(external).rglob("*") if p.is_file()]
        assert len(files) == 1 and files[0].name == "summary.json"
        raw = files[0].read_text()
        assert "DO-NOT-SAVE" not in raw and "packet_records" not in raw
        assert json.loads(raw)["capture_status"] == "capture_unavailable"


def test_capture_output_inside_repository_is_rejected(tmp_path):
    output = run_ps(tmp_path, r"""
function New-PSSession { [pscustomobject]@{Synthetic=$true} }
function Invoke-Command {
    [pscustomobject]@{summary=[pscustomobject]@{schema='homunculus.infinity-vm-pilot.v1'}}
}
function Remove-PSSession { $global:pilotTestClosed=$true }
$credential=[pscredential]::new('synthetic-user',(ConvertTo-SecureString 'synthetic-only' -AsPlainText -Force))
try { & $env:PILOT_WRAPPER -Credential $credential; throw 'Unexpected success' }
catch { if ($_.Exception.Message -notmatch 'outside repositories') { throw } }
if (-not $global:pilotTestClosed) { throw 'Session leaked' }
'Repository output blocked'
""", {"TEMP": str(tmp_path), "TMP": str(tmp_path)})
    assert "Repository output blocked" in output


def test_exclusion_reasons_distinguish_own_traffic_from_network_and_allowlist(tmp_path):
    output = run_ps(tmp_path, r"""
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:PILOT_WORKER,[ref]$tokens,[ref]$errors)
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
@(
    (Get-InfinitySourceDecision '192.0.2.220' '192.0.2.220'),
    (Get-InfinitySourceDecision '198.51.100.10' '192.0.2.220'),
    (Get-InfinitySourceDecision '192.0.2.10' '192.0.2.220'),
    (Get-InfinitySourceDecision '192.0.2.10' '192.0.2.220' @('192.0.2.11')),
    (Get-InfinitySourceDecision '192.0.2.10' '192.0.2.220' @('192.0.2.10'))
) | ConvertTo-Json -Compress
""")
    assert json.loads(output) == ["capture_adapter_source", "outside_source_subnet", "selected",
                                  "outside_device_allowlist", "selected"]


@pytest.mark.parametrize("fault", ["", "AddMembership", "DropMembership", "Bind"])
def test_pds_subscription_uses_selected_interface_and_always_closes(tmp_path, fault):
    output = run_ps(tmp_path, r"""
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:PILOT_WORKER,[ref]$tokens,[ref]$errors)
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
$global:pilotFakeSocket=[pscustomobject]@{ExclusiveAddressUse=$false;ReceiveBufferSize=0;BoundPort=0;LocalInterface='';
    Events=(New-Object 'System.Collections.Generic.List[string]')}
$global:pilotFakeSocket | Add-Member ScriptMethod Bind {
    param($endpoint)
    $this.Events.Add('Bind'); $this.BoundPort=$endpoint.Port
    if ($env:FAULT -eq 'Bind') { throw 'Synthetic bind fault' }
}
$global:pilotFakeSocket | Add-Member ScriptMethod SetSocketOption {
    param($level,$option,$membership)
    $this.Events.Add($option.ToString()); $this.LocalInterface=$membership.LocalAddress.ToString()
    if ($env:FAULT -eq $option.ToString()) { throw 'Synthetic membership fault' }
}
$global:pilotFakeSocket | Add-Member ScriptMethod Dispose { $this.Events.Add('Dispose') }
function New-InfinityUdpSocket { $global:pilotFakeSocket }
try {
    $subscription=Open-InfinityPdsSubscription '239.2.3.4' '192.0.2.220' @('192.0.2.10')
    Close-InfinityPdsSubscription $subscription
} catch { if ($env:FAULT -notin @('AddMembership','Bind')) { throw } }
$global:pilotFakeSocket | ConvertTo-Json -Depth 4 -Compress
""", {"FAULT": fault})
    result = json.loads(output)
    assert result["ExclusiveAddressUse"] and result["BoundPort"] == 2050
    assert result["Events"][-1] == "Dispose"
    if fault != "Bind":
        assert result["LocalInterface"] == "192.0.2.220"
        assert "AddMembership" in result["Events"]
    if fault not in ("AddMembership", "Bind"):
        assert result["Events"] == ["Bind", "AddMembership", "DropMembership", "Dispose"]


def test_pds_membership_rejects_unicast_control_groups_and_ambiguous_sources(tmp_path):
    output = run_ps(tmp_path, r"""
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($env:PILOT_WORKER,[ref]$tokens,[ref]$errors)
foreach ($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
$rejected=0
foreach ($group in @('192.0.2.10','224.0.0.1','ff02::1','240.1.2.3')) {
    try { Assert-InfinityPdsGroup $group @('192.0.2.10') } catch { $rejected++ }
}
try { Assert-InfinityPdsGroup '239.2.3.4' @('192.0.2.10','192.0.2.11') } catch { $rejected++ }
try { Assert-InfinityPdsGroup '239.2.3.4' @() } catch { $rejected++ }
Assert-InfinityPdsGroup '239.2.3.4' @('192.0.2.10')
$rejected
""")
    assert output.strip() == "6"
