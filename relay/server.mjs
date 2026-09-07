import {DiaryMonitor} from './diary.mjs';
import {ActivityTracker} from './activity.mjs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {Gateway} from './gateway.mjs';
import {Store} from './store.mjs';
import {equal,verifyLine,randomToken,allowedSession,textContent} from './security.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=process.env.GONTA_STATE_DIR||path.join(os.homedir(),'.gonta');
mkdirSync(directory,{recursive:true,mode:0o700});
const configFile=path.join(directory,'config.json');
if(!existsSync(configFile))writeFileSync(configFile,JSON.stringify({passcode:randomToken(),allowedOrigins:['http://127.0.0.1:18890','http://localhost:18890'],line:{}},null,2),{mode:0o600});
const config=JSON.parse(readFileSync(configFile));
if(!config.passcode||config.passcode.length<24)throw Error('A passcode of at least 24 characters is required.');
const oc=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG||path.join(os.homedir(),'.openclaw/openclaw.json')));
const gateway=new Gateway({url:`ws://127.0.0.1:${oc.gateway.port||18789}`,token:oc.gateway.auth.token,directory});
const activities=new ActivityTracker();
const diary=new DiaryMonitor((method,params)=>gateway.request(method,params),()=>{for(const ws of peers)send(ws,{type:'status',status:info()});});
const store=new Store(path.join(directory,'gonta.sqlite'));
try{chmodSync(path.join(directory,'gonta.sqlite'),0o600);}catch{}
const port=Number(process.env.PORT||18890),peers=new Set();
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));};
const limiters=new Map();
function limit(key,max,window=60000){const now=Date.now();let r=limiters.get(key);if(!r||r.until<now){r={n:0,until:now+window};limiters.set(key,r);}return ++r.n<=max;}
setInterval(()=>{for(const[k,v]of limiters)if(v.until<Date.now())limiters.delete(k);},60000).unref();
const send=(ws,obj)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));};
async function sessions(){const r=await gateway.request('sessions.list',{limit:200});return(r.sessions||[]).filter(x=>allowedSession(x.key)).map(x=>({key:x.key,name:x.label||x.displayName|| (x.key.endsWith(':main')?'メインの会話':'新しい会話'),channel:x.channel||'web',updatedAt:x.updatedAt,hasActiveRun:x.hasActiveRun}));}
async function history(key){if(!allowedSession(key))throw Error('この会話にはアクセスできません。');const r=await gateway.request('chat.history',{sessionKey:key,limit:100});return{activity:activities.get(key),messages:(r.messages||[]).filter(m=>['user','assistant'].includes(m.role)).map(m=>({id:m.id||m.messageId,role:m.role,text:textContent(m),timestamp:m.timestamp})).filter(m=>m.text),sessionInfo:r.sessionInfo,inFlightRun:r.inFlightRun?{runId:r.inFlightRun.runId,text:r.inFlightRun.text}:null};}
function info(){return{gateway:gateway.ready,backgroundActivity:diary.activity,version:gateway.version,line:!!(config.line?.secret&&config.line?.token),lineBotId:config.line?.botId||null,lineEvents:store.counts()};}
async function rpc(ws,method,p){
 switch(method){
 case 'status':return info();
 case 'sessions':return sessions();
 case 'history':ws.session=p.sessionKey;return history(p.sessionKey);
 case 'new':{const key=`agent:main:gonta:${randomUUID()}`;ws.session=key;return{key};}
 case 'send':{
  if(!allowedSession(p.sessionKey)||typeof p.message!=='string'||!p.message.trim()||p.message.length>20000||!/^[-a-f0-9]{36}$/.test(p.idempotencyKey||''))throw Error('メッセージの形式が正しくありません。');
  if(!limit('send',30))throw Error('送信が多すぎます。少し待ってください。');
  ws.session=p.sessionKey;return gateway.request('chat.send',{sessionKey:p.sessionKey,message:p.message,idempotencyKey:p.idempotencyKey});
 }
 case 'abort':if(!allowedSession(p.sessionKey)||typeof p.runId!=='string')throw Error('停止する応答を選んでください。');return gateway.request('chat.abort',{sessionKey:p.sessionKey,runId:p.runId});
 case 'pair':{
  if(!allowedSession(p.sessionKey))throw Error('先に会話を選択してください。');
  const code=randomBytes(5).toString('hex').toUpperCase();store.pair(code,p.sessionKey);return{code,expiresIn:600,botId:config.line?.botId};
 }
 default:throw Error('対応していない操作です。');
 }
}
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'&&req.method==='GET')return json(res,200,{service:'gonta',ok:true});
 if(url.pathname==='/api/connection'&&req.method==='GET'){
  const upstream=await fetch('https://gonta-connect.umedademu.workers.dev/',{signal:AbortSignal.timeout(8000)});
  res.setHeader('Cache-Control','no-store');
  return json(res,upstream.status,await upstream.json());
 }
 if(url.pathname==='/line/webhook'&&req.method==='POST'){
  if(!config.line?.secret)return json(res,503,{error:'LINE is not configured'});
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>1024*1024){json(res,413,{error:'Too large'});req.destroy();return;}chunks.push(chunk);}
  const raw=Buffer.concat(chunks);if(!verifyLine(raw,req.headers['x-line-signature'],config.line.secret))return json(res,401,{error:'Invalid signature'});
  const body=JSON.parse(raw);if(!Array.isArray(body.events))return json(res,400,{error:'Invalid events'});
  for(const e of body.events)if(e.type==='message'&&e.source?.type==='user'&&e.message?.type==='text'&&typeof e.webhookEventId==='string')store.enqueue(e);
  json(res,200,{ok:true});void drain();return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
 const files={'/':'index.html','/app.js':'app.js','/discovery.js':'discovery.js','/theme.js':'theme.js','/room.js':'room.js','/room.css':'room.css','/room-background.png':'room-background.png','/room-gonta.png':'room-gonta.png','/room-work-pc.png':'room-work-pc.png','/room-work-diary.png':'room-work-diary.png','/room-work-obsidian.png':'room-work-obsidian.png','/DotGothic16-Regular.ttf':'DotGothic16-Regular.ttf','/DotGothic16-OFL.txt':'DotGothic16-OFL.txt','/style.css':'style.css','/icon.svg':'icon.svg','/gonta-profile.png':'gonta-profile.png'};
 const file=files[url.pathname];if(!file)return json(res,404,{error:'Not found'});
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
 res.writeHead(200,{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://gonta-connect.umedademu.workers.dev wss: ws://127.0.0.1:* ws://localhost:*; base-uri 'none'; frame-ancestors 'none'"});res.end(req.method==='HEAD'?'':readFileSync(path.join(root,'public',file)));
 }catch{if(!res.headersSent)json(res,500,{error:'Request failed'});else res.end();}
});
const wss=new WebSocketServer({noServer:true,maxPayload:128*1024,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
 const origin=req.headers.origin;
 if(req.url!=='/ws'||!config.allowedOrigins.includes(origin)||wss.clients.size>=30){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
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
gateway.on('event',frame=>{
 if(frame.event==='cron')void diary.refresh();
 const p=frame.payload;
 const change=activities.event(frame);if(change)for(const ws of peers)if(ws.session===change.sessionKey)send(ws,{type:'activity',...change});
 if(frame.event==='chat'&&allowedSession(p?.sessionKey))for(const ws of peers)if(ws.session===p.sessionKey)send(ws,{type:'chat',sessionKey:p.sessionKey,runId:p.runId,state:p.state,text:textContent(p.message),error:p.errorMessage});
});
gateway.on('ready',()=>{diary.start();console.log('OpenClaw connected');for(const ws of peers)send(ws,{type:'status',status:info()});void drain();});
gateway.on('offline',()=>{diary.stop();for(const ws of peers)send(ws,{type:'status',status:info()});});
gateway.on('diagnostic',e=>console.error('Gateway:',e));

async function lineReply(e,text){
 const messages=[];for(let i=0;i<Math.min(text.length,24000);i+=4800)messages.push({type:'text',text:text.slice(i,i+4800)});
 if(!messages.length)messages.push({type:'text',text:'応答が完了しました。詳細はWeb画面で確認できます。'});
 const r=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{Authorization:`Bearer ${config.line.token}`,'Content-Type':'application/json'},body:JSON.stringify({replyToken:e.replyToken,messages}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('LINE reply HTTP '+r.status);
}
async function lineTurn(e,key){
 const runId=e.webhookEventId;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>finish(new Error('応答が長時間続いています。Web画面で続きを確認してください。')),45000);
  function finish(err,text){clearTimeout(timer);gateway.off('event',event);err?reject(err):resolve(text);}
  function event(f){const p=f.payload;if(f.event==='chat'&&p?.runId===runId&&p.sessionKey===key){if(p.state==='final')finish(null,textContent(p.message));else if(p.state==='error'||p.state==='aborted')finish(new Error(p.errorMessage||'応答が停止しました。'));}}
  gateway.on('event',event);
  gateway.request('chat.send',{sessionKey:key,message:e.message.text,idempotencyKey:runId}).catch(e=>finish(e));
 });
}
let draining=false;
async function drain(){
 if(draining||!config.line?.token)return;draining=true;
 try{let row;while((row=store.next())){
  const e=JSON.parse(row.body);store.status(row.id,'processing');
  try{
   let key=store.user(e.source.userId);const text=e.message.text.trim();let reply;
   if(!key||/^(?:連携\s*)?[A-Fa-f0-9]{10}$/.test(text)){
    const code=text.replace(/^連携\s*/,'').toUpperCase();
    if(!limit('pair:'+e.source.userId,10,600000))reply='しばらく待ってから連携コードを入力してください。';
    else reply=store.consume(code,e.source.userId)?'連携しました。このまま送信すると、選んだ会話の続きを話せます。\n「/会話」で会話一覧を表示できます。':'Web画面の「LINEとつなぐ」で発行した連携コードを送信してください。';
   }else if(text==='/会話'||text==='/sessions'){
    const list=await sessions();store.set('list:'+e.source.userId,list.map(x=>x.key));reply=list.map((x,i)=>`${i+1}. ${x.name}`).join('\n')+'\n\n「/切替 1」のように送ると、その会話に切り替わります。';
   }else if(/^\/(切替|use)\s+\d+$/.test(text)){
    const list=store.get('list:'+e.source.userId)||[],next=list[Number(text.split(/\s+/)[1])-1];
    if(next&&allowedSession(next)){store.bind(e.source.userId,next);reply='会話を切り替えました。続けてメッセージを送ってください。';}else reply='先に「/会話」で一覧を表示し、その番号を指定してください。';
   }else if(text==='/新規'||text==='/new'){
    key=`agent:main:gonta:${randomUUID()}`;store.bind(e.source.userId,key);reply='新しい会話を始めます。メッセージを送ってください。';
   }else if(text==='/help'||text==='/ヘルプ')reply='/会話：会話一覧\n/切替 番号：会話を変更\n/新規：新しい会話\nPCのOpenClawと接続中のみ返信できます。';
   else if(!gateway.ready)reply='PCのOpenClawに接続できません。PCの起動状態を確認し、後で再送してください。';
   else {
    // Mark before dispatch. Never automatically replay a turn with an uncertain outcome.
    store.status(row.id,'dispatched');
    try{reply=await lineTurn(e,key);}catch(e){reply=e.message;}
   }
   await lineReply(e,reply);store.status(row.id,'done');
  }catch(e){store.status(row.id,'failed',e.message);console.error('LINE event failed:',row.id,e.message);}
 }}finally{draining=false;}
}
server.listen(port,'127.0.0.1',()=>console.log(`Gonta listening on http://127.0.0.1:${port}`));gateway.connect();
process.on('SIGTERM',()=>{diary.stop();gateway.stop();for(const ws of wss.clients)ws.close();server.close(()=>{store.close();process.exit(0);});});
