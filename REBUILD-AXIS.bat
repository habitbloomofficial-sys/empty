@echo off
setlocal
title Axis - repair
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem The big hammer: reinstall everything and rebuild from scratch.
rem
rem START-AXIS.bat installs and rebuilds by itself when it needs to, so this is
rem only for when something has gone wrong and you want it all done again.
rem
rem Your settings, memories and session history live in the data folder and are
rem not touched by any of this.
rem
rem This file used to send installing and building to ONE failure message, and
rem that message blamed the internet. So a build that failed for its own reasons
rem — a stray file, a type error, anything at all — told you your connection had
rem dropped, and rerunning it could never help. Two failures, two messages, and
rem neither of them guesses.
rem ---------------------------------------------------------------------------

if not exist "data" mkdir "data"
set "LOG=data\last-rebuild.log"
echo Axis rebuild %DATE% %TIME% (launcher 2026-09-02.1) > "%LOG%"

echo.
echo   Repairing Axis...
echo.
rem LAUNCHER VERSION 2026-09-02.1 - printed so it is obvious which copy is running.
echo   launcher 2026-09-02.1
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

where npm >nul 2>nul
if errorlevel 1 goto no_npm

if not exist "package.json" goto wrong_folder

rem A pull that never landed cannot be rebuilt into working. Say so first,
rem rather than spending five minutes reinstalling the same broken copy.
git diff --quiet -- package.json package-lock.json 2>nul
if errorlevel 1 goto pull_is_blocked

echo   [1/4] Clearing the old libraries...
rem node_modules is downloaded, never written by hand, so removing it loses
rem nothing. It is also the only way to fix an install that no longer matches
rem package-lock.json - which is what "could not find a declaration file"
rem about a library usually means. npm install alone will not repair that.
if exist "node_modules" echo         Removing node_modules - this is why the next step is slow.
if exist "node_modules" rmdir /s /q "node_modules"
if exist "data\.deps-stamp" del /q "data\.deps-stamp" >nul 2>nul

echo.
echo   [2/4] Installing everything Axis needs. This one takes a few minutes.
echo Running npm install >> "%LOG%"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'" >nul 2>nul

echo.
echo   [3/4] Clearing the old build...
if exist ".next" rmdir /s /q ".next"

echo.
echo   [4/4] Building...
echo Running npm run build >> "%LOG%"
call npm run build >> "%LOG%" 2>&1
if errorlevel 1 goto build_failed

echo.
echo   Done. Start Axis with START-AXIS.bat.
echo.
echo Rebuild finished cleanly. >> "%LOG%"
pause
exit /b 0

rem --- each failure, with its own cause --------------------------------------

:pull_is_blocked
echo   Stopping before I reinstall anything, because it would not help.
echo.
echo   package.json and package-lock.json have local edits in this folder.
echo   That makes "git pull" abort without doing anything, so the fixes on
echo   GitHub have not arrived - and rebuilding an old copy just rebuilds
echo   an old copy.
echo.
echo   Run FIX-AXIS.bat first. It moves those edits somewhere safe, pulls,
echo   and sends you back here. Then this file will do some good.
echo.
echo Stopped: local package edits are blocking the pull >> "%LOG%"
pause
exit /b 1

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
echo.
echo   Looking in: %CD%
echo.
echo FAILED: no package.json in %CD% >> "%LOG%"
pause
exit /b 1

:install_failed
echo.
echo   Downloading what Axis needs didn't work.
echo.
echo   THIS one really is usually the connection - it is the only step that
echo   talks to the internet. Check you're online and run this again.
echo.
echo   If you are online and it still fails, the log below will say why.
goto show_log

:build_failed
echo.
echo   Everything downloaded fine. Axis then failed to BUILD, which has
echo   nothing to do with your internet - don't keep rerunning this.
echo.
rem "Cannot find module" naming a folder Axis has never had means files from
rem another project are sitting in src\. tsc compiles everything under there,
rem so they break the build even though nothing in Axis imports them.
git status --short src 2>nul | findstr /r "^??" >nul 2>nul
if errorlevel 1 goto build_failed_plain
echo   I can see why. There are files in src\ that aren't part of Axis:
echo.
git status --short src 2>nul | findstr /r "^??"
echo.
echo   Those are left over from another project worked on in this folder.
echo   Axis compiles everything under src\, so they break the build even
echo   though nothing in Axis uses them.
echo.
echo   Look at the list above. If you don't want them here:
echo       git clean -n -d src     (shows what would go - deletes nothing)
echo       git clean -f -d src     (actually deletes them)
echo.
goto show_log

:build_failed_plain
echo   The reason is in the log below. If it says "type check", read the
echo   file and line it names - that is the actual fault.
goto show_log

:show_log
echo.
echo   The last 20 lines of what happened:
echo   -----------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '%LOG%' -Tail 20" 2>nul
echo   -----------------------------------
echo.
echo   The whole log is in %CD%\%LOG%
echo   Send me that file and I can tell you exactly what went wrong.
echo.
pause
exit /b 1
