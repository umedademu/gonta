export function createRoom(){
 const $=id=>document.getElementById(id),root=$('pixel-room');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let active=false,state={},entries=[],position=-1,lastSession=null,timer,fullText='',revealed=0,voiceFlow=false;
 let soundOn=true,audio;
 try{soundOn=localStorage.getItem('gonta.roomSound')!=='off';}catch{}
 const soundButton=document.createElement('button');soundButton.id='room-sound';soundButton.type='button';
 root.querySelector('.room-topline').append(soundButton);
 for(const kind of ['pc','obsidian','diary']){const sprite=document.createElement('div');sprite.className=`room-worker room-worker-${kind}`;sprite.setAttribute('aria-hidden','true');root.querySelector('.room-scene').append(sprite);}
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
 function mode(value){active=value;document.body.classList.toggle('room-mode',active);root.hidden=!active;$('room-toggle').setAttribute('aria-pressed',String(active));$('room-toggle').textContent=active?'通常チャット':'ゴンタの部屋';try{localStorage.setItem('gonta.view',active?'room':'chat');}catch{}if(!active)finish();else paint(false);}
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
  $('room-status').textContent=!online?'接続を待っています':diaryWork?'日記を更新しています':'ゴンタは ここにいます';
  $('room-bubble').textContent=diaryWork?'日記':searching?'ノート':pcWork?'ファイル':waiting?(state.stream?'！':'…'):'♪';
  $('room-context').textContent=state.sessionName||'会話のつづき';
  const entry=entries[position];
  const replying=!!waiting&&!!state.stream;
  const text=!online?'おかえり。まずは右上の接続ボタンから、PCにつないでね。':!state.selected?'会話を選ぶと、ここで続きを話せるよ。':replying?state.stream:entry?.text||'おかえり！ 今日はどんな話をしようか。下の入力欄から話しかけてね。';
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
