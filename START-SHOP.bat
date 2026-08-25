@echo off
setlocal
title AUREA - Trade Portal
cd /d "%~dp0"

rem The webshop.
rem
rem Same server as Axis - the shop is a room inside it, at /shop rather than at
rem the front door. Double-clicking START-AXIS.bat opens Axis and never shows
rem the shop at all, which is exactly the wrong first impression to hand a
rem customer. This opens the right page and leaves the rest alone.

echo.
echo   A U R E A   -   Trade Portal
echo   ----------------------------
echo.
echo   Access code: camilla
echo.

set "OPEN_URL=http://127.0.0.1:3000/shop"
call "%~dp0START-AXIS.bat"
