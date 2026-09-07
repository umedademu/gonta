# ゴンタの部屋：画像差し替えガイド

通常チャットと同じOpenClawセッション・送信欄を使う追加表示モードです。右上の「ゴンタの部屋」「通常チャット」で切り替えます。表示モードは端末に保存されます。部屋の前後ボタンでメッセージを読み返せます。長文は会話枠内でスクロールできます。

## Geminiなどで作り込む場合

- `public/room-background.png`：部屋の背景。横長3:2、中央の手前にキャラを置ける空間を残します。現在は1536×1024。文字・キャラは描き込まないでください。
- `public/room-gonta.png`：全身のゴンタ。背景透過PNG、緑の四角いメガネ・黒い毛・白い鼻先と胸。現在は1ポーズです。画像自体の透明領域を含め、中央配置してください。
- `public/room.css`：キャラの位置・サイズ・揺れ方・RPG風会話枠。
- `public/room.js`：表示モード・会話表示・文字送り。送信処理は既存の`public/app.js`を共用します。

同名PNGを差し替えてGitHubへ反映すると、Vercelが再公開します。スプライトシートに変える場合はCSS/JSも調整してください。通常姿は1枚絵の上下動・傾き、作業姿は下記の横2コマのスプライトです。口パクや歩行のアニメーションはまだありません。

日本語ドット文字には[DotGothic16](https://github.com/fontworks-fonts/DotGothic16)を同梱しています。ライセンスは`public/DotGothic16-OFL.txt`です。

## 画像生成の記録

OpenAIの組み込みimage_genツールで作成した試作用素材です。ゴンタの生成には既存の`public/gonta-profile.png`を参照画像として使用しました。

### 背景の最終プロンプト

Use case: stylized-concept. Asset type: background for a cozy retro Japanese RPG chat room. Create a wide landscape 3:2 pixel art interior, straight-on slightly top-down 8-bit game view, deliberately chunky pixel grid, limited warm ochre wood and muted forest green palette. Bookshelf on left, wooden desk and tiny retro computer on right, window showing blue evening sky in back, small warm desk lamp, wooden plank floor and large simple sage green rug in the middle foreground. Empty central rug with plenty of space for a separately overlaid dog sprite. Cozy intimate study, readable simple shapes. No characters, no text, no letters, no dialogue boxes, no UI, no gradients, no photorealism. Fill entire rectangular image.

### ゴンタの最終プロンプト

Use case: stylized-concept. Input image is character reference only. Create a single full-body sitting dog game sprite on a truly transparent background. Same black dog with bright green square glasses, white muzzle and chest, brown eyes and upright rounded ears as reference. Cute calm friendly chibi proportions, facing viewer, front paws visible, tail curled to the side. Low resolution 8-bit NES RPG pixel art, large sharp blocky pixels, limited palette, no smooth edges or gradients. Center the whole dog in frame, modest transparent margin, no room, no floor, no cast shadow, no text, only one pose, not a sprite sheet.
# 作業用スプライト（2026-09-06）

内蔵画像生成ツールで作成。`public/room-work-pc.png` は右上のPCへ向いた背面姿、`public/room-work-obsidian.png` は左の本棚へ向いた背面姿。各PNGは透明背景・横2コマ（等幅の正方形セル）で、CSSが0.65秒周期で切り替える。Geminiで差し替える場合も同じ配置・足の基準位置・透明背景を維持する。

送信文のパス／調べもの表現から先行表示し、実際のツールイベントが届いたらそちらを優先する。ObsidianとPC処理が並行する間はObsidianを優先。終了・切断時は通常姿に戻る。動きを減らす設定では静止画。

生成プロンプト:

+### pc

Use case: stylized-concept. Game pixel sprite sheet on genuinely transparent background. Reference 1 is the identity of Gonta: black dog, green square glasses, white paw tips, rounded ears, white tail tip. Reference 2 gives room perspective only, do not draw the room or furniture. Draw exactly TWO animation frames side by side in a 2:1 canvas, each in an equal square cell, aligned same scale and foot baseline, full body with small padding. Crisp chunky NES-style pixels, no labels, no text, no shadows outside character. Gonta is seen from BEHIND in three-quarter rear view facing UPPER RIGHT, standing and leaning forward to use the existing desk PC. Show the back of his head and ears, tiny green glasses side arm only, muzzle aimed away to upper right. Both front paws extended to upper-right keyboard height. Frame 1 left paw raised and right paw lower, frame 2 right paw raised and left paw lower, typing/rummaging animated. No front-facing eyes. No computer or chair drawn.


### obsidian

Use case: stylized-concept. Game pixel sprite sheet on genuinely transparent background. Reference 1 is the identity of Gonta: black dog, green square glasses, white paw tips, rounded ears, white tail tip. Reference 2 gives room perspective only, do not draw the room or furniture. Draw exactly TWO animation frames side by side in a 2:1 canvas, each in an equal square cell, aligned same scale and foot baseline, full body with small padding. Crisp chunky NES-style pixels, no labels, no text, no shadows outside character. Gonta is seen from BEHIND in three-quarter rear view facing UPPER LEFT toward the existing bookshelf. Show back of head and ears, green glasses side arm only. Standing reaching into shelf and pulling a purple notebook with cream pages. Frame 1 paw reaching upward with notebook close to body, frame 2 looking down toward open notebook in paws, back still toward viewer. Same head position and body scale, distinct paw and page movement. No front-facing eyes. No shelf drawn.

## 日記の定期更新（2026-09-08）

OpenClawの `cron.list` を接続時・15秒ごと・cronイベント受信時に読み取り、日記の更新／追記／作成ジョブの `state.runningAtMs` がある間、日記を書く専用アニメーションを表示する。チャット送信や会話選択がなくても表示される。終了・エラー・切断時には解除する。複数の日記更新が重なれば最後の実行が終わるまで表示する。読み取りに失敗した間は通常表示に戻し、次の確認で復帰する。定期ジョブ自体の実行やスケジュール変更は行わない。

PC上でジョブ名・説明・指示文を判定し、Webには `{kind:'diary'}` のみ送る。cronの会話履歴や指示文は公開しない。日記表示はPC／Obsidian検索の作業姿より優先し、会話本文・返答の文字送りはそのまま。日記表示自体は無音。動きを減らす設定では静止画。

素材 `public/room-work-diary.png` は背景込みの横2コマ、全体3:1・各コマ3:2。左右で部屋とゴンタの位置・大きさを揃え、鉛筆と手を少し動かす。CSSで0.9秒周期に切り替える。Geminiで差し替える場合も同じ構成にする。内蔵image_genで生成。

最終生成プロンプト:

Use case: stylized-concept. Generate a 3:1 wide horizontal two-frame pixel-art animation sheet for Gonta writing a diary in his room. EXACTLY TWO equal 3:2 landscape cells side by side, with no gap or border between. Reference 1 is the EXACT room background to preserve: bookshelf at left, blue night window in middle, CRT computer and green chair at right, sage green rug in foreground. Copy the same room into BOTH cells, keep furniture and lighting stationary and matched between frames. Reference 2 is the NEW diary-writing Gonta pose: black dog with green glasses, white muzzle/chest/paws, purple notebook and yellow pencil. Ignore/remove the checkerboard in reference 2 completely. Place just ONE small full-body diary-writing Gonta seated on the center foreground rug in EACH room cell, occupying about 32 percent of each room's height, feet at 82 percent down each cell. Frame 1 pencil touching left part of open page; frame 2 paw and pencil shifted slightly right while writing, small head tilt; no other scene differences. Dog must sit naturally on rug with a tiny contact shadow, and remain exactly same position/scale in both frames. OPAQUE finished room art filling every pixel edge to edge. Absolutely NO transparency, NO checkerboard, NO white backdrop, NO text, NO lettering, NO UI. Crisp chunky retro Japanese RPG pixel art, warm amber lighting. Final canvas aspect ratio THREE TO ONE; each half THREE TO TWO.


