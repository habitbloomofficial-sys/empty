@echo off
setlocal
title Axis
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem Starting Axis, and saying what happened when it doesn't start.
rem
rem Two rules shape this file.
rem
rem First: no parenthesised blocks. Batch expands a whole ( ... ) block before
rem it runs any of it, so a variable set inside one and read inside the same one
rem reads its old value. That bug is invisible, it depends on where the lines
rem sit, and it cannot be tested from anywhere but Windows. Labels and goto have
rem none of that, so this file uses them everywhere and reads slightly longer in
rem exchange for being correct.
rem
rem Second: everything that happens is written to data\last-launch.log. "It
rem doesn't work" is not something anyone can act on. A log is.
rem ---------------------------------------------------------------------------

if not exist "data" mkdir "data"
set "LOG=data\last-launch.log"
echo Axis launch %DATE% %TIME% > "%LOG%"

echo.
echo   A X I S
echo   -------
echo.

rem --- the things Windows may not have ---------------------------------------

where node >nul 2>nul
if errorlevel 1 goto no_node
for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo Node %NODEVER% >> "%LOG%"

where npm >nul 2>nul
if errorlevel 1 goto no_npm

if not exist "package.json" goto wrong_folder

rem PowerShell does the version checks below. If it is missing or blocked this
rem still runs — it just installs and builds every time rather than working out
rem that it needn't.
set "PS=1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "exit 0" >nul 2>nul
if errorlevel 1 set "PS=0"
echo PowerShell available: %PS% >> "%LOG%"

rem --- is what is on disk newer than what was last built? --------------------
rem
rem Worked out BEFORE deciding to reuse a copy that is already running. Get that
rem order wrong and an Axis from this morning answers on the port, this script
rem opens it, and the update looks like it failed when it was never loaded.

set "NEEDS_INSTALL=0"
set "NEEDS_BUILD=0"

if "%PS%"=="0" goto assume_work

rem Whether node_modules merely EXISTS is not the question — after an update
rem adds a library the folder is there and the library isn't. The lock file's
rem fingerprint against the last successful install is the honest question.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash; $s='data\.deps-stamp'; if((Test-Path 'node_modules') -and (Test-Path $s) -and ((Get-Content $s -Raw).Trim() -eq $h)){exit 0}else{exit 1}" >nul 2>nul
if errorlevel 1 set "NEEDS_INSTALL=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "if(-not (Test-Path '.next\BUILD_ID')){exit 1}; $b=(Get-Item '.next\BUILD_ID').LastWriteTimeUtc; $n=(Get-ChildItem -Recurse -File -Path 'src','public','package.json','next.config.ts' -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc; if($n -gt $b){exit 1}else{exit 0}" >nul 2>nul
if errorlevel 1 set "NEEDS_BUILD=1"
goto checked

:assume_work
rem No PowerShell to ask, so assume there is work to do. Slower, never wrong.
if not exist "node_modules" set "NEEDS_INSTALL=1"
if not exist ".next\BUILD_ID" set "NEEDS_BUILD=1"

:checked
echo Needs install: %NEEDS_INSTALL%  Needs build: %NEEDS_BUILD% >> "%LOG%"

rem --- is one already running? -----------------------------------------------
rem
rem netstat rather than PowerShell: it is in every Windows, it needs no
rem execution policy, and it answers instantly.

set "RUNNING=0"
netstat -ano | findstr /r /c:"TCP.*:3000 .*LISTENING" >nul 2>nul
if not errorlevel 1 set "RUNNING=1"
echo Port 3000 in use: %RUNNING% >> "%LOG%"

if "%RUNNING%"=="0" goto do_install
if "%NEEDS_INSTALL%"=="1" goto stale
if "%NEEDS_BUILD%"=="1" goto stale

echo   Axis is already running - opening it.
echo.
echo Reused the running copy. >> "%LOG%"
start "" http://127.0.0.1:3000
exit /b 0

rem --- install ---------------------------------------------------------------

:do_install
if "%NEEDS_INSTALL%"=="0" goto do_build
echo   Getting what Axis needs. This takes a minute the first time.
echo.
echo Running npm install >> "%LOG%"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 goto install_failed
if "%PS%"=="1" powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'"
rem New libraries mean new code, which always needs a new build.
set "NEEDS_BUILD=1"

rem --- build -----------------------------------------------------------------

:do_build
if "%NEEDS_BUILD%"=="0" goto launch
echo   Preparing Axis. This happens after an update, not every time.
echo.
echo Running npm run build >> "%LOG%"
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 goto build_failed

rem --- launch ----------------------------------------------------------------

:launch
echo Starting the server >> "%LOG%"

rem Open the browser only once the server answers, so the first thing seen is
rem Axis rather than a connection error.
start "" powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 120;$i++){try{$null=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3000' -TimeoutSec 2;Start-Process 'http://127.0.0.1:3000';break}catch{Start-Sleep -Milliseconds 500}}"

echo   Starting. Your browser will open on its own.
echo   Closing this window shuts Axis down.
echo.
call npm run start

echo.
echo   Axis has stopped.
echo.
echo   If that happened immediately, something else is using port 3000.
echo   Close the other Axis window, or restart the computer, then try again.
echo.
pause
exit /b 0

rem --- everything that can go wrong, said plainly ----------------------------

:no_node
echo   Node.js isn't installed on this computer.
echo   Opening the download page - install it, then run this again.
echo.
echo FAILED: node is not installed >> "%LOG%"
start "" https://nodejs.org/en/download
pause
exit /b 1

:no_npm
echo   Node.js is installed but npm isn't on the PATH.
echo   Reinstalling Node.js from nodejs.org fixes this - it includes npm.
echo.
echo FAILED: npm not on PATH >> "%LOG%"
pause
exit /b 1

:wrong_folder
echo   There's no package.json here, so this isn't the Axis folder.
echo   This file has to stay next to the rest of Axis - if you copied it to
echo   the desktop, make a shortcut instead.
echo.
echo   Looking in: %CD%
echo.
echo FAILED: no package.json in %CD% >> "%LOG%"
pause
exit /b 1

:install_failed
echo.
echo   Installing what Axis needs didn't work.
echo.
echo   The usual cause is the internet dropping partway through. Run this
echo   again first; if it fails twice, run REBUILD-AXIS.bat.
goto show_log

:build_failed
echo.
echo   Axis didn't build.
echo.
echo   If the log mentions "type check" or a missing module, an update needs
echo   installing: run REBUILD-AXIS.bat once and it will sort itself out.
goto show_log

:stale
echo   Axis is already running, but it's an older version - the update you
echo   pulled hasn't been loaded yet.
echo.
echo   Close the other Axis window (the black one that says "Starting"), then
echo   run this again. It will install and rebuild, which takes about a minute.
echo.
echo Stopped: a stale copy is running >> "%LOG%"
pause
exit /b 1

:show_log
echo.
echo   The last 15 lines of what happened:
echo   -----------------------------------
if "%PS%"=="1" powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '%LOG%' -Tail 15"
echo   -----------------------------------
echo.
echo   The whole log is in %CD%\%LOG%
echo   Send me that file and I can tell you exactly what went wrong.
echo.
pause
exit /b 1
