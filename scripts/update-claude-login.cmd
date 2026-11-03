@echo off
rem Double-click to renew Gonta's one-year Claude login token (see set-claude-token.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-claude-token.ps1"
echo.
pause
