# ゴンタの部屋：画像差し替えガイド

通常チャットと同じOpenClawセッション・送信欄を使う追加表示モードです。右上の「ゴンタの部屋」「通常チャット」で切り替えます。表示モードは端末に保存されます。部屋の前後ボタンでメッセージを読み返せます。長文は会話枠内でスクロールできます。

## Geminiなどで作り込む場合

- `public/room-background.png`：部屋の背景。横長3:2、中央の手前にキャラを置ける空間を残します。現在は1536×1024。文字・キャラは描き込まないでください。
- `public/room-gonta.png`：全身のゴンタ。背景透過PNG、緑の四角いメガネ・黒い毛・白い鼻先と胸。現在は1ポーズです。画像自体の透明領域を含め、中央配置してください。
- `public/room.css`：キャラの位置・サイズ・揺れ方・RPG風会話枠。
- `public/room.js`：表示モード・会話表示・文字送り。送信処理は既存の`public/app.js`を共用します。

同名PNGを差し替えてGitHubへ反映すると、Vercelが再公開します。スプライトシートに変える場合はCSS/JSも調整してください。現状の動きは1枚絵の上下動・傾きです。口パクや歩行のアニメーションはまだありません。

日本語ドット文字には[DotGothic16](https://github.com/fontworks-fonts/DotGothic16)を同梱しています。ライセンスは`public/DotGothic16-OFL.txt`です。

## 画像生成の記録

OpenAIの組み込みimage_genツールで作成した試作用素材です。ゴンタの生成には既存の`public/gonta-profile.png`を参照画像として使用しました。

### 背景の最終プロンプト

Use case: stylized-concept. Asset type: background for a cozy retro Japanese RPG chat room. Create a wide landscape 3:2 pixel art interior, straight-on slightly top-down 8-bit game view, deliberately chunky pixel grid, limited warm ochre wood and muted forest green palette. Bookshelf on left, wooden desk and tiny retro computer on right, window showing blue evening sky in back, small warm desk lamp, wooden plank floor and large simple sage green rug in the middle foreground. Empty central rug with plenty of space for a separately overlaid dog sprite. Cozy intimate study, readable simple shapes. No characters, no text, no letters, no dialogue boxes, no UI, no gradients, no photorealism. Fill entire rectangular image.

### ゴンタの最終プロンプト

Use case: stylized-concept. Input image is character reference only. Create a single full-body sitting dog game sprite on a truly transparent background. Same black dog with bright green square glasses, white muzzle and chest, brown eyes and upright rounded ears as reference. Cute calm friendly chibi proportions, facing viewer, front paws visible, tail curled to the side. Low resolution 8-bit NES RPG pixel art, large sharp blocky pixels, limited palette, no smooth edges or gradients. Center the whole dog in frame, modest transparent margin, no room, no floor, no cast shadow, no text, only one pose, not a sprite sheet.
