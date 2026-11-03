# ゴンタ（常駐する Claude Code）用に、1年間有効なログイン用の合言葉を作って保存する。
# 通常のログインは約2週間で切れ、無人の常駐プロセスは自分で更新できないため。
# 合言葉は Claude Code 公式の `claude setup-token` で作り、このWindowsユーザーだけが
# 読めるように暗号化（DPAPI）して %USERPROFILE%\.gonta に保存する。画面とログには残さない。
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:USERPROFILE '.gonta'
$tokenFile = Join-Path $state 'claude-oauth-token.dpapi'
$infoFile = Join-Path $state 'claude-oauth-token.json'
New-Item -ItemType Directory -Path $state -Force | Out-Null

# Claude アプリの中から開いた場合でも、普通のログイン手順になるようにする。
Get-ChildItem env: | Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC_)' } | ForEach-Object { Remove-Item -LiteralPath ('env:' + $_.Name) }

$claude = $null
foreach ($candidate in @((Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'), (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))) {
    if (Test-Path -LiteralPath $candidate) { $claude = $candidate; break }
}
if (-not $claude) { $command = Get-Command claude -ErrorAction SilentlyContinue; if ($command) { $claude = $command.Source } }
if (-not $claude) { throw 'claude コマンドが見つかりません。Claude Code がインストールされているか確認してください。' }

Write-Host ''
Write-Host '=== ゴンタのログイン更新 ===' -ForegroundColor Cyan
Write-Host '1. このあとブラウザが開きます。Claude の画面で「承認（Authorize）」を押してください。'
Write-Host '2. この黒い画面に「sk-ant-oat」で始まる長い文字列が表示されます。それをコピーしてください。'
Write-Host '   （マウスで文字列をなぞって選び、右クリックするとコピーできます）'
Write-Host ''
Write-Host 'うまくいかないとき：' -ForegroundColor Yellow
Write-Host '  ブラウザに「ブラウザを確認できませんでした」と出たら、拡張機能が邪魔をしています。'
Write-Host '  この黒い画面に出ている https://claude.ai/... のURLをなぞってコピーし（c キーでコピーできる場合もあります）、'
Write-Host '  Chrome のシークレットウィンドウ（Ctrl + Shift + N）か Edge に貼り付けて開いてください。'
Write-Host '  ブラウザに確認コードが表示されたら、それをこの黒い画面に貼り付けて Enter を押します。'
Write-Host ''
& $claude setup-token
if ($LASTEXITCODE -ne 0) { throw ('claude setup-token が終了コード {0} で止まりました。もう一度実行してください。' -f $LASTEXITCODE) }

Write-Host ''
Write-Host '3. コピーした文字列を、下に貼り付けて Enter を押してください。' -ForegroundColor Cyan
Write-Host '   （右クリックで貼り付けられます。貼り付けても画面には表示されません）'
$secure = Read-Host '合言葉' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($plain -notmatch '^sk-ant-\S{20,}$') {
    $plain = $null
    throw '貼り付けた文字列の形が違います。sk-ant-oat で始まる文字列を、前後の空白なしでそのまま貼り付けてください。'
}
$clean = ConvertTo-SecureString -String $plain -AsPlainText -Force
$plain = $null
$clean | ConvertFrom-SecureString | Set-Content -LiteralPath $tokenFile -Encoding ASCII
$now = Get-Date
[ordered]@{ created = $now.ToString('o'); expires = $now.AddDays(365).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $infoFile -Encoding UTF8
Write-Host ''
Write-Host ('保存しました。有効期限はおよそ {0:yyyy年M月d日} です。期限の30日前から LINE でお知らせします。' -f $now.AddDays(365)) -ForegroundColor Green

# 動いているゴンタに読み直させる。止まっていれば、次の起動時に使われる。
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
    & $node.Source (Join-Path $repo 'scripts\local.mjs') restart
    if ($LASTEXITCODE -ne 0) { Write-Host 'ゴンタはいま止まっています。次に起動したとき、この合言葉が使われます。' }
}
Write-Host 'これで完了です。ゴンタに話しかけて、返事が来るか確かめてください。'
