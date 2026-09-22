# Remote, bounded packet observation for Windows Server 2012 R2.
# No installation, application commands, persistent changes or remote files.
# Optional explicit ICMP probes or temporary membership of an observed PDS group.
[CmdletBinding()]
param(
    [string]$AdapterIp = '10.10.203.220',
    [string[]]$DeviceIp = @(),
    [ValidateRange(1,300)][int]$Duration = 30,
    [bool]$CapturePayload = $false,
    [string]$TargetIp = '172.100.101.72',
    [bool]$ProbeDevices = $false,
    [string]$JoinPdsGroup = ''
)
$ErrorActionPreference = 'Stop'

function Get-InfinityIPv4Header {
    param([byte[]]$Bytes, [int]$Count)
    if ($Count -lt 20 -or $Count -gt $Bytes.Length -or ($Bytes[0] -shr 4) -ne 4) { return }
    $ihl = ($Bytes[0] -band 15) * 4
    $length = [int]$Bytes[2] * 256 + $Bytes[3]
    if ($ihl -lt 20 -or $length -lt $ihl -or $length -ne $Count) { return }
    $flagsOffset = [int]$Bytes[6] * 256 + $Bytes[7]
    $fragmented = ($flagsOffset -band 16383) -ne 0
    $sourcePort = $destinationPort = $null
    if ($Bytes[9] -eq 17 -and -not $fragmented) {
        if ($length -lt $ihl + 8) { return }
        $udpLength = [int]$Bytes[$ihl+4] * 256 + $Bytes[$ihl+5]
        if ($udpLength -lt 8 -or $ihl + $udpLength -ne $length) { return }
        $sourcePort = [int]$Bytes[$ihl] * 256 + $Bytes[$ihl+1]
        $destinationPort = [int]$Bytes[$ihl+2] * 256 + $Bytes[$ihl+3]
    }
    [pscustomobject]@{
        Source=($Bytes[12..15] -join '.'); Destination=($Bytes[16..19] -join '.')
        Protocol=[int]$Bytes[9]; SourcePort=$sourcePort; DestinationPort=$destinationPort
        Fragmented=$fragmented; Length=$length
    }
}

function Assert-InfinityUnicastIPv4 {
    param([string]$Address)
    $ip = [Net.IPAddress]::Parse($Address)
    if ($ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -ne $Address) {
        throw 'A canonical IPv4 address is required.'
    }
    $bytes = $ip.GetAddressBytes()
    if ($bytes[0] -eq 0 -or $bytes[0] -eq 127 -or $bytes[0] -ge 224) {
        throw 'An IPv4 unicast address is required.'
    }
}

function Get-InfinitySourceDecision {
    param([string]$Source,[string]$Adapter,[string[]]$Allowlist=@())
    $networkPrefix=$Adapter.Substring(0,$Adapter.LastIndexOf('.')+1)
    if ($Source -eq $Adapter) { return 'capture_adapter_source' }
    if (-not $Source.StartsWith($networkPrefix)) { return 'outside_source_subnet' }
    if ($Allowlist.Count -gt 0 -and $Source -notin $Allowlist) { return 'outside_device_allowlist' }
    return 'selected'
}

function Assert-InfinityPdsGroup {
    param([string]$Group,[string[]]$Devices)
    $ip=[Net.IPAddress]::Parse($Group)
    if ($Devices.Count -ne 1 -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ip.ToString() -ne $Group) {
        throw 'PDS membership requires one explicit source and one canonical IPv4 multicast group.'
    }
    $octets=$ip.GetAddressBytes()
    if ($octets[0] -lt 224 -or $octets[0] -gt 239 -or
        ($octets[0] -eq 224 -and $octets[1] -eq 0 -and $octets[2] -eq 0)) {
        throw 'Use an observed data multicast group, not unicast or link-local control groups.'
    }
}

function New-InfinityUdpSocket {
    New-Object Net.Sockets.Socket -ArgumentList ([Net.Sockets.AddressFamily]::InterNetwork),
        ([Net.Sockets.SocketType]::Dgram),([Net.Sockets.ProtocolType]::Udp)
}

function Open-InfinityPdsSubscription {
    param([string]$Group,[string]$Adapter,[string[]]$Devices)
    Assert-InfinityPdsGroup $Group $Devices
    $receiver=New-InfinityUdpSocket
    try {
        # Refuse an occupied port; do not share or displace a vendor receiver.
        $receiver.ExclusiveAddressUse=$true
        $receiver.ReceiveBufferSize=1048576
        $receiver.Bind((New-Object Net.IPEndPoint -ArgumentList ([Net.IPAddress]::Any),2050))
        $membership=New-Object Net.Sockets.MulticastOption -ArgumentList ([Net.IPAddress]::Parse($Group)),([Net.IPAddress]::Parse($Adapter))
        $receiver.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP,[Net.Sockets.SocketOptionName]::AddMembership,$membership)
        [pscustomobject]@{Socket=$receiver;Membership=$membership;MembershipRemoved=$false;SocketClosed=$false}
    } catch { $receiver.Dispose(); throw }
}

function Close-InfinityPdsSubscription {
    param($Subscription)
    if (-not $Subscription) { return }
    try {
        $Subscription.Socket.SetSocketOption([Net.Sockets.SocketOptionLevel]::IP,
            [Net.Sockets.SocketOptionName]::DropMembership,$Subscription.Membership)
        $Subscription.MembershipRemoved=$true
    } catch { } finally {
        $Subscription.Socket.Dispose()
        $Subscription.SocketClosed=$true
    }
}

Assert-InfinityUnicastIPv4 $AdapterIp
Assert-InfinityUnicastIPv4 $TargetIp
$DeviceIp = @($DeviceIp | Select-Object -Unique)
if ($DeviceIp.Count -gt 13 -or (($CapturePayload -or $ProbeDevices) -and $DeviceIp.Count -eq 0)) {
    throw 'Payload capture or device probes require an explicit allowlist of 1 to 13 IPv4 addresses.'
}
$prefix = $AdapterIp.Substring(0,$AdapterIp.LastIndexOf('.')+1)
foreach ($address in $DeviceIp) {
    Assert-InfinityUnicastIPv4 $address
    if (-not $address.StartsWith($prefix) -or $address -eq $AdapterIp -or $address -match '\.(0|255)$') {
        throw 'Each monitor must be a distinct host in the selected /24 network.'
    }
}
if ($JoinPdsGroup) { Assert-InfinityPdsGroup $JoinPdsGroup $DeviceIp }
$nicFound = $false
foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    foreach ($unicast in $nic.GetIPProperties().UnicastAddresses) {
        if ($unicast.Address.ToString() -eq $AdapterIp -and $nic.OperationalStatus -eq 'Up' -and
            $unicast.IPv4Mask.ToString() -eq '255.255.255.0') { $nicFound=$true; $captureNic=$nic }
    }
}
if (-not $nicFound) { throw 'The specified local /24 adapter is not up; no capture started.' }

$flows = @{}
$observedSources = @{}
$records = New-Object 'System.Collections.Generic.List[object]'
$summary = [ordered]@{
    schema='homunculus.infinity-vm-pilot.v1'; mode='passive-ipv4-pilot'
    collector_revision=4
    device_probes_enabled=$ProbeDevices
    adapter_ip=$AdapterIp; allowed_devices=$DeviceIp; source_subnet=($prefix+'0/24')
    target_ip=$TargetIp; duration_requested_seconds=$Duration; payload_capture=$CapturePayload
    clinical_ingest_enabled=$false; clinical_mapping_verified=$false
    timestamp_source='vm_receive_clock_not_device_time'; capture_status='not_started'
    started_utc=[DateTime]::UtcNow.ToString('o'); observed_ip_packets=0; selected_packets=0
    malformed_packets=0; excluded_packets=0; fragmented_packets=0; flow_overflow=0
    payload_bytes=0; limit_reached=$false; capture_error_code=$null
    capture_drops=$null; capture_drop_statistics_available=$false
    exclusion_reasons=[ordered]@{capture_adapter_source=0;outside_source_subnet=0;outside_device_allowlist=0}
    observed_source_overflow=0
    pds_subscription=[ordered]@{requested_group=$JoinPdsGroup;port=2050;interface_ip=$AdapterIp
        joined=$false;membership_removed=$false;socket_closed=$false
        udp_datagrams_from_selected_source=0;udp_datagrams_other_sources=0}
}
# Read current interface/route/membership state. No probes to monitor addresses.
$interfaceIndex=$captureNic.GetIPProperties().GetIPv4Properties().Index
$networkSnapshot=[ordered]@{
    interface_index=$interfaceIndex; name=$captureNic.Name; description=$captureNic.Description
    mac=$captureNic.GetPhysicalAddress().ToString(); link_status=$captureNic.OperationalStatus.ToString()
    speed_bps=$captureNic.Speed; monitor_vlan_verified=$false; errors=@()
}
try {
    $networkSnapshot.neighbors=@(Get-NetNeighbor -InterfaceIndex $interfaceIndex -AddressFamily IPv4 |
        Select-Object -First 256 IPAddress,LinkLayerAddress,@{Name='State';Expression={$_.State.ToString()}})
} catch { $networkSnapshot.errors+='neighbor_snapshot_unavailable' }
try {
    $networkSnapshot.routes=@(Get-NetRoute -InterfaceIndex $interfaceIndex -AddressFamily IPv4 |
        Select-Object -First 64 DestinationPrefix,NextHop,RouteMetric)
} catch { $networkSnapshot.errors+='route_snapshot_unavailable' }
try {
    $joins=@(& "$env:SystemRoot\System32\netsh.exe" interface ipv4 show joins "interface=$interfaceIndex")
    if ($LASTEXITCODE -ne 0) { throw 'Membership snapshot unavailable' }
    $networkSnapshot.multicast_memberships=@($joins | Select-Object -First 100)
} catch { $networkSnapshot.errors+='membership_snapshot_unavailable' }
try {
    $networkSnapshot.firewall_profiles=@(Get-NetFirewallProfile | Select-Object Name,Enabled,
        @{Name='DefaultInboundAction';Expression={$_.DefaultInboundAction.ToString()}})
} catch { $networkSnapshot.errors+='firewall_profile_snapshot_unavailable' }
$summary.network_snapshot=[pscustomobject]$networkSnapshot
$probes = @()
$socket = $null
$subscription = $null
$timer = [Diagnostics.Stopwatch]::StartNew()
try {
    $socket = New-Object Net.Sockets.Socket -ArgumentList ([Net.Sockets.AddressFamily]::InterNetwork),
        ([Net.Sockets.SocketType]::Raw),([Net.Sockets.ProtocolType]::IP)
    $socket.ReceiveBufferSize = 1048576
    $socket.Bind((New-Object Net.IPEndPoint -ArgumentList ([Net.IPAddress]::Parse($AdapterIp)),0))
    # RCVALL_IPLEVEL=3 receives packets already delivered to this NIC, without
    # requesting promiscuous mode. It cannot overcome switch/VM multicast filtering.
    $null = $socket.IOControl([Net.Sockets.IOControlCode]::ReceiveAll,[byte[]]@(3,0,0,0),$null)
    $buffer = New-Object byte[] 65535
    $timer.Restart()
    $summary.capture_status='completed'
    if ($JoinPdsGroup) {
        $subscription=Open-InfinityPdsSubscription $JoinPdsGroup $AdapterIp $DeviceIp
        $summary.pds_subscription.joined=$true
        $udpBuffer=New-Object byte[] 65535
        try {
            $duringJoins=@(& "$env:SystemRoot\System32\netsh.exe" interface ipv4 show joins "interface=$interfaceIndex")
            if ($LASTEXITCODE -ne 0) { throw 'Membership snapshot unavailable' }
            $summary.pds_subscription.memberships_during_test=@($duringJoins | Select-Object -First 100)
        } catch { $summary.pds_subscription.snapshot_error='membership_snapshot_unavailable' }
    }
    if ($ProbeDevices) {
        $summary.mode='ipv4-pilot-with-explicit-icmp-probes'
        foreach ($address in $DeviceIp) {
            $ping = New-Object Net.NetworkInformation.Ping
            try {
                $task = $ping.SendPingAsync($address,1000)
                $probes += [pscustomobject]@{Address=$address;Client=$ping;Task=$task}
            } catch { $ping.Dispose(); $probes += [pscustomobject]@{Address=$address;Client=$null;Task=$null} }
        }
    }
    if ($JoinPdsGroup) { $summary.mode='ipv4-pilot-with-explicit-multicast-subscription' }
    while ($timer.Elapsed.TotalSeconds -lt $Duration) {
        if ($subscription) {
            # Drain the receiver without decoding or saving datagram contents.
            # Raw-IP flow headers below identify the actual multicast destination.
            for ($i=0;$i -lt 32 -and $subscription.Socket.Poll(0,[Net.Sockets.SelectMode]::SelectRead);$i++) {
                [Net.EndPoint]$sender=New-Object Net.IPEndPoint -ArgumentList ([Net.IPAddress]::Any),0
                $null=$subscription.Socket.ReceiveFrom($udpBuffer,[ref]$sender)
                if ($sender.Address.ToString() -in $DeviceIp) { $summary.pds_subscription.udp_datagrams_from_selected_source++ }
                else { $summary.pds_subscription.udp_datagrams_other_sources++ }
            }
        }
        if (-not $socket.Poll(200000,[Net.Sockets.SelectMode]::SelectRead)) { continue }
        $count = $socket.Receive($buffer)
        $summary.observed_ip_packets++
        if ($summary.observed_ip_packets -ge 200000) { $summary.limit_reached=$true; break }
        $header = Get-InfinityIPv4Header $buffer $count
        if (-not $header) { $summary.malformed_packets++; continue }
        $decision=Get-InfinitySourceDecision $header.Source $AdapterIp $DeviceIp
        if (-not $observedSources.ContainsKey($header.Source)) {
            if ($observedSources.Count -lt 64) {
                $observedSources[$header.Source]=[ordered]@{source=$header.Source;packets=0;decision=$decision}
            } else { $summary.observed_source_overflow++ }
        }
        if ($observedSources.ContainsKey($header.Source)) { $observedSources[$header.Source].packets++ }
        if ($decision -ne 'selected') {
            $summary.exclusion_reasons[$decision]++
            $summary.excluded_packets++; continue
        }
        $summary.selected_packets++
        if ($header.Fragmented) { $summary.fragmented_packets++ }
        $key = '{0}|{1}|{2}|{3}|{4}' -f $header.Source,$header.Destination,$header.Protocol,$header.SourcePort,$header.DestinationPort
        $now = [DateTime]::UtcNow
        if (-not $flows.ContainsKey($key)) {
            if ($flows.Count -lt 256) {
                $flows[$key]=[ordered]@{source=$header.Source;destination=$header.Destination;protocol=$header.Protocol
                    source_port=$header.SourcePort;destination_port=$header.DestinationPort;packets=0;bytes=0
                    first_receive_utc=$now.ToString('o');last_receive_utc=$now.ToString('o')}
            } else { $summary.flow_overflow++ }
        }
        if ($flows.ContainsKey($key)) {
            $flows[$key].packets++; $flows[$key].bytes += $count
            $flows[$key].last_receive_utc=$now.ToString('o')
        }
        if ($CapturePayload -and -not $header.Fragmented -and $header.Protocol -eq 17 -and
            $header.DestinationPort -in @(2000,2050,2100,2150)) {
            if ($records.Count -ge 5000 -or $summary.payload_bytes + $count -gt 4194304) {
                $summary.limit_reached=$true; break
            }
            $epochTicks = $now.Ticks - ([DateTime]'1970-01-01T00:00:00Z').ToUniversalTime().Ticks
            $records.Add([pscustomobject]@{
                seconds=[uint32][math]::Floor($epochTicks/10000000)
                microseconds=[uint32][math]::Floor(($epochTicks % 10000000)/10)
                data=[Convert]::ToBase64String($buffer,0,$count)
            })
            $summary.payload_bytes += $count
        }
    }
} catch {
    $summary.capture_status='capture_unavailable'
    $summary.capture_error_code=$_.Exception.GetBaseException().GetType().Name
    if ($_.Exception.GetBaseException() -is [Net.Sockets.SocketException]) {
        $summary.capture_error_code=$_.Exception.GetBaseException().SocketErrorCode.ToString()
    }
} finally {
    if ($socket) { $socket.Dispose() }
    if ($subscription) {
        Close-InfinityPdsSubscription $subscription
        $summary.pds_subscription.membership_removed=$subscription.MembershipRemoved
        $summary.pds_subscription.socket_closed=$subscription.SocketClosed
    }
    $summary.device_connectivity=@(foreach ($probe in $probes) {
        $status='not_completed'; $roundtrip=$null
        try {
            if ($probe.Task -and $probe.Task.Status -eq 'RanToCompletion') {
                $status=$probe.Task.Result.Status.ToString()
                if ($status -eq 'Success') { $roundtrip=$probe.Task.Result.RoundtripTime }
            } elseif (-not $probe.Task -or $probe.Task.IsFaulted -or $probe.Task.IsCanceled) { $status='probe_error' }
        } finally { if ($probe.Client) { $probe.Client.Dispose() } }
        [pscustomobject]@{address=$probe.Address;icmp_status=$status;roundtrip_ms=$roundtrip;device_type_verified=$false}
    })
    $timer.Stop()
}
$summary.duration_actual_seconds=[math]::Round($timer.Elapsed.TotalSeconds,3)
$summary.flows=@($flows.Values)
$summary.observed_sources=@($observedSources.Values)
$summary.payload_packets=$records.Count
# Connectivity probes target only the requested Homunculus host, after capture.
$summary.target_connections=@(foreach ($port in @(2575,8080)) {
    $client=New-Object Net.Sockets.TcpClient
    $reachable=$false
    try { $pending=$client.ConnectAsync($TargetIp,$port); $reachable=$pending.Wait(3000) -and $client.Connected } catch {} finally { $client.Dispose() }
    [pscustomobject]@{port=$port;tcp_reachable=$reachable;application_protocol_verified=$false}
})
[pscustomobject]@{summary=[pscustomobject]$summary;packet_records=$records.ToArray()}
