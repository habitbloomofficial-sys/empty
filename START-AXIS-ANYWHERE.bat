@echo off
setlocal enabledelayedexpansion
title Axis - anywhere
cd /d "%~dp0"

echo.
echo   Axis, from anywhere
echo   -------------------
echo.
echo   This gives Axis a web address that works from any phone, on any
echo   network, anywhere in the world. Leave this window open while you
echo   are away - closing it takes him off the internet.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed. Opening the download page.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

rem --------------------------------------------------------------------------
rem The passcode comes first, before anything is exposed.
rem
rem Axis reads mail, places calls and opens things on this computer. Putting
rem that on the internet unlocked is not a setting anyone should be able to
rem leave switched off by accident, so this refuses to start without one. He
rem would refuse to answer anyway - this just says so before you have carried
rem the address to your phone and wondered why it doesn't work.
rem --------------------------------------------------------------------------
if not exist "data\auth.json" (
  echo   No passcode is set yet.
  echo.
  echo   Open Axis on this computer with START-AXIS.bat, go to
  echo   Settings, then Remote access, and set one. Then run this again.
  echo.
  echo   It only takes a moment, and it is the only thing standing between
  echo   your computer and whoever finds the address.
  echo.
  pause
  exit /b 1
)

rem Same install/build rules as the other launchers.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash; $s='data\.deps-stamp'; if((Test-Path 'node_modules') -and (Test-Path $s) -and ((Get-Content $s -Raw).Trim() -eq $h)){exit 0} else {exit 1}"
if errorlevel 1 (
  echo   Getting what Axis needs. This takes a minute the first time.
  echo.
  call npm install
  if errorlevel 1 goto failed
  powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'"
  if exist ".next\BUILD_ID" del /q ".next\BUILD_ID" >nul 2>nul
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if(-not (Test-Path '.next\BUILD_ID')){exit 1}; $b=(Get-Item '.next\BUILD_ID').LastWriteTimeUtc; $n=(Get-ChildItem -Recurse -File -Path 'src','public','package.json','next.config.ts' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc; if($n -gt $b){exit 1} else {exit 0}"
if errorlevel 1 (
  echo   Preparing Axis. This happens after an update, not every time.
  echo.
  call npm run build
  if errorlevel 1 goto failed
)

rem --------------------------------------------------------------------------
rem cloudflared makes the tunnel. It is a single file from Cloudflare, kept in
rem this folder so nothing is installed system-wide and deleting the folder
rem takes it with you.
rem --------------------------------------------------------------------------
set CFD=data\cloudflared.exe
if not exist "%CFD%" (
  echo   Getting the tunnel program from Cloudflare, once...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{Invoke-WebRequest -UseBasicParsing 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'data\cloudflared.exe'; exit 0}catch{Write-Host $_.Exception.Message; exit 1}"
  if errorlevel 1 (
    echo.
    echo   That download failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
  )
)

rem Start Axis itself, in its own window, then tunnel to it.
start "Axis engine" /min cmd /c "npm run start"

echo   Starting Axis and opening the tunnel. This takes a few seconds.
echo.

node scripts\anywhere.mjs
if errorlevel 1 goto failed

echo.
echo   Axis is off the internet again.
pause
exit /b 0

:failed
echo.
echo   That didn't work. The error is above.
echo.
pause
exit /b 1
