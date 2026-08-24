@echo off
setlocal
title Axis - phone access
cd /d "%~dp0"

echo.
echo   Axis on your phone
echo   --------------------
echo.
echo   This serves Axis to your own Wi-Fi so your phone can reach it.
echo   Leave this window open while you use it.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed. Opening the download page.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

rem Same rule as START-AXIS.bat: node_modules existing is not the same as it
rem being up to date. After an update adds a library the folder is still there
rem and the library isn't, and the failure lands somewhere unrelated.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash; $s='data\.deps-stamp'; if((Test-Path 'node_modules') -and (Test-Path $s) -and ((Get-Content $s -Raw).Trim() -eq $h)){exit 0} else {exit 1}"
if errorlevel 1 (
  echo   Getting what Axis needs. This takes a minute the first time.
  echo.
  call npm install
  if errorlevel 1 goto failed
  powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'"
  if exist ".next\BUILD_ID" del /q ".next\BUILD_ID" >nul 2>nul
)

rem Build only when something changed, rather than on every phone start.
powershell -NoProfile -ExecutionPolicy Bypass -Command "if(-not (Test-Path '.next\BUILD_ID')){exit 1}; $b=(Get-Item '.next\BUILD_ID').LastWriteTimeUtc; $n=(Get-ChildItem -Recurse -File -Path 'src','public','package.json','next.config.ts' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc; if($n -gt $b){exit 1} else {exit 0}"
if errorlevel 1 (
  echo   Preparing Axis. This happens after an update, not every time.
  echo.
  call npm run build
  if errorlevel 1 goto failed
)

node scripts\phone-server.mjs
if errorlevel 1 goto failed

echo.
echo   Axis has stopped.
pause
exit /b 0

:failed
echo.
echo   That didn't work. The error is above.
echo.
echo   If Windows Firewall asked whether to allow Node.js and you said no,
echo   your phone will not be able to reach this computer. Allow it on
echo   Private networks and run this again.
echo.
pause
exit /b 1
