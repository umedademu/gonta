# Gonta

個人アシスタント「ゴンタ」に、WebとLINEから話しかけるための個人用チャットアプリです。ゴンタの頭脳は、このPC（Windows）で常駐する改変なしのClaude Code（`claude`コマンド）です。課金はPCにログイン済みのClaudeサブスクリプションだけで、APIキーは使いません。

## 構成

- `public/` — Vercelで配信する静的Web画面。スマートフォン対応。
- `relay/` — PC（Windows）で稼働する認証付き中継役。
  - `relay/brain.mjs` — `claude`を1本だけ常駐させ、発言を1ターンずつ流し込む。会話IDを保存し、落ちても同じ会話を復帰する。
  - `relay/server.mjs` — WebSocket API、LINE Webhook、メモ帳APIの転送、ローカル専用入口。
- `scripts/tunnel.mjs` — Cloudflare Quick Tunnelの接続先管理。LINE WebhookのURLを追従させます。
- `scripts/local.mjs` — PC内からの操作（状態確認・日記の実行・テスト送信）。
- `scripts/start-gonta.ps1` / `scripts/install-windows-startup.ps1` — Windowsログイン時の自動起動。
- `scripts/retire-openclaw.ps1` — 旧構成（WSLのOpenClaw）の停止。
- `scripts/legacy/` — 旧構成の起動スクリプト（参考・復旧用）。
- `test/` — 頭脳の入出力、作業表示、日記の日付、Webhook署名、連携コード、重複排除の検証。
- `worker/` — メモ帳用Cloudflare Worker。今回の移行では変更していません。

人格と記憶はリポジトリの外、`C:\Users\USER\gonta-brain` にあります（後述）。

## 頭脳（常駐するClaude Code）

中継役は起動時に`claude`を子プロセスとして1本起動し、作業ディレクトリを人格フォルダにして常駐させます。

- 入出力は `--input-format stream-json --output-format stream-json --include-partial-messages`。返答はWebへ逐次表示し、LINEへは完成後に送ります。
- WebとLINEの発言は同じ会話に順番に流します。同時実行はせず、待ち行列で1ターンずつ処理します。
- 権限は `--permission-mode acceptEdits`、許可ツールはPowerShell・Bash・ファイルの読み書き検索・Web取得・スキル。`--permission-prompts none` なので、許可外の操作は確認を待たずに拒否されます。サブエージェント（Agent）は使いません。
- 会話IDは `C:\Users\USER\.gonta\claude-session.json` に保存し、プロセスが落ちたときや中継役の再起動時は `--resume` で同じ会話を復帰します。復帰できない場合だけ新しい会話を始めます。
- `--bare` は付けません（サブスクのログインを使うため）。`ANTHROPIC_API_KEY` は設定せず、親プロセスから引き継いだClaude関連の環境変数も渡しません。
- モデルは `config.json` の `claude.model`（既定 `sonnet`）。利用枠はコーディング作業と共有なので、モデルを呼ぶのは人の発言と1日1回の日記だけです。定期的な見回りや通知はしません。
- 各発言には `[Web 2026-10-20 21:30]` のような送信元と日本時間の前置きを付けて渡します。ゴンタはこれで現在時刻を知ります。

## 人格フォルダ（`C:\Users\USER\gonta-brain`）

- `CLAUDE.md` — 人格（旧 SOUL / IDENTITY / USER / AGENTS を統合）。末尾で `MEMORY.md` を読み込みます。
- `MEMORY.md` — 長期記憶。`memory/` — 日々のメモと進捗ファイル。ゴンタ自身が会話の中で書き足します。
- `DIARY_TASK.md` — 毎晩の日記作成の手順。`.claude/skills/diary-writer/` — 日記の書式と決まり。
- `scripts/collect_diary_context.py` — 日記の材料集め（Web・LINEの会話、Codex Desktop、Claude Desktopの作業履歴）。
- `tasks/habits.md` — 習慣表（参照のみ）。`archive/openclaw/` — 移行前の元ファイルの写し。
- `.claude/settings.json` — 許可ツールの設定。

Desktop直下に置かないのは、`C:\Users\USER\Desktop\CLAUDE.md`（開発用の指示）を自動で継承してしまうためです。元のOpenClaw側のファイル（WSLの `~/.openclaw/workspace`）は消していません。

## 設定（`C:\Users\USER\.gonta\config.json`）

```json
{
  "passcode": "24文字以上のアクセスキー",
  "allowedOrigins": ["http://127.0.0.1:18890", "https://your-app.vercel.app"],
  "siteUrl": "https://your-app.vercel.app",
  "line": {"secret": "チャネルシークレット", "token": "チャネルアクセストークン", "botId": "@bot-id"},
  "claude": {"model": "sonnet", "workspace": "C:\\Users\\USER\\gonta-brain"}
}
```

`claude.model` は `sonnet` / `opus` / `fable` などの別名か正式名。`claude.effort` で思考の深さ、`claude.workspace` で人格フォルダの場所を変えられます。`line` を使わない場合は空のオブジェクトにします。`allowedOrigins` は接続のたびに読み直すので、トンネルのURLが変わっても中継役の再起動は不要です。その他の変更後は中継役を再起動します。

同じフォルダの `gonta.sqlite` に会話ログ（Web履歴用・日記の材料）、LINE連携、Webhook受信状態を保存します。`local-token` はローカル専用入口の合言葉、`discovery-private.pem` は接続先案内の署名鍵です。これらは共有・コミットしないでください。

## ローカル起動手順

Node.js 22.16以上、Windowsにインストールされログイン済みのClaude Code（`claude auth status` で確認）、Python 3（日記の材料集め）が必要です。

```sh
npm ci
npm start
```

初回に `~/.gonta/config.json` を作成します。`http://127.0.0.1:18890` を開き、アクセスキーを入力します。PC内からの確認は次のとおりです。

```powershell
node scripts\local.mjs status
node scripts\local.mjs say "こんにちは"
```

## Windowsログイン時の自動起動

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-startup.ps1
```

ユーザーのログイン時にタスク `Gonta-Autostart` が端末画面を開かずに起動スクリプト `%LOCALAPPDATA%\Gonta\Start-Gonta.ps1` を実行し、中継役（常駐 `claude` を含む）と外部接続トンネルを起動して監視します。落ちた場合は10秒後に再起動します。ログは `%LOCALAPPDATA%\Gonta\` の `startup.log`・`relay.log`・`tunnel.log`。同時に日記用のタスク `Gonta-Diary`（毎日03:00）も登録します。パスワードの登録は不要です。Windowsへログインする前の起動と、スリープ中・電源オフ中の利用はできません。

解除する場合:

```powershell
Unregister-ScheduledTask -TaskName Gonta-Autostart -Confirm:$false
Unregister-ScheduledTask -TaskName Gonta-Diary -Confirm:$false
```

## 日記

毎日03:00にタスク `Gonta-Diary` が `node scripts\local.mjs diary` を実行します。中継役のローカル専用入口（`127.0.0.1:18891`、トンネルは通さない、`local-token` が必要）へ指示が届き、常駐するゴンタが `DIARY_TASK.md` の手順で前日分（午前4時区切り）の日記を `C:\Users\USER\repo\my-vault\日記\YYYY\MM\YYYY年MM月DD日.md` に書きます。材料はその日のWeb・LINEの会話に加え、`collect_diary_context.py` が集めるCodex DesktopとClaude Desktopの作業履歴です。結果は `%LOCALAPPDATA%\Gonta\diary.log` に残ります。

手動で特定の日を書く場合:

```powershell
node scripts\local.mjs diary 2026-10-20
```

日記の実行中、Web画面では日記を書く姿が表示されます。旧構成の4時間おきの更新とDiscord投稿は廃止しました。

## 接続

`http://127.0.0.1:18890` またはVercelのWeb画面を開き、PC側の接続先URLとアクセスキーを入力します。通常はアクセスキーをブラウザのsessionStorageに保持します。「この端末で接続情報を覚える」を選ぶとlocalStorageに保存して次回も自動接続します。Web版の接続先URLは自動取得します。詳しくは[接続ガイド](CONNECTION.md)を参照してください。送信結果が不明なメッセージは自動再送しません。

Cloudflare Quick Tunnelは `scripts/tunnel.mjs` が起動します。`cloudflared` はWindowsなら `winget install Cloudflare.cloudflared` で導入でき、PATH上か `%LOCALAPPDATA%\Microsoft\WinGet\Links` から探します（`GONTA_CLOUDFLARED` で場所を指定可能）。`.local/接続情報.txt` と `.local/Gontaを開く.url` に最新情報が出力されます。これらは秘密情報を含むため共有・コミットしないでください。

**Quick Tunnelは試用向けで、再起動時にURLが変わり、可用性の保証もありません。** LINEのWebhook URLは自動更新され、Webは接続先を自動取得します。恒久運用では独自ドメインを使った名前付きTunnelに切り替えてください。

## メモ帳

画面右端の「« メモ」でメモ帳を開き、「メモ1〜5」のタブで最大5つのメモを切り替えます。タブ名の変更、自動保存、競合時の下書き保持など、動作は従来どおりです。保存APIは専用Worker `gonta-memo`、保存先はD1 `gonta-memo` の5行で、Vercelの `/api/memo?id=1`〜`5` から転送します。通常の接続キーから用途を分けて導出したトークンで認証し、WorkerにはそのSHA-256ハッシュを secret `MEMO_TOKEN_HASH` として登録します。PCが停止中でも、接続キーを保持した端末ならメモは利用できます。

```sh
npx wrangler d1 execute gonta-memo --remote --config worker/wrangler.jsonc --file worker/migrations/0001_memo.sql
npx wrangler d1 execute gonta-memo --remote --config worker/wrangler.jsonc --file worker/migrations/0002_memo_tabs.sql
npx wrangler d1 execute gonta-memo --remote --config worker/wrangler.jsonc --file worker/migrations/0003_memo_titles.sql
npx wrangler deploy --config worker/wrangler.jsonc --secrets-file /secure/path/memo-secrets.json
```

secretのJSONは `{"MEMO_TOKEN_HASH":"SHA256(SHA256('gonta.memo.v1:' + 接続キー)の小文字hex文字列)の小文字hex文字列"}`。実際の値や接続キーはコミットしないでください。

## LINE

1. 専用のLINE公式アカウントを作成し、Messaging APIを有効にします。
2. チャネルシークレット・アクセストークンをPC側設定に保存します。
3. Webhookを `https://your-tunnel/line/webhook` に設定し、「Webhookの利用」を有効にします。既定の応答メッセージは無効にします。
4. Webで「LINEとつなぐ」から連携コードを発行し、LINEボットに送ります。コードは10分間・1回限りです。

連携後はそのまま送ると、Webと同じ1つの会話の続きになります。個人トークのテキストのみ対応します。Webhookは署名を検証し、イベントIDをSQLiteに保存して再送を重複排除します。処理を始めたイベントはクラッシュ後に自動実行しません。45秒以内に返答が完成しないときは「考え中」と返し、完成後にプッシュメッセージで送ります。

## 旧構成（OpenClaw）からの切り替え

新構成の動作確認後に、旧構成の自動起動とWSL内のサービスを止めます。アンインストールやデータ削除はしません。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\retire-openclaw.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-startup.ps1
```

旧構成に戻す場合はWSL内で `systemctl --user enable --now openclaw-gateway.service gonta.service gonta-tunnel.service` を実行し、`scripts/legacy/` のスクリプトで旧タスクを登録し直します。

## セキュリティと範囲

未認証では履歴・送信APIを利用できません。WebSocketは許可Originを検証し、HMACチャレンジで認証します。LINEは署名と、Webで発行したコードによるユーザー連携の両方が必要です。ローカル専用入口はループバックのみで、トンネルを通さず、合言葉ファイルが必要です。

**認証済みユーザーの発言は、常駐するClaude Codeの権限（PowerShell実行・ファイル操作）で実行されます。** アクセスキーと自動接続リンクを他人に渡さないでください。TLSはCloudflareで終端します。LINE利用時はLINEにも送受信内容が渡ります。VercelとGitHubにはアプリのソースコードだけを置き、トークン・会話履歴・人格フォルダを置きません。

Discordの受け口は旧構成とともに停止しています。添付ファイル、画像表示、Claude Codeの確認ダイアログは未対応です。

## 検証・デプロイ

```sh
npm test
npm run build
```

日記の材料集めの検証は人格フォルダで `python -m unittest test_claude_diary_context test_diary_context`（`scripts` 内）。Vercelの出力は `dist/`。秘密情報を環境変数に登録する必要はありません。

参考: [Claude Code ヘッドレス実行](https://code.claude.com/docs/en/headless)、[Claude Code 利用規約の整理](https://code.claude.com/docs/en/legal-and-compliance)、[LINE Messaging API](https://developers.line.biz/ja/docs/messaging-api/)、[Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
