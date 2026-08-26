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

rem --------------------------------------------------------------------------
rem Windows Firewall. The reason for "it just doesn't work".
rem
rem Axis listens on every address on this machine, and always has. What stops
rem the phone is Windows deciding nothing from outside may reach the port -
rem which is the default, and which is also what happens for ever after if the
rem "Allow Node.js to communicate on this network?" box was ever cancelled.
rem There is no error anywhere. The phone just spins.
rem
rem So: look before starting, and if the way isn't clear, ask Windows for
rem permission to clear it. One port, on private networks only.
rem --------------------------------------------------------------------------
call :checkfirewall
if "%FWSTATE%"=="clear" goto firewall_ok
if "%FWSTATE%"=="unknown" goto firewall_ok
if "%FWSTATE%"=="public" goto firewall_public

echo.
echo   Windows is blocking your phone from reaching this computer.
echo.
echo   I can fix that: one rule, for one port, on your own home network
echo   only. Windows will ask you to approve it - click Yes.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\firewall-elevate.ps1" -Port 3443

call :checkfirewall
if "%FWSTATE%"=="clear" goto firewall_ok
if "%FWSTATE%"=="unknown" goto firewall_ok
if "%FWSTATE%"=="public" goto firewall_public

echo.
echo   That didn't go through - most likely the permission box was declined.
echo.
echo   Starting anyway. If your phone can't connect, close this window and
echo   right-click START-AXIS-PHONE.bat, then Run as administrator.
echo.
pause
goto firewall_ok

:firewall_public
echo.
echo   Windows has this Wi-Fi marked as Public, which means "hide this
echo   computer from everything else on this network" - your own phone
echo   included. On a home network that is the wrong setting.
echo.
set "MAKEPRIVATE="
set /p MAKEPRIVATE=  Set it to Private? Type Y and press Enter (or just Enter to skip): 
if /i not "%MAKEPRIVATE%"=="Y" goto firewall_ok
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\firewall-elevate.ps1" -Port 3443 -Private
goto firewall_ok

:firewall_ok

node scripts\phone-server.mjs
if errorlevel 1 goto failed

echo.
echo   Axis has stopped.
pause
exit /b 0

rem Ask firewall.ps1 what is in the way and turn its exit code into a word,
rem because "if errorlevel N" means "N or higher" and reads backwards.
:checkfirewall
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\firewall.ps1" -Port 3443
if errorlevel 3 (set "FWSTATE=public" & exit /b 0)
if errorlevel 2 (set "FWSTATE=unknown" & exit /b 0)
if errorlevel 1 (set "FWSTATE=blocked" & exit /b 0)
set "FWSTATE=clear"
exit /b 0

:failed
echo.
echo   That didn't work. The error is above.
echo.
echo   If it mentions a port already being in use, Axis is already running
echo   in another window - close that one first.
echo.
pause
exit /b 1
