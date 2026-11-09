@echo off
REM Homunculus doktor/hemsire mobil app'ini baslatir.
REM Cift tiklayin -> bir terminal acilir -> QR cikinca telefonda Expo Go ile tarayin.
REM (Telefon ile bilgisayar ayni WiFi'da olmali.)
title Homunculus Doktor/Hemsire App
cd /d "%~dp0"
echo.
echo   Homunculus doktor/hemsire mobil app baslatiliyor...
echo   QR cikinca telefonda Expo Go ile tarayin (ayni WiFi).
echo   Internet uzerinden (farkli ag) acmak icin asagidaki komutu
echo   elle ekleyin:  npx expo start  komutunu  --tunnel  ile calistirin.
echo   Kapatmak icin bu pencerede Ctrl+C.
echo.
call npx expo start
pause
