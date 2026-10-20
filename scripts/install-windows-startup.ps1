param(
    [int]$Port = 18890,
    [string]$DiaryTime = '03:00',
    [switch]$NoStart
)

# Registers two tasks for the signed-in user:
#   Gonta-Autostart  at sign-in: relay + resident Claude Code + Cloudflare tunnel
#   Gonta-Diary      daily at $DiaryTime: asks the resident Gonta to write the diary
# The OpenClaw-era task is left untouched; scripts\retire-openclaw.ps1 removes it.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Gonta'
$launcherPath = Join-Path $runtimeDirectory 'Start-Gonta.ps1'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-gonta.ps1') -Destination $launcherPath -Force

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited

$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Repo "{1}" -Port {2}' -f $launcherPath, $repo, $Port
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $runtimeDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Gonta (relay, resident Claude Code, tunnel) at Windows sign-in without a window.'
Register-ScheduledTask -TaskName 'Gonta-Autostart' -InputObject $task -Force | Out-Null

$diaryArguments = '"{0}" diary' -f (Join-Path $repo 'scripts\local.mjs')
$diaryAction = New-ScheduledTaskAction -Execute $node -Argument $diaryArguments -WorkingDirectory $repo
$diaryTrigger = New-ScheduledTaskTrigger -Daily -At $DiaryTime
$diarySettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$diaryTask = New-ScheduledTask -Action $diaryAction -Trigger $diaryTrigger -Principal $principal -Settings $diarySettings -Description 'Ask the resident Gonta to write yesterday''s diary.'
Register-ScheduledTask -TaskName 'Gonta-Diary' -InputObject $diaryTask -Force | Out-Null

if (-not $NoStart) { Start-ScheduledTask -TaskName 'Gonta-Autostart' }
Write-Output ('Installed Gonta-Autostart (port {0}) and Gonta-Diary ({1}). Logs: {2}' -f $Port, $DiaryTime, $runtimeDirectory)
