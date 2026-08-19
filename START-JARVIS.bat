@echo off
setlocal
title JARVIS
cd /d "%~dp0"

echo.
echo   JARVIS
echo   ------
echo.

rem Node is the only thing JARVIS needs that Windows doesn't ship with.
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed on this computer.
  echo   Opening the download page - install it, then run this again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First run - installing what JARVIS needs. This takes a minute or two.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

if not exist ".next\BUILD_ID" (
  echo   Preparing JARVIS. This happens once, not every time.
  echo.
  call npm run build
  if errorlevel 1 goto failed
)

rem If JARVIS is already running, use that one. Starting a second copy just
rem fails to take the port, and then you have a browser window pointed at a
rem server that never came up - which looks exactly like JARVIS being broken.
powershell -NoProfile -Command "try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000' -TimeoutSec 2; exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  echo   JARVIS is already running - opening it.
  echo.
  start "" http://127.0.0.1:3000
  exit /b 0
)

rem Open the browser only once the server actually answers, so the first thing
rem seen is JARVIS rather than a connection error. Runs alongside the server
rem below, which holds this window.
start "" powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000' -TimeoutSec 2;Start-Process 'http://127.0.0.1:3000';break}catch{Start-Sleep -Milliseconds 500}}"

echo   Starting. Your browser will open on its own.
echo   Closing this window shuts JARVIS down.
echo.
call npm run start

echo.
echo   JARVIS has stopped.
echo.
echo   If that happened immediately with an "address already in use" error,
echo   another copy is still running. Close its window, or restart the
echo   computer, then try again.
pause
exit /b 0

:failed
echo.
echo   That didn't work. The error is above.
echo.
pause
exit /b 1
