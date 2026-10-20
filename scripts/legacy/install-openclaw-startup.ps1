param(
    [ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'umedademu'
)

$ErrorActionPreference = 'Stop'
$taskName = 'Gonta-OpenClaw-Autostart'
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Gonta'
$launcherPath = Join-Path $runtimeDirectory 'Start-OpenClaw.ps1'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-openclaw.ps1') -Destination $launcherPath -Force

$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Distribution "{1}" -LinuxUser "{2}"' -f $launcherPath, $Distribution, $LinuxUser
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $runtimeDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start OpenClaw and Gonta in WSL at Windows sign-in, without opening a terminal.'
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output ('Installed and started {0}. Log: {1}\startup.log' -f $taskName, $runtimeDirectory)
