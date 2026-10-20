param(
    [ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'umedademu'
)

# Run only after the Claude-based Gonta has been verified. Stops and disables the
# OpenClaw-era autostart and the WSL services. Nothing is uninstalled or deleted;
# `systemctl --user enable --now ...` inside WSL brings the old setup back.
$ErrorActionPreference = 'Continue'
$task = Get-ScheduledTask -TaskName 'Gonta-OpenClaw-Autostart' -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName 'Gonta-OpenClaw-Autostart' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'Gonta-OpenClaw-Autostart' -Confirm:$false
    Write-Output 'Removed the Gonta-OpenClaw-Autostart task.'
} else { Write-Output 'Gonta-OpenClaw-Autostart task was not registered.' }
# The launcher keeps a hidden PowerShell holding WSL open; end it so WSL can idle out.
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*Start-OpenClaw.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# No double quotes inside: Windows PowerShell 5.1 does not escape them for native commands.
& wsl.exe --distribution $Distribution --user $LinuxUser --exec /bin/bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user disable --now gonta-tunnel.service gonta.service openclaw-gateway.service; systemctl --user --no-pager --no-legend list-units openclaw* gonta*'
Write-Output 'OpenClaw services are stopped and disabled inside WSL (data and installation kept).'
