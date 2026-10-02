# Local research UI only. Does not change either VM's services or network settings.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dashboardPath = Join-Path $projectRoot 'dashboard'
$vitePath = Join-Path $dashboardPath 'node_modules\vite\bin\vite.js'
$accessPath = Join-Path $env:LOCALAPPDATA 'HomunculusResearchAccess'
$caPath = Join-Path $accessPath 'ca.pem'
$tokenPath = Join-Path $accessPath 'viewer-token.txt'
$viewUrl = 'http://127.0.0.1:5175/?infinityTest=1'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$scpPath = (Get-Command scp.exe -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
    throw 'Local dashboard dependencies are missing.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 5175 -ErrorAction SilentlyContinue) {
    throw "Port 5175 is already in use. Inspect the existing view at $viewUrl before starting another server."
}

New-Item -ItemType Directory -Path $accessPath -Force | Out-Null
Write-Host 'Downloading public CA and viewer key from the hub. Enter the SSH password only at its prompt.'
& $scpPath -o StrictHostKeyChecking=yes -o ConnectTimeout=10 'sysadmin@172.100.101.72:/home/sysadmin/infinity-research-ca.pem' $caPath
if ($LASTEXITCODE -ne 0) {
    throw 'Public CA copy failed. First export infinity-research-ca.pem on the hub using the supplied install command.'
}
& $scpPath -p -o StrictHostKeyChecking=yes -o ConnectTimeout=10 'sysadmin@172.100.101.72:/home/sysadmin/infinity-viewer-token.txt' $tokenPath
if ($LASTEXITCODE -ne 0) { throw 'Viewer key copy failed; the local server was not started.' }

if ((Get-Item -LiteralPath $caPath).Length -gt 65536 -or
    -not (Get-Content -Raw -LiteralPath $caPath).Contains('-----BEGIN CERTIFICATE-----')) {
    throw 'Invalid public CA file.'
}
if ((Get-Item -LiteralPath $tokenPath).Length -gt 4096) { throw 'Invalid viewer key file.' }
$viewerKey = (Get-Content -Raw -LiteralPath $tokenPath).Trim()
if ($viewerKey -notmatch '^[A-Za-z0-9_-]{32,256}$') { throw 'Invalid viewer key format.' }
Set-Clipboard -Value $viewerKey
$viewerKey = $null

$previousUpstream = $env:INFINITY_RESEARCH_UPSTREAM
$previousCa = $env:INFINITY_RESEARCH_CA_FILE
Push-Location -LiteralPath $dashboardPath
try {
    $env:INFINITY_RESEARCH_UPSTREAM = 'https://172.100.101.72:8766'
    $env:INFINITY_RESEARCH_CA_FILE = $caPath
    Write-Host "Open $viewUrl and paste the viewer key already copied to your clipboard."
    Write-Host 'Keep this terminal open for the local screen. VM collection continues independently.'
    Write-Host 'Expected screen label: CANLI PAKET TESTI. Packet and candidate delivery still need verification.'
    & $nodePath $vitePath --host 127.0.0.1 --port 5175 --strictPort
} finally {
    $env:INFINITY_RESEARCH_UPSTREAM = $previousUpstream
    $env:INFINITY_RESEARCH_CA_FILE = $previousCa
    Pop-Location
}
