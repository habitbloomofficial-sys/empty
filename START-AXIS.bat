@echo off
setlocal
title Axis
cd /d "%~dp0"

rem Which page the browser lands on. START-SHOP.bat sets this before calling
rem here; run on its own, Axis opens his own front page as he always has.
if not defined OPEN_URL set "OPEN_URL=http://127.0.0.1:3000"

echo.
echo   A X I S
echo   -------
echo.

rem Node is the only thing Axis needs that Windows doesn't ship with.
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js isn't installed on this computer.
  echo   Opening the download page - install it, then run this again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

rem --------------------------------------------------------------------------
rem Work out whether what is on disk is newer than what was last built, BEFORE
rem deciding to reuse a copy that is already running.
rem
rem Getting this order wrong is its own bug: after an update, an older Axis
rem still running from this morning answers on the port, this script cheerfully
rem opens it, and none of the new features are there. The update looks like it
rem failed when it was simply never loaded.
rem --------------------------------------------------------------------------
set NEEDS_INSTALL=0
set NEEDS_BUILD=0

rem Checking whether node_modules merely *exists* is not enough, and that
rem mistake is what produced "Can't resolve 'docx'": after an update adds a
rem library, the folder is there but the library isn't, so the install gets
rem skipped and the build fails on something you never touched. The lock file's
rem fingerprint is the honest question - if it differs from the last successful
rem install, there is work to do.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash; $s='data\.deps-stamp'; if((Test-Path 'node_modules') -and (Test-Path $s) -and ((Get-Content $s -Raw).Trim() -eq $h)){exit 0} else {exit 1}"
if errorlevel 1 set NEEDS_INSTALL=1

powershell -NoProfile -ExecutionPolicy Bypass -Command "if(-not (Test-Path '.next\BUILD_ID')){exit 1}; $b=(Get-Item '.next\BUILD_ID').LastWriteTimeUtc; $n=(Get-ChildItem -Recurse -File -Path 'src','public','package.json','next.config.ts' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc; if($n -gt $b){exit 1} else {exit 0}"
if errorlevel 1 set NEEDS_BUILD=1

rem If Axis is already running, use that one. Starting a second copy just fails
rem to take the port, and then you have a browser window pointed at a server
rem that never came up - which looks exactly like Axis being broken.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000' -TimeoutSec 2; exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 (
  if "%NEEDS_INSTALL%"=="1" goto stale
  if "%NEEDS_BUILD%"=="1" goto stale
  echo   Axis is already running - opening it.
  echo.
  start "" "%OPEN_URL%"
  exit /b 0
)

if "%NEEDS_INSTALL%"=="1" (
  echo   Getting what Axis needs. This takes a minute the first time.
  echo.
  call npm install
  if errorlevel 1 goto failed
  powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'"
  rem New libraries mean new code, which always needs a new build.
  set NEEDS_BUILD=1
)

if "%NEEDS_BUILD%"=="1" (
  echo   Preparing Axis. This happens after an update, not every time.
  echo.
  call npm run build
  if errorlevel 1 goto failed
)

rem Open the browser only once the server actually answers, so the first thing
rem seen is Axis rather than a connection error. Runs alongside the server
rem below, which holds this window.
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 120;$i++){try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000' -TimeoutSec 2;Start-Process '%OPEN_URL%';break}catch{Start-Sleep -Milliseconds 500}}"

echo   Starting. Your browser will open on its own.
echo   Closing this window shuts Axis down.
echo.
call npm run start

echo.
echo   Axis has stopped.
echo.
echo   If that happened immediately with an "address already in use" error,
echo   another copy is still running. Close its window, or restart the
echo   computer, then try again.
pause
exit /b 0

:stale
echo   Axis is already running, but it's an older version - the update you
echo   pulled hasn't been loaded yet.
echo.
echo   Close the other Axis window (the black one that says "Starting"), then
echo   run this again. It will install and rebuild, which takes about a minute.
echo.
pause
exit /b 1

:failed
echo.
echo   That didn't work. The error is above.
echo.
echo   Most of the time this is fixed by running REBUILD-AXIS.bat once,
echo   which reinstalls everything from scratch.
echo.
pause
exit /b 1
