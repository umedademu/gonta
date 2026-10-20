# ブックマークからの接続

https://gonta-sand.vercel.app/ をブックマークする。初回は接続設定でアクセスキーを入力し、個人の端末なら「この端末で接続情報を覚える」を選ぶ。接続先URLは空欄でよい。保存解除は「接続情報を消して切断」。ブラウザのデータ削除やプライベートブラウズでは再入力が必要。

PC（Windows）の起動とネット接続が必要。Quick Tunnel再起動時にはURLが変わるが、Webは同一オリジンの `/api/connection` を通して固定Worker `https://gonta-connect.umedademu.workers.dev/` から最新URLを自動取得する。Workerと対応ブラウザの双方で署名検証し、Ed25519非対応の古いWebViewではWorker側の検証結果とHTTPSを利用する。KVの反映に最大1分程度かかる場合があり、接続画面は再試行する。

## 構成

- Cloudflare Worker: `gonta-connect`、KVバインディング `ENDPOINTS` → `gonta-endpoints`。保存対象は接続URL、有効期限、PCの署名のみ。
- PCの署名秘密鍵: `C:\Users\USER\.gonta\discovery-private.pem`。GitHub・Vercel・Workerへ送信しない。バックアップ時は `C:\Users\USER\.gonta` に含める。
- 公開検証鍵: `public/discovery.js`。Ed25519で検証し、HTTPSのQuick Tunnel URLだけを許可。
- `scripts/tunnel.mjs` がLINE Webhook更新と案内レコード公開を行う。公開はURL変更時と4時間ごと、期限24時間。失敗は30秒後に再試行。
- トンネルは `--protocol http2` で起動する。このPCではQUIC（UDP/7844）がタイムアウトするため、利用できるHTTP/2（TCP/7844）を明示する。
- `cloudflared` はWindowsに `winget install Cloudflare.cloudflared` で導入する。PATH上、`%LOCALAPPDATA%\Microsoft\WinGet\Links`、`Program Files` の順に探し、`GONTA_CLOUDFLARED` で場所を指定できる。
- 新しいトンネルURLは `config.json` の `allowedOrigins` に追加される。中継役は接続のたびに読み直すため再起動は不要。トンネルの再起動は、自動起動なら `%LOCALAPPDATA%\Gonta\Start-Gonta.ps1` が10秒後に行う。
- Workerソースは `scripts/discovery-worker.mjs`。ダッシュボード配置時は `public/discovery.js` のexportを外した内容と連結し、import行を除いた単一ファイルにする。
- 個人端末の任意保存はlocalStorage。未選択時は従来どおりsessionStorage。アクセスキーは案内Workerへ送られず、PCへのHMAC認証に使う。

URL固定のNamed Tunnelへの変更ではない。Webが変更を自動追従する方式。LINEは従来の自動Webhook更新を継続する。

## 中継役の入口

- `127.0.0.1:18890` — Web画面とWebSocket、LINE Webhook、メモ帳APIの転送。トンネルが外へ公開するのはこの口だけ。
- `127.0.0.1:18891` — ローカル専用入口（日記の定時実行、状態確認、テスト送信）。トンネルを通さず、`C:\Users\USER\.gonta\local-token` の合言葉が必要。`node scripts\local.mjs` から使う。
