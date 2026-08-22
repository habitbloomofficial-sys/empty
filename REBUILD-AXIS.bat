@echo off
setlocal
title Axis - repair
cd /d "%~dp0"

rem The big hammer. START-AXIS.bat installs and rebuilds by itself when it
rem needs to, so this is only for when something has gone wrong and you want
rem everything done again from scratch.
rem
rem Your settings, memories and session history live in the data folder and are
rem not touched by any of this.

echo.
echo   Repairing Axis...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed. Opening the download page.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

echo   [1/3] Installing everything Axis needs...
call npm install
if errorlevel 1 goto failed
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'"

echo.
echo   [2/3] Clearing the old build...
if exist ".next" rmdir /s /q ".next"

echo.
echo   [3/3] Building...
call npm run build
if errorlevel 1 goto failed

echo.
echo   Done. Start Axis with START-AXIS.bat.
echo.
pause
exit /b 0

:failed
echo.
echo   The repair failed. The error is above.
echo.
echo   If it mentions a missing module, your internet connection dropped
echo   during the install - just run this again.
echo.
pause
exit /b 1
