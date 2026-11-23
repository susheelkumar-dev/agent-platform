@echo off
rem One click, from nothing to a running app: check, set up, migrate GridTrade, start (with UI Forge).
rem Double-click it from Explorer, or run it in a normal (not Administrator) window. Safe to run again at any time.
setlocal
cd /d "%~dp0"
set PS=powershell.exe -NoProfile -ExecutionPolicy Bypass -File

echo.
echo ===== 1/4  Checking prerequisites =====
%PS% scripts\check-prereqs.ps1 || goto :fail
echo.
echo ===== 2/4  Setting up (Python environment, config, tests) =====
%PS% scripts\setup-local.ps1 || goto :fail
echo.
echo ===== 3/4  Converting GridTrade to React, first time only (install, type-check, build) =====
%PS% scripts\migrate-gridtrade.ps1 -IfMissing || goto :fail
echo.
echo ===== 4/4  Starting the API, registry, React app and UI Forge =====
%PS% scripts\start-local.ps1 -WithBuilder || goto :fail
echo.
echo Done. React app: http://localhost:5173 (admin / GridTrade#2026)   UI Forge: http://127.0.0.1:8140
echo To stop everything later: scripts\stop-local.ps1
pause
exit /b 0

:fail
echo.
echo Stopped at the step above. Fix what it says (the red lines), then run this file again.
pause
exit /b 1
