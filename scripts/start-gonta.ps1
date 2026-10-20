param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [int]$Port = 18890
)

# Keeps the relay (Gonta + resident Claude Code) and the Cloudflare tunnel running
# without a terminal window. Started by the Gonta-Autostart task at sign-in.
$ErrorActionPreference = 'Stop'
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'Gonta'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$logPath = Join-Path $runtimeDirectory 'startup.log'

function Write-StartupLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message) -Encoding UTF8
}
function Rotate-Log([string]$Path) {
    if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 2097152) {
        Move-Item -LiteralPath $Path -Destination ($Path + '.previous') -Force
    }
}
function Resolve-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw 'node.exe was not found.'
}
function Start-Worker([string]$Name, [string]$Script) {
    Rotate-Log $logPath
    $out = Join-Path $runtimeDirectory ($Name + '.log')
    $err = Join-Path $runtimeDirectory ($Name + '.err.log')
    Rotate-Log $out; Rotate-Log $err
    $process = Start-Process -FilePath $script:node -ArgumentList @($Script) -WorkingDirectory $Repo -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Write-StartupLog ('Started {0} (pid {1}).' -f $Name, $process.Id)
    return $process
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\Gonta-Autostart')
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit 0 }
    $env:PORT = [string]$Port
    $script:node = Resolve-Node
    Write-StartupLog ('Launcher running for {0} on port {1} with {2}.' -f $Repo, $Port, $script:node)
    $workers = @{ relay = $null; tunnel = $null }
    $scripts = @{ relay = 'relay\server.mjs'; tunnel = 'scripts\tunnel.mjs' }
    $lastStart = @{ relay = [DateTime]::MinValue; tunnel = [DateTime]::MinValue }
    $delays = @{ relay = 0; tunnel = 0 }
    while ($true) {
        foreach ($name in @('relay', 'tunnel')) {
            $process = $workers[$name]
            if ($null -eq $process -or $process.HasExited) {
                if ($null -ne $process) {
                    $process.WaitForExit()
                    Write-StartupLog ('{0} exited with code {1}.' -f $name, $process.ExitCode)
                    $process.Dispose()
                    $workers[$name] = $null
                    # A worker that dies within 30 seconds is broken (missing cloudflared, port in use): retry slowly.
                    $delays[$name] = if (((Get-Date) - $lastStart[$name]).TotalSeconds -lt 30) { 60 } else { 10 }
                }
                if (((Get-Date) - $lastStart[$name]).TotalSeconds -ge $delays[$name]) {
                    try { $workers[$name] = Start-Worker $name $scripts[$name]; $lastStart[$name] = Get-Date }
                    catch { Write-StartupLog ('{0} could not start: {1}' -f $name, $_.Exception.Message); $lastStart[$name] = Get-Date }
                }
            }
        }
        Start-Sleep -Seconds 5
    }
}
finally {
    foreach ($process in $workers.Values) { if ($null -ne $process -and -not $process.HasExited) { try { $process.Kill() } catch {} } }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
