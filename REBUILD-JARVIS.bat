@echo off
setlocal
title JARVIS - rebuild
cd /d "%~dp0"

rem Run this after changing JARVIS's code (or after a git pull). Settings and
rem memories live in the data folder and are untouched by any of this.

echo.
echo   Rebuilding JARVIS...
echo.

call npm install
if errorlevel 1 goto failed

call npm run build
if errorlevel 1 goto failed

echo.
echo   Done. Start JARVIS with START-JARVIS.bat.
echo.
pause
exit /b 0

:failed
echo.
echo   The rebuild failed. The error is above.
echo.
pause
exit /b 1
