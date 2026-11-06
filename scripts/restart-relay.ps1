# ゴンタの中継役（relay\server.mjs）を起動し直して、新しいプログラムを読み込ませる。
# 動いている中継役を止めると、自動起動のタスク（Gonta-Autostart）が約10秒後に起動し直す。
# 最後に、ゴンタがどちらの払い方（API のクレジットか、サブスク）で動いているかを表示する。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'node.exe が見つかりません。' }
$task = Get-ScheduledTask -TaskName 'Gonta-Autostart' -ErrorAction SilentlyContinue
if (-not $task) { throw '自動起動のタスク Gonta-Autostart がありません。README の「Windowsログイン時の自動起動」の手順で登録してください。' }

Write-Host ''
Write-Host '=== ゴンタの中継役の起動し直し ===' -ForegroundColor Cyan
foreach ($relay in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'relay[\\/]server\.mjs' })) {
    Stop-Process -Id $relay.ProcessId -Force
    Write-Host ('動いていた中継役を止めました（番号 {0}）。' -f $relay.ProcessId)
}
if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName 'Gonta-Autostart'; Write-Host '自動起動のタスクを始めました。' }

Write-Host '起動を待っています（1分ほどかかることがあります）…'
$ErrorActionPreference = 'Continue'
$status = $null
Start-Sleep -Seconds 5
for ($i = 0; $i -lt 40 -and -not $status; $i++) {
    Start-Sleep -Seconds 3
    $text = & $node.Source (Join-Path $repo 'scripts\local.mjs') status 2>$null
    if ($LASTEXITCODE -eq 0) { try { $status = ($text | Out-String) | ConvertFrom-Json } catch { $status = $null } }
}
if (-not $status) {
    Write-Host '2分待っても起動を確かめられませんでした。%LOCALAPPDATA%\Gonta\relay.err.log を見てください。' -ForegroundColor Red
    exit 1
}
$month = $status.apiThisMonth
if ($status.route -eq 'api') {
    Write-Host ('起動しました。ゴンタは API のクレジットで動いています（今月 {0:N2} ドル／上限 {1} ドル）。' -f $month.usd, $month.limit) -ForegroundColor Green
} else {
    $reason = [string]$status.routeReason
    $why = if ($reason -match 'is not set') { 'API のキー（BOT_CLAUDE_API_KEY）が見つからない' }
        elseif ($reason -match 'used up') { ('今月の分（上限 {0} ドル）を使い切った。来月の最初の発言で API に戻ります' -f $month.limit) }
        elseif ($reason -match 'turned off') { '設定（config.json の claude.api）で API を使わないようにしている' }
        elseif ($reason -match 'not installed') { 'Agent SDK が入っていない。gonta フォルダで npm ci を実行してください' }
        elseif ($reason -match 'API failed|did not start|stopped before') { 'API でエラーが出た。1時間後にまた API を試します' }
        else { $reason }
    Write-Host ('起動しました。ゴンタはサブスクで動いています。わけ：{0}' -f $why) -ForegroundColor Yellow
    Write-Host ('（記録用のわけ：{0}）' -f $reason)
}
Write-Host 'ゴンタに話しかけて、返事が来るか確かめてください。'
