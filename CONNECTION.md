# ブックマークからの接続

https://gonta-sand.vercel.app/ をブックマークする。初回は接続設定でアクセスキーを入力し、個人の端末なら「この端末で接続情報を覚える」を選ぶ。接続先URLは空欄でよい。保存解除は「接続情報を消して切断」。ブラウザのデータ削除やプライベートブラウズでは再入力が必要。

PC・WSL・ネット接続が必要。Quick Tunnel再起動時にはURLが変わるが、Webは同一オリジンの `/api/connection` を通して固定Worker `https://gonta-connect.umedademu.workers.dev/` から最新URLを自動取得する。Workerと対応ブラウザの双方で署名検証し、Ed25519非対応の古いWebViewではWorker側の検証結果とHTTPSを利用する。KVの反映に最大1分程度かかる場合があり、接続画面は再試行する。

## 構成

- Cloudflare Worker: `gonta-connect`、KVバインディング `ENDPOINTS` → `gonta-endpoints`。保存対象は接続URL、有効期限、PCの署名のみ。
- PCの署名秘密鍵: `~/.gonta/discovery-private.pem`、権限600。GitHub・Vercel・Workerへ送信しない。バックアップ時は`~/.gonta`に含める。
- 公開検証鍵: `public/discovery.js`。Ed25519で検証し、HTTPSのQuick Tunnel URLだけを許可。
- `scripts/tunnel.mjs`がLINE Webhook更新と案内レコード公開を行う。公開はURL変更時と4時間ごと、期限24時間。失敗は30秒後に再試行。
- Workerソースは `scripts/discovery-worker.mjs`。ダッシュボード配置時は `public/discovery.js` のexportを外した内容と連結し、import行を除いた単一ファイルにする。
- 個人端末の任意保存はlocalStorage。未選択時は従来どおりsessionStorage。アクセスキーは案内Workerへ送られず、PCへのHMAC認証に使う。

URL固定のNamed Tunnelへの変更ではない。Webが変更を自動追従する方式。LINEは従来の自動Webhook更新を継続する。
