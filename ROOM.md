# ゴンタの部屋：画像差し替えガイド

通常チャットと同じOpenClawセッション・送信欄を使う追加表示モードです。右上の「ゴンタの部屋」「通常チャット」で切り替えます。表示モードは端末に保存されます。部屋の前後ボタンでメッセージを読み返せます。長文は会話枠内でスクロールできます。

## Geminiなどで作り込む場合

- `public/room-background.png`：部屋の背景。横長16:9、中央の手前にキャラを置ける空間を残します。現在は1672×941。文字・キャラは描き込まないでください。
- `public/room-gonta.png`：全身のゴンタ。背景透過PNG、緑の四角いメガネ・黒い毛・白い鼻先と胸。現在は1ポーズです。画像自体の透明領域を含め、中央配置してください。
- `public/room.css`：キャラの位置・サイズ・揺れ方・RPG風会話枠。
- `public/room.js`：表示モード・会話表示・文字送り。送信処理は既存の`public/app.js`を共用します。

同名PNGを差し替えてGitHubへ反映すると、Vercelが再公開します。配置を変える場合はCSS/JSも調整してください。通常姿は1枚絵の上下動・傾き、作業姿は下記の横2コマ、表情は4×4のスプライトです。口パクや歩行のアニメーションはまだありません。

日本語ドット文字には[DotGothic16](https://github.com/fontworks-fonts/DotGothic16)を同梱しています。ライセンスは`public/DotGothic16-OFL.txt`です。

## 横長の部屋（2026-09-20）

部屋の背景を16:9に描き直し、スマホでは左右8pxの余白まで広げました。PCでは従来の高さを目安に横幅を拡張しています。ゴンタと作業スプライトの縦横比は保ち、家具に合わせて位置を調整しました。日記作成用画像は背景込みの絵から透過スプライトに変更し、全ての状態で同じ横長の部屋を使います。

`public/room-work-diary.png` は1774×887の透過PNG。横2コマ・各コマ正方形、中央に日記を書くゴンタを配置し、足元と縮尺を揃えます。CSSが0.9秒周期で切り替えます。

以下の2点は組み込み `image_gen` ツールで生成しました。背景は旧 `room-background.png`、日記姿は旧 `room-work-diary.png` を参照しています。

### 横長背景の最終プロンプト

Use case: precise-object-edit. Asset type: pixel-art background for a retro chat room. Input image 1 is the room to redraw. Redraw this same cozy study as a wider 16:9 landscape composition, naturally revealing a little more space at left and right rather than stretching the furniture. Keep the warm wood, green rug, blue night window, chunky detailed pixel-art style and evening lighting. Preserve recognizable furniture and approximate interaction anchors: tall bookshelf occupies left 5–28% of the frame; window centered near 50%; desk and retro CRT computer at right, keyboard centered around x=73%, y=48%; green chair near right desk. The central foreground rug remains empty for a separately overlaid dog, with a clear sitting area at x=50%, y=78%. Slightly overhead straight-on game perspective, full room fills the canvas, 16:9 wide framing. No dog, no people, no characters, no text, no UI, no borders, no letterboxing. Opaque image.

### 透過日記スプライトの最終プロンプト

Use case: background-extraction. Asset type: two-frame pixel animation sprite atlas. Input image 1 shows Gonta writing his diary in two room frames; use the dog pose, identity and notebook as the edit target, remove the room entirely. Deliver only TWO full-body diary-writing dog sprites side-by-side on a genuinely TRANSPARENT alpha background in a 2:1 wide canvas. Each half is an equal square cell. Same cute black dog with green square glasses, white muzzle/chest/paws and white tail tip. Seated three-quarter front view looking down into the open purple diary, holding a yellow pencil. Left cell: pencil tip on page. Right cell: pencil and paw move a little across the page, tiny head nod. Keep camera, scale, whole body position and foot baseline locked across the two frames. Entire dog, ears, tail, notebook and pencil fit safely inside each cell, with 10% transparent margin; feet at 90% of each cell. Preserve the chunky retro pixel-art style, no smoothing. No furniture, no rug, no room, no extra props, no shadow outside dog, no text, no labels, no borders. Transparent background, not a checkerboard drawing.

## 返答に合わせた表情（2026-09-20）

ゴンタの返答本文からブラウザ内で表現を判定し、喜び・怒り・悲しみ・くつろぎ・共感・励まし・応援の7種類を切り替えます。ストリーミング中と過去の返答の閲覧にも対応します。ユーザーの発言、考え中、切断中は通常姿。日記作成・Obsidian検索・PC調査の作業アニメーションを優先します。文字送りと既存の効果音はそのまま使い、表情変更で最初から再生しません。

判定は `public/room.js` の `classifyEmotion` にある日本語の表現ルールです。引用・コードを除外し、共感などの具体的な表現を優先します。文脈を完全に理解するものではなく、曖昧な返答は通常姿になります。会話への指示追加・別のAI呼び出し・本文へのラベル挿入はありません。判定表現はこの関数で追加できます。

専用素材は `public/room-emotions.png`（透過PNG、1254×1254）。均等な4列×4行で、左から2コマずつの組です。各セルの大きさ・ゴンタの位置と縮尺・透明背景を維持すれば、Geminiなどで作り直した同名画像に差し替えられます。CSSの `room-expression` が2コマを切り替え、端末の「動きを減らす」設定では静止します。画像取得に失敗した場合は元の通常姿が残ります。

| 行 | 左2コマ | 右2コマ |
| --- | --- | --- |
| 1 | 喜び | 怒り |
| 2 | 悲しみ | くつろぎ |
| 3 | 共感 | 励まし |
| 4 | 応援 | 通常・まばたき（予備） |

2026-09-20に通常姿 `public/room-gonta.png` をベースに全面描き直しを実施。通常時と完全に同一の画風・クオリティ・プロポーション（尖った三角立ち耳、シャープなV字胸毛、足元）を厳密に継承し、ゴンタのアイデンティティである「四角い緑フレームのメガネ＋完全透明レンズ＋澄んだ茶色い瞳」を100%維持しています。AI生成によるメガネの吊り上がりやサングラス化（黒塗りレンズ）、耳や体型の崩れを完全に排除しました。また、`public/room-work-diary.png` の日記執筆姿についても同様にメガネの吊り上がり・サングラス化を修正し、クリアレンズの四角い眼鏡に変更しています。

## 画像生成の記録

OpenAIの組み込みimage_genツールで作成した試作用素材です。ゴンタの生成には既存の`public/gonta-profile.png`を参照画像として使用しました。

### 初期背景の生成プロンプト（3:2版）

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

初期素材 `public/room-work-diary.png` は背景込みの横2コマ、全体3:1・各コマ3:2でした。2026-09-20に上記の透過スプライトへ置き換えています。以下は初期素材の生成記録です。

最終生成プロンプト:

Use case: stylized-concept. Generate a 3:1 wide horizontal two-frame pixel-art animation sheet for Gonta writing a diary in his room. EXACTLY TWO equal 3:2 landscape cells side by side, with no gap or border between. Reference 1 is the EXACT room background to preserve: bookshelf at left, blue night window in middle, CRT computer and green chair at right, sage green rug in foreground. Copy the same room into BOTH cells, keep furniture and lighting stationary and matched between frames. Reference 2 is the NEW diary-writing Gonta pose: black dog with green glasses, white muzzle/chest/paws, purple notebook and yellow pencil. Ignore/remove the checkerboard in reference 2 completely. Place just ONE small full-body diary-writing Gonta seated on the center foreground rug in EACH room cell, occupying about 32 percent of each room's height, feet at 82 percent down each cell. Frame 1 pencil touching left part of open page; frame 2 paw and pencil shifted slightly right while writing, small head tilt; no other scene differences. Dog must sit naturally on rug with a tiny contact shadow, and remain exactly same position/scale in both frames. OPAQUE finished room art filling every pixel edge to edge. Absolutely NO transparency, NO checkerboard, NO white backdrop, NO text, NO lettering, NO UI. Crisp chunky retro Japanese RPG pixel art, warm amber lighting. Final canvas aspect ratio THREE TO ONE; each half THREE TO TWO.


