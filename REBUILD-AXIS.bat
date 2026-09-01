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
echo Axis rebuild %DATE% %TIME% > "%LOG%"

echo.
echo   Repairing Axis...
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

where npm >nul 2>nul
if errorlevel 1 goto no_npm

if not exist "package.json" goto wrong_folder

echo   [1/3] Installing everything Axis needs...
echo Running npm install >> "%LOG%"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 goto install_failed
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash | Set-Content 'data\.deps-stamp'" >nul 2>nul

echo.
echo   [2/3] Clearing the old build...
if exist ".next" rmdir /s /q ".next"

echo.
echo   [3/3] Building...
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
