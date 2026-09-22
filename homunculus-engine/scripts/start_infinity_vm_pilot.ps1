# Run locally. WinRM executes the bounded worker in memory on the specified VM.
# No service installation, device command, firewall edit or clinical ingestion.
[CmdletBinding()]
param(
    [string]$ComputerName='10.10.200.116',
    [string]$AdapterIp='10.10.203.220',
    [string]$TargetIp='172.100.101.72',
    [string[]]$DeviceIp=@(),
    [ValidateRange(1,300)][int]$Duration=30,
    [switch]$CapturePayload,
    [switch]$ProbeDevices,
    [string]$JoinPdsGroup='',
    [System.Management.Automation.PSCredential]$Credential
)
$ErrorActionPreference='Stop'
$session=$writer=$null
try {
    if ($CapturePayload -and ($DeviceIp.Count -lt 1 -or $DeviceIp.Count -gt 13)) {
        throw 'Select 1 to 13 monitor IPs before requesting payload capture.'
    }
    if ($ProbeDevices -and ($DeviceIp.Count -lt 1 -or $DeviceIp.Count -gt 13)) {
        throw 'Select 1 to 13 explicit IPs before requesting device probes.'
    }
    if ($JoinPdsGroup -and $DeviceIp.Count -ne 1) { throw 'PDS membership requires exactly one explicit source IP.' }
    if (-not $Credential) { $Credential=Get-Credential -Message 'Authorized Windows server account' }
    if (-not $Credential) { throw 'Sign-in cancelled.' }
    $session=New-PSSession -ComputerName $ComputerName -Credential $Credential -Authentication Negotiate `
        -SessionOption (New-PSSessionOption -OpenTimeout 15000 -MaximumReceivedObjectSize 67108864 -MaximumReceivedDataSizePerCommand 67108864)
    Write-Host "Observing VM adapter $AdapterIp for at most $Duration seconds. No clinical forwarding."
    if ($JoinPdsGroup) { Write-Host "Temporary subscription: $JoinPdsGroup UDP 2050 on $AdapterIp; released when the worker stops." }
    $remoteResult=Invoke-Command -Session $session -FilePath (Join-Path $PSScriptRoot 'infinity_vm_worker.ps1') `
        -ArgumentList $AdapterIp,$DeviceIp,$Duration,([bool]$CapturePayload),$TargetIp,([bool]$ProbeDevices),$JoinPdsGroup
    if ($remoteResult.summary.schema -ne 'homunculus.infinity-vm-pilot.v1') { throw 'Invalid remote report.' }
    $directory=Join-Path ([IO.Path]::GetTempPath()) ('HomunculusDiagnostics\infinity-pilot-'+[Guid]::NewGuid().ToString('N'))
    # Ensure even an overridden TEMP cannot place captures inside a repository.
    $parent=[IO.DirectoryInfo]::new([IO.Path]::GetFullPath($directory))
    while ($null -ne $parent) {
        if ((Test-Path -LiteralPath (Join-Path $parent.FullName '.git')) -or
            ($parent.Exists -and ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint))) {
            throw 'Report directory must be outside repositories and reparse points.'
        }
        $parent=$parent.Parent
    }
    $null=New-Item -ItemType Directory -Path $directory
    $summary=$remoteResult.summary
    if ($CapturePayload) {
        $capturePath=Join-Path $directory 'infinity-ipv4.pcap'
        $writer=[IO.BinaryWriter]::new([IO.File]::Open($capturePath,[IO.FileMode]::CreateNew))
        # Little-endian PCAP, LINKTYPE_RAW=101: IPv4 datagrams, not Ethernet frames.
        $writer.Write([uint32]2712847316); $writer.Write([uint16]2); $writer.Write([uint16]4)
        $writer.Write([uint32]0); $writer.Write([uint32]0); $writer.Write([uint32]65535); $writer.Write([uint32]101)
        $savedBytes=0; $savedPackets=0
        foreach ($record in $remoteResult.packet_records) {
            if ($record.data.Length -gt 87380 -or $savedPackets -ge 5000) { throw 'Remote packet limit exceeded.' }
            $bytes=[Convert]::FromBase64String($record.data)
            if ($bytes.Length -lt 20 -or $bytes.Length -gt 65535 -or $record.microseconds -ge 1000000 -or
                $savedBytes+$bytes.Length -gt 4194304) { throw 'Invalid remote packet bounds.' }
            $writer.Write([uint32]$record.seconds); $writer.Write([uint32]$record.microseconds)
            $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]$bytes.Length); $writer.Write($bytes)
            $savedBytes+=$bytes.Length; $savedPackets++
        }
        $writer.Dispose(); $writer=$null
        if ($savedPackets -ne $summary.payload_packets -or $savedBytes -ne $summary.payload_bytes) { throw 'Capture count mismatch.' }
        $summary | Add-Member -NotePropertyName capture_sha256 -NotePropertyValue ((Get-FileHash -LiteralPath $capturePath -Algorithm SHA256).Hash.ToLowerInvariant())
    }
    # Serialize only explicit diagnostic properties, excluding WinRM metadata.
    $clean=[ordered]@{}
    foreach ($property in $summary.PSObject.Properties) {
        if ($property.Name -notin @('PSComputerName','RunspaceId','PSShowComputerName')) { $clean[$property.Name]=$property.Value }
    }
    $reportPath=Join-Path $directory 'summary.json'
    [IO.File]::WriteAllText($reportPath,($clean | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    Write-Output "Report saved: $reportPath"
    Write-Output "Capture status: $($summary.capture_status); selected IP packets: $($summary.selected_packets); clinical forwarding: disabled"
} finally {
    if ($writer) { $writer.Dispose() }
    if ($session) { Remove-PSSession -Session $session -ErrorAction SilentlyContinue }
    $Credential=$null
}
