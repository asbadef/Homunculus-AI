# Infinity: 100 monitors on one VLAN

Decision proposal, 2026-09-20. The user confirmed that all 100 target monitors
share one VLAN. This document describes the intended deployment; it is not a
claim that a validated decoder, production collector or failover system exists.

Implementation update: the [research transport and deployment package](../deploy/infinity/README.md)
now provides the multi-device collector, encrypted queue, HTTPS receiver and transport
dashboard. Clinical decoding, live fleet validation and automated failover remain
outstanding. The current single-collector service must not be described as the
complete architecture below.

## Network decision

Use one dedicated active collector VM, with a standby collector on a different
physical host where available. Each VM has a monitor-VLAN NIC and a management/
uplink NIC. Assign unique, reserved addresses; do not reuse the current collector's
10.10.203.220 address. The monitor NIC has no default route. The management NIC
provides the route to Homunculus at 172.100.101.72. Verify the actual return route.
Disable IP forwarding, bridging and NAT between the two interfaces: the collector
is an application endpoint, not the monitor network's router.

Do not change the monitors' Default Route to Homunculus or to a collector.
A network default gateway routes traffic to other networks; it does not select
a measurement export application or translate Infinity packets into HL7.
Same-VLAN reception uses the collector's explicit multicast membership on its
monitor interface. Verify VLAN attachment, switch IGMP snooping/querier behavior,
virtual-switch delivery and host filtering. Merely assigning a matching IP subnet
does not prove those conditions.

Adding a monitor NIC directly to Homunculus can provide the same network access,
provided a collector process joins the groups on that NIC. It does not remove the
decoder requirement. Dedicated collectors are preferred here to separate packet
handling, service updates and buffering from the central application. One VM per
monitor is not justified by current evidence. Two VMs on the same physical host
do not provide host-failure protection.

## Intended data path

```text
100 Infinity monitors, one VLAN
              |
      observed multicast groups
              |
       active collector <--- standby takeover (to implement)
              |
     verified decoder + bounded persistent queue
              |
       authenticated encrypted uplink
              |
   Homunculus ingest -> storage -> live display
```

Keep a separate research path for undecoded packets. Native PDS bytes must not be
sent to the existing HL7/MLLP listener on port 2575 or submitted as observations.
After validation, reuse the existing Observation/forwarding pipeline where its
semantics fit. Unknown values, units or validity states remain excluded.

## What the site evidence establishes

The 2026-09-19 collector on 10.10.203.220 received 301 full IPv4 datagrams during
the 60-second subscription to 224.0.2.27:2050 from 10.10.203.27:2564. No monitor
default-gateway change was needed for this test. The file integrity was verified.
Its 346/624-byte UDP payload layouts differ from the earlier 622/1430-byte test.
Measurement fields and the monitor's contemporaneous state remain unverified.
Neither this single-device result nor successful TCP connections to Homunculus
establishes 100-device capacity or correct clinical delivery.

Current pilot constraints, inspected on 2026-09-20:

- Maximum 300 seconds; at most 13 explicitly allowed sources.
- The multicast option requires one source and one known group.
- Exclusive UDP 2050 binding prevents using many copies as one scalable service.
- At most 5,000 saved packets or 4 MiB; transfer occurs after the finite run.
- No production service, native validated decoder or collector failover exists.

Do not simply raise these limits and label the pilot production-ready.

## Collector and receiver requirements

1. Inventory all 100 devices: stable identity, IP, model/firmware, monitoring unit,
   observed multicast groups and physical location. Keep patient identity separate.
   Do not generate multicast addresses by substituting an IP's last octet.
2. One managed receiver per collector must handle all configured groups, bind the
   explicit interface and retain source and destination metadata for each packet.
   Verify OS/socket membership limits and switch/virtual-switch group capacity.
3. Dispatch each source to a versioned, validated decoder. Preserve device time and
   receive time separately; handle malformed, truncated, duplicated, out-of-order,
   invalid and stale data without producing fresh-looking measurements.
4. Forward validated numerics over authenticated TLS with acknowledgment and a
   bounded encrypted disk queue. Define retention, overflow reporting and retry
   behavior. The existing SQLite outbox is a starting point, not a throughput test.
5. Implement active ownership with fencing/leases and receiver-side idempotency.
   Standby takeover must not create duplicate clinical events. If sequence/time
   semantics are not known, deduplication cannot yet be claimed correct.
6. Show per-device last packet and last valid measurement separately. Report gaps,
   decoder rejection, queue age/depth, forwarding errors and available drop counts.
   Missing kernel/NIC drop statistics remain unknown, never zero.
7. Assign observations to a patient only through verified device/bed/patient
   association with explicit change handling. Old queue entries retain their
   original association; they must not inherit a new occupant of the same bed.
8. Treat ECG waveform rendering as a separate deliverable: channel identity,
   sample rate, scaling, timing and gaps need independent validation. Numeric HR
   extraction does not validate a waveform decoder or replacement alarm display.

## Capacity and acceptance

Cisco's Infinity guide gives approximately 100 kbit/s per bedside monitor as
network planning context. Multiplying by 100 gives about 10 Mbit/s, not a measured
site peak or a sizing guarantee. Measure actual active-device traffic, bursts,
group fan-out, decoder cost, persistence and display load before sizing VMs.
Continuous raw storage at 10 Mbit/s would be about 108 GB/day before overhead;
raw capture should remain bounded research evidence, not the default archive.

Verify one device end to end with known test values and documented field semantics,
then expand to 13, 50 and all 100. At each stage measure latency, packet rejection,
loss where observable, CPU/memory/disk, queue growth and device separation. Use a
defined acceptance target before testing; packet arrival rate is not measurement
update rate. Exercise uplink loss, restart, stale input, address/bed/patient changes,
and active-collector failure. Synthetic 100-source replay helps test scaling but
does not prove live 100-device compatibility. Final acceptance requires all 100
identified devices under representative live load and verified display behavior.

Immediate next prerequisite: establish an independently verified native decoder
or a working licensed vendor export. Additional NICs/VMs alone cannot satisfy it.
Continue with the existing collector for that investigation before provisioning
the production pair. No deployment or monitor-setting change accompanies this note.

## Sources

- [Microsoft: TCP/IP addressing and subnetting](https://learn.microsoft.com/en-us/troubleshoot/windows-client/networking/tcpip-addressing-and-subnetting)
  explains local subnets and default gateways.
- [Cisco: Drager patient monitoring deployment guide](https://www.cisco.com/c/en/us/products/collateral/wireless/draeger-patient-monitoring-cat-wireless-dg.html)
  describes per-monitor multicast, IGMP and approximate traffic rate.
- [Drager: Infinity Gateway Suite](https://www.draeger.com/en-us_us/Products/Infinity-Gateway-Suite)
  describes HL7 and WinAccess integration; it does not validate our native decoder.
- [Local pilot evidence and limitations](INFINITY-VM-GATEWAY-PILOT.md).
