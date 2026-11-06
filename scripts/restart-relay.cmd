@echo off
rem Double-click to restart Gonta's relay so new code is loaded (see restart-relay.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-relay.ps1"
echo.
pause
