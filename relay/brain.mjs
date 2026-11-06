// One resident Claude Code conversation is Gonta's brain. Every message from the Web,
// LINE, Discord and the local trigger is queued and sent as one conversation turn at a time.
// It normally runs through the Claude Agent SDK on the API key in BOT_CLAUDE_API_KEY, paid by the
// monthly API credit of the user's plan, so the plan's weekly limit is left alone (the "api"
// route). When the key is missing, the API fails or Gonta's monthly share is spent, the same
// conversation continues in the resident `claude` CLI on the subscription login (the "plan" route).
// The conversation is persisted by Claude Code itself; this module keeps only the session id so
// a crash, a restart or a change of route resumes the same conversation.
import {spawn,execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SpendLedger,usageGrowth} from './spend.mjs';

// The relay still works on the plan route if the SDK package is missing.
let sdkQuery=null,sdkError='';
try{({query:sdkQuery}=await import('@anthropic-ai/claude-agent-sdk'));}catch(e){sdkError=String(e.message).split('\n')[0];}

export const DEFAULT_TOOLS=['PowerShell','Bash','Read','Edit','Write','MultiEdit','NotebookEdit','Glob','Grep','WebFetch','WebSearch','Skill'];
const TURN_LIMIT=25*60000;
export const KEY_NAME='BOT_CLAUDE_API_KEY';
export const MONTHLY_USD=20;
const API_PAUSE=60*60000;

export function resolveClaude(env=process.env){
 if(env.GONTA_CLAUDE)return env.GONTA_CLAUDE;
 if(process.platform==='win32'){
  const candidates=[env.APPDATA&&path.join(env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe'),path.join(os.homedir(),'.local','bin','claude.exe')];
  for(const c of candidates)if(c&&existsSync(c))return c;
  return 'claude.cmd';
 }
 return 'claude';
}

// Never inherit another Claude Code session's identity or an API key. The plan route
// authenticates with the user's own subscription: the one-year token from `claude setup-token`
// when one is stored, otherwise the login stored by `claude`. The api route adds the key itself.
// The tools Gonta runs (PowerShell, Bash) never see the key or the token (SUBPROCESS_ENV_SCRUB).
export function cleanEnvironment(env=process.env,token=null){
 const out={};
 for(const [k,v] of Object.entries(env))if(!/^(CLAUDE|ANTHROPIC_|MCP_)/i.test(k))out[k]=v;
 out.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';
 out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';
 out.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB='1';
 out.DISABLE_AUTOUPDATER='1';
 if(token)out.CLAUDE_CODE_OAUTH_TOKEN=token;
 return out;
}

// The API key is the user's environment variable BOT_CLAUDE_API_KEY. A process started before the
// variable was set does not see it, so the registry copy (HKCU\Environment) is read then. The key
// is only ever put in the SDK child's own environment, as ANTHROPIC_API_KEY: that name set for the
// whole PC would switch every other Claude Code to the key. It is never logged.
export function readApiKey(env=process.env,run=execFileSync){
 const direct=String(env[KEY_NAME]||'').trim();
 if(direct||process.platform!=='win32')return direct;
 try{
  const out=run('reg',['query','HKCU\\Environment','/v',KEY_NAME],{encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','ignore']});
  return out.match(new RegExp(`^\\s*${KEY_NAME}\\s+REG_\\w+\\s+(.+)$`,'m'))?.[1].trim()||'';
 }catch{return '';}
}

// A normal /login expires after about two weeks and an unattended process cannot
// renew it. scripts/set-claude-token.ps1 stores a one-year `claude setup-token`
// token encrypted for this Windows user (DPAPI); it is decrypted only into the
// child's environment and never written to a log.
export const TOKEN_FILE='claude-oauth-token.dpapi';
export function loadOAuthToken(directory,log=console){
 const file=path.join(directory,TOKEN_FILE);
 if(process.platform!=='win32'||!existsSync(file))return null;
 try{
  const script='$s=(Get-Content -LiteralPath $env:GONTA_TOKEN_FILE -Raw).Trim()|ConvertTo-SecureString;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}';
  const token=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:20000,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,GONTA_TOKEN_FILE:file}}).trim();
  if(/^\S{20,}$/.test(token))return token;
  log.error('Claude token file is not usable; falling back to the normal login');
 }catch(e){log.error('Claude token could not be read:',String(e.message).split('\n')[0]);}
 return null;
}
// Dates of the stored token (no secret). Windows PowerShell 5.1 writes UTF-8 with a BOM.
export function readTokenInfo(directory){try{return JSON.parse(readFileSync(path.join(directory,'claude-oauth-token.json'),'utf8').replace(/^﻿/,''));}catch{return null;}}
export const AUTH_FAILURE=/Failed to authenticate|OAuth (session|token)|Login expired|run \/login|Not logged in|authentication_error|Invalid bearer token|invalid x-api-key/i;
export const AUTH_MESSAGE='PCのClaudeのログイン期限が切れたため、返事ができません。PCで gonta フォルダの scripts\\update-claude-login.cmd を実行すると直ります。';

// API errors the subscription can answer instead (a bad key, no credit left, limits, outages).
// A request that is wrong in itself would fail there too, so it is not retried.
const API_FAILURES=new Set(['authentication_failed','billing_error','rate_limit','overloaded','server_error','unknown','account_on_hold','verification_required','oauth_org_not_allowed','model_not_found']);
export function apiFailure(error,detail=''){return API_FAILURES.has(error)||/credit balance|billing|x-api-key|invalid api key|authentication_error|overloaded/i.test(detail);}

export function claudeArguments({sessionId,resume,model,effort,tools=DEFAULT_TOOLS}){
 const args=['-p','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--verbose',
  '--permission-mode','acceptEdits','--permission-prompts','none','--allowedTools',tools.join(','),'--disallowedTools','Agent,Task','--strict-mcp-config'];
 if(model)args.push('--model',model);
 if(effort)args.push('--effort',effort);
 args.push(resume?'--resume':'--session-id',sessionId);
 return args;
}
// The same settings for the Agent SDK. Without systemPrompt the SDK sends an empty one, so Claude
// Code's own prompt is asked for; settings and CLAUDE.md are read from the same places as the CLI.
export function sdkOptions({sessionId,resume,model,effort,tools=DEFAULT_TOOLS}){
 const options={systemPrompt:{type:'preset',preset:'claude_code'},settingSources:['user','project','local'],
  allowedTools:tools.filter(t=>t!=='Skill'),skills:'all',disallowedTools:['Agent','Task'],
  permissionMode:'acceptEdits',permissionPrompts:'none',strictMcpConfig:true,includePartialMessages:true};
 if(model)options.model=model;
 if(effort)options.effort=effort;
 if(resume)options.resume=sessionId;else options.sessionId=sessionId;
 return options;
}

// Claude Code's running totals for a conversation, saved in its transcript when a process ends.
// A resumed process starts counting from them, so the api route measures its spending from there.
export function savedTotals(sessionId,projects=path.join(os.homedir(),'.claude','projects')){
 if(!/^[0-9a-f-]{36}$/i.test(sessionId||''))return {};
 try{
  for(const dir of readdirSync(projects)){
   const file=path.join(projects,dir,sessionId+'.jsonl');
   if(!existsSync(file))continue;
   const lines=readFileSync(file,'utf8').split('\n');
   for(let i=lines.length-1;i>=0;i--){
    if(!lines[i].includes('"cost-state"'))continue;
    try{const entry=JSON.parse(lines[i]);if(entry.type==='cost-state')return entry.modelUsage||{};}catch{}
   }
   return {};
  }
 }catch{}
 return {};
}

const join=(a,b)=>a&&b?a+'\n\n'+b:a||b||'';
const PURPOSES={web:'Webの会話',line:'LINEの会話',discord:'Discordの会話',local:'PCからの送信',diary:'日記'};

// The SDK reads user turns from this; ending it closes Claude Code's input and the process exits.
class Inbox{
 constructor(){this.items=[];this.done=false;this.wake=null;}
 push(item){if(this.done)return false;this.items.push(item);this.wake?.();return true;}
 end(){this.done=true;this.wake?.();}
 async *[Symbol.asyncIterator](){
  for(;;){
   while(this.items.length)yield this.items.shift();
   if(this.done)return;
   await new Promise(r=>{this.wake=r;});this.wake=null;
  }
 }
}

// A relay that died without warning can leave its resident claude.exe behind on
// Windows. Before resuming a session, end any claude.exe still holding that id.
export function killStaleClaude(sessionId,log=console){
 if(process.platform!=='win32'||!/^[0-9a-f-]{36}$/.test(sessionId||''))return;
 try{
  const script=`Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -like '*${sessionId}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
  const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:15000,windowsHide:true});
  const pids=out.split(/\s+/).filter(Boolean);
  if(pids.length)log.error('Stopped stale claude.exe:',pids.join(', '));
 }catch(e){log.error('Stale process check failed:',e.message);}
}

export class Brain extends EventEmitter{
 constructor({cwd,directory,command,model,effort,spawnImpl=spawn,log=console,tokenLoader,api=true,queryImpl=sdkQuery,keyReader=readApiKey,monthlyUsd=MONTHLY_USD,spendFile,ledger,projects}){
  super();this.cwd=cwd;this.directory=directory;this.command=command||resolveClaude();this.model=model;this.effort=effort;this.spawnImpl=spawnImpl;this.log=log;
  this.tokenLoader=tokenLoader||(()=>loadOAuthToken(directory,log));
  this.api=api;this.queryImpl=queryImpl;this.keyReader=keyReader;this.monthlyUsd=monthlyUsd;this.projects=projects;
  this.ledger=ledger||new SpendLedger({file:spendFile,log});
  this.route=null;this.routeReason='';this.keyMissing=false;this.apiPausedUntil=0;this.apiPauseReason='';
  this.auth={ok:true,changed:null,failedGeneration:-1};this.authSource=null;this.generation=0;this.reloadPending=false;
  this.queue=[];this.current=null;this.process=null;this.closing=null;this.waiting=false;this.stopped=false;this.restartDelay=5000;this.version=null;this.modelName=null;this.calls=new Map();
  this.sessionFile=path.join(directory,'claude-session.json');
  try{this.session=JSON.parse(readFileSync(this.sessionFile,'utf8'));}catch{this.session=null;}
  this.resume=typeof this.session?.id==='string'&&this.session.cwd===cwd;
 }
 get ready(){return (!!this.process||this.waiting)&&!this.stopped;}
 get sessionId(){return this.resume?this.session.id:this.pendingSession;}
 get apiMonth(){return {usd:Math.round(this.ledger.month()*10000)/10000,limit:this.monthlyUsd};}
 // Why the api route cannot be used now ('' when it can). The key itself is read on start.
 apiBlock(now=Date.now()){
  if(!this.api)return 'the API route is turned off in config.json';
  if(!this.queryImpl)return `the Agent SDK is not installed (${sdkError})`;
  if(now<this.apiPausedUntil)return this.apiPauseReason;
  const spent=this.ledger.month(now);
  if(spent>=this.monthlyUsd)return `this month's API share is used up ($${spent.toFixed(2)} of $${this.monthlyUsd})`;
  return '';
 }
 start(){
  if(this.stopped||this.process||this.waiting)return;
  clearTimeout(this.restartTimer);
  // Never two processes on one conversation: wait until the previous one has ended. Its saved
  // totals are then also the ones the next process starts from.
  if(this.closing){this.waiting=true;this.closing.then(()=>{this.waiting=false;this.start();});return;}
  const sessionId=this.resume?this.session.id:randomUUID();
  if(this.resume)killStaleClaude(sessionId,this.log);
  let reason=this.apiBlock(),key='',proc;
  this.keyMissing=false;
  if(!reason){key=this.keyReader();if(!key){reason=`${KEY_NAME} is not set`;this.keyMissing=true;}}
  if(!reason){
   try{proc=this.spawnApi(sessionId,key);}
   catch(e){this.pauseApi(`the Agent SDK did not start: ${e.message}`);reason=this.apiPauseReason;}
  }
  if(!proc){
   try{proc=this.spawnPlan(sessionId);}
   catch(e){this.log.error('Claude start failed:',e.message);this.scheduleRestart();return;}
  }
  if(proc.route!==this.route||reason!==this.routeReason)this.log.log(proc.route==='api'?'Claude route: API credit (Agent SDK)':`Claude route: subscription, because ${reason}`);
  this.route=proc.route;this.routeReason=reason;
  this.process=proc;this.generation++;this.pendingSession=sessionId;this.sawInit=false;
  this.log.log(`Claude started (${this.resume?'resume':'new'} ${sessionId}, ${{api:'API key',token:'one-year token',login:'normal login'}[this.authSource]})`);
  this.emit('ready');this.pump();
 }
 spawnPlan(sessionId){
  const args=claudeArguments({sessionId,resume:this.resume,model:this.model,effort:this.effort});
  const token=this.tokenLoader();this.authSource=token?'token':'login';
  const child=this.spawnImpl(this.command,args,{cwd:this.cwd,env:cleanEnvironment(process.env,token),stdio:['pipe','pipe','pipe'],windowsHide:true,shell:/\.(cmd|bat)$/i.test(this.command)});
  const proc={route:'plan',stderr:'',
   send:obj=>{try{child.stdin.write(JSON.stringify(obj)+'\n');return true;}catch(e){this.log.error('Claude write failed:',e.message);return false;}},
   interrupt:()=>proc.send({type:'control_request',request_id:randomUUID(),request:{subtype:'interrupt'}}),
   end:()=>{try{child.stdin.end();}catch{}},
   kill:()=>{try{child.kill();}catch{}}};
  let buffer='';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   buffer+=chunk;let i;
   while((i=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;
    let msg;try{msg=JSON.parse(line);}catch{continue;}
    this.receive(proc,msg);
   }
  });
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{proc.stderr=(proc.stderr+chunk).slice(-4000);});
  child.stdin.on('error',()=>{});
  child.on('error',e=>{this.log.error('Claude process error:',e.message);});
  child.on('exit',(code,signal)=>this.exited(proc,code,signal));
  return proc;
 }
 spawnApi(sessionId,key){
  const inbox=new Inbox(),abortController=new AbortController();
  const proc={route:'api',stderr:'',usage:this.resume?savedTotals(sessionId,this.projects):{},
   send:obj=>inbox.push({...obj,parent_tool_use_id:null,session_id:''}),
   interrupt:()=>{query.interrupt().catch(e=>this.log.error('Claude interrupt failed:',e.message));return true;},
   end:()=>inbox.end(),
   kill:()=>abortController.abort()};
  const query=this.queryImpl({prompt:inbox,options:{...sdkOptions({sessionId,resume:this.resume,model:this.model,effort:this.effort}),
   cwd:this.cwd,env:{...cleanEnvironment(process.env),ANTHROPIC_API_KEY:key},abortController,stderr:d=>{proc.stderr=(proc.stderr+d).slice(-4000);}}});
  this.authSource='api';
  (async()=>{
   let code=0;
   try{for await(const msg of query)this.receive(proc,msg);}
   catch(e){code=1;proc.stderr=(proc.stderr+'\n'+e.message).slice(-4000);}
   this.exited(proc,code,null);
  })();
  return proc;
 }
 receive(proc,msg){
  if(proc!==this.process)return;
  try{this.handle(proc,msg);}catch(e){this.log.error('Claude event error:',e.message);}
 }
 handle(proc,m){
  if(m.type==='system'&&m.subtype==='init'){
   if(typeof m.session_id==='string'&&(!this.session||this.session.id!==m.session_id)){this.session={id:m.session_id,cwd:this.cwd,updated:new Date().toISOString()};this.resume=true;try{writeFileSync(this.sessionFile,JSON.stringify(this.session,null,2),{mode:0o600});}catch(e){this.log.error('Session file:',e.message);}}
   if(!this.sawInit){
    this.sawInit=true;this.restartDelay=5000;this.version=m.claude_code_version||this.version;this.modelName=m.model||this.modelName;
    if(proc.route==='api'&&m.apiKeySource&&m.apiKeySource!=='ANTHROPIC_API_KEY')this.log.error('Claude is not using the API key:',m.apiKeySource);
   }
   return;
  }
  const t=this.current;
  if(m.type==='rate_limit_event'){this.log.log('Claude rate limit:',JSON.stringify(m.rate_limit_info||m).slice(0,300));return;}
  if(!t)return;
  if(m.type==='stream_event'){
   if(m.parent_tool_use_id)return;
   const e=m.event||{};
   if(e.type==='content_block_start'&&e.content_block?.type==='text'){t.block='';t.streaming=true;}
   else if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'&&t.streaming){t.block+=e.delta.text;t.text=join(t.committed,t.block);this.delta(t);}
   else if(e.type==='content_block_stop'&&t.streaming){t.committed=join(t.committed,t.block);t.block='';t.streaming=false;t.text=t.committed;}
   return;
  }
  if(m.type==='assistant'){
   if(m.parent_tool_use_id)return;
   // API failures arrive as synthetic assistant messages; never show them as Gonta's words.
   if(m.error){t.apiError=m.error;t.errorText=(m.message?.content||[]).filter(b=>b?.type==='text').map(b=>b.text).join('\n');return;}
   for(const b of m.message?.content||[]){
    if(b.type==='text'&&b.text&&!t.committed.endsWith(b.text)&&!(t.streaming&&t.block===b.text)){t.committed=join(t.committed,b.text);t.text=join(t.committed,t.streaming?t.block:'');this.delta(t);}
    if(b.type==='tool_use'&&typeof b.id==='string'){this.calls.set(b.id,{name:b.name,input:b.input});this.emit('tool',{runId:t.runId,phase:'start',id:b.id,name:b.name,input:b.input,hidden:t.hidden});}
   }
   return;
  }
  if(m.type==='user'){
   for(const b of m.message?.content||[])if(b?.type==='tool_result'&&this.calls.delete(b.tool_use_id))this.emit('tool',{runId:t.runId,phase:'end',id:b.tool_use_id,hidden:t.hidden});
   return;
  }
  if(m.type==='result'){
   if(typeof m.session_id==='string'&&this.session?.id!==m.session_id)this.handle(proc,{type:'system',subtype:'init',session_id:m.session_id});
   if(proc.route==='api')this.recordUsage(proc,m,t);
   const ok=m.subtype==='success'&&!m.is_error&&!t.apiError;
   const detail=[t.errorText,typeof m.result==='string'?m.result:'',...(Array.isArray(m.errors)?m.errors:[])].filter(Boolean).join('\n');
   if(proc.route==='api'){
    if(!ok&&!t.aborted&&!t.retried&&apiFailure(t.apiError,detail)){this.leaveApi(`${t.apiError||'error'}: ${detail}`,t);return;}
   }else{
    if(!t.aborted&&(t.apiError==='authentication_failed'||(!ok&&AUTH_FAILURE.test(detail)))){
     if(AUTH_FAILURE.test(t.text))t.text='';
     this.markAuth(false,detail);this.finish('error',new Error(AUTH_MESSAGE));return;
    }
    if(ok)this.markAuth(true);
   }
   if(!t.text&&ok&&typeof m.result==='string')t.text=m.result;
   if(t.aborted)this.finish('aborted',new Error('応答を停止しました。'));
   else if(ok)this.finish('final');
   else this.finish('error',new Error(describeFailure(m)));
  }
 }
 // Each API turn adds what it cost to the shared ledger, per model.
 recordUsage(proc,m,t){
  const {rows,totals}=usageGrowth(proc.usage,m.modelUsage);proc.usage=totals;
  if(rows.length)void this.ledger.add(rows.map(r=>({...r,purpose:PURPOSES[t.source]||'会話'})));
 }
 // The API failed: leave it for an hour and answer this turn on the subscription instead.
 leaveApi(reason,t){
  this.pauseApi(reason);
  clearTimeout(this.timer);clearTimeout(t.deltaTimer);t.deltaTimer=null;this.current=null;this.calls.clear();
  Object.assign(t,{committed:'',block:'',streaming:false,text:'',apiError:null,errorText:'',retried:true});
  this.queue.unshift(t);
  this.restart();this.start();
 }
 pauseApi(reason){
  this.apiPausedUntil=Date.now()+API_PAUSE;
  this.apiPauseReason=`the API failed (${String(reason).replace(/\s+/g,' ').slice(0,200)})`;
  this.log.error(`Claude API failed; the subscription answers for the next hour: ${String(reason).replace(/\s+/g,' ').slice(0,200)}`);
 }
 delta(t){
  if(t.hidden)return;
  const now=Date.now();
  if(now-(t.lastDelta||0)<120){if(!t.deltaTimer)t.deltaTimer=setTimeout(()=>{t.deltaTimer=null;if(this.current===t)this.emitTurn(t,'delta');},120).unref?.();return;}
  t.lastDelta=now;this.emitTurn(t,'delta');
 }
 emitTurn(t,state,error){this.emit('turn',{runId:t.runId,state,text:t.text,source:t.source,hidden:t.hidden,error});}
 send({text,source='web',runId=randomUUID(),hidden=false}){
  if(typeof text!=='string'||!text.trim())return Promise.reject(new Error('メッセージが空です。'));
  return new Promise((resolve,reject)=>{this.queue.push({prompt:text,source,runId,hidden,resolve,reject,committed:'',block:'',streaming:false,text:'',started:0});this.pump();});
 }
 get busy(){return this.current?{runId:this.current.runId,source:this.current.source,hidden:this.current.hidden,text:this.current.text,started:this.current.started}:null;}
 markAuth(ok,detail=''){
  if(!ok)this.auth.failedGeneration=this.generation;
  if(this.auth.ok===ok)return;
  this.auth={...this.auth,ok,changed:Date.now()};
  if(ok)this.log.log('Claude login works again');else this.log.error('Claude login failed:',String(detail).replace(/\s+/g,' ').slice(0,200));
  this.emit('auth',{ok});
 }
 // Restart now, or after the running turn, so a renewed token, login or API key is read
 // (and the API is tried again even if it failed within the hour).
 reload(){if(this.current){this.reloadPending=true;return 'after-turn';}this.apiPausedUntil=0;this.restart();this.start();return 'now';}
 // Between turns, change route when needed: leave the API when it is paused or the month's share
 // is spent, and go back when that has passed. A missing key is only looked for again on restart.
 wrongRoute(){
  const block=this.apiBlock();
  return this.process.route==='api'?!!block:!block&&!this.keyMissing;
 }
 pump(){
  if(this.current||!this.queue.length||this.stopped)return;
  if(this.process&&this.wrongRoute())this.restart();
  // After a login failure, the next message starts a fresh process that reads the current credentials.
  if(this.process?.route==='plan'&&!this.auth.ok&&this.auth.failedGeneration===this.generation)this.restart();
  // start() pumps the queue itself once the process exists; continuing here would send twice.
  if(!this.process){this.start();return;}
  const t=this.current=this.queue.shift();t.started=Date.now();
  this.timer=setTimeout(()=>{this.log.error('Turn timed out; interrupting');this.abort(t.runId,'時間切れのため応答を止めました。');},TURN_LIMIT);this.timer.unref?.();
  this.emitTurn(t,'start');
  if(!this.process.send({type:'user',message:{role:'user',content:t.prompt}}))this.finish('error',new Error('ゴンタの頭脳に送れませんでした。もう一度送ってください。'));
 }
 abort(runId,reason){
  const t=this.current;if(!t||t.runId!==runId)return false;
  t.aborted=true;t.abortReason=reason;
  this.process?.interrupt();
  clearTimeout(t.abortTimer);t.abortTimer=setTimeout(()=>{if(this.current===t){this.log.error('Interrupt ignored; restarting Claude');this.restart();this.finish('aborted');}},20000);t.abortTimer.unref?.();
  return true;
 }
 finish(state,err){
  const t=this.current;if(!t)return;
  clearTimeout(this.timer);clearTimeout(t.abortTimer);clearTimeout(t.deltaTimer);t.deltaTimer=null;this.current=null;this.calls.clear();
  if(state==='aborted'&&t.abortReason)err=new Error(t.abortReason);
  this.emitTurn(t,state,err?.message);
  if(state==='final')t.resolve({text:t.text});else t.reject(Object.assign(err||new Error('応答が停止しました。'),{text:t.text,state}));
  if(this.reloadPending){this.reloadPending=false;this.apiPausedUntil=0;this.restart();this.start();}
  this.pump();
 }
 // End the running process: it exits once its input closes, and is killed after 3 seconds.
 restart(){
  const p=this.process;if(!p)return;
  this.process=null;p.retired=true;
  const closing=this.closing=new Promise(resolve=>{p.onExit=resolve;if(p.exited)resolve();setTimeout(resolve,6000).unref?.();})
   .then(()=>{if(this.closing===closing)this.closing=null;});
  p.end();setTimeout(()=>{if(!p.exited)p.kill();},3000).unref?.();
 }
 exited(proc,code,signal){
  proc.exited=true;proc.onExit?.();
  if(proc.retired||proc!==this.process)return;
  this.process=null;
  const stderr=proc.stderr.trim();
  this.log.error(`Claude exited (code ${code}, signal ${signal})${stderr?': '+stderr.slice(-600):''}`);
  const resumeFailed=!this.sawInit&&this.resume&&/no conversation found|session .*not found|could not resume|invalid session/i.test(stderr);
  // The SDK could not start Claude Code at all: answer on the subscription without a wait.
  const t=this.current;
  if(proc.route==='api'&&!this.sawInit&&!resumeFailed&&!this.stopped){
   this.pauseApi(`the Agent SDK stopped before starting (code ${code}): ${stderr.slice(-200)}`);
   if(t&&!t.retried){clearTimeout(this.timer);this.current=null;this.calls.clear();Object.assign(t,{committed:'',block:'',streaming:false,text:'',retried:true});this.queue.unshift(t);}
   this.emit('offline');this.start();return;
  }
  if(t)this.finish('error',new Error('ゴンタの頭脳が再起動しました。もう一度送ってください。'));
  this.emit('offline');
  if(this.stopped)return;
  if(resumeFailed){this.log.error('Resume failed; the next start opens a new conversation');this.resume=false;}
  this.scheduleRestart();
 }
 scheduleRestart(){
  if(this.stopped)return;
  const delay=this.restartDelay;this.restartDelay=Math.min(this.restartDelay*2,60000);
  clearTimeout(this.restartTimer);this.restartTimer=setTimeout(()=>this.start(),delay);this.restartTimer.unref?.();
 }
 newConversation(){this.resume=false;this.session=null;try{writeFileSync(this.sessionFile,'{}',{mode:0o600});}catch{}this.restart();this.start();}
 stop(){this.stopped=true;clearTimeout(this.restartTimer);const p=this.process;this.process=null;if(p){p.retired=true;p.end();setTimeout(()=>{if(!p.exited)p.kill();},5000).unref?.();}for(const t of this.queue)t.reject(new Error('停止中です。'));this.queue=[];}
}

function describeFailure(m){
 const detail=typeof m.result==='string'&&m.result?m.result.slice(0,300):Array.isArray(m.errors)?m.errors.join('; ').slice(0,300):'';
 if(m.subtype==='error_max_turns')return '手順が多すぎて途中で止まりました。続きを頼んでください。';
 if(/rate limit|usage limit|limit reached/i.test(detail))return '利用枠の上限に達したようです。しばらく待ってから送ってください。'+(detail?'（'+detail+'）':'');
 return '応答に失敗しました。'+(detail?'（'+detail+'）':'');
}
