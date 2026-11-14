# Yerelden VM'e yayın (Tur 0'dan beri git ile): VM, asbadef/main'e ileri sarılır; değişen servisler
# (homunculus-engine -> api, dashboard -> web) derlenir. Her yayından önce tam yedek alınır.
# Önkoşul: değişiklikler yerelde test edilmiş ve asbadef/main'e gönderilmiş olmalı.
# Kullanım: powershell -File .claude\vm-yayin.ps1 [-Kuru] [-Hepsi]
param([switch]$Kuru, [switch]$Hepsi)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$hedef = "sysadmin@172.100.101.72"
scp .claude/vm/yedek-al.sh .claude/vm/geri-don.sh .claude/vm/guncelle.sh .claude/vm/durum.sh "${hedef}:/tmp/" | Out-Null
$bayrak = @(); if ($Kuru) { $bayrak += "--kuru" }; if ($Hepsi) { $bayrak += "--hepsi" }
if ($Kuru) {
  ssh $hedef "sudo bash /tmp/guncelle.sh $($bayrak -join ' ')"
} else {
  ssh $hedef "TS=`$(sudo bash /tmp/yedek-al.sh) && echo yedek=`$TS && sudo bash /tmp/guncelle.sh $($bayrak -join ' '); sudo bash /tmp/durum.sh | head -6"
}
