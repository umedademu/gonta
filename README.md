# Gonta

個人アシスタント「ゴンタ」に、WebとLINEから話しかけるための個人用チャットアプリです。ゴンタの頭脳は、このPC（Windows）で常駐する改変なしのClaude Codeです。ふだんは Claude Agent SDK を通して動き、利用者のプランに付く月200ドルの API クレジットで払います（プランの週の枠は使いません）。キーが無い・API が失敗した・ゴンタの月の分（20ドル）を使い切ったときは、同じ会話のまま、PCにログイン済みのClaudeサブスクリプションで動く `claude` コマンドに切り替わります。

## 構成

- `public/` — Vercelで配信する静的Web画面。スマートフォン対応。
- `relay/` — PC（Windows）で稼働する認証付き中継役。
  - `relay/brain.mjs` — 頭脳を1本だけ常駐させ、発言を1ターンずつ流し込む。ふだんは Agent SDK（API のクレジット）、だめなときは `claude`（サブスク）。会話IDを保存し、落ちても道が切り替わっても同じ会話を続ける。
  - `relay/spend.mjs` — API で使った額を、ほかのBOTと共通の帳（`使った額.csv`）に書き、ゴンタの月の上限を確かめる。
  - `relay/server.mjs` — WebSocket API、LINE Webhook、Discord受け口、メモ帳APIの転送、ローカル専用入口。
  - `relay/discord.mjs` — Discordのボット接続（受信はGateway、返信はREST）。
- `scripts/tunnel.mjs` — Cloudflare Quick Tunnelの接続先管理。LINE WebhookのURLを追従させます。
- `scripts/local.mjs` — PC内からの操作（状態確認・日記の実行・テスト送信・頭脳の再起動）。
- `scripts/update-claude-login.cmd` / `scripts/set-claude-token.ps1` — 頭脳用の1年有効なログイン用の合言葉を作って保存する（ダブルクリックで実行）。
- `scripts/restart-relay.cmd` / `scripts/restart-relay.ps1` — 中継役を起動し直し、どちらの払い方で動いているかを表示する（ダブルクリックで実行）。
- `scripts/start-gonta.ps1` / `scripts/install-windows-startup.ps1` — Windowsログイン時の自動起動。
- `scripts/retire-openclaw.ps1` — 旧構成（WSLのOpenClaw）の停止。
- `scripts/legacy/` — 旧構成の起動スクリプト（参考・復旧用）。
- `test/` — 頭脳の入出力、API の道とサブスクの道の切り替え、使った額の記録、作業表示、日記の日付、Discordの受け口、Webhook署名、連携コード、重複排除の検証。
- `worker/` — メモ帳用Cloudflare Worker。今回の移行では変更していません。

人格と記憶はリポジトリの外、`C:\Users\USER\gonta-brain` にあります（後述）。

## 頭脳（常駐するClaude Code。ふだんは API のクレジット、だめなときはサブスク）

中継役は頭脳を1本だけ常駐させ、作業ディレクトリを人格フォルダにします。動かし方（道）は2つあり、どちらも同じ会話（同じ会話ID）をそのまま続けます。

- **API の道（ふだん）**：[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)（`@anthropic-ai/claude-agent-sdk`。版を固定。中に同じ版の Claude Code が入っています）の `query()` に、発言を1つずつ流し込みます。払いは利用者のプランに付く月200ドルの API クレジットで、プランの週の枠は使いません。
  - キーはユーザーの環境変数 `BOT_CLAUDE_API_KEY` から読み、前から動いているプロセスに見えないときはレジストリ（`HKCU\Environment`）から読みます。
  - キーは頭脳の子プロセスの環境にだけ `ANTHROPIC_API_KEY` という名前で渡します。PC全体や中継役自身には置きません（置くと、このPCのほかの Claude Code が全部キーの払いに切り替わります）。キーは画面・ログ・記録に出しません。
- **サブスクの道（予備）**：これまでどおり `claude` を `--input-format stream-json` で常駐させます。ログインは、保存済みの1年有効な合言葉（`claude setup-token`）があればそれを、なければPCの通常のログインを使います（次の節）。`--bare` は付けません。
- **切り替え**：次のときはサブスクの道で動き、ログ（`%LOCALAPPDATA%\Gonta\relay.log` と `relay.err.log`）に `Claude route: subscription, because ...` と残します。API の道に戻ったときは `Claude route: API credit (Agent SDK)` と残します。
  - キーが見つからない。キーを入れた後に `node scripts\local.mjs restart` を実行すると API の道に戻ります。
  - API が失敗した（キーの誤り・クレジット切れ・混雑など）。その発言はサブスクの道で答え直します。API は1時間後の発言か、`restart` のときにまた試します。
  - ゴンタの今月の分（既定20ドル。日本時間の1日〜月末）を使い切った。次の月の最初の発言で API の道に戻ります。
  - 切り替えは発言と発言の間だけで、前の頭脳が終わったのを確かめてから次を起動します（1つの会話を2本で同時に動かさないため）。
- **使った額**：API の道の1ターンごとに、ほかのBOTと共通の帳 `C:\Users\USER\Desktop\bot-office\.local\APIクレジット\使った額.csv` へ、モデルごとに1行足します（部門は `gonta`、使い道は「Webの会話」「LINEの会話」「Discordの会話」「PCからの送信」「日記」）。
  - Claude Code が答えに付ける使用量は、会話を通した合計（前の起動の分も含む）なので、前回から増えた分だけを書きます。起動し直した直後は、会話の記録に残る合計から数え始めます。
  - ほかのBOTも書く帳なので、ほかのBOTと同じ印のファイル（`使った額.csv.lock`）を作れたときだけ書きます。書けなかった行は覚えておき、次のターンで書きます（その間も今月の額には数えます）。
  - 今月の額は、この帳の `gonta` の行を足して数えます。
- **どちらの道でも同じこと**：
  - 返答はWebへ逐次表示し、LINEへは完成後に送ります。
  - Web・LINE・Discordの発言は同じ1つの会話に順番に流します。同時実行はせず、待ち行列で1ターンずつ処理します。
  - 権限は `acceptEdits`、許可ツールはPowerShell・Bash・ファイルの読み書き検索・Web取得・スキル。許可外の操作は確認を待たずに拒否されます（`permission-prompts none`）。サブエージェント（Agent）は使いません。外部接続（MCP）は読みません。
  - Claude Code の標準の指示文と、人格フォルダの `CLAUDE.md`・設定を読みます。親プロセスから引き継いだClaude関連の環境変数は渡しません。
  - ゴンタが動かす PowerShell や Bash からは、キーも合言葉も見えません（`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`）。
- 会話IDは `C:\Users\USER\.gonta\claude-session.json` に保存し、プロセスが落ちたとき・中継役の再起動時・道の切り替え時は同じ会話を復帰します（resume）。復帰できない場合だけ新しい会話を始めます。
- モデルは `config.json` の `claude.model`（既定 `sonnet`）。モデルを呼ぶのは人の発言と1日1回の日記だけです。定期的な見回りや通知はしません。
- 各発言には `[Web 2026-10-20 21:30]` や `[Discord #何でも 梅田 2026-10-20 21:30]` のような送信元と日本時間の前置きを付けて渡します。ゴンタはこれで現在時刻を知ります。
- いまどちらの道で動いているか、今月いくら使ったかは `node scripts\local.mjs status` の `route`（`api`＝API の道、`plan`＝サブスクの道）・`routeReason`・`apiThisMonth` で確かめられます。

## ログインの期限（大事）

サブスクの道は、API の道が使えないときの予備です。いざというときに動けるよう、ログインは切らさないでください。

PCの通常のログイン（`claude auth login` や `/login`）には期限があり、このPCでは14日で切れました（2026-10-20のログインが2026-11-03 15:24に失効）。対話画面なら起動時に警告が出ますが、常駐する頭脳には出ず、期限が切れると自分では更新できません。そのため、無人運用には公式の[`claude setup-token`](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)で作る1年有効な合言葉を使います。サブスクの道の課金は同じClaudeサブスクリプションです（API のクレジットではありません）。

更新手順（1年ごと、またはログイン切れの案内が出たとき）:

1. このPCで `scripts\update-claude-login.cmd` をダブルクリックします。
2. 開いたブラウザでClaudeの「承認（Authorize）」を押します。
3. 黒い画面に表示された `sk-ant-oat` で始まる文字列をコピーし、同じ画面の「合言葉」に貼り付けてEnterを押します。

合言葉はこのWindowsユーザーだけが読めるように暗号化（DPAPI）して `C:\Users\USER\.gonta\claude-oauth-token.dpapi` に保存され、画面・ログ・GitHubには残りません。日付だけを `claude-oauth-token.json` に記録し、期限の30日前・7日前・前日・当日にLINEでお知らせします（ふだん API の道で動いていても、予備のためにお知らせします）。保存後はスクリプトが頭脳を再起動して新しい合言葉を読み込ませます。

サブスクの道でログインが切れているとき、ゴンタは英語のエラーではなく「PCのClaudeのログイン期限が切れたため、返事ができません」と返します。ログインし直した後の最初の発言で頭脳を自動的に起動し直すので、中継役の再起動は不要です。手動で読み直させるときは `node scripts\local.mjs restart`（API の道も試し直します）。いま何で動いているかは `node scripts\local.mjs status` の `authSource`（`api`＝API のキー、`token`＝合言葉、`login`＝通常のログイン）、合言葉の期限は `tokenExpires`（合言葉で動いているときだけ）で確認できます。

合言葉をやめて通常のログインに戻すときは、`claude-oauth-token.dpapi` と `claude-oauth-token.json` を消して `node scripts\local.mjs restart` を実行します。

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
  "discord": {
    "token": "Botトークン",
    "guilds": {"サーバーID": {"deny": ["返答しないチャンネルID"]}},
    "dm": true,
    "requireMention": true,
    "announce": {"diary": "日記の結果を投稿するチャンネルID"},
    "diaryChannels": ["日記の材料にするチャンネルID"],
    "diaryAuthor": "梅田さんのユーザーID"
  },
  "claude": {"model": "sonnet", "workspace": "C:\\Users\\USER\\gonta-brain", "api": true, "apiMonthlyUsd": 20}
}
```

`discord` を省くとDiscordの受け口は起動しません。`claude.model` は `sonnet` / `opus` / `fable` などの別名か正式名。`claude.effort` で思考の深さ、`claude.workspace` で人格フォルダの場所を変えられます。`claude.api` を `false` にすると API の道を使わず、いつもサブスクの道で動きます。`claude.apiMonthlyUsd` はゴンタが1か月に使ってよい API の額（既定20ドル）、`claude.spendFile` は使った額の帳の場所です（既定は上記の共通の帳）。`api` と `apiMonthlyUsd` は省いても既定のとおり動きます。`line` を使わない場合は空のオブジェクトにします。`allowedOrigins` は接続のたびに読み直すので、トンネルのURLが変わっても中継役の再起動は不要です。その他の変更後は中継役を再起動します。

同じフォルダの `gonta.sqlite` に会話ログ（Web履歴用・日記の材料）、LINE連携、Webhook受信状態を保存します。`claude-oauth-token.dpapi` は頭脳用の合言葉（暗号化済み）です。`local-token` はローカル専用入口の合言葉、`discovery-private.pem` は接続先案内の署名鍵です。これらは共有・コミットしないでください。

## ローカル起動手順

Node.js 22.16以上、Windowsにインストールされログイン済みのClaude Code（`claude auth status` で確認。サブスクの道で使います）、Python 3（日記の材料集め）が必要です。`npm ci` で Agent SDK（中の Claude Code 本体を含めて約330MB）も入ります。API の道にはユーザーの環境変数 `BOT_CLAUDE_API_KEY` が要ります（無ければサブスクの道で動きます）。

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

ユーザーのログイン時にタスク `Gonta-Autostart` が端末画面を開かずに起動スクリプト `%LOCALAPPDATA%\Gonta\Start-Gonta.ps1` を実行し、中継役（常駐する頭脳を含む）と外部接続トンネルを起動して監視します。落ちた場合は10秒後に再起動します。プログラムを更新した後は `scripts\restart-relay.cmd` をダブルクリックすると、中継役を止めて起動し直し（トンネルはそのまま）、どちらの道で動いているかを表示します。ログは `%LOCALAPPDATA%\Gonta\` の `startup.log`・`relay.log`・`tunnel.log`。同時に日記用のタスク `Gonta-Diary`（毎日03:00）も登録します。パスワードの登録は不要です。Windowsへログインする前の起動と、スリープ中・電源オフ中の利用はできません。

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

## Discord

旧構成のBotトークンをそのまま `discord.token` に設定すると、中継役がDiscordに接続します。`guilds` に書いたサーバーのチャンネル（`deny` 以外）とDMを受け付け、サーバー内ではゴンタへのメンションか、ゴンタの発言への返信だけに応答します（`requireMention: false` で全発言に応答）。返信は元のメッセージへの返信として投稿し、2000文字ごとに分割します。他のボットの発言には応答しません。

Discordの発言もWeb・LINEと同じ1つの会話に入り、Web画面の履歴にも表示されます。毎晩の日記の結果は `announce.diary` のチャンネルに投稿します。日記の材料集めは `diaryChannels` の各チャンネルを読み、`diaryAuthor` の投稿だけを使います。Developer PortalでMESSAGE CONTENTインテントを有効にしておく必要があります（旧構成で有効化済み）。

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

Discordの添付ファイル・リアクション、画像表示、Claude Codeの確認ダイアログは未対応です。

## 検証・デプロイ

```sh
npm test
npm run build
```

日記の材料集めの検証は人格フォルダで `python -m unittest test_claude_diary_context test_diary_context`（`scripts` 内）。Vercelの出力は `dist/`。秘密情報を環境変数に登録する必要はありません。

参考: [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[Claude Code ヘッドレス実行](https://code.claude.com/docs/en/headless)、[Claude Code 利用規約の整理](https://code.claude.com/docs/en/legal-and-compliance)、[LINE Messaging API](https://developers.line.biz/ja/docs/messaging-api/)、[Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
