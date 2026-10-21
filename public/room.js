import {strips} from './anim/manifest.js';

// Presentation only: never send emotion labels back into the conversation.
export function classifyEmotion(reply=''){
 const text=String(reply)
  .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,'')
  .replace(/`[^`\n]*(?:`|$)/g,'')
  .replace(/^\s*>.*$/gm,'')
  .replace(/[「『“"][^」』”"\n]*[」』”"]/g,'')
  .replace(/(?:嬉しく|うれしく|楽しく|悲しく|寂しく|さみしく|つらく|辛く|しんどく|眠く|ねむく)(?:は)?(?:ない|ありません)/g,'')
  .replace(/(?:大丈夫|嬉しい|うれしい|楽しい|悲しい|寂しい|眠い|応援|許せない)(?:と(?:は)?(?:言えない|思わない)|わけではない)/g,'');
 // Specific supportive phrases take precedence over a generic happy ending; greetings only count at the start.
 const rules=[
  ['empathy',/つらかった|辛かった|しんどかった|苦しかった|大変だったね|大変でしたね|その気持ち.{0,12}(?:わかる|分かる|わかります|分かります)|話してくれてありがとう|気持ちに寄り添/],
  ['apology',/ごめん(?:ね|なさい|[。！!…])|すみません(?:でした)?|申し訳(?:ない|ありません|ございません)|失礼しました|お詫び/],
  ['anger',/それは(?:本当に)?(?:理不尽|ひどい|酷い)|納得いかないね|許せない(?:ね|よ|です|[！!。])/],
  ['sadness',/(?:悲しい|寂しい|さみしい|切ない)(?:ね|ですね|よ|な|気持ち|[。…])|残念だったね|残念でしたね/],
  ['surprise',/え[っえぇ]+[！!？?]|ええ[！!？?]|まじ(?:で|か)[！!？?]|(?:本当|ほんと)(?:に)?[！!？?]|びっくり|驚い(?:た|ちゃ)|なんと[！!]|まさか|すごっ|うわ[ぁあっ]*[！!]/],
  ['cheering',/応援(?:してる|している|しています|するよ)|(?:がんばれ|頑張れ|ファイト)(?:[！!。\s]|$)|いけるぞ/],
  ['encouragement',/きっと大丈夫|大丈夫(?:だよ|ですよ)|焦らなく(?:て|ても)|あせらなく(?:て|ても)|無理しなく(?:て|ても)|一歩ずつ|少しずつ(?:で|進|やって)|あなたならできる|君ならできる/],
  ['laugh',/笑(?:っちゃ|える|った|えて)|[wｗ]{2,}|あはは|わはは|ははは|ふふっ|くすっ|[（(]笑[）)]/],
  ['joy',/おめでとう|やった(?:ね|ー|！|!)|よく(?:頑張った|がんばった)|嬉しい|うれしい|すごいね|素晴らしいね|最高だね|楽しみだね/],
  ['affection',/ありがと(?:う|ね|[！!。])|感謝(?:して|だね|です)|大好き|だいすき|好きだよ|なでなで|ぎゅっ|そばにいる/],
  ['greeting',/^\s*(?:おはよ|こんにち[はわ]|こんばんは|おかえり|ただいま|やあ|やっほ|はじめまして|お疲れ(?:さま|様)|おつかれ)/],
  ['agree',/なるほど|了解|りょうかい|わかった(?:よ|！|!|。)|わかりました|オッケー|OK[！!。]|いいね[！!。]|そうだね[！!。]|賛成|その通り|同感|うんうん/],
  ['sleepy',/眠(?:い|く|た)|ねむ(?:い|た)|あくび|寝よう|寝ます|うとうと|ふぁ[ーぁあ]|zz+/i],
  ['curious',/どうかな[？?]|どう思う[？?]|どっち(?:が|に)|どれ(?:が|に)|のかな[？?]|なんだろう|どういうこと|気になる(?:ね|な)|教えて(?:くれる|もらえる|ほしい)|聞かせて|何があった|どうしたの/],
  ['pondering',/うーん|う〜ん|ううん|そうだな[あぁー]|難しいね|悩ましい|迷う(?:ね|な)|考えてみる|考え中|ちょっと待って/],
  ['relaxed',/おやすみ|ゆっくり(?:休|やす)|のんびり(?:し|過ご)|ほっと(?:する|した|したね|ひと息)|一息つこ|ひと息つこ|穏やかな/],
 ];
 return rules.find(([,pattern])=>pattern.test(text))?.[0]||'neutral';
}

// Every strip in public/anim, with the accessible name and the speech-bubble mark shown while it plays.
export const reactions={
 idle:['いつものゴンタ','♪'],idle2:['いつものゴンタ','♪'],idle3:['いつものゴンタ','♪'],talk:['話すゴンタ','！'],think:['考えるゴンタ','…'],
 joy:['うれしそうなゴンタ','♪'],anger:['憤るゴンタ','ﾑｯ'],sadness:['悲しそうなゴンタ','…'],relaxed:['くつろぐゴンタ','♪'],
 empathy:['気持ちに寄り添うゴンタ','…'],encouragement:['励ますゴンタ','！'],cheering:['応援するゴンタ','！！'],
 surprise:['驚くゴンタ','！？'],laugh:['笑うゴンタ','ﾜﾊﾊ'],sleepy:['眠そうなゴンタ','Zz'],apology:['謝るゴンタ','…'],
 affection:['なつくゴンタ','♥'],greeting:['あいさつするゴンタ','♪'],curious:['首をかしげるゴンタ','？'],pondering:['考え込むゴンタ','…'],agree:['うなずくゴンタ','！'],
};

export function createRoom(){
 const $=id=>document.getElementById(id),root=$('pixel-room');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let active=false,state={},entries=[],position=-1,lastSession=null,timer,fullText='',revealed=0,voiceFlow=false;
 let soundOn=true,audio;
 try{soundOn=localStorage.getItem('gonta.roomSound')!=='off';}catch{}
 const soundButton=document.createElement('button');soundButton.id='room-sound';soundButton.type='button';
 $('header-actions').append(soundButton);
 for(const kind of ['pc','obsidian','diary']){const sprite=document.createElement('div');sprite.className=`room-worker room-worker-${kind}`;sprite.setAttribute('aria-hidden','true');root.querySelector('.room-scene').append(sprite);}
 const sprite=document.createElement('div');sprite.className='room-sprite';sprite.setAttribute('role','img');root.querySelector('.room-scene').append(sprite);
 // Strips download one at a time once the room is open; the static picture stays until the current one is in.
 const loaded=new Set(),queue=Object.keys(reactions);let loading=false,currentAnim='',idle='idle';
 function preload(){
  if(loading||!active)return;const name=queue.shift();if(!name)return;loading=true;
  const img=document.createElement('img');
  img.onload=()=>{loaded.add(name);loading=false;syncSprite();preload();};
  img.onerror=()=>{loading=false;preload();};
  img.src=`/anim/${name}.png`;
 }
 function syncSprite(){
  root.classList.toggle('has-sprite',loaded.has(currentAnim));
  const index=queue.indexOf(currentAnim);if(index>0)queue.unshift(...queue.splice(index,1));
 }
 function setAnim(anim){
  if(anim===currentAnim)return;currentAnim=anim;root.setAttribute('data-anim',anim);sprite.setAttribute('aria-label',reactions[anim][0]);
  // A reflow between removing and restoring the class restarts the strip from its first frame.
  sprite.classList.toggle('is-running',false);void sprite.offsetWidth;sprite.classList.toggle('is-running',true);
  syncSprite();restIdle();
 }
 // Each resting strip starts and ends on the plain pose, so swapping at the loop length is seamless:
 // Gonta mostly breathes, sometimes glances around the room, occasionally yawns.
 let idleTimer;
 function restIdle(){
  clearTimeout(idleTimer);if(!currentAnim.startsWith('idle'))return;
  idleTimer=setTimeout(()=>{const roll=Math.random();idle=roll<.5?'idle':roll<.78?'idle2':'idle3';if(idle===currentAnim)restIdle();else setAnim(idle);},strips[currentAnim].ms);
 }
 function soundLabel(){soundButton.textContent=soundOn?'音 ON':'音 OFF';soundButton.setAttribute('aria-label','文字送りの効果音');soundButton.setAttribute('aria-pressed',String(soundOn));}
 function unlock(){if(!active||!soundOn)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')void audio.resume().catch(()=>{});}catch{}}
 // Browsers require a user gesture before audio can start.
 document.addEventListener('pointerdown',unlock);document.addEventListener('keydown',unlock);
 soundButton.onclick=()=>{soundOn=!soundOn;try{localStorage.setItem('gonta.roomSound',soundOn?'on':'off');}catch{}soundLabel();if(soundOn)unlock();};soundLabel();
 function beep(character){
  if(!soundOn||!active||document.hidden||audio?.state!=='running'||/\s/u.test(character))return;
  const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
  oscillator.type='square';oscillator.frequency.setValueAtTime(760+(character.codePointAt(0)%5)*65,now);
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.018,now+.002);gain.gain.setValueAtTime(.018,now+.014);gain.gain.linearRampToValueAtTime(0,now+.023);
  oscillator.connect(gain);gain.connect(audio.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(now);oscillator.stop(now+.025);
 }
 try{active=localStorage.getItem('gonta.view')==='room';}catch{}
 function mode(value){active=value;document.body.classList.toggle('room-mode',active);root.hidden=!active;$('room-toggle').setAttribute('aria-pressed',String(active));$('room-toggle').textContent=active?'通常チャット':'ゴンタの部屋';try{localStorage.setItem('gonta.view',active?'room':'chat');}catch{}if(!active)finish();else{paint(false);preload();}}
 function finish(){clearInterval(timer);timer=null;revealed=Array.from(fullText).length;$('room-text').textContent=fullText;$('room-reveal').hidden=true;}
 function write(text,speak){
  if(fullText===text)return;
  const continuation=speak&&voiceFlow&&text.startsWith(fullText);
  fullText=text;voiceFlow=speak;clearInterval(timer);timer=null;
  if(!speak||reduce.matches||!active||document.hidden){finish();return;}
  if(!continuation)revealed=0;
  const chars=Array.from(text);$('room-text').textContent=chars.slice(0,revealed).join('');$('room-reveal').hidden=false;
  timer=setInterval(()=>{const character=chars[revealed++];if(character)beep(character);$('room-text').textContent=chars.slice(0,revealed).join('');if(revealed>=chars.length)finish();},30);
 }
 function paint(animate){
  const online=state.connected&&state.gatewayReady;
  const latest=position===entries.length-1;
  const waiting=online&&state.runId&&latest;
  const request=entries.findLast(message=>message.role==='user')?.text||'';
  const requestedSearch=/obsidian|オブシディアン/i.test(request)||(/日記|ノート|メモ/.test(request)&&/調べ|探|検索|読み|読ん|言及|見て|確認/.test(request));
  const requestedPC=/(?:[a-z]:\\|\/mnt\/[a-z]\/|\/home\/|\/Users\/)/i.test(request)||(/PC|パソコン|ローカル|フォルダ|ファイル|デスクトップ/i.test(request)&&/調べ|探|検索|読み|読ん|見て|確認|中身/.test(request));
  const toolKind=waiting?state.activity?.kind:null;
  const toolSearch=toolKind==='obsidian';
  const searchHint=!!waiting&&!state.stream&&!toolKind&&requestedSearch;
  const searching=toolSearch||searchHint;
  const pcWork=toolKind==='pc'||(!!waiting&&!state.stream&&!toolKind&&!requestedSearch&&requestedPC);
  const diaryWork=!!online&&state.backgroundActivity?.kind==='diary';
  root.classList.toggle('is-diary-writing',diaryWork);
  root.classList.toggle('is-searching',searching&&!diaryWork);
  root.classList.toggle('is-pc-working',pcWork&&!diaryWork);
  root.classList.toggle('is-thinking',!!waiting&&!state.stream);root.classList.toggle('is-talking',!!waiting&&!!state.stream);
  $('room-context').textContent=state.sessionName||'会話のつづき';
  const entry=entries[position];
  const replying=!!waiting&&!!state.stream;
  const text=!online?'おかえり。まずは右上の接続ボタンから、PCにつないでね。':!state.selected?'会話を選ぶと、ここで続きを話せるよ。':replying?state.stream:entry?.text||'おかえり！ 今日はどんな話をしようか。下の入力欄から話しかけてね。';
  const canEmote=online&&state.selected&&!diaryWork&&!searching&&!pcWork&&(!waiting||replying)&&(replying||entry?.role==='assistant');
  const emotion=canEmote?classifyEmotion(text):'neutral';
  const busy=diaryWork||searching||pcWork;
  const anim=busy?idle:waiting&&!state.stream?'think':emotion!=='neutral'?emotion:replying?'talk':idle;
  setAnim(anim);
  $('room-bubble').textContent=diaryWork?'日記':searching?'ノート':pcWork?'ファイル':reactions[anim][1];
  $('room-speaker').textContent=entry?.role==='user'&&!replying?'あなた':'ゴンタ';
  $('room-thinking').textContent=toolSearch?'Obsidianのノートを調べています…':toolKind==='pc'?'PC内のファイルを確認しています…':searchHint||pcWork?'調べものをお願いしています…':'ゴンタが考え中…';
  $('room-thinking').hidden=!waiting||(replying&&!toolKind);
  $('room-count').textContent=entries.length?`${position+1} / ${entries.length}`:'新しい会話';
  $('room-prev').disabled=position<=0;$('room-next').disabled=position>=entries.length-1;
  write(text,!!online&&!!latest&&((!!waiting&&!!state.stream)||(animate&&entry?.role==='assistant')));$('room-dialogue').setAttribute('aria-busy',String(!!waiting));
 }
 function update(next){
  const oldCount=entries.length,following=position===oldCount-1;
  const changedSession=next.selected!==lastSession;
  state=next;entries=[...(next.messages||[])];lastSession=next.selected;
  const justSent=next.runId&&entries.length>oldCount&&entries.at(-1)?.role==='user';
  if(changedSession||following||justSent)position=entries.length-1;else position=Math.min(position,entries.length-1);
  // Unchanged history refreshes must not restart the text animation.
  paint(!changedSession&&entries.length>oldCount);
 }
 $('room-toggle').onclick=()=>{mode(!active);if(active)unlock();};$('room-history').onclick=()=>mode(false);
 $('room-prev').onclick=()=>{finish();voiceFlow=false;position=Math.max(0,position-1);paint(false);};
 $('room-next').onclick=()=>{finish();voiceFlow=false;position=Math.min(entries.length-1,position+1);paint(false);};
 $('room-reveal').onclick=finish;reduce.addEventListener('change',()=>{if(reduce.matches)finish();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)finish();});
 mode(active);return {update};
}
