export function createRoom(){
 const $=id=>document.getElementById(id),root=$('pixel-room');
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let active=false,state={},entries=[],position=-1,lastSession=null,shown='',timer,fullText='';
 try{active=localStorage.getItem('gonta.view')==='room';}catch{}
 function mode(value){active=value;document.body.classList.toggle('room-mode',active);root.hidden=!active;$('room-toggle').setAttribute('aria-pressed',String(active));$('room-toggle').textContent=active?'通常チャット':'ゴンタの部屋';try{localStorage.setItem('gonta.view',active?'room':'chat');}catch{}if(!active)finish();else paint(false);}
 function finish(){clearInterval(timer);timer=null;$('room-text').textContent=fullText;$('room-reveal').hidden=true;}
 function write(text,animate){
  if(shown===text)return;shown=text;fullText=text;clearInterval(timer);timer=null;
  if(!animate||reduce.matches||!active){finish();return;}
  const chars=Array.from(text);let n=0;$('room-text').textContent='';$('room-reveal').hidden=false;
  timer=setInterval(()=>{n=Math.min(n+3,chars.length);$('room-text').textContent=chars.slice(0,n).join('');if(n===chars.length)finish();},24);
 }
 function paint(animate){
  const online=state.connected&&state.gatewayReady;
  const latest=position===entries.length-1;
  const waiting=online&&state.runId&&latest;
  root.classList.toggle('is-thinking',!!waiting&&!state.stream);root.classList.toggle('is-talking',!!waiting&&!!state.stream);
  $('room-status').textContent=!online?'接続を待っています':waiting?'ゴンタが考えています…':'ゴンタは ここにいます';
  $('room-bubble').textContent=waiting?(state.stream?'！':'…'):'♪';
  $('room-context').textContent=state.sessionName||'会話のつづき';
  const entry=entries[position];
  const text=!online?'おかえり。まずは右上の接続ボタンから、PCにつないでね。':!state.selected?'会話を選ぶと、ここで続きを話せるよ。':waiting?(state.stream||'うーん、ちょっと考えているよ…'):entry?.text||'おかえり！ 今日はどんな話をしようか。下の入力欄から話しかけてね。';
  $('room-speaker').textContent=entry?.role==='user'&&!waiting?'あなた':'ゴンタ';
  $('room-count').textContent=entries.length?`${position+1} / ${entries.length}`:'新しい会話';
  $('room-prev').disabled=position<=0;$('room-next').disabled=position>=entries.length-1;
  write(text,animate&&!waiting);$('room-dialogue').setAttribute('aria-busy',String(!!waiting));
 }
 function update(next){
  const oldCount=entries.length,following=position===oldCount-1;
  const changedSession=next.selected!==lastSession;
  state=next;entries=[...(next.messages||[])];lastSession=next.selected;
  if(changedSession||following)position=entries.length-1;else position=Math.min(position,entries.length-1);
  // Unchanged history refreshes must not restart the text animation.
  paint(!changedSession&&entries.length>oldCount);
 }
 $('room-toggle').onclick=()=>mode(!active);$('room-history').onclick=()=>mode(false);
 $('room-prev').onclick=()=>{position=Math.max(0,position-1);paint(false);};
 $('room-next').onclick=()=>{position=Math.min(entries.length-1,position+1);paint(false);};
 $('room-reveal').onclick=finish;reduce.addEventListener('change',()=>{if(reduce.matches)finish();});
 mode(active);return {update};
}
