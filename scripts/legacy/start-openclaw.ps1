param(
    [ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'umedademu'
)

$ErrorActionPreference = 'Stop'
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Gonta'
$logPath = Join-Path $runtimeDirectory 'startup.log'
$wslPath = Join-Path $env:SystemRoot 'System32\wsl.exe'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

function Write-StartupLog([string]$Message) {
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 524288) {
        Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force
    }
    Add-Content -LiteralPath $logPath -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message) -Encoding UTF8
}

# Keep one foreground WSL process alive after the services have started.
# systemd services alone do not prevent WSL from shutting down when idle.
$linuxStartup = @'
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
for attempt in {1..30}; do
    if [ -S "$XDG_RUNTIME_DIR/bus" ] &&
       systemctl --user start openclaw-gateway.service gonta.service gonta-tunnel.service &&
       systemctl --user is-active --quiet openclaw-gateway.service gonta.service gonta-tunnel.service; then
        echo 'OpenClaw, Gonta and tunnel are active; keeping WSL running.'
        exec /bin/sleep infinity
    fi
    /bin/sleep 2
done
echo 'Could not start the OpenClaw services.' >&2
exit 1
'@
$linuxStartup = $linuxStartup.Replace("`r`n", "`n")

$mutex = New-Object System.Threading.Mutex($false, 'Local\Gonta-OpenClaw-Autostart')
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit 0 }
    while ($true) {
        try {
            Write-StartupLog ('Starting services in {0} as {1}.' -f $Distribution, $LinuxUser)
            # Send Bash source through stdin, avoiding Windows PowerShell 5.1's
            # native argument quoting of embedded shell quotes and newlines.
            $startInfo = New-Object System.Diagnostics.ProcessStartInfo
            $startInfo.FileName = $wslPath
            # WSL treats quotes around these simple names as part of the name.
            # Both parameters are restricted above to characters safe here.
            $startInfo.Arguments = '--distribution {0} --user {1} --exec /bin/bash -s' -f $Distribution, $LinuxUser
            $startInfo.UseShellExecute = $false
            $startInfo.CreateNoWindow = $true
            $startInfo.RedirectStandardInput = $true
            $startInfo.RedirectStandardOutput = $true
            $startInfo.RedirectStandardError = $true
            $child = New-Object System.Diagnostics.Process
            $child.StartInfo = $startInfo
            try {
                $child.Start() | Out-Null
                $stderr = $child.StandardError.ReadToEndAsync()
                $child.StandardInput.Write($linuxStartup + "`n")
                $child.StandardInput.Close()
                while ($null -ne ($line = $child.StandardOutput.ReadLine())) { Write-StartupLog $line }
                $child.WaitForExit()
                $errorText = $stderr.GetAwaiter().GetResult().Trim()
                if ($errorText) { Write-StartupLog $errorText }
                Write-StartupLog ('WSL exited with code {0}; retrying in 15 seconds.' -f $child.ExitCode)
            }
            finally { $child.Dispose() }
        }
        catch { Write-StartupLog ('Startup error: {0}; retrying in 15 seconds.' -f $_.Exception.Message) }
        Start-Sleep -Seconds 15
    }
}
finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
