@echo off
setlocal
title Axis - unstick
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem For one situation, and it is the one that cost the most days.
rem
rem   error: Your local changes to the following files would be overwritten
rem          by merge:  package.json  package-lock.json
rem   Aborting
rem
rem When git says that, the pull does NOTHING. Every fix stays on GitHub, the
rem old broken file stays in this folder, and running the launcher again just
rem reruns the same broken copy. It looks exactly like a fix that did not work,
rem which is the worst thing it could look like.
rem
rem What this does about it: puts those local edits somewhere safe with
rem "git stash", pulls, and stops. It does not delete them - a stash can be
rem read back with "git stash list" and "git stash pop" for as long as you
rem like. Nothing in data\ is touched: settings, memories and history are not
rem git's business and it never sees them.
rem
rem It shows the plan first and waits. Nothing changes until a key is pressed.
rem ---------------------------------------------------------------------------

if not exist "data" mkdir "data"
set "LOG=data\last-fix.log"
echo Axis unstick %DATE% %TIME% (launcher 2026-09-02.1) > "%LOG%"

echo.
echo   A X I S   -   U N S T I C K
echo   ---------------------------
rem LAUNCHER VERSION 2026-09-02.1 - printed so it is obvious which copy is running.
echo   launcher 2026-09-02.1
echo.

where git >nul 2>nul
if errorlevel 1 goto no_git
if not exist "package.json" goto wrong_folder

rem --- is it even stuck? ------------------------------------------------------

git diff --quiet -- package.json package-lock.json
if errorlevel 1 goto is_stuck

echo   Your package.json and package-lock.json have no local edits, so a
echo   pull is not being blocked by them. Nothing here needs unsticking.
echo.
echo   Run CHECK-AXIS.bat - it will say what IS wrong.
echo.
echo Nothing to do: no local edits to package files. >> "%LOG%"
pause
exit /b 0

:is_stuck
echo   These two files have been edited in this folder:
echo.
git diff --stat -- package.json package-lock.json
echo.
echo   Those edits are why "git pull" aborts, and why the fixes on GitHub
echo   are not reaching this computer.
echo.
echo   Almost always these were not edited on purpose - npm rewrites both
echo   files whenever it installs something, so a stray "npm install" from
echo   another project is enough to do it.
echo.
echo   What I am about to do, in order:
echo.
echo     1. git stash push - moves those two edits into git's stash.
echo        They are KEPT, not deleted. "git stash list" shows them,
echo        "git stash pop" brings them back.
echo     2. git pull       - brings down the updates that are waiting.
echo     3. Tell you what to run next. I will not build anything myself.
echo.
echo   Nothing in your data folder is touched at any point.
echo.
echo   Press a key to do it, or close this window to leave it all alone.
pause >nul

rem --- 1. put the local edits somewhere safe ---------------------------------

echo.
echo   [1/3] Putting those edits in the stash...
echo Running git stash push >> "%LOG%"
git stash push -m "Axis unstick - local package edits" -- package.json package-lock.json >> "%LOG%" 2>&1
if errorlevel 1 goto stash_failed
echo         Kept. Recover them any time with: git stash pop

rem --- 2. pull ---------------------------------------------------------------

echo.
echo   [2/3] Getting the updates from GitHub...
echo Running git pull >> "%LOG%"
git pull >> "%LOG%" 2>&1
if errorlevel 1 goto pull_failed

echo.
echo   [3/3] Done. This folder is now up to date:
echo.
git log --oneline -1
git log --oneline -1 >> "%LOG%"
echo.

rem --- anything else in the folder worth knowing about ----------------------

if not exist "empty\package.json" goto no_nested
echo   One more thing, and it is worth reading.
echo.
echo   There is a SECOND project inside this folder, at:
echo       %CD%\empty
echo.
echo   It has its own package.json and its own src folder. It is not part of
echo   Axis. Axis no longer compiles it, so it can no longer break the build -
echo   but it should not be there. Look at what is in it, and move it out or
echo   delete it when you are ready. I am not going to delete it for you.
echo.
echo Nested project found at %CD%\empty >> "%LOG%"

:no_nested
echo   Now run REBUILD-AXIS.bat once. It will reinstall from the versions
echo   that just arrived and build from scratch, which is what clears the
echo   type errors about pptxgenjs and exceljs.
echo.
echo   After that, START-AXIS.bat as usual.
echo.
echo Unstick finished cleanly. >> "%LOG%"
pause
exit /b 0

rem --- the ways this can fail, each said separately -------------------------

:stash_failed
echo.
echo   git would not stash those edits, so I stopped before pulling and
echo   nothing has changed. This is unusual and the log says why.
echo.
echo FAILED: git stash push >> "%LOG%"
goto show_log

:pull_failed
echo.
echo   The edits are safely stashed, but the pull itself failed. That is a
echo   different problem from the one this file fixes - the log below has
echo   git's own words for it, and they are worth sending to me as they are.
echo.
echo   Your stashed edits are not lost. "git stash list" still shows them.
echo.
echo FAILED: git pull >> "%LOG%"
goto show_log

:no_git
echo   Git is not installed on this computer, so there is nothing here for
echo   me to unstick. Install it from https://git-scm.com/download/win
echo.
echo FAILED: git not on PATH >> "%LOG%"
pause
exit /b 1

:wrong_folder
echo   There is no package.json here, so this is not the Axis folder.
echo   This file has to sit next to the rest of Axis.
echo.
echo   Looking in: %CD%
echo.
echo FAILED: no package.json in %CD% >> "%LOG%"
pause
exit /b 1

:show_log
echo   The last 20 lines of what happened:
echo   -----------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content '%LOG%' -Tail 20" 2>nul
echo   -----------------------------------
echo.
echo   The whole log is in %CD%\%LOG%
echo.
pause
exit /b 1
