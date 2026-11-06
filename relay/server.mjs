import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,readdirSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {Brain,TOKEN_FILE,readTokenInfo} from './brain.mjs';
import {Discord,addressed,allowedChannel,cleanContent} from './discord.mjs';
import {ActivityTracker} from './activity.mjs';
import {Store} from './store.mjs';
import {diaryDate,diaryInstruction,messageLabel} from './diary.mjs';
import {equal,verifyLine,randomToken,allowedSession} from './security.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=process.env.GONTA_STATE_DIR||path.join(os.homedir(),'.gonta');
mkdirSync(directory,{recursive:true,mode:0o700});
const configFile=path.join(directory,'config.json');
if(!existsSync(configFile))writeFileSync(configFile,JSON.stringify({passcode:randomToken(),allowedOrigins:['http://127.0.0.1:18890','http://localhost:18890'],line:{},claude:{model:'sonnet'}},null,2),{mode:0o600});
const readConfig=()=>JSON.parse(readFileSync(configFile,'utf8'));
const config=readConfig();
if(!config.passcode||config.passcode.length<24)throw Error('A passcode of at least 24 characters is required.');
const localTokenFile=path.join(directory,'local-token');
if(!existsSync(localTokenFile))writeFileSync(localTokenFile,randomToken(),{mode:0o600});
const localToken=readFileSync(localTokenFile,'utf8').trim();

// Gonta's single conversation keeps the key the Web client has always used.
const conversation=config.conversationKey||'agent:main:discord:channel:1472809918645010535';
const workspace=process.env.GONTA_BRAIN||config.claude?.workspace||path.join(os.homedir(),'gonta-brain');
if(!existsSync(path.join(workspace,'CLAUDE.md')))throw Error(`Gonta's personality folder is missing: ${workspace}`);
// The brain answers on the API credit (Agent SDK) and falls back to the subscription; see brain.mjs.
const brain=new Brain({cwd:workspace,directory,model:process.env.GONTA_MODEL||config.claude?.model||'sonnet',effort:config.claude?.effort,command:config.claude?.command,api:config.claude?.api!==false,monthlyUsd:config.claude?.apiMonthlyUsd,spendFile:config.claude?.spendFile});
const activities=new ActivityTracker();
const store=new Store(path.join(directory,'gonta.sqlite'));
try{chmodSync(path.join(directory,'gonta.sqlite'),0o600);}catch{}
const port=Number(process.env.PORT||18890),localPort=Number(process.env.GONTA_LOCAL_PORT||port+1),peers=new Set();
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));};
const limiters=new Map();
function limit(key,max,window=60000){const now=Date.now();let r=limiters.get(key);if(!r||r.until<now){r={n:0,until:now+window};limiters.set(key,r);}return ++r.n<=max;}
setInterval(()=>{for(const[k,v]of limiters)if(v.until<Date.now())limiters.delete(k);},60000).unref();
const send=(ws,obj)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));};
const broadcast=obj=>{for(const ws of peers)send(ws,obj);};
const broadcastConversation=obj=>{for(const ws of peers)if(ws.session===conversation)send(ws,obj);};
const visibleRun=()=>{const b=brain.busy;return b&&!b.hidden?{runId:b.runId,text:b.text}:null;};
// The one-year token's dates (no secret) are written next to it by set-claude-token.ps1.
const tokenInfo=()=>readTokenInfo(directory);
function info(){
 const b=brain.busy;
 return{gateway:brain.ready,auth:brain.auth.ok?'ok':'expired',authSource:brain.authSource,tokenExpires:brain.authSource==='token'?tokenInfo()?.expires||null:null,backgroundActivity:b?.hidden?{kind:'diary'}:null,version:brain.version?`Claude Code ${brain.version}`:'Claude Code',model:brain.modelName||brain.model,line:!!(config.line?.secret&&config.line?.token),lineBotId:config.line?.botId||null,lineEvents:store.counts(),discord:discord?(discord.ready?'connected':'offline'):'disabled'};
}
function sessions(){return[{key:conversation,name:'#何でも',channel:'web',updatedAt:store.lastMessageAt(),hasActiveRun:!!visibleRun()}];}
function history(key){
 if(key!==conversation)throw Error('この会話にはアクセスできません。');
 const run=visibleRun();
 return{activity:activities.get(),messages:store.history(100).map(m=>({id:m.id,role:m.role,text:m.text,timestamp:m.timestamp})),sessionInfo:{hasActiveRun:!!run},inFlightRun:run};
}
// A turn is one message to the resident brain. Web and LINE share the queue.
function submit({text,source,runId,hidden=false,detail=''}){
 if(!hidden)store.addMessage({id:runId,role:'user',source,text});
 return brain.send({text:hidden?text:messageLabel(source,new Date(),detail)+'\n'+text,source,runId,hidden});
}
async function rpc(ws,method,p){
 switch(method){
 case 'status':return info();
 case 'sessions':return sessions();
 case 'history':ws.session=p.sessionKey;return history(p.sessionKey);
 case 'new':ws.session=conversation;return{key:conversation};
 case 'send':{
  if(p.sessionKey!==conversation||typeof p.message!=='string'||!p.message.trim()||p.message.length>20000||!/^[-a-f0-9]{36}$/.test(p.idempotencyKey||''))throw Error('メッセージの形式が正しくありません。');
  if(!limit('send',30))throw Error('送信が多すぎます。少し待ってください。');
  ws.session=conversation;
  if(store.hasMessage(p.idempotencyKey))return{runId:p.idempotencyKey};
  if(!brain.ready)throw Error('ゴンタの頭脳が起動していません。少し待ってから再送してください。');
  void submit({text:p.message,source:'web',runId:p.idempotencyKey}).catch(()=>{});
  return{runId:p.idempotencyKey};
 }
 case 'abort':if(p.sessionKey!==conversation||typeof p.runId!=='string')throw Error('停止する応答を選んでください。');if(!brain.abort(p.runId))throw Error('その応答はすでに終わっています。');return{ok:true};
 case 'pair':{
  if(!allowedSession(p.sessionKey))throw Error('先に会話を選択してください。');
  const code=randomBytes(5).toString('hex').toUpperCase();store.pair(code,conversation);return{code,expiresIn:600,botId:config.line?.botId};
 }
 default:throw Error('対応していない操作です。');
 }
}
const files={'/':'index.html','/app.js':'app.js','/memo.js':'memo.js','/memo-state.js':'memo-state.js','/memo.css':'memo.css','/discovery.js':'discovery.js','/theme.js':'theme.js','/room.js':'room.js','/room.css':'room.css','/room-background.png':'room-background.png','/room-gonta.png':'room-gonta.png','/room-emotions.png':'room-emotions.png','/room-emotion-joy.png':'room-emotion-joy.png','/room-work-pc.png':'room-work-pc.png','/room-work-diary.png':'room-work-diary.png','/room-work-obsidian.png':'room-work-obsidian.png','/DotGothic16-Regular.ttf':'DotGothic16-Regular.ttf','/DotGothic16-OFL.txt':'DotGothic16-OFL.txt','/style.css':'style.css','/icon.svg':'icon.svg','/gonta-profile.png':'gonta-profile.png'};
// Animation strips are generated by scripts/sprites.py, so serve whatever public/anim holds.
for(const name of readdirSync(path.join(root,'public','anim')))files['/anim/'+name]='anim/'+name;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.json':'application/json'};
async function readBody(req,res,max){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max){json(res,413,{error:'Too large'});req.destroy();return null;}chunks.push(chunk);}return Buffer.concat(chunks);}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{service:'gonta',ok:true,brain:brain.ready});
 if(url.pathname==='/api/connection'&&req.method==='GET'){
  const upstream=await fetch('https://gonta-connect.umedademu.workers.dev/',{signal:AbortSignal.timeout(8000)});
  res.setHeader('Cache-Control','no-store');
  return json(res,upstream.status,await upstream.json());
 }
 if(url.pathname==='/api/memo'&&['GET','PUT','OPTIONS'].includes(req.method)){
  let body;
  if(req.method==='PUT'){body=await readBody(req,res,650000);if(body===null)return;}
  const headers={'Authorization':req.headers.authorization||'','Content-Type':'application/json'};
  if(req.headers.origin)headers.Origin=req.headers.origin;
  const upstream=await fetch('https://gonta-memo.umedademu.workers.dev/api/memo'+url.search,{method:req.method,headers,body,signal:AbortSignal.timeout(12000)});
  if(upstream.status===204){res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;}
  return json(res,upstream.status,await upstream.json());
 }
 if(url.pathname==='/line/webhook'&&req.method==='POST'){
  if(!config.line?.secret)return json(res,503,{error:'LINE is not configured'});
  const raw=await readBody(req,res,1024*1024);if(raw===null)return;
  if(!verifyLine(raw,req.headers['x-line-signature'],config.line.secret))return json(res,401,{error:'Invalid signature'});
  const body=JSON.parse(raw);if(!Array.isArray(body.events))return json(res,400,{error:'Invalid events'});
  for(const e of body.events)if(e.type==='message'&&e.source?.type==='user'&&e.message?.type==='text'&&typeof e.webhookEventId==='string')store.enqueue(e);
  json(res,200,{ok:true});void drain();return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
 const file=files[url.pathname];if(!file)return json(res,404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://gonta-connect.umedademu.workers.dev wss: ws://127.0.0.1:* ws://localhost:*; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?'':readFileSync(path.join(root,'public',file)));
 }catch{if(!res.headersSent)json(res,500,{error:'Request failed'});else res.end();}
});
const wss=new WebSocketServer({noServer:true,maxPayload:128*1024,perMessageDeflate:false});
function allowedOrigins(){try{const c=readConfig();if(Array.isArray(c.allowedOrigins))config.allowedOrigins=c.allowedOrigins;}catch{}return config.allowedOrigins;}
server.on('upgrade',(req,socket,head)=>{
 const origin=req.headers.origin;
 if(req.url!=='/ws'||!allowedOrigins().includes(origin)||wss.clients.size>=30){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
 wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
wss.on('connection',(ws,req)=>{
 const nonce=randomToken();let authenticated=false,processing=0;
 const ip=req.headers['cf-connecting-ip']||req.socket.remoteAddress;
 const timeout=setTimeout(()=>ws.close(1008,'Authentication required'),10000);
 send(ws,{type:'challenge',nonce});
 ws.on('message',async raw=>{
  try{
   const msg=JSON.parse(raw);
   if(!authenticated){
    if(!limit('auth:'+ip,15,300000)||msg.type!=='auth'||!equal(msg.proof,createHmac('sha256',config.passcode).update(nonce).digest('hex'))){ws.close(1008,'Authentication failed');return;}
    authenticated=true;clearTimeout(timeout);peers.add(ws);send(ws,{type:'ready',status:info()});return;
   }
   if(msg.type!=='request'||typeof msg.id!=='string'||msg.id.length>80)return;
   if(++processing>8){processing--;send(ws,{type:'response',id:msg.id,error:'処理中です。少し待ってください。'});return;}
   try{const result=await rpc(ws,msg.method,msg.params||{});send(ws,{type:'response',id:msg.id,result});}
   catch(e){send(ws,{type:'response',id:msg.id,error:e.message});}finally{processing--;}
  }catch{ws.close(1008,'Invalid message');}
 });
 ws.on('close',()=>{clearTimeout(timeout);peers.delete(ws);});ws.on('error',()=>{});
});
brain.on('turn',t=>{
 if(t.hidden){
  if(t.state!=='delta')broadcast({type:'status',status:info()});
  if(t.state!=='start'&&t.state!=='delta'){
   console.log(`Diary turn ${t.state}:`,(t.error||t.text||'').slice(0,300).replace(/\s+/g,' '));
   const channel=config.discord?.announce?.diary;
   if(discord?.ready&&channel&&t.source==='diary')discord.reply(channel,t.state==='final'?t.text:`日記の定時実行が失敗しました: ${t.error||''}`).catch(e=>console.error('Diary announce:',e.message));
  }
  return;
 }
 if(t.state==='start')return;
 if(['final','error','aborted'].includes(t.state)){
  if(t.text)store.addMessage({id:'reply:'+t.runId,role:'assistant',source:t.source,text:t.text});
  const change=activities.clear();if(change!==undefined)broadcastConversation({type:'activity',sessionKey:conversation,activity:null});
 }
 broadcastConversation({type:'chat',sessionKey:conversation,runId:t.runId,state:t.state,text:t.text,error:t.error});
});
brain.on('tool',e=>{if(e.hidden)return;const activity=activities.event(e);if(activity!==undefined)broadcastConversation({type:'activity',sessionKey:conversation,activity});});
brain.on('auth',()=>broadcast({type:'status',status:info()}));
brain.on('ready',()=>{console.log('Claude brain ready');broadcast({type:'status',status:info()});void drain();});
brain.on('offline',()=>{const change=activities.clear();if(change!==undefined)broadcastConversation({type:'activity',sessionKey:conversation,activity:null});broadcast({type:'status',status:info()});});

// Discord: one bot connection; replies go to the channel the message came from.
let discord=null;
if(config.discord?.token){
 discord=new Discord({token:config.discord.token});
 discord.on('ready',()=>broadcast({type:'status',status:info()}));
 discord.on('offline',()=>broadcast({type:'status',status:info()}));
 discord.on('message',m=>{discordMessage(m).catch(e=>console.error('Discord message failed:',e.message));});
 discord.connect();
}
async function discordMessage(m){
 if(!m?.author||m.author.bot||typeof m.content!=='string'||!discord.user)return;
 if(!allowedChannel(m,config.discord)||!addressed(m,discord.user.id,config.discord))return;
 const text=cleanContent(m.content,discord.user.id);if(!text)return;
 const runId='discord:'+m.id;
 if(store.hasMessage(runId))return;
 if(!limit('discord',30))return;
 const name=await discord.channelName(m.channel_id);
 const author=m.member?.nick||m.author.global_name||m.author.username||'';
 if(!brain.ready){await discord.reply(m.channel_id,'PCのゴンタが起動していません。少し待ってから送ってください。',m.id);return;}
 try{const r=await submit({text,source:'discord',runId,detail:`${name} ${author}`.trim()});await discord.reply(m.channel_id,r.text,m.id);}
 catch(e){await discord.reply(m.channel_id,(e.text?e.text+'\n\n':'')+e.message,m.id);}
}
async function lineSend(endpoint,payload){
 const r=await fetch('https://api.line.me/v2/bot/message/'+endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.line.token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(`LINE ${endpoint} HTTP ${r.status}`);
}
function lineMessages(text){const messages=[];for(let i=0;i<Math.min(text.length,24000);i+=4800)messages.push({type:'text',text:text.slice(i,i+4800)});if(!messages.length)messages.push({type:'text',text:'応答が完了しました。詳細はWeb画面で確認できます。'});return messages;}
const lineReply=(e,text)=>lineSend('reply',{replyToken:e.replyToken,messages:lineMessages(text)});
const linePush=(userId,text)=>lineSend('push',{to:userId,messages:lineMessages(text)});
// Reply tokens expire quickly: answer within 45 seconds, then push the real reply.
async function lineTurn(e){
 const outcome=submit({text:e.message.text,source:'line',runId:e.webhookEventId}).then(r=>({text:r.text}),err=>({text:err.text,error:err.message}));
 const result=await Promise.race([outcome,new Promise(r=>setTimeout(()=>r(null),45000))]);
 if(result){await lineReply(e,result.error?(result.text?result.text+'\n\n'+result.error:result.error):result.text);return;}
 await lineReply(e,'考え中。終わったら、このまま続けて送るね。');
 const late=await outcome;
 await linePush(e.source.userId,late.error?(late.text?late.text+'\n\n'+late.error:late.error):late.text);
}
let draining=false;
async function drain(){
 if(draining||!config.line?.token)return;draining=true;
 try{let row;while((row=store.next())){
  const e=JSON.parse(row.body);store.status(row.id,'processing');
  try{
   const key=store.user(e.source.userId);const text=e.message.text.trim();let reply;
   if(!key||/^(?:連携\s*)?[A-Fa-f0-9]{10}$/.test(text)){
    const code=text.replace(/^連携\s*/,'').toUpperCase();
    if(!limit('pair:'+e.source.userId,10,600000))reply='しばらく待ってから連携コードを入力してください。';
    else reply=store.consume(code,e.source.userId)?'連携しました。このまま送信すると、Webと同じ会話の続きを話せます。':'Web画面の「LINEとつなぐ」で発行した連携コードを送信してください。';
   }else if(['/会話','/sessions','/新規','/new'].includes(text)||/^\/(切替|use)\s+\d+$/.test(text))reply='いまはWebとLINEで1つの会話を共有しています。そのまま続けて送ってください。';
   else if(text==='/help'||text==='/ヘルプ')reply='そのまま送ると、Webと同じ会話の続きになります。\n45秒以内に返事が間に合わないときは、できあがり次第こちらから送ります。\nPCのゴンタが起動しているときだけ返信できます。';
   else if(!brain.ready)reply='PCのゴンタが起動していません。PCの状態を確認し、後で再送してください。';
   else{
    // Mark before dispatch. Never automatically replay a turn with an uncertain outcome.
    store.status(row.id,'dispatched');
    await lineTurn(e);store.status(row.id,'done');continue;
   }
   await lineReply(e,reply);store.status(row.id,'done');
  }catch(e){store.status(row.id,'failed',e.message);console.error('LINE event failed:',row.id,e.message);}
 }}finally{draining=false;}
}
// Remind on LINE 30, 7 and 1 days before the one-year token runs out, and when it has. The token
// is also the fallback while the API answers, so this does not depend on the current route.
// Only a fixed message is sent; the model is not called.
function remindToken(){
 const t=tokenInfo();if(!existsSync(path.join(directory,TOKEN_FILE))||!t?.expires||!config.line?.token)return;
 const days=Math.ceil((Date.parse(t.expires)-Date.now())/86400000);
 const step=[0,1,7,30].find(d=>days<=d);if(step===undefined)return;
 const key='tokenReminder:'+t.expires,last=store.get(key);if(typeof last==='number'&&last<=step)return;
 store.set(key,step);
 const text=days>0?`ゴンタのログイン用の合言葉は、あと${days}日で期限が切れます。PCで gonta フォルダの scripts\\update-claude-login.cmd を実行して更新してください。`:'ゴンタのログイン用の合言葉の期限が切れました。PCで gonta フォルダの scripts\\update-claude-login.cmd を実行して更新してください。';
 for(const user of store.lineUsers())linePush(user,text).catch(e=>console.error('Token reminder:',e.message));
}
setTimeout(remindToken,120000).unref();setInterval(remindToken,6*3600000).unref();
// Local-only entrance for the PC itself: the nightly diary task and manual checks.
// It is bound to loopback on a port the tunnel never forwards and needs the token file.
const local=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!equal(req.headers['x-gonta-token']||'',localToken))return json(res,401,{error:'Unauthorized'});
  if(url.pathname==='/status'&&req.method==='GET')return json(res,200,{...info(),route:brain.route,routeReason:brain.routeReason||null,apiThisMonth:brain.apiMonth,busy:brain.busy&&{runId:brain.busy.runId,source:brain.busy.source,hidden:brain.busy.hidden,started:brain.busy.started},queued:brain.queue.length,session:brain.sessionId||null,workspace});
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  const raw=await readBody(req,res,64*1024);if(raw===null)return;
  const body=raw.length?JSON.parse(raw):{};
  const wait=body.wait!==false;
  if(url.pathname==='/restart')return json(res,200,{ok:true,when:brain.reload()});
  if(url.pathname==='/diary'){
   const date=body.date||diaryDate();
   const runId='diary:'+date+':'+randomUUID();
   const turn=submit({text:diaryInstruction(date),source:'diary',runId,hidden:true});
   if(!wait){turn.catch(()=>{});return json(res,202,{runId,date});}
   try{const r=await turn;return json(res,200,{ok:true,runId,date,text:r.text});}catch(e){return json(res,200,{ok:false,runId,date,text:e.text||'',error:e.message});}
  }
  if(url.pathname==='/say'){
   if(typeof body.text!=='string'||!body.text.trim())return json(res,400,{error:'text is required'});
   const runId=randomUUID();
   const turn=submit({text:body.text,source:'local',runId});
   if(!wait){turn.catch(()=>{});return json(res,202,{runId});}
   try{const r=await turn;return json(res,200,{ok:true,runId,text:r.text});}catch(e){return json(res,200,{ok:false,runId,text:e.text||'',error:e.message});}
  }
  return json(res,404,{error:'Not found'});
 }catch(e){if(!res.headersSent)json(res,500,{error:e.message});else res.end();}
});
local.requestTimeout=0;local.headersTimeout=60000;
server.listen(port,'127.0.0.1',()=>console.log(`Gonta listening on http://127.0.0.1:${port}`));
local.listen(localPort,'127.0.0.1',()=>console.log(`Local trigger on http://127.0.0.1:${localPort}`));
brain.start();
process.on('SIGTERM',()=>{brain.stop();discord?.stop();for(const ws of wss.clients)ws.close();local.close();server.close(()=>{store.close();process.exit(0);});});
process.on('SIGINT',()=>process.emit('SIGTERM'));
