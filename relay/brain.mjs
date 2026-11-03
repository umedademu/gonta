// One resident Claude Code process is Gonta's brain. Every message from the Web,
// LINE and the local trigger is queued and sent as one conversation turn at a time.
// The conversation is persisted by Claude Code itself; this module keeps only the
// session id so a crash or restart resumes the same conversation (--resume).
import {spawn,execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TOOLS=['PowerShell','Bash','Read','Edit','Write','MultiEdit','NotebookEdit','Glob','Grep','WebFetch','WebSearch','Skill'];
const TURN_LIMIT=25*60000;

export function resolveClaude(env=process.env){
 if(env.GONTA_CLAUDE)return env.GONTA_CLAUDE;
 if(process.platform==='win32'){
  const candidates=[env.APPDATA&&path.join(env.APPDATA,'npm','node_modules','@anthropic-ai','claude-code','bin','claude.exe'),path.join(os.homedir(),'.local','bin','claude.exe')];
  for(const c of candidates)if(c&&existsSync(c))return c;
  return 'claude.cmd';
 }
 return 'claude';
}

// Never inherit another Claude Code session's identity or an API key. The resident
// process authenticates with the user's own subscription: the one-year token from
// `claude setup-token` when one is stored, otherwise the login stored by `claude`.
export function cleanEnvironment(env=process.env,token=null){
 const out={};
 for(const [k,v] of Object.entries(env))if(!/^(CLAUDE|ANTHROPIC_|MCP_)/i.test(k))out[k]=v;
 out.CLAUDE_CODE_DISABLE_AUTO_MEMORY='1';
 out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1';
 out.DISABLE_AUTOUPDATER='1';
 if(token)out.CLAUDE_CODE_OAUTH_TOKEN=token;
 return out;
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
export const AUTH_FAILURE=/Failed to authenticate|OAuth (session|token)|Login expired|run \/login|Not logged in|authentication_error|Invalid bearer token|invalid x-api-key/i;
export const AUTH_MESSAGE='PCのClaudeのログイン期限が切れたため、返事ができません。PCで gonta フォルダの scripts\\update-claude-login.cmd を実行すると直ります。';

export function claudeArguments({sessionId,resume,model,effort,tools=DEFAULT_TOOLS}){
 const args=['-p','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--verbose',
  '--permission-mode','acceptEdits','--permission-prompts','none','--allowedTools',tools.join(','),'--disallowedTools','Agent,Task','--strict-mcp-config'];
 if(model)args.push('--model',model);
 if(effort)args.push('--effort',effort);
 args.push(resume?'--resume':'--session-id',sessionId);
 return args;
}

const join=(a,b)=>a&&b?a+'\n\n'+b:a||b||'';

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
 constructor({cwd,directory,command,model,effort,spawnImpl=spawn,log=console,tokenLoader}){
  super();this.cwd=cwd;this.directory=directory;this.command=command||resolveClaude();this.model=model;this.effort=effort;this.spawnImpl=spawnImpl;this.log=log;
  this.tokenLoader=tokenLoader||(()=>loadOAuthToken(directory,log));
  this.auth={ok:true,changed:null,failedGeneration:-1};this.authSource=null;this.generation=0;this.reloadPending=false;
  this.queue=[];this.current=null;this.process=null;this.stopped=false;this.restartDelay=5000;this.version=null;this.modelName=null;this.calls=new Map();
  this.sessionFile=path.join(directory,'claude-session.json');
  try{this.session=JSON.parse(readFileSync(this.sessionFile,'utf8'));}catch{this.session=null;}
  this.resume=typeof this.session?.id==='string'&&this.session.cwd===cwd;
 }
 get ready(){return !!this.process&&!this.stopped;}
 get sessionId(){return this.resume?this.session.id:this.pendingSession;}
 start(){
  if(this.stopped||this.process)return;
  clearTimeout(this.restartTimer);
  const sessionId=this.resume?this.session.id:randomUUID();
  if(this.resume)killStaleClaude(sessionId,this.log);
  const args=claudeArguments({sessionId,resume:this.resume,model:this.model,effort:this.effort});
  const token=this.tokenLoader();this.authSource=token?'token':'login';
  let child;
  try{child=this.spawnImpl(this.command,args,{cwd:this.cwd,env:cleanEnvironment(process.env,token),stdio:['pipe','pipe','pipe'],windowsHide:true,shell:/\.(cmd|bat)$/i.test(this.command)});}
  catch(e){this.log.error('Claude start failed:',e.message);this.scheduleRestart();return;}
  this.process=child;this.generation++;this.pendingSession=sessionId;this.stderr='';this.buffer='';this.sawInit=false;
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>this.receive(chunk));
  child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-4000);});
  child.stdin.on('error',()=>{});
  child.on('error',e=>{this.log.error('Claude process error:',e.message);});
  child.on('exit',(code,signal)=>this.exited(child,code,signal));
  this.log.log(`Claude started (${this.resume?'resume':'new'} ${sessionId}, ${this.authSource==='token'?'one-year token':'normal login'})`);
  this.emit('ready');this.pump();
 }
 receive(chunk){
  this.buffer+=chunk;let i;
  while((i=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);if(!line)continue;
   let msg;try{msg=JSON.parse(line);}catch{continue;}
   try{this.handle(msg);}catch(e){this.log.error('Claude event error:',e.message);}
  }
 }
 handle(m){
  if(m.type==='system'&&m.subtype==='init'){
   if(typeof m.session_id==='string'&&(!this.session||this.session.id!==m.session_id)){this.session={id:m.session_id,cwd:this.cwd,updated:new Date().toISOString()};this.resume=true;try{writeFileSync(this.sessionFile,JSON.stringify(this.session,null,2),{mode:0o600});}catch(e){this.log.error('Session file:',e.message);}}
   if(!this.sawInit){this.sawInit=true;this.restartDelay=5000;this.version=m.claude_code_version||this.version;this.modelName=m.model||this.modelName;}
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
   if(typeof m.session_id==='string'&&this.session?.id!==m.session_id)this.handle({type:'system',subtype:'init',session_id:m.session_id});
   const ok=m.subtype==='success'&&!m.is_error&&!t.apiError;
   const detail=[t.errorText,typeof m.result==='string'?m.result:'',...(Array.isArray(m.errors)?m.errors:[])].filter(Boolean).join('\n');
   if(!t.aborted&&(t.apiError==='authentication_failed'||(!ok&&AUTH_FAILURE.test(detail)))){
    if(AUTH_FAILURE.test(t.text))t.text='';
    this.markAuth(false,detail);this.finish('error',new Error(AUTH_MESSAGE));return;
   }
   if(ok)this.markAuth(true);
   if(!t.text&&ok&&typeof m.result==='string')t.text=m.result;
   if(t.aborted)this.finish('aborted',new Error('応答を停止しました。'));
   else if(ok)this.finish('final');
   else this.finish('error',new Error(describeFailure(m)));
  }
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
 // Restart now, or after the running turn, so a renewed token or login is read.
 reload(){if(this.current){this.reloadPending=true;return 'after-turn';}this.restart();this.start();return 'now';}
 pump(){
  if(this.current||!this.queue.length||this.stopped)return;
  // After a login failure, the next message starts a fresh process that reads the current credentials.
  if(this.process&&!this.auth.ok&&this.auth.failedGeneration===this.generation)this.restart();
  // start() pumps the queue itself once the process exists; continuing here would send twice.
  if(!this.process){this.start();return;}
  const t=this.current=this.queue.shift();t.started=Date.now();
  this.timer=setTimeout(()=>{this.log.error('Turn timed out; interrupting');this.abort(t.runId,'時間切れのため応答を止めました。');},TURN_LIMIT);this.timer.unref?.();
  this.emitTurn(t,'start');
  if(!this.write({type:'user',message:{role:'user',content:t.prompt}}))this.finish('error',new Error('ゴンタの頭脳に送れませんでした。もう一度送ってください。'));
 }
 write(obj){try{this.process.stdin.write(JSON.stringify(obj)+'\n');return true;}catch(e){this.log.error('Claude write failed:',e.message);return false;}}
 abort(runId,reason){
  const t=this.current;if(!t||t.runId!==runId)return false;
  t.aborted=true;t.abortReason=reason;
  this.write({type:'control_request',request_id:randomUUID(),request:{subtype:'interrupt'}});
  clearTimeout(t.abortTimer);t.abortTimer=setTimeout(()=>{if(this.current===t){this.log.error('Interrupt ignored; restarting Claude');this.restart();}},20000);t.abortTimer.unref?.();
  return true;
 }
 finish(state,err){
  const t=this.current;if(!t)return;
  clearTimeout(this.timer);clearTimeout(t.abortTimer);clearTimeout(t.deltaTimer);t.deltaTimer=null;this.current=null;this.calls.clear();
  if(state==='aborted'&&t.abortReason)err=new Error(t.abortReason);
  this.emitTurn(t,state,err?.message);
  if(state==='final')t.resolve({text:t.text});else t.reject(Object.assign(err||new Error('応答が停止しました。'),{text:t.text,state}));
  if(this.reloadPending){this.reloadPending=false;this.restart();this.start();}
  this.pump();
 }
 restart(){const p=this.process;if(!p)return;this.process=null;try{p.stdin.end();}catch{}setTimeout(()=>{try{p.kill();}catch{}},3000).unref?.();}
 exited(child,code,signal){
  if(child!==this.process&&this.process)return;
  this.process=null;
  const stderr=this.stderr.trim();
  this.log.error(`Claude exited (code ${code}, signal ${signal})${stderr?': '+stderr.slice(-600):''}`);
  if(this.current)this.finish('error',new Error('ゴンタの頭脳が再起動しました。もう一度送ってください。'));
  this.emit('offline');
  if(this.stopped)return;
  if(!this.sawInit&&this.resume&&/no conversation found|session .*not found|could not resume|invalid session/i.test(stderr)){this.log.error('Resume failed; the next start opens a new conversation');this.resume=false;}
  this.scheduleRestart();
 }
 scheduleRestart(){
  if(this.stopped)return;
  const delay=this.restartDelay;this.restartDelay=Math.min(this.restartDelay*2,60000);
  clearTimeout(this.restartTimer);this.restartTimer=setTimeout(()=>this.start(),delay);this.restartTimer.unref?.();
 }
 newConversation(){this.resume=false;this.session=null;try{writeFileSync(this.sessionFile,'{}',{mode:0o600});}catch{}this.restart();}
 stop(){this.stopped=true;clearTimeout(this.restartTimer);const p=this.process;this.process=null;if(p){try{p.stdin.end();}catch{}setTimeout(()=>{try{p.kill();}catch{}},5000).unref?.();}for(const t of this.queue)t.reject(new Error('停止中です。'));this.queue=[];}
}

function describeFailure(m){
 const detail=typeof m.result==='string'&&m.result?m.result.slice(0,300):Array.isArray(m.errors)?m.errors.join('; ').slice(0,300):'';
 if(m.subtype==='error_max_turns')return '手順が多すぎて途中で止まりました。続きを頼んでください。';
 if(/rate limit|usage limit|limit reached/i.test(detail))return '利用枠の上限に達したようです。しばらく待ってから送ってください。'+(detail?'（'+detail+'）':'');
 return '応答に失敗しました。'+(detail?'（'+detail+'）':'');
}
