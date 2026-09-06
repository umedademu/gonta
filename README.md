# Gonta

OpenClawのDiscord会話を、WebとLINEから続ける個人用チャットアプリです。

## 構成

- `public/` — Vercelで配信する静的Web画面。スマートフォン対応。
- `relay/` — PCのWSLで稼働する認証付きブリッジ。OpenClaw Gatewayはlocalhostのまま。
- `scripts/tunnel.mjs` — Cloudflare Quick Tunnelの接続先管理。LINE WebhookのURLを追従させます。
- `test/` — Webhook署名、許可する会話、連携コード、重複排除の検証。

WebとLINEはOpenClawの同じ`sessionKey`を使います。Discordの既存履歴を移行・統合する必要はありません。Webで送った内容はOpenClawの会話履歴に保存されますが、Discord画面へのメッセージの転載はしません。元のDiscordから続けると同じ文脈を利用します。

## ローカル起動

Node.js 22.16以上と、稼働中のOpenClaw 2026.8.2（wire protocol 4）が必要です。

```sh
npm ci
npm start
```

初回に`~/.gonta/config.json`と独立した接続用デバイスを作成します。設定・鍵・LINE連携・Webhook受信状態は`~/.gonta`に保存します。OpenClaw設定は`~/.openclaw/openclaw.json`から読み取り、書き換えません。

```json
{
  "passcode": "生成された24文字以上のアクセスキー",
  "allowedOrigins": ["http://127.0.0.1:18890", "https://your-app.vercel.app"],
  "siteUrl": "https://your-app.vercel.app",
  "line": {"secret": "チャネルシークレット", "token": "チャネルアクセストークン", "botId": "@bot-id"}
}
```

LINEを使わない場合は`line`を空のオブジェクトにします。設定変更後はブリッジを再起動します。

## 接続

`http://127.0.0.1:18890`またはVercelのWeb画面を開き、PC側の接続先URLとアクセスキーを入力します。アクセスキーはブラウザのsessionStorageにのみ保持します。ページへの再接続は自動で行いますが、送信結果が不明なメッセージは自動再送しません。

Cloudflare Quick Tunnelを使う場合は、公式の`cloudflared`を`~/.local/bin/cloudflared`に設置し、`node scripts/tunnel.mjs`を起動します。`.local/接続情報.txt`と`.local/Gontaを開く.url`に最新情報が出力されます。これらは秘密情報を含むため共有・コミットしないでください。

**Quick Tunnelは試用向けで、再起動時にURLが変わり、可用性の保証もありません。** LINEのWebhook URLは自動更新されますが、Webは最新の接続情報を再入力する必要があります。恒久運用では独自ドメインを使った名前付きTunnelに切り替えてください。PCが停止・スリープ中は会話できません。

## LINE

1. 専用のLINE公式アカウントを作成し、Messaging APIを有効にします。
2. チャネルシークレット・アクセストークンをPC側設定に保存します。
3. Webhookを`https://your-tunnel/line/webhook`に設定し、「Webhookの利用」を有効にします。既定の応答メッセージは無効にします。
4. Webで会話を選び「LINEとつなぐ」で連携コードを発行します。
5. LINEボットに連携コードを送ります。コードは10分間・1回限りです。

`/会話`で会話一覧、`/切替 1`で対象変更、`/新規`で新しい会話を開始します。LINEは個人トークのテキストのみ対応します。画像・音声・グループトークは対象外です。

Webhookは署名を検証し、イベントIDをSQLiteに保存して再送を重複排除します。処理を始めたイベントはクラッシュ後に自動実行しません。45秒を超える応答はWebで確認する案内をLINEに返します。LINE返信が失敗したイベントは`line_events`に`failed`で記録されます。手動再送はOpenClaw履歴を確認してから行ってください。

## セキュリティと範囲

未認証では会話一覧・履歴・送信APIを利用できません。WebSocketは許可Originを検証し、HMACチャレンジで認証します。LINEは署名と、Webで発行したコードによるユーザー連携の両方が必要です。OpenClawの設定変更・シェル実行・管理APIをブリッジから直接呼び出す機能はありません。ただし**認証済みユーザーの会話は通常のOpenClawの権限で実行されます**。アクセスキーと自動接続リンクを他人に渡さないでください。

TLSはCloudflareで終端します。通信はCloudflareを経由し、LINE利用時はLINEにも送受信内容が渡ります。VercelとGitHubにはアプリのソースコードだけを置き、トークン・会話履歴を置きません。

対応する会話はmain/codexエージェントのDiscord会話、メイン会話、Gontaで作成した会話です。cron/ACPなどの内部セッションは対象外です。Webでは直近100件のテキスト履歴を表示します。添付ファイル、承認UI、画像表示は未対応です。OpenClawが実行承認を要求する操作は既存のControl UI等で承認してください。

## 検証・デプロイ

```sh
npm test
npm run build
```

Vercelの出力は`dist/`。秘密情報を環境変数に登録する必要はありません。`allowedOrigins`には実際の本番URLを明示して再起動してください。

参考: [OpenClawクライアント](https://docs.openclaw.ai/gateway/clients)、[LINE Messaging API](https://developers.line.biz/ja/docs/messaging-api/)、[Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
