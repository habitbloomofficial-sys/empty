@echo off
setlocal
title JARVIS - phone access
cd /d "%~dp0"

echo.
echo   JARVIS on your phone
echo   --------------------
echo.
echo   This serves JARVIS to your own Wi-Fi so your phone can reach it.
echo   Leave this window open while you use it.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed. Opening the download page.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First run - installing what JARVIS needs.
  call npm install
  if errorlevel 1 goto failed
)

call npm run phone
if errorlevel 1 goto failed

echo.
echo   JARVIS has stopped.
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
