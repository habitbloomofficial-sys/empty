@echo off
setlocal
title Axis - check
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem What this is for.
rem
rem A fix can be finished, pushed, and correct on GitHub, and still not be on
rem this computer. When that happens every symptom points at the fix being
rem wrong, because the old file is the only one anybody can see. The question
rem that settles it - "which version of these files am I actually running?" -
rem had no way of being asked, so this file asks it.
rem
rem It changes nothing. It installs nothing. It reads, and prints one screen.
rem
rem Same two rules as the other launchers: no parenthesised blocks, because
rem batch expands one before running any of it and a variable set and read
rem inside the same block reads its old value; and everything printed also goes
rem to data\last-check.log, so the screen can be sent rather than retyped.
rem ---------------------------------------------------------------------------

if not exist "data" mkdir "data"
set "LOG=data\last-check.log"
echo Axis check %DATE% %TIME% (launcher 2026-09-01.3) > "%LOG%"

echo.
echo   A X I S   -   C H E C K
echo   -----------------------
rem LAUNCHER VERSION 2026-09-01.3 - printed so it is obvious which copy is running.
echo   launcher 2026-09-01.3
echo.

rem --- where am I -------------------------------------------------------------

echo   Folder:  %CD%
echo Folder: %CD% >> "%LOG%"

if not exist "package.json" goto wrong_folder

rem --- which copy of the launchers is here ------------------------------------
rem
rem The stamp is printed by the launchers themselves too, so what is on screen
rem when one fails and what is reported here are the same number.

set "STAMP_START=(not stamped - this is an old copy)"
set "STAMP_REBUILD=(not stamped - this is an old copy)"
if not exist "START-AXIS.bat" goto no_start_file
for /f "tokens=4" %%v in ('findstr /c:"rem LAUNCHER VERSION" "START-AXIS.bat"') do set "STAMP_START=%%v"
:no_start_file
if not exist "REBUILD-AXIS.bat" goto no_rebuild_file
for /f "tokens=4" %%v in ('findstr /c:"rem LAUNCHER VERSION" "REBUILD-AXIS.bat"') do set "STAMP_REBUILD=%%v"
:no_rebuild_file

echo.
echo   START-AXIS.bat:    %STAMP_START%
echo   REBUILD-AXIS.bat:  %STAMP_REBUILD%
echo START-AXIS.bat: %STAMP_START% >> "%LOG%"
echo REBUILD-AXIS.bat: %STAMP_REBUILD% >> "%LOG%"

rem --- what does git say ------------------------------------------------------

where git >nul 2>nul
if errorlevel 1 goto no_git

set "BRANCH=(unknown)"
set "COMMIT=(unknown)"
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
for /f "delims=" %%c in ('git log -1 --pretty=format:"%%h %%s" 2^>nul') do set "COMMIT=%%c"

echo.
echo   Branch:  %BRANCH%
echo   Commit:  %COMMIT%
echo Branch: %BRANCH% >> "%LOG%"
echo Commit: %COMMIT% >> "%LOG%"

echo.
echo   Asking GitHub what the newest version is...
git fetch origin %BRANCH% >> "%LOG%" 2>&1
if errorlevel 1 goto fetch_failed

set "BEHIND=0"
set "AHEAD=0"
for /f "delims=" %%n in ('git rev-list --count HEAD..origin/%BRANCH% 2^>nul') do set "BEHIND=%%n"
for /f "delims=" %%n in ('git rev-list --count origin/%BRANCH%..HEAD 2^>nul') do set "AHEAD=%%n"
echo Behind: %BEHIND%  Ahead: %AHEAD% >> "%LOG%"

if not "%BEHIND%"=="0" goto behind
echo   Up to date with GitHub.
echo.
goto local_changes

:behind
echo.
echo   *** This folder is %BEHIND% update(s) BEHIND GitHub. ***
echo.
echo   That is the whole problem. The fix exists, it just isn't here yet.
echo   Run this, in this folder, and then try Axis again:
echo.
echo       git pull
echo.
echo   If git pull prints an error, send me that error - it is the answer.
echo.
echo VERDICT: behind by %BEHIND% >> "%LOG%"
goto local_changes

rem --- anything here that shouldn't be ---------------------------------------
rem
rem Files from another project sitting in src\ get compiled as though they
rem belonged to Axis, and the build fails naming modules Axis has never had.

:local_changes
git status --short src 2>nul | findstr /r "^??" >nul 2>nul
if errorlevel 1 goto no_strays
echo   Files in src\ that are not part of Axis:
echo.
git status --short src 2>nul | findstr /r "^??"
git status --short src 2>nul | findstr /r "^??" >> "%LOG%"
echo.
echo   These break the build even though nothing in Axis imports them:
echo       git clean -n -d src     shows what would go, deletes nothing
echo       git clean -f -d src     actually deletes them
echo.
goto tools

:no_strays
echo   No stray files in src\.
echo.

rem --- the tools Windows needs to have ---------------------------------------

:tools
set "NODEVER=(not installed)"
set "NPMVER=(not installed)"
for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
for /f "delims=" %%v in ('npm --version 2^>nul') do set "NPMVER=%%v"
echo   Node:    %NODEVER%
echo   npm:     %NPMVER%
echo Node: %NODEVER%  npm: %NPMVER% >> "%LOG%"

echo.
echo   -----------------------
echo   Saved to %CD%\%LOG%
echo   Send me that file and I can see everything above.
echo.
pause
exit /b 0

rem --- the things that stop this answering -----------------------------------

:wrong_folder
echo.
echo   There is no package.json here, so this is not the Axis folder.
echo   This file has to sit next to the rest of Axis. If you copied it to the
echo   desktop, delete the copy and make a shortcut instead - a copy on the
echo   desktop checks the desktop, which is how the wrong answer gets given.
echo.
echo FAILED: no package.json in %CD% >> "%LOG%"
pause
exit /b 1

:no_git
echo.
echo   Git is not installed on this computer, so I cannot tell whether this
echo   folder is up to date - and that is the question worth answering.
echo   Install it from https://git-scm.com/download/win and run this again.
echo.
echo FAILED: git not on PATH >> "%LOG%"
pause
exit /b 1

:fetch_failed
echo.
echo   Could not reach GitHub just now, so I cannot say whether this folder is
echo   up to date. Everything above this line is still true. This one check is
echo   the only thing that needs the internet - try it again in a moment.
echo.
echo FAILED: git fetch could not reach the remote >> "%LOG%"
goto local_changes
