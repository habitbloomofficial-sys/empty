@echo off
setlocal
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem He is called Jarvis again. This file is the old name, kept because there is
rem a shortcut on his desktop pointing at it and a renamed file would simply
rem stop working one day with no explanation — which, after the fortnight we
rem have just had, is the last thing this folder needs.
rem
rem It says the new name once and then does the job. Delete it whenever the
rem shortcut has been repointed; nothing depends on it.
rem ---------------------------------------------------------------------------

rem LAUNCHER VERSION 2026-09-12.1 - printed so it is obvious which copy is running.
echo   launcher 2026-09-12.1
echo.
echo   He's called Jarvis now - this is START-JARVIS-PHONE.bat
echo.

if not exist "START-JARVIS-PHONE.bat" goto missing
call "START-JARVIS-PHONE.bat" %*
exit /b %ERRORLEVEL%

:missing
echo   START-JARVIS-PHONE.bat isn't in this folder, so there is nothing to hand over to.
echo   Run CHECK-JARVIS.bat, or pull the latest version with: git pull
echo.
pause
exit /b 1
