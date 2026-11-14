# Yerelden VM'e arayüz yayını: yamayı ve değişen metin dosyalarının tamamını hazırlar, gönderir, yayınlar.
# Kullanım: powershell -File .claude\vm-yayin.ps1 <etiket>
# Taban: 1b33d399 (asbadef/main'de bizim ilk kaydımızdan önceki son Asaf kaydı).
param([string]$Etiket = "yama")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$taban = "1b33d399"
$yama = Join-Path $env:TEMP "vm-$Etiket.patch"
$tar = Join-Path $env:TEMP "vm-$Etiket-metin.tar"
cmd /c "git diff --binary $taban HEAD -- dashboard > `"$yama`""
$metin = git diff --name-only $taban HEAD -- dashboard/src/live/i18n/strings
if ($metin) { tar -cf $tar $metin } else { if (Test-Path $tar) { Remove-Item $tar } }
scp $yama .claude/vm-yayin.sh sysadmin@172.100.101.72:/tmp/ | Out-Null
$ucuncu = ""
if ($metin) { scp $tar sysadmin@172.100.101.72:/tmp/vm-metin.tar | Out-Null; $ucuncu = "/tmp/vm-metin.tar" }
ssh sysadmin@172.100.101.72 "sudo bash /tmp/vm-yayin.sh /tmp/vm-$Etiket.patch $Etiket $ucuncu 2>&1 | tail -2; echo kaynak=`$(cd /opt/homunculus && sudo git status --porcelain | grep -c dashboard)"
