@echo off
setlocal enabledelayedexpansion
title Axis - anywhere
cd /d "%~dp0"

echo.
echo   Axis, from anywhere
echo   -------------------
echo.
rem LAUNCHER VERSION 2026-09-01.3 - printed so it is obvious which copy is running.
echo   launcher 2026-09-01.3
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
rem The passcode is asked for further down, once Axis is running - see
rem scripts\anywhere.mjs. It used to be checked here, which meant this window
rem closed and sent you off to find a settings page before anything happened.
rem Nothing goes on the internet without one either way; the difference is only
rem that you are now asked rather than dismissed.
rem --------------------------------------------------------------------------

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
