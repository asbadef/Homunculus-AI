# Infinity VM gateway pilot

The requested route is bedside monitors -> collector VM -> Homunculus. This pilot
implements the bounded **network evidence collection** step, not a clinically validated
Infinity Gateway replacement. It cannot yet turn proprietary PDS data into trusted
observations or generate clinical analyses. Existing candidate byte offsets remain
unverified and must not enter `/ingest`, the patient board, or clinical alerts.

## Site configuration and current evidence

### New central-display lead, 2026-09-21

The user reports that bedside monitors are displayed together on a Drager main
screen at **10.10.203.232** and asks whether that system can be the data source.
This address was not identified in the earlier collector inspection. Its product,
software version, operating system, enabled export options and relationship to
WIN-DRGGW01 remain unknown. No connection, service scan, login, software installation
or capture on this clinical station has been performed by this investigation.

Follow-up identification: the user supplied "Infinity CentralStation / Infinity
Telemetry System / Infinity M300 / software VF8". This matches the VF8 product/manual
family; it does not establish the running patch version, enabled options or that
M300 devices are actually in the target fleet. The vendor-hosted
[VF8 manual, Greek edition](https://www.draeger.com/Content/Documents/Products/infinity-centralstation-infinity-m300-sw-vf8-ifu-ms20994-el.pdf)
specifies HL7 through Infinity Gateway Suite (printed p.22). It also describes
retrospective waveform file export to compatible third-party equipment and a
configured destination (p.234); this is not evidence of a live numeric API at .232.
Next inspect existing integration configuration read-only with the authorized
operator/biomedical team; do not infer a Gateway installation from the manual title.

Identify the product/version from About/System Information first. The official
[CentralStation Wide product page](https://www.draeger.com/en-us_us/Products/Infinity-CentralStation)
describes central display, retrospective data, reports and non-diagnostic full
disclosure ECG export. That does not establish a continuous numeric API on this
particular installation. The separate
[Gateway Suite product](https://www.draeger.com/en-us_us/Products/Infinity-Gateway-Suite)
documents HL7 and WinAccess integration; its options must not be inferred from
the presence of a central screen. Prefer an existing supported, enabled export
if found. Otherwise, receiving the same monitor multicast on our separate collector
still requires native decoding. Do not deploy our worker on the active central
station merely to gain network visibility.

### Selected monitor changed to .28, 2026-09-21

The user selected **10.10.203.28** for the next test. Report
`%TEMP%\HomunculusDiagnostics\infinity-pilot-7de6521161d64482afc631bbb80450ec\summary.json`
was read after completion. Its 30.119-second explicit-ICMP run selected exactly
one 60-byte IPv4 protocol-1 packet from .28 to the collector .220. The ping was
successful (2 ms). No selected UDP packets or payload were captured, and no PDS
membership was requested. The NIC was up; 65 packets were observed, with 63
collector-source packets and one .250 packet excluded. Kernel drop counts remain
unknown. Collector TCP checks to Homunculus 2575 and 8080 succeeded again.

This establishes unicast reachability only. It neither identifies .28's PDS group
nor proves that the monitor is not streaming. The prior .27 group's reference-zero
entry in the membership snapshot is not evidence of an active .28 subscription.
Do not repeat the same no-membership capture expecting it to identify an unseen
stream. Next inspect the switch's source/group forwarding information if available,
or a bounded header capture on an authorized mirror of .28's port. The user has
been asked for switch make/model, management address and available access. Do not
derive .28's multicast group merely by replacing the last octet of .27's group.

### Cisco switch evidence for the .28 test, 2026-09-21

The user supplied read-only outputs from Catalyst 3650 `2ACCSW-S2.3`:

- MAC `0030.e607.3701`, associated with .28 in the collector report, is dynamically
  learned in VLAN **203** through `Gi3/0/47`. Whether this is a direct endpoint port
  or an intermediate link has not been inspected.
- VLAN 203 IGMP snooping explicitly lists **224.0.2.28**, with v2 receiver port
  `Gi3/0/34`. This is an observed candidate group, not a guessed address. Receiver
  membership alone does not prove that .28 is the group's packet source.
- The same receiver port subscribes to 224.0.2.{23,24,25,26,27,29,31,32,33,34,37,38}.
  In particular .38 is an additional group, not a newly verified device/IP.
  The identity of Gi3/0/34 has not been established as CentralStation .232.
- VLAN 203 querier is shown as `10.10.203.250`, IGMPv2, via `Po46`.
- `show ip arp 10.10.203.28` returned no row; do not treat that as endpoint absence.

Next: the existing VM worker can temporarily join the observed group 224.0.2.28,
allow only source 10.10.203.28 and record headers for 30 seconds. Verify the raw-IP
flow source, destination, UDP port and membership cleanup in its resulting summary.
No switch configuration change, SPAN session or clinical payload capture is needed
for this next membership test. Success will establish transport, not decoding.

### .28 membership test succeeded, 2026-09-21

The completed report at
`%TEMP%\HomunculusDiagnostics\infinity-pilot-cb09d9ea95bc461ca5cc49248d83358e\summary.json`
was inspected. Over 30.132 seconds it selected **151 UDP packets / 135,584 IP bytes**
from **10.10.203.28:2564 to 224.0.2.28:2050**. Thus this source/group/port mapping
is now observed in packet headers, not merely inferred from the snooping table.
The first/last selected timestamps were 07:04:59.0198433 and 07:05:28.9104657 UTC.
The separate membership socket counted 150 selected datagrams and no other sources;
different socket/run boundaries do not by themselves prove loss. Capture drop
statistics are unavailable. No malformed or fragmented packets or limit stop were
reported. Membership removal and socket closure were both confirmed.

Collector-to-Homunculus TCP checks on 2575 and 8080 still passed. Payload capture
was off, so this run cannot decode HR/SpO2/RESP or establish measurement validity.
The capture is finished; there is no ongoing collection from this finite test.
Next step is a bounded full-payload research capture for this now-verified source
and group, paired with contemporaneous display values/device time and measurement
state. Keep raw data outside repositories. Do not assume the old .27 byte layout.

Reader note: PowerShell 5.1 ConvertFrom-Json rejects the nested firewall enum
serialization's case-distinct `value`/`Value` keys. Python json.load successfully
read this report; this reader compatibility issue is not a capture failure.

### .28 full-payload capture and first structure analysis, 2026-09-21

Report `infinity-pilot-449cd61513d3499dbdadc35ecd9df9a5/summary.json` completed in
60.106 seconds. The PCAP holds 301 RAW IPv4 records, 270,464 IP bytes, 275,304 file
bytes. SHA-256 was verified before/after analysis:
`0b8a286fc16426816ff79ce47a3cdf0d1c93c0be178f9bdfab4c2ecd0a8b93ef`.
The flow is .28:2564 -> 224.0.2.28:2050, first/last receive times
07:10:12.8167226 / 07:11:12.5198401 UTC. Membership and socket cleanup succeeded.
The separate UDP subscription counted 300; kernel/NIC loss remains unknown.

Structure-only analysis found 181 payloads of 676 bytes, 60 of 898 bytes and 60
of 1430 bytes. Prior research guard `0206` occurs at offset 738 in all 898-byte
payloads and offset 952 in all 1430-byte payloads. In the latter, `01be` occurs at
1198 and `1905` at both 928 and 1414. `1e09` was not found. These are byte-pattern
occurrences only, not verified parameter identifiers. Old .27 offsets were not
applied, no profile hash scope was widened and no numeric/waveform values were
published. Multiple occurrences make fixed-offset assumptions especially weak.

The user confirmed that contemporaneous displayed values were **not noted**, but
can note them for another run. Thus retrospective clinical field validation is
not possible from this capture alone. Structure metadata is in the external
`structure-analysis.json`; originals and analysis were hash-verified and archived
at `C:\Users\User\Desktop\Homunculus-Captures\infinity-vm-28-20260921-449cd615`.
Next bounded capture should include independently recorded screen values and
observation times; number matching alone will still not establish units/status/
device-time semantics or clinical validity.

### Previously inspected host inventory

- Collector host: `WIN-DRGGW01`, management `10.10.200.116`, monitor NIC
  `10.10.203.220/24`, Windows Server 2012 R2.
- Homunculus host: `172.100.101.72`; existing documented ports: MLLP 2575,
  web 8080, SSH 22. These ports answered workstation TCP connections on 2026-09-19.
  That does not prove the collector-to-Homunculus path or application readiness.
- `Draeger\Infinity Gateway` registry component names exist. No running Gateway
  service was found in the inspected reports. No EXE/DLL/MSI/CHM was found by the
  bounded `C:\GWdraeger` scan. Neither absence from this scan nor registry presence
  determines license validity or proves whether an installation exists elsewhere.
- No authenticated SSH access to Homunculus has been established by this agent.
  No collector service or new receiver has been deployed.

## Run the first observation

Run on the Windows workstation, in the same PowerShell where the authorized server
credential exists. The worker is sent through WinRM and runs in memory on the VM;
the script does not need to be copied to the VM or installed there.

```powershell
& '.\homunculus-engine\scripts\start_infinity_vm_pilot.ps1' -Credential $dragerCred
```

If no credential is supplied, a local Windows credential prompt appears. Passwords
are not written to files. The existing WinRM configuration must already permit the
connection; this script never changes TrustedHosts or authentication policy.

The default mode watches the selected `/24` adapter for 30 seconds, aggregates
IPv4 flow headers, discards payloads, then probes only the requested Homunculus
host's ports 2575 and 8080 with empty TCP connections. A port response is **not** an
HL7 ACK or a successful clinical delivery. The observation creates
`%TEMP%\HomunculusDiagnostics\infinity-pilot-<id>\summary.json` on the workstation.

The worker also snapshots the selected NIC's MAC/index, cached neighbors, routes,
current multicast memberships and firewall profile state. These reads do not verify
the hypervisor VLAN or change network configuration. Bounded source counters and
exclusion reasons distinguish the collector's own packets, other subnets and sources
outside an explicit allowlist; they never expose packet payloads.

To distinguish unicast reception from multicast reception, an explicit optional test
sends **one ICMP echo per supplied IP** while observation is active:

```powershell
& '.\homunculus-engine\scripts\start_infinity_vm_pilot.ps1' `
  -Credential $dragerCred -DeviceIp '<identified-device-ip>' -ProbeDevices
```

This mode is labelled `ipv4-pilot-with-explicit-icmp-probes`, not passive. It does not
send application commands or join multicast groups. A ping reply verifies neither
device type nor measurement decoding; lack of a reply can reflect ICMP filtering.

### First actual VM result, 2026-09-19

The 30-second run on `10.10.203.220` completed without a reported capture error:
62 IPv4 packets were observed, all 62 excluded by the source filter, zero selected,
zero malformed and no configured limit reached. The original report did not separate
exclusion reasons, so it does not identify those 62 sources or their cause. No payload
was retained. Collector-origin TCP checks to `172.100.101.72:2575` and `:8080` both
succeeded. The user's Linux output also showed the bridge/web containers running and
API/Postgres healthy. Native monitor traffic and clinical forwarding remain unverified.

Raw sockets require administrative permission on the collector. `RCVALL_IPLEVEL`
observes packets already reaching the NIC without requesting promiscuous mode.
Without the explicit subscription option, the worker sends no monitor commands or
multicast joins. Neither mode changes routing or
firewall settings, creates no VM files, and closes its socket on completion/failure.
IPv4 headers are inspected in memory; Ethernet/ARP and IPv6 are not captured.
VM/switch multicast filtering or host firewall policy may still prevent receipt.
An empty capture is not proof that the monitor cannot export data.

### Explicit subscription to an already observed PDS group

The calibrated run on 2026-09-19 received one IPv4 ICMP packet from each of
`10.10.203.27`, `.26`, `.31` and `.32`; all four ping probes succeeded. No UDP flow
from these sources was observed. The selected NIC was `Infinity`, index 12, with
only `224.0.0.1` and `224.0.0.252` listed as multicast memberships. The neighbor cache
associated `.27` with the same MAC as the earlier direct Kappa test. This supports
unicast accessibility; it neither proves the other devices' models nor identifies
the cause of missing multicast traffic.

The earlier direct capture actually observed `.27` sending PDS traffic to
`224.0.2.27:2050`. Do not derive groups for other devices from their IP addresses.
To test this known flow, use:

```powershell
& '.\homunculus-engine\scripts\start_infinity_vm_pilot.ps1' `
  -DeviceIp '10.10.203.27' -JoinPdsGroup '224.0.2.27' -Duration 30
```

This explicitly requests a temporary multicast membership on `10.10.203.220`.
It can emit IGMP membership traffic and cause the network to deliver the group's
traffic to this VM. It is **not passive**. It sends no application message to the
monitor and does not change monitor configuration, persistent network settings,
firewall policy or clinical services. It does not bypass multicast filtering.

The socket exclusively binds UDP 2050 and refuses a port already in use. Membership
is dropped and the socket closed in `finally`; failures during opening also dispose
the socket. One explicit source is required. Local-control multicast groups and
unicast addresses are rejected. The report records requested group/interface,
join and cleanup status, membership snapshot, raw IP flow destinations and separate
UDP receiver counters. UDP receiver counters alone do not prove a datagram's
multicast destination; inspect the raw flow headers too. Payload retention remains
off unless separately requested with `-CapturePayload`.

See [Microsoft multicast socket semantics](https://learn.microsoft.com/en-us/dotnet/api/system.net.sockets.multicastoption)
for interface-specific joining and dropping memberships. Synthetic tests cover
group validation, exclusive binding and cleanup after bind/join/drop failures;
real delivery still requires the on-VM run.

### Successful on-VM subscription, 2026-09-19

The subsequent actual 30-second subscription completed successfully on the collector.
Raw-IP observation recorded **151 UDP packets**, 64,814 IP bytes, from
`10.10.203.27:2564` to `224.0.2.27:2050`; first/last receive timestamps were
09:49:58.0484370 and 09:50:27.8765713 UTC. The independent UDP socket counted 150
datagrams from the selected source and zero from others. Those counters observe
different queues and can differ at the run boundary; they do not establish a
kernel/network packet-loss count. Drop statistics remain unknown.

Membership was present during the run, explicitly removed on completion, and the
socket closed. Both collector-to-Homunculus TCP checks still succeeded. Thus the
selected native Kappa flow can reach this VM using the existing monitor NIC and an
explicit subscription. This does not prove other devices' groups, all Gateway
features, or clinical decoding. Payload capture was disabled and no measurement
values were recorded by this run. About five packets per second is transport
cadence, not a measurement-update rate.

The next bounded research run for this same source can enable payload capture:

```powershell
& '.\homunculus-engine\scripts\start_infinity_vm_pilot.ps1' `
  -DeviceIp '10.10.203.27' -JoinPdsGroup '224.0.2.27' -CapturePayload -Duration 60
```

Record contemporaneous displayed values and device clock separately without patient
identifiers. Matching numbers alone is not sufficient to validate field semantics,
units, status codes or patient association. Do not reuse the earlier test's fixed
payload layout unless the new capture's actual structure has been checked.

### First full VM capture and offline structure check

The 60-second targeted capture completed on 2026-09-19 and saved 301 complete RAW
IPv4 datagrams outside the repository. File size was 134,094 bytes; SHA-256 matched
the collector summary before and after analysis. The source/destination was again
`10.10.203.27:2564 -> 224.0.2.27:2050`, spanning 59.937495 seconds. No malformed,
truncated or fragmented datagrams were found in the saved file. This does not
measure packets lost before capture. Membership and socket cleanup were reported
successful; the separately drained UDP socket counted 300 datagrams.

UDP payload lengths were **346 bytes (241 packets)** and **624 bytes (60 packets)**.
The previous active self-test had 622/1430-byte payloads. None of the four previously
used two-byte guard patterns occurred in the new payloads. No earlier byte-offset
profile was extended to accept this capture, and no candidate vital signs were
published. This structure difference does not by itself establish standby, invalid
measurements, a firmware change or a different clinical state; contemporaneous
screen values/device state are still needed.

The restricted tshark protocol list originally omitted `raw`, causing this link type
to produce no IP rows in the offline reader. `raw` is now explicitly enabled for
discovery/research. A synthetic LINKTYPE_RAW regression test checks both readers
against actual tshark. All 49 discovery/research tests passed after the correction.
The first empty structure report is invalid and is explicitly superseded by the
corrected external `structure-analysis-v2.json`; the PCAP was not modified.

Limits: duration 1–300 seconds, at most 200,000 received packets examined, 256 distinct
flows retained. Capture failure, malformed packets, fragment counts, excluded packets,
flow overflow and limit stops are explicit. Kernel/NIC drop counts are unavailable
and are reported as unknown, never zero. Receive timestamps come from the VM's clock,
not the monitor's measurement clock. No values appear as patient measurements.

## Optional, targeted research capture

Only after source IPs have been identified, request full IPv4 datagrams for selected
monitors. Confirm the devices and authorized test scope before using this on clinical
traffic. No default monitor IP is inferred from the previous laptop test.

```powershell
# Replace the documentation address with an identified, authorized monitor IP.
& '.\homunculus-engine\scripts\start_infinity_vm_pilot.ps1' `
  -Credential $dragerCred -DeviceIp '<monitor-ip>' -CapturePayload -Duration 60
```

The allowlist must contain 1–13 devices on the selected `/24`; full datagrams are
retained only for unfragmented UDP destination ports 2000, 2050, 2100 and 2150.
Capture stops at 5,000 datagrams or 4 MiB. The memory buffer travels over authenticated
WinRM when the finite run ends, then the workstation writes a LINKTYPE_RAW (101) PCAP
and a SHA-256 in the summary. This is a bounded batch transfer, **not a real-time
forwarder**. PCAP contains network payloads and may contain clinical/personal data.
Keep it outside repositories; never upload it to external model services by default.
The wrapper rejects repository and reparse-point output ancestors.

The existing discovery/research tools can read the resulting PCAP. A previous
research profile intentionally rejects a new capture hash; it must not be widened
automatically or treated as protocol validation. A new capture requires an explicitly
reviewed research profile. The pilot itself has no candidate-value decoder.

## Gates for permanent forwarding

1. Verify monitor-origin UDP actually reaches the collector and identify each source.
2. Establish a verified native decoder/SDK or a functioning, licensed vendor output.
   Verify value, unit, validity flags, device time, device identity, disconnect/stale
   behavior, duplicates and independent known test signals. Patient identity is separate.
3. Establish authenticated deployment access to Homunculus. Native research packets
   require a separate restricted receiver; do not send them to the existing HL7 port
   or FHIR `/ingest`. Define encryption, retention, bounded buffering and replay rules
   before making that receiver persistent.
4. Enable clinical forwarding only for independently validated mappings and confirmed
   patient assignments. Unknown mappings remain excluded. Test single-device first,
   then device changes and all 13 sources independently.

Do not start legacy Dräger executables, restore vendor services, change licensed
options, or assume that Sentinel/USB sharing proves a valid Gateway installation.

## References and verification

- [Microsoft raw socket documentation](https://learn.microsoft.com/en-us/windows/win32/winsock/tcp-ip-raw-sockets-2)
  and [SIO_RCVALL semantics](https://learn.microsoft.com/en-us/windows/win32/winsock/sio-rcvall).
- [Wireshark 4.0.17 release notes](https://www.wireshark.org/docs/relnotes/wireshark-4.0.17.html):
  this is the last release supporting Windows 8.1/Server 2012. The pilot avoids an
  old capture-driver installation on this VM; compatibility of its raw socket path
  must still be tested on the actual VM.

Synthetic tests execute the PowerShell IPv4/UDP parser and exercise the local wrapper
with mocked remoting, write and reopen a RAW PCAP using actual tshark, verify session
cleanup and reject payload capture without an allowlist. They do not establish actual
VM capture capability, successful remote deployment or clinical correctness.
