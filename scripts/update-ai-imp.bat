@echo off
rem One-click update for D:\AI-Imp. Double-click to use the newest update zip (in .\updates, this folder or
rem Downloads), or drag a zip onto this file. Keep this file and update-ai-imp.ps1 next to ai-agent-platform.
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-ai-imp.ps1" %*
set RC=%ERRORLEVEL%
echo.
if %RC% neq 0 (echo Update did not finish - see the red message above.) else (echo Done.)
pause
exit /b %RC%
