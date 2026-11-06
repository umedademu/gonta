import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AUTH_MESSAGE,Brain,claudeArguments,cleanEnvironment,readApiKey,readTokenInfo,savedTotals} from '../relay/brain.mjs';
import {jstTime} from '../relay/spend.mjs';

// A fake `claude` child: whatever the test scripts on stdout, the Brain must parse.
// Like the real one, it exits once its input is closed.
function fakeSpawn(){
 const calls=[];
 const spawn=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.written=[];child.stdin.on('data',d=>child.written.push(...String(d).split('\n').filter(Boolean).map(l=>JSON.parse(l))));
  child.stdin.on('finish',()=>setImmediate(()=>child.emit('exit',0,null)));
  child.kill=()=>child.emit('exit',null,'SIGTERM');child.emitLine=obj=>child.stdout.write(JSON.stringify(obj)+'\n');
  calls.push({command,args,options,child});return child;
 };
 return {spawn,calls};
}
// A fake Agent SDK query(): records the turns it is given and yields whatever the test emits.
// It ends when its input ends, as Claude Code does when the SDK closes its input.
function fakeQuery(){
 const calls=[];
 const query=({prompt,options})=>{
  const call={options,sent:[],interrupts:0,ended:false},out=[];let wake=null,done=false,failure=null;
  call.emit=m=>{out.push(m);wake?.();};
  call.fail=e=>{failure=e;done=true;wake?.();};
  (async()=>{for await(const m of prompt)call.sent.push(m);call.ended=true;done=true;wake?.();})();
  const messages=(async function*(){for(;;){while(out.length)yield out.shift();if(done){if(failure)throw failure;return;}await new Promise(r=>{wake=r;});wake=null;}})();
  messages.interrupt=async()=>{call.interrupts++;};
  calls.push(call);return messages;
 };
 return {query,calls};
}
const tick=()=>new Promise(r=>setTimeout(r,5));
const settle=()=>new Promise(r=>setTimeout(r,40));
function directory(){return mkdtempSync(path.join(os.tmpdir(),'gonta-brain-test-'));}
const quiet={log(){},error(){}};
const KEY='sk-ant-api03-'+'k'.repeat(93);
function recorder(){const lines=[];return {lines,log:(...a)=>lines.push(a.join(' ')),error:(...a)=>lines.push(a.join(' '))};}
function apiBrain(extra={}){
 const dir=directory(),sdk=fakeQuery(),cli=fakeSpawn();
 const spendFile=path.join(dir,'使った額.csv'),projects=path.join(dir,'projects');mkdirSync(projects);
 const brain=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',spawnImpl:cli.spawn,queryImpl:sdk.query,keyReader:()=>KEY,tokenLoader:()=>null,spendFile,projects,log:quiet,...extra});
 return {brain,sdk,cli,dir,spendFile,projects};
}
const ledgerRows=file=>readFileSync(file,'utf8').trim().split('\n').map(l=>l.split(','));
const usage=(input,output,read,write,usd)=>({inputTokens:input,outputTokens:output,cacheReadInputTokens:read,cacheCreationInputTokens:write,costUSD:usd});

test('arguments keep the subscription login and ask for a resumable streamed session',()=>{
 const args=claudeArguments({sessionId:'abc',resume:false,model:'sonnet'});
 assert.ok(args.includes('--input-format')&&args.includes('stream-json')&&args.includes('--include-partial-messages'));
 assert.ok(!args.includes('--bare'));
 assert.deepEqual(args.slice(-2),['--session-id','abc']);
 assert.deepEqual(claudeArguments({sessionId:'abc',resume:true}).slice(-2),['--resume','abc']);
 assert.equal(args[args.indexOf('--permission-prompts')+1],'none');
 assert.match(args[args.indexOf('--allowedTools')+1],/PowerShell/);
 const env=cleanEnvironment({PATH:'x',ANTHROPIC_API_KEY:'secret',CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'s'});
 assert.deepEqual(Object.keys(env).sort(),['CLAUDE_CODE_DISABLE_AUTO_MEMORY','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','CLAUDE_CODE_SUBPROCESS_ENV_SCRUB','DISABLE_AUTOUPDATER','PATH']);
});

test('one turn at a time: streamed text, tool activity, final text, and the queue order',async()=>{
 const {spawn,calls}=fakeSpawn();const dir=directory();
 const brain=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',spawnImpl:spawn,api:false,log:quiet});
 const turns=[],tools=[];brain.on('turn',t=>turns.push({...t}));brain.on('tool',e=>tools.push(e));
 brain.start();assert.equal(calls.length,1);assert.ok(brain.ready);assert.equal(brain.route,'plan');
 const first=brain.send({text:'こんにちは',source:'web',runId:'r1'});
 const second=brain.send({text:'次',source:'line',runId:'r2'});
 await tick();
 const child=calls[0].child;
 assert.equal(child.written.length,1);assert.deepEqual(child.written[0],{type:'user',message:{role:'user',content:'こんにちは'}});
 child.emitLine({type:'system',subtype:'init',session_id:'sess-1',model:'claude-sonnet-5-5',claude_code_version:'2.1.291'});
 child.emitLine({type:'stream_event',event:{type:'content_block_start',content_block:{type:'text'}}});
 child.emitLine({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'やあ'}}});
 child.emitLine({type:'stream_event',event:{type:'content_block_stop'}});
 child.emitLine({type:'assistant',message:{content:[{type:'text',text:'やあ'},{type:'tool_use',id:'t1',name:'PowerShell',input:{command:'Get-Date'}}]}});
 child.emitLine({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'now'}]}});
 child.emitLine({type:'stream_event',event:{type:'content_block_start',content_block:{type:'text'}}});
 child.emitLine({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'21時'}}});
 child.emitLine({type:'stream_event',event:{type:'content_block_stop'}});
 child.emitLine({type:'assistant',message:{content:[{type:'text',text:'21時'}]}});
 child.emitLine({type:'result',subtype:'success',is_error:false,result:'21時',session_id:'sess-1'});
 await tick();
 assert.deepEqual(await first,{text:'やあ\n\n21時'});
 const states=turns.filter(t=>t.runId==='r1').map(t=>t.state);
 assert.equal(states[0],'start');assert.ok(states.includes('delta'));assert.equal(states.at(-1),'final');
 assert.equal(turns.find(t=>t.state==='final').text,'やあ\n\n21時');
 assert.deepEqual(tools.map(e=>e.phase+':'+e.id),['start:t1','end:t1']);
 assert.equal(JSON.parse(readFileSync(path.join(dir,'claude-session.json'),'utf8')).id,'sess-1');
 // The second message was only written after the first turn finished.
 assert.equal(child.written.length,2);assert.equal(child.written[1].message.content,'次');
 child.emitLine({type:'result',subtype:'error_during_execution',is_error:true,result:'boom'});
 await assert.rejects(second,/応答に失敗しました/);
 assert.equal(turns.at(-1).state,'error');assert.equal(turns.at(-1).source,'line');
 brain.stop();
});

test('a crash fails the running turn, restarts with --resume, and resume failure falls back to a new session',async()=>{
 const {spawn,calls}=fakeSpawn();const dir=directory();
 writeFileSync(path.join(dir,'claude-session.json'),JSON.stringify({id:'old-session',cwd:'C:\\brain'}));
 const brain=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',spawnImpl:spawn,api:false,log:quiet});
 brain.restartDelay=1;
 brain.start();assert.deepEqual(calls[0].args.slice(-2),['--resume','old-session']);
 const turn=brain.send({text:'x',runId:'r1'});await tick();
 calls[0].child.stderr.write('Error: No conversation found with session ID: old-session\n');
 calls[0].child.emit('exit',1,null);
 await assert.rejects(turn,/再起動/);
 await settle();
 assert.equal(calls.length,2);assert.equal(calls[1].args.at(-2),'--session-id');assert.notEqual(calls[1].args.at(-1),'old-session');
 brain.stop();
});

test('abort sends an interrupt and the result is reported as aborted with the partial text',async()=>{
 const {spawn,calls}=fakeSpawn();
 const brain=new Brain({cwd:'C:\\brain',directory:directory(),command:'fake',spawnImpl:spawn,api:false,log:quiet});
 const states=[];brain.on('turn',t=>states.push(t.state));
 brain.start();const turn=brain.send({text:'長い話',runId:'r1'});await tick();
 const child=calls[0].child;
 child.emitLine({type:'stream_event',event:{type:'content_block_start',content_block:{type:'text'}}});
 child.emitLine({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'途中'}}});
 assert.equal(brain.abort('r1'),true);assert.equal(brain.abort('other'),false);
 await tick();
 assert.equal(child.written.at(-1).type,'control_request');assert.equal(child.written.at(-1).request.subtype,'interrupt');
 child.emitLine({type:'result',subtype:'success',is_error:false,result:'途中'});
 await assert.rejects(turn,e=>e.state==='aborted'&&e.text==='途中');
 assert.equal(states.at(-1),'aborted');
 brain.stop();
});

test('only an explicitly loaded one-year token reaches the child, never an inherited one',()=>{
 const inherited=cleanEnvironment({PATH:'x',CLAUDE_CODE_OAUTH_TOKEN:'from-the-desktop-app'});
 assert.equal(inherited.CLAUDE_CODE_OAUTH_TOKEN,undefined);
 assert.equal(cleanEnvironment({PATH:'x'},'sk-ant-oat01-test').CLAUDE_CODE_OAUTH_TOKEN,'sk-ant-oat01-test');
});

test('an expired login gives a plain message, and the next message starts a fresh process that reads the new token',async()=>{
 const {spawn,calls}=fakeSpawn();let token=null;
 const brain=new Brain({cwd:'C:\\brain',directory:directory(),command:'fake',spawnImpl:spawn,api:false,log:quiet,tokenLoader:()=>token});
 const auth=[],turns=[];brain.on('auth',a=>auth.push(a.ok));brain.on('turn',t=>turns.push(t));
 brain.start();assert.equal(brain.authSource,'login');
 const first=brain.send({text:'こんにちは',runId:'r1'});await tick();
 const failure='Failed to authenticate: OAuth session expired and could not be refreshed';
 calls[0].child.emitLine({type:'assistant',error:'authentication_failed',message:{content:[{type:'text',text:failure}]}});
 calls[0].child.emitLine({type:'result',subtype:'success',is_error:true,result:failure});
 await assert.rejects(first,e=>e.message===AUTH_MESSAGE&&e.text==='');
 assert.ok(turns.every(t=>!String(t.text).includes('Failed to authenticate')),'the English error is never shown as Gonta\'s words');
 assert.equal(brain.auth.ok,false);assert.deepEqual(auth,[false]);assert.equal(calls.length,1);
 token='sk-ant-oat01-'+'x'.repeat(40);
 const second=brain.send({text:'もう一度',runId:'r2'});await settle();
 assert.equal(calls.length,2);assert.equal(calls[1].options.env.CLAUDE_CODE_OAUTH_TOKEN,token);assert.equal(brain.authSource,'token');
 assert.equal(calls[1].child.written[0].message.content,'もう一度');
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'はい'});
 assert.deepEqual(await second,{text:'はい'});assert.equal(brain.auth.ok,true);assert.deepEqual(auth,[false,true]);
 const third=brain.send({text:'三つ目',runId:'r3'});await tick();
 assert.equal(calls.length,2,'a working login does not restart the process');
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'了解'});await third;
 brain.stop();
});

test('reload restarts an idle brain at once and a busy one after its turn, never running two at once',async()=>{
 const {spawn,calls}=fakeSpawn();
 const brain=new Brain({cwd:'C:\\brain',directory:directory(),command:'fake',spawnImpl:spawn,api:false,log:quiet,tokenLoader:()=>null});
 brain.start();assert.equal(brain.reload(),'now');
 assert.ok(brain.ready,'messages are still accepted while the old process ends');assert.equal(calls.length,1);
 await settle();assert.equal(calls.length,2);assert.ok(brain.ready);
 const turn=brain.send({text:'x',runId:'r1'});await tick();
 assert.equal(brain.reload(),'after-turn');assert.equal(calls.length,2);
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'ok'});await turn;
 await settle();assert.equal(calls.length,3);assert.ok(brain.ready);
 brain.stop();
});

test('token dates written by Windows PowerShell (UTF-8 with BOM) are readable',()=>{
 const dir=directory();
 writeFileSync(path.join(dir,'claude-oauth-token.json'),'\uFEFF{"created":"2026-11-03T22:27:23+09:00","expires":"2027-11-03T22:27:23+09:00"}','utf8');
 assert.equal(readTokenInfo(dir).expires,'2027-11-03T22:27:23+09:00');
 assert.equal(readTokenInfo(path.join(dir,'missing')),null);
});

test('the API key comes from the environment, else from the registry, and is never required',()=>{
 assert.equal(readApiKey({BOT_CLAUDE_API_KEY:' sk-ant-api03-env '},()=>{throw Error('not called');}),'sk-ant-api03-env');
 if(process.platform==='win32'){
  const reg='\r\nHKEY_CURRENT_USER\\Environment\r\n    BOT_CLAUDE_API_KEY    REG_SZ    sk-ant-api03-reg\r\n\r\n';
  assert.equal(readApiKey({},()=>reg),'sk-ant-api03-reg');
  assert.equal(readApiKey({},()=>{throw Error('missing');}),'');
 }
});

test('the API route runs the Agent SDK with the CLI settings, the key only in its child environment, and records what it cost',async()=>{
 const log=recorder();
 const {brain,sdk,spendFile}=apiBrain({log,model:'sonnet',effort:'high'});
 const turns=[];brain.on('turn',t=>turns.push({...t}));
 brain.start();
 assert.equal(sdk.calls.length,1);assert.equal(brain.route,'api');assert.equal(brain.authSource,'api');assert.ok(brain.ready);
 const o=sdk.calls[0].options;
 assert.equal(o.env.ANTHROPIC_API_KEY,KEY);assert.equal(process.env.ANTHROPIC_API_KEY,undefined,'the relay itself never holds the key');
 assert.equal(o.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB,'1');assert.equal(o.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
 assert.deepEqual(o.systemPrompt,{type:'preset',preset:'claude_code'});
 assert.equal(o.cwd,'C:\\brain');assert.equal(o.model,'sonnet');assert.equal(o.effort,'high');
 assert.equal(o.permissionMode,'acceptEdits');assert.equal(o.permissionPrompts,'none');assert.equal(o.strictMcpConfig,true);assert.equal(o.includePartialMessages,true);
 assert.deepEqual(o.disallowedTools,['Agent','Task']);assert.ok(o.allowedTools.includes('PowerShell'));assert.equal(o.skills,'all');
 assert.match(o.sessionId,/^[0-9a-f-]{36}$/);assert.equal(o.resume,undefined);
 const first=brain.send({text:'こんにちは',source:'web',runId:'r1'});
 const second=brain.send({text:'日記を書いて',source:'diary',runId:'r2',hidden:true});
 await tick();
 const q=sdk.calls[0];
 assert.deepEqual(q.sent,[{type:'user',message:{role:'user',content:'こんにちは'},parent_tool_use_id:null,session_id:''}]);
 q.emit({type:'system',subtype:'init',session_id:o.sessionId,model:'claude-sonnet-5-5',claude_code_version:'2.1.318',apiKeySource:'ANTHROPIC_API_KEY'});
 q.emit({type:'stream_event',event:{type:'content_block_start',content_block:{type:'text'}}});
 q.emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'やあ'}}});
 q.emit({type:'stream_event',event:{type:'content_block_stop'}});
 q.emit({type:'assistant',message:{content:[{type:'text',text:'やあ'}]}});
 q.emit({type:'result',subtype:'success',is_error:false,result:'やあ',session_id:o.sessionId,modelUsage:{'claude-sonnet-5-5':usage(10,20,0,15000,0.0752)}});
 assert.deepEqual(await first,{text:'やあ'});
 assert.ok(turns.some(t=>t.runId==='r1'&&t.state==='delta'),'the reply is shown while it is written');
 await tick();
 assert.equal(q.sent.length,2,'the next turn waits for the first');
 // Totals keep growing within the process: the second row is only the growth.
 q.emit({type:'result',subtype:'success',is_error:false,result:'書いた',session_id:o.sessionId,modelUsage:{'claude-sonnet-5-5':usage(14,50,15000,16000,0.0812),'claude-haiku-5-5':usage(500,30,0,0,0.0001)}});
 assert.deepEqual(await second,{text:'書いた'});
 await brain.ledger.flush();
 const rows=ledgerRows(spendFile);
 assert.deepEqual(rows[0],['日時','部門','使い道','モデル','入力','出力','キャッシュ読み','キャッシュ書き','ドル']);
 assert.deepEqual(rows.slice(1).map(r=>r.slice(1)),[
  ['gonta','Webの会話','claude-sonnet-5-5','10','20','0','15000','0.075200'],
  ['gonta','日記','claude-sonnet-5-5','4','30','15000','1000','0.006000'],
  ['gonta','日記','claude-haiku-5-5','500','30','0','0','0.000100']]);
 assert.match(rows[1][0],/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
 assert.equal(JSON.parse(readFileSync(path.join(brain.directory,'claude-session.json'),'utf8')).id,o.sessionId);
 assert.ok(log.lines.some(l=>/route: API credit/.test(l)));
 assert.ok(log.lines.every(l=>!l.includes(KEY)),'the key is never logged');
 brain.stop();await tick();assert.equal(q.ended,true);
});

test('a resumed API conversation counts only what grew since the totals saved in its transcript',async()=>{
 const {brain,sdk,dir,spendFile,projects}=apiBrain();
 const id=randomUUID();
 writeFileSync(path.join(dir,'claude-session.json'),JSON.stringify({id,cwd:'C:\\brain'}));
 mkdirSync(path.join(projects,'C--brain'));
 const saved={'claude-sonnet-5-5':usage(100,200,3000,4000,1.5)};
 writeFileSync(path.join(projects,'C--brain',id+'.jsonl'),[
  JSON.stringify({type:'user',message:{role:'user',content:'cost-state is only a word here'}}),
  JSON.stringify({type:'cost-state',sessionId:id,modelUsage:{'claude-sonnet-5-5':usage(1,1,1,1,0.1)}}),
  JSON.stringify({type:'cost-state',sessionId:id,modelUsage:saved}),
  JSON.stringify({type:'assistant',message:{content:[]}})].join('\n')+'\n');
 assert.deepEqual(savedTotals(id,projects),saved);assert.deepEqual(savedTotals(randomUUID(),projects),{});
 const resumed=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',queryImpl:sdk.query,keyReader:()=>KEY,tokenLoader:()=>null,spendFile,projects,log:quiet});
 brain.stop();
 resumed.start();
 const q=sdk.calls.at(-1);assert.equal(q.options.resume,id);assert.equal(q.options.sessionId,undefined);
 const turn=resumed.send({text:'続き',source:'line',runId:'r1'});await tick();
 // A crashed process can report zeros; they must not restart the count.
 q.emit({type:'result',subtype:'success',is_error:false,result:'はい',session_id:id,modelUsage:{'claude-sonnet-5-5':usage(102,210,3500,4100,1.52)}});
 await turn;
 const again=resumed.send({text:'次',source:'line',runId:'r2'});await tick();
 q.emit({type:'result',subtype:'error_during_execution',is_error:true,result:'x',session_id:id,modelUsage:{'claude-sonnet-5-5':usage(0,0,0,0,0)}});
 await assert.rejects(again);
 await resumed.ledger.flush();
 const rows=ledgerRows(spendFile).slice(1);
 assert.equal(rows.length,1);assert.deepEqual(rows[0].slice(2),['LINEの会話','claude-sonnet-5-5','2','10','500','100','0.020000']);
 resumed.stop();
});

test('an API failure is answered by the subscription in the same conversation, and the API is tried again after a reload',async()=>{
 const log=recorder();
 const {brain,sdk,cli}=apiBrain({log});
 brain.start();
 const o=sdk.calls[0].options,q=sdk.calls[0];
 const turn=brain.send({text:'こんにちは',source:'web',runId:'r1'});await tick();
 q.emit({type:'system',subtype:'init',session_id:o.sessionId,apiKeySource:'ANTHROPIC_API_KEY'});
 q.emit({type:'assistant',error:'billing_error',message:{content:[{type:'text',text:'Credit balance is too low'}]}});
 q.emit({type:'result',subtype:'success',is_error:true,result:'Credit balance is too low',session_id:o.sessionId});
 await settle();
 assert.equal(q.ended,true,'the API process was closed');
 assert.equal(cli.calls.length,1);assert.equal(brain.route,'plan');assert.match(brain.routeReason,/API failed.*billing_error/);
 assert.deepEqual(cli.calls[0].args.slice(-2),['--resume',o.sessionId],'the same conversation continues');
 assert.equal(cli.calls[0].child.written[0].message.content,'こんにちは','the same turn is sent again');
 cli.calls[0].child.emitLine({type:'result',subtype:'success',is_error:false,result:'サブスクで返事',session_id:o.sessionId});
 assert.deepEqual(await turn,{text:'サブスクで返事'});
 assert.ok(log.lines.some(l=>/Claude API failed.*billing_error/.test(l)),'the switch is logged');
 assert.ok(log.lines.some(l=>/route: subscription, because the API failed/.test(l)));
 // Within the hour the next turn stays on the subscription.
 const next=brain.send({text:'もう一つ',runId:'r2'});await tick();
 assert.equal(sdk.calls.length,1);assert.equal(cli.calls[0].child.written[1].message.content,'もう一つ');
 cli.calls[0].child.emitLine({type:'result',subtype:'success',is_error:false,result:'はい'});await next;
 // A reload (after fixing the key or adding credit) tries the API again.
 assert.equal(brain.reload(),'now');await settle();
 assert.equal(sdk.calls.length,2);assert.equal(brain.route,'api');assert.equal(sdk.calls[1].options.resume,o.sessionId);
 brain.stop();
});

test('an Agent SDK that cannot start leaves the turn to the subscription at once',async()=>{
 const {brain,sdk,cli}=apiBrain();
 brain.start();
 const turn=brain.send({text:'こんにちは',runId:'r1'});await tick();
 sdk.calls[0].fail(new Error('Claude Code executable not found'));
 await settle();
 assert.equal(cli.calls.length,1);assert.equal(brain.route,'plan');assert.match(brain.routeReason,/did not start|stopped before starting/);
 assert.equal(cli.calls[0].child.written[0].message.content,'こんにちは');
 cli.calls[0].child.emitLine({type:'result',subtype:'success',is_error:false,result:'はい'});
 assert.deepEqual(await turn,{text:'はい'});
 brain.stop();
});

test('when the month\'s share is spent the next turn moves to the subscription; other bots and other months do not count',async()=>{
 const {brain,sdk,cli,spendFile}=apiBrain({monthlyUsd:20});
 const now=jstTime(),lastMonth=jstTime(Date.now()-40*86400000);
 writeFileSync(spendFile,['日時,部門,使い道,モデル,入力,出力,キャッシュ読み,キャッシュ書き,ドル',
  `${now},gonta,Webの会話,claude-sonnet-5-5,1,1,1,1,19.990000`,
  `${now},経済指標,"判断表, 3回",claude-opus-5-5,1,1,1,1,30.0`,
  `${lastMonth},gonta,Webの会話,claude-sonnet-5-5,1,1,1,1,50.0`].join('\n')+'\n');
 brain.start();assert.equal(brain.route,'api');assert.equal(brain.apiMonth.usd,19.99);
 const q=sdk.calls[0];
 const first=brain.send({text:'一つ目',source:'web',runId:'r1'});await tick();
 q.emit({type:'result',subtype:'success',is_error:false,result:'はい',modelUsage:{'claude-sonnet-5-5':usage(1,1,1,1,0.02)}});
 await first;await brain.ledger.flush();
 const second=brain.send({text:'二つ目',source:'web',runId:'r2'});await settle();
 assert.equal(q.ended,true);assert.equal(cli.calls.length,1);assert.equal(brain.route,'plan');assert.match(brain.routeReason,/used up \(\$20\.01 of \$20\)/);
 cli.calls[0].child.emitLine({type:'result',subtype:'success',is_error:false,result:'サブスク'});
 assert.deepEqual(await second,{text:'サブスク'});
 brain.stop();
});

test('without a key, or with the API turned off, the brain answers on the subscription and says why',()=>{
 const missing=apiBrain({keyReader:()=>''});
 missing.brain.start();assert.equal(missing.sdk.calls.length,0);assert.equal(missing.cli.calls.length,1);
 assert.equal(missing.brain.route,'plan');assert.equal(missing.brain.routeReason,'BOT_CLAUDE_API_KEY is not set');
 assert.equal(missing.cli.calls[0].options.env.ANTHROPIC_API_KEY,undefined);
 missing.brain.stop();
 const off=apiBrain({api:false});
 off.brain.start();assert.equal(off.sdk.calls.length,0);assert.match(off.brain.routeReason,/turned off/);
 off.brain.stop();
});
