import {createRoom} from './room.js';
const $=id=>document.getElementById(id);
let ws,connected=false,gatewayReady=false,selected=null,sessionList=[],messages=[],runId=null,stream='',intentional=false,reconnectTimer,requestCount=0,historyGeneration=0;
const room=createRoom();
function updateRoom(){room.update({connected,gatewayReady,selected,messages,runId,stream,sessionName:$('conversation-title').textContent});}
const pending=new Map();
const saved=JSON.parse(sessionStorage.getItem('gonta.connection')||'null');
let credentials=saved;
const fragment=new URLSearchParams(location.hash.slice(1));
if(fragment.get('relay')&&fragment.get('key')){credentials={url:fragment.get('relay'),key:fragment.get('key')};history.replaceState(null,'',location.pathname);}
const notice=text=>{$('notice').textContent=text||'';$('notice').hidden=!text;};
function showSettings(){ $('relay-url').value=credentials?.url||localStorage.getItem('gonta.relay')||(location.hostname==='127.0.0.1'||location.hostname==='localhost'?location.origin:'');$('passcode').value=credentials?.key||'';if(!$('settings').open)$('settings').showModal();}
for(const id of ['settings-open','welcome-connect','connection-pill'])$(id).onclick=showSettings;
document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>$(el.dataset.close).close());
$('menu-toggle').onclick=()=>$('sidebar').classList.toggle('open');
document.querySelector('.main').addEventListener('click',e=>{if(!e.target.closest('#menu-toggle'))$('sidebar').classList.remove('open');});
function setStatus(status){gatewayReady=!!status.gateway;document.body.classList.toggle('connected',connected&&gatewayReady);$('connection-label').textContent=connected?(gatewayReady?'接続中':'PCを確認'):'未接続';$('sidebar-state').textContent=connected?(gatewayReady?'OpenClawにつながっています':'OpenClawの接続を待っています'):'PCへの接続を待っています';$('line-dialog').dataset.enabled=String(!!status.line);$('line-add').hidden=!status.lineBotId;if(status.lineBotId)$('line-add').href='https://line.me/R/ti/p/'+encodeURIComponent(status.lineBotId);updateComposer();}
function updateComposer(){updateRoom();const enabled=connected&&gatewayReady&&!!selected;$('message').disabled=!enabled;$('send').disabled=!enabled||!!runId;$('message').placeholder=enabled?'Gontaに話しかける…':'まずはPCに接続してください';$('composer-state').textContent=runId?'Gontaが考えています…':enabled?'Enterで送信 · Shift + Enterで改行':'接続後にメッセージを送信できます';$('stop').hidden=!runId;}
function rpc(method,params={}){if(!connected)return Promise.reject(Error('PCに接続してください。'));const id=String(++requestCount);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('応答を確認できませんでした。再送の前に履歴を確認してください。'));},35000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({type:'request',id,method,params}));});}
function websocketURL(value){const u=new URL(value);if(!['https:','http:','wss:','ws:'].includes(u.protocol)||u.username||u.password)throw Error('接続先URLを確認してください。');if(['http:','ws:'].includes(u.protocol)&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('外部接続にはHTTPSのURLを指定してください。');u.protocol=['https:','wss:'].includes(u.protocol)?'wss:':'ws:';u.pathname='/ws';u.search='';u.hash='';return u.href;}
async function proof(nonce,key){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(nonce)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function connect(c){
 clearTimeout(reconnectTimer);intentional=false;connected=false;if(ws){ws.onclose=null;ws.close();}
 let target;try{target=websocketURL(c.url);}catch(e){$('connect-error').textContent=e.message;return;}
 credentials=c;$('connect-error').textContent='接続しています…';$('connect-submit').disabled=true;
 const current=ws=new WebSocket(target);const timer=setTimeout(()=>current.close(),12000);
 current.onmessage=async event=>{
  let f;try{f=JSON.parse(event.data);}catch{return;}
  if(f.type==='challenge'){try{current.send(JSON.stringify({type:'auth',proof:await proof(f.nonce,c.key)}));}catch{current.close();}}
  if(f.type==='ready'){
   clearTimeout(timer);connected=true;sessionStorage.setItem('gonta.connection',JSON.stringify(c));localStorage.setItem('gonta.relay',c.url);$('connect-submit').disabled=false;$('connect-error').textContent='';$('settings').close();setStatus(f.status);notice('');
   try{await refreshSessions();if(selected)await selectSession(selected);else if(sessionList.length)await selectSession(sessionList.find(x=>x.key.includes(':discord:'))?.key||sessionList[0].key);else await newChat();}catch(e){notice(e.message);}
  }
  if(f.type==='response'){const p=pending.get(f.id);if(p){clearTimeout(p.timer);pending.delete(f.id);f.error?p.reject(Error(f.error)):p.resolve(f.result);}}
  if(f.type==='status')setStatus(f.status);
  if(f.type==='chat'&&f.sessionKey===selected){
   if(f.state==='delta'){runId=f.runId;stream=f.text||stream;renderMessages();updateComposer();}
   else if(['final','error','aborted'].includes(f.state)){runId=null;stream='';updateComposer();await loadHistory().catch(e=>notice(e.message));void refreshSessions();if(f.error)notice(f.error);}
  }
 };
 current.onclose=e=>{
  clearTimeout(timer);connected=false;gatewayReady=false;setStatus({});$('connect-submit').disabled=false;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('接続が切れました。再接続後に履歴を確認してください。'));}pending.clear();
  if(!intentional){const text=e.code===1008?'アクセスキーを確認してください。':'接続できません。PC側のGontaと接続先URLを確認してください。';$('connect-error').textContent=text;notice(text);if(e.code!==1008&&sessionStorage.getItem('gonta.connection'))reconnectTimer=setTimeout(()=>connect(credentials),6000);}
 };
 current.onerror=()=>{};
}
$('connect-form').onsubmit=e=>{e.preventDefault();connect({url:$('relay-url').value.trim(),key:$('passcode').value.trim()});};
$('disconnect').onclick=()=>{intentional=true;clearTimeout(reconnectTimer);ws?.close();sessionStorage.removeItem('gonta.connection');localStorage.removeItem('gonta.relay');credentials=null;connected=false;selected=null;sessionList=[];messages=[];runId=null;stream='';$('passcode').value='';$('relay-url').value='';setStatus({});renderSessions();renderMessages();$('settings').close();$('welcome').hidden=false;$('conversation-title').textContent='会話のつづき';notice('');};
async function refreshSessions(){sessionList=await rpc('sessions');renderSessions();}
function displayName(s){return s.name.replace(/^\d+\s+(?=#)/,'');}
function renderSessions(){const list=$('sessions');list.replaceChildren();const q=$('search').value.trim().toLowerCase();const filtered=sessionList.filter(s=>displayName(s).toLowerCase().includes(q));if(!filtered.length){const p=document.createElement('p');p.className='sidebar-empty';p.textContent=connected?'会話が見つかりません。':'接続すると会話がここに並びます。';list.append(p);}for(const s of filtered){const b=document.createElement('button');b.className='session'+(s.key===selected?' active':'');b.setAttribute('aria-current',s.key===selected?'true':'false');const strong=document.createElement('strong');strong.textContent=displayName(s);const small=document.createElement('small');small.textContent=(s.channel==='discord'?'◉ Discord':'▤ Web')+(s.hasActiveRun?' · 応答中':'');b.append(strong,small);b.onclick=()=>selectSession(s.key).catch(e=>notice(e.message));list.append(b);}}
$('search').oninput=renderSessions;
async function selectSession(key){selected=key;runId=null;stream='';messages=[];renderMessages();renderSessions();$('welcome').hidden=true;$('sidebar').classList.remove('open');$('conversation-title').textContent=displayName(sessionList.find(s=>s.key===key)||{name:'新しい会話'});updateComposer();await loadHistory();}
async function loadHistory(){if(!selected)return;const key=selected,generation=++historyGeneration;const r=await rpc('history',{sessionKey:key});if(key!==selected||generation!==historyGeneration)return;messages=r.messages;runId=r.inFlightRun?.runId||null;stream=r.inFlightRun?.text||'';if(!runId&&r.sessionInfo?.hasActiveRun)notice('この会話ではOpenClawが処理中です。完了すると履歴が更新されます。');renderMessages();updateComposer();}
async function newChat(){if(!connected){showSettings();return;}const r=await rpc('new');selected=r.key;messages=[];stream='';runId=null;historyGeneration++;sessionList.unshift({key:r.key,name:'新しい会話',channel:'web'});$('welcome').hidden=true;$('conversation-title').textContent='新しい会話';$('sidebar').classList.remove('open');renderSessions();renderMessages();updateComposer();$('message').focus();}
$('new-chat').onclick=()=>newChat().catch(e=>notice(e.message));
function renderText(el,text){const parts=text.split(/(```[\s\S]*?```)/g);for(const p of parts){if(p.startsWith('```')&&p.endsWith('```')){const pre=document.createElement('pre');const code=document.createElement('code');code.textContent=p.slice(3,-3).replace(/^[\w+-]*\n/,'');pre.append(code);el.append(pre);}else{const span=document.createElement('span');span.textContent=p;el.append(span);}}}
function renderMessages(){updateRoom();const box=$('messages'),nearBottom=$('chat').scrollHeight-$('chat').scrollTop-$('chat').clientHeight<180;box.replaceChildren();if(!selected)return;for(const m of messages){const row=document.createElement('article');row.className='message '+m.role;const avatar=document.createElement('div');avatar.className='avatar';if(m.role==='assistant'){const img=document.createElement('img');img.src='/gonta-profile.png';img.alt='';avatar.append(img);}else avatar.textContent='YOU';const body=document.createElement('div');body.className='message-body';const author=document.createElement('div');author.className='message-author';author.textContent=m.role==='assistant'?'Gonta':'あなた';if(m.timestamp){const d=new Date(m.timestamp);if(!isNaN(d)){const t=document.createElement('time');t.textContent=d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});author.append(t);}}const content=document.createElement('div');content.className='message-text';renderText(content,m.text);body.append(author,content);row.append(avatar,body);box.append(row);}
 if(runId){const row=document.createElement('div');row.className='message';const avatar=document.createElement('div');avatar.className='avatar';const img=document.createElement('img');img.src='/gonta-profile.png';img.alt='';avatar.append(img);const text=document.createElement('div');text.className=stream?'message-text':'thinking';text.textContent=stream||'Gontaが考えています…';row.append(avatar,text);box.append(row);}
 if(!messages.length&&!runId){const empty=document.createElement('div');empty.className='empty-chat';empty.textContent='ここから、新しい会話を。';box.append(empty);}
 if(nearBottom||messages.length<5)$('chat').scrollTop=$('chat').scrollHeight;
}
$('composer').onsubmit=async e=>{e.preventDefault();const message=$('message').value.trim();if(!message||!connected||!selected||runId)return;const key=selected,id=crypto.randomUUID();runId=id;messages.push({role:'user',text:message,timestamp:Date.now()});$('message').value='';$('message').style.height='auto';renderMessages();updateComposer();notice('');try{const r=await rpc('send',{sessionKey:key,message,idempotencyKey:id});if(selected===key&&runId===id)runId=r.runId||id;}catch(e){notice(e.message);if(selected===key){runId=null;await loadHistory().catch(()=>{});}}finally{updateComposer();}};
$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('composer').requestSubmit();}};
$('message').oninput=()=>{$('message').style.height='auto';$('message').style.height=Math.min($('message').scrollHeight,180)+'px';};
$('stop').onclick=async()=>{try{await rpc('abort',{sessionKey:selected,runId});await loadHistory();}catch(e){notice(e.message);}};
async function showLine(){const ready=connected&&selected&&$('line-dialog').dataset.enabled==='true';$('line-description').textContent=!connected?'まずPCに接続してください。':!selected?'会話一覧から、続けたい会話を選択してください。':!ready?'LINEボットは設定中です。PC側でMessaging APIの設定が完了すると連携できます。':`「${$('conversation-title').textContent}」の続きをLINEで話せます。`;$('line-details').hidden=!ready;$('pair-box').hidden=true;if(!$('line-dialog').open)$('line-dialog').showModal();}
for(const id of ['line-open','welcome-line'])$(id).onclick=showLine;
$('pair-create').onclick=async()=>{try{const r=await rpc('pair',{sessionKey:selected});$('pair-code').textContent=r.code;$('pair-box').hidden=false;}catch(e){$('line-description').textContent=e.message;}};
$('pair-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('pair-code').textContent);$('pair-copy').textContent='コピー済み';setTimeout(()=>$('pair-copy').textContent='コピー',2000);}catch{$('pair-copy').textContent='コードを選択してコピー';}};
setInterval(()=>{if(connected&&gatewayReady&&selected&&document.visibilityState==='visible')void loadHistory().catch(()=>{});},12000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&connected)void loadHistory().catch(()=>{});});
if(credentials)connect(credentials);
