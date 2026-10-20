// Minimal Discord bot client: one gateway connection for receiving messages and
// the REST API for replying. Gonta answers direct messages, and guild messages
// that mention the bot (or reply to it) in channels the configuration allows.
import WebSocket from 'ws';
import {EventEmitter} from 'node:events';

const GATEWAY='wss://gateway.discord.gg';
const API='https://discord.com/api/v10';
// GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT (privileged; enabled in the developer portal)
export const INTENTS=(1<<0)|(1<<9)|(1<<12)|(1<<15);
const FATAL_CLOSE={4004:'Discordのトークンが無効です。',4010:'Discordのシャード設定が不正です。',4011:'Discordのシャード数が足りません。',4013:'Discordのインテント指定が不正です。',4014:'DiscordでMESSAGE CONTENTインテントが許可されていません。'};

export function allowedChannel(message,policy={}){
 if(!message.guild_id)return policy.dm!==false;
 const guilds=policy.guilds;
 if(guilds&&typeof guilds==='object'){const g=guilds[message.guild_id];if(!g)return false;if(Array.isArray(g.deny)&&g.deny.includes(message.channel_id))return false;if(Array.isArray(g.allow)&&!g.allow.includes(message.channel_id))return false;}
 return true;
}
export function addressed(message,botId,policy={}){
 if(!message.guild_id||policy.requireMention===false)return true;
 if((message.mentions||[]).some(u=>u?.id===botId))return true;
 return message.referenced_message?.author?.id===botId;
}
export function cleanContent(text,botId){return String(text||'').replace(new RegExp(`<@!?${botId}>`,'g'),'').replace(/\s+$/,'').trim();}
export function chunks(text,size=1900){const out=[];const t=String(text||'').trim()||'（返答が空でした）';for(let i=0;i<t.length&&out.length<10;i+=size)out.push(t.slice(i,i+size));return out;}

export class Discord extends EventEmitter{
 constructor({token,log=console,WebSocketImpl=WebSocket,fetchImpl=fetch}){
  super();this.token=token;this.log=log;this.WebSocketImpl=WebSocketImpl;this.fetchImpl=fetchImpl;
  this.seq=null;this.sessionId=null;this.resumeUrl=null;this.user=null;this.ready=false;this.stopped=false;this.backoff=5000;this.channels=new Map();
 }
 connect(){
  if(this.stopped||this.ws)return;
  const base=this.sessionId&&this.resumeUrl?this.resumeUrl:GATEWAY;
  const ws=this.ws=new this.WebSocketImpl(base+'/?v=10&encoding=json');
  ws.on('open',()=>{this.acked=true;});
  ws.on('message',data=>{let p;try{p=JSON.parse(data);}catch{return;}this.handle(p);});
  ws.on('error',e=>this.log.error('Discord socket:',e.message));
  ws.on('close',(code,reason)=>{
   if(ws!==this.ws)return;
   this.ws=null;this.ready=false;clearInterval(this.heartbeat);this.heartbeat=null;
   this.emit('offline');
   const fatal=FATAL_CLOSE[code];
   if(fatal){this.log.error('Discord closed:',code,fatal);this.stopped=true;return;}
   if([4007,4009].includes(code))this.sessionId=null;
   this.log.error(`Discord closed (${code} ${String(reason||'')})${this.stopped?'':'; reconnecting'}`);
   if(!this.stopped)this.schedule();
  });
 }
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.connect(),this.backoff);this.timer.unref?.();this.backoff=Math.min(this.backoff*2,60000);}
 send(payload){try{this.ws?.send(JSON.stringify(payload));}catch(e){this.log.error('Discord send:',e.message);}}
 handle(p){
  if(typeof p.s==='number')this.seq=p.s;
  switch(p.op){
  case 10:{
   const interval=p.d?.heartbeat_interval||41250;
   clearInterval(this.heartbeat);this.acked=true;
   this.heartbeat=setInterval(()=>{if(!this.acked){this.log.error('Discord heartbeat lost; reconnecting');try{this.ws?.terminate?.();this.ws?.close?.();}catch{}return;}this.acked=false;this.send({op:1,d:this.seq});},interval);
   this.heartbeat.unref?.();
   if(this.sessionId)this.send({op:6,d:{token:this.token,session_id:this.sessionId,seq:this.seq}});
   else this.send({op:2,d:{token:this.token,intents:INTENTS,properties:{os:process.platform,browser:'gonta',device:'gonta'}}});
   return;
  }
  case 11:this.acked=true;return;
  case 1:this.send({op:1,d:this.seq});return;
  case 7:this.log.log('Discord asked to reconnect');try{this.ws?.close(4000,'reconnect');}catch{}return;
  case 9:
   if(p.d!==true)this.sessionId=null;
   setTimeout(()=>{if(this.sessionId)this.send({op:6,d:{token:this.token,session_id:this.sessionId,seq:this.seq}});else this.send({op:2,d:{token:this.token,intents:INTENTS,properties:{os:process.platform,browser:'gonta',device:'gonta'}}});},2000+Math.random()*3000).unref?.();
   return;
  case 0:
   if(p.t==='READY'){this.sessionId=p.d.session_id;this.resumeUrl=p.d.resume_gateway_url||null;this.user=p.d.user;this.ready=true;this.backoff=5000;this.log.log(`Discord ready as ${p.d.user?.username||p.d.user?.id}`);this.emit('ready');}
   else if(p.t==='RESUMED'){this.ready=true;this.backoff=5000;this.emit('ready');}
   else if(p.t==='MESSAGE_CREATE')this.emit('message',p.d);
   return;
  }
 }
 async rest(method,path,body,attempt=0){
  const r=await this.fetchImpl(API+path,{method,headers:{Authorization:'Bot '+this.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  if(r.status===429&&attempt<2){const wait=Number((await r.json().catch(()=>({})))?.retry_after||1)*1000;await new Promise(x=>setTimeout(x,wait));return this.rest(method,path,body,attempt+1);}
  if(!r.ok)throw Error(`Discord ${method} ${path} HTTP ${r.status}`);
  return r.status===204?null:r.json();
 }
 async reply(channelId,text,replyTo){
  const parts=chunks(text);
  for(const [i,content] of parts.entries())await this.rest('POST',`/channels/${channelId}/messages`,{content,allowed_mentions:{parse:[]},...(i===0&&replyTo?{message_reference:{message_id:replyTo,fail_if_not_exists:false}}:{})});
 }
 // Channel history for the diary collector and labels; names are cached per process.
 async channelName(channelId){
  if(this.channels.has(channelId))return this.channels.get(channelId);
  let name='';try{const c=await this.rest('GET',`/channels/${channelId}`);name=c?.name?'#'+c.name:(c?.type===1?'DM':'');}catch{}
  this.channels.set(channelId,name);return name;
 }
 stop(){this.stopped=true;clearTimeout(this.timer);clearInterval(this.heartbeat);try{this.ws?.close(1000,'shutdown');}catch{}this.ws=null;}
}
