import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AUTH_MESSAGE,Brain,claudeArguments,cleanEnvironment} from '../relay/brain.mjs';

// A fake `claude` child: whatever the test scripts on stdout, the Brain must parse.
function fakeSpawn(){
 const calls=[];
 const spawn=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.written=[];child.stdin.on('data',d=>child.written.push(...String(d).split('\n').filter(Boolean).map(l=>JSON.parse(l))));
  child.kill=()=>child.emit('exit',null,'SIGTERM');child.emitLine=obj=>child.stdout.write(JSON.stringify(obj)+'\n');
  calls.push({command,args,options,child});return child;
 };
 return {spawn,calls};
}
const tick=()=>new Promise(r=>setTimeout(r,5));
function directory(){return mkdtempSync(path.join(os.tmpdir(),'gonta-brain-test-'));}

test('arguments keep the subscription login and ask for a resumable streamed session',()=>{
 const args=claudeArguments({sessionId:'abc',resume:false,model:'sonnet'});
 assert.ok(args.includes('--input-format')&&args.includes('stream-json')&&args.includes('--include-partial-messages'));
 assert.ok(!args.includes('--bare'));
 assert.deepEqual(args.slice(-2),['--session-id','abc']);
 assert.deepEqual(claudeArguments({sessionId:'abc',resume:true}).slice(-2),['--resume','abc']);
 assert.equal(args[args.indexOf('--permission-prompts')+1],'none');
 assert.match(args[args.indexOf('--allowedTools')+1],/PowerShell/);
 const env=cleanEnvironment({PATH:'x',ANTHROPIC_API_KEY:'secret',CLAUDECODE:'1',CLAUDE_CODE_SESSION_ID:'s'});
 assert.deepEqual(Object.keys(env).sort(),['CLAUDE_CODE_DISABLE_AUTO_MEMORY','CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','DISABLE_AUTOUPDATER','PATH']);
});

test('one turn at a time: streamed text, tool activity, final text, and the queue order',async()=>{
 const {spawn,calls}=fakeSpawn();const dir=directory();
 const brain=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',spawnImpl:spawn,log:{log(){},error(){}}});
 const turns=[],tools=[];brain.on('turn',t=>turns.push({...t}));brain.on('tool',e=>tools.push(e));
 brain.start();assert.equal(calls.length,1);assert.ok(brain.ready);
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
 const brain=new Brain({cwd:'C:\\brain',directory:dir,command:'fake',spawnImpl:spawn,log:{log(){},error(){}}});
 brain.restartDelay=1;
 brain.start();assert.deepEqual(calls[0].args.slice(-2),['--resume','old-session']);
 const turn=brain.send({text:'x',runId:'r1'});await tick();
 calls[0].child.stderr.write('Error: No conversation found with session ID: old-session\n');
 calls[0].child.emit('exit',1,null);
 await assert.rejects(turn,/再起動/);
 await new Promise(r=>setTimeout(r,20));
 assert.equal(calls.length,2);assert.equal(calls[1].args.at(-2),'--session-id');assert.notEqual(calls[1].args.at(-1),'old-session');
 brain.stop();
});

test('abort sends an interrupt and the result is reported as aborted with the partial text',async()=>{
 const {spawn,calls}=fakeSpawn();
 const brain=new Brain({cwd:'C:\\brain',directory:directory(),command:'fake',spawnImpl:spawn,log:{log(){},error(){}}});
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
 const brain=new Brain({cwd:'C:\brain',directory:directory(),command:'fake',spawnImpl:spawn,log:{log(){},error(){}},tokenLoader:()=>token});
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
 const second=brain.send({text:'もう一度',runId:'r2'});await tick();
 assert.equal(calls.length,2);assert.equal(calls[1].options.env.CLAUDE_CODE_OAUTH_TOKEN,token);assert.equal(brain.authSource,'token');
 assert.equal(calls[1].child.written[0].message.content,'もう一度');
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'はい'});
 assert.deepEqual(await second,{text:'はい'});assert.equal(brain.auth.ok,true);assert.deepEqual(auth,[false,true]);
 const third=brain.send({text:'三つ目',runId:'r3'});await tick();
 assert.equal(calls.length,2,'a working login does not restart the process');
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'了解'});await third;
 brain.stop();
});

test('reload restarts an idle brain at once and a busy one after its turn',async()=>{
 const {spawn,calls}=fakeSpawn();
 const brain=new Brain({cwd:'C:\brain',directory:directory(),command:'fake',spawnImpl:spawn,log:{log(){},error(){}},tokenLoader:()=>null});
 brain.start();assert.equal(brain.reload(),'now');assert.equal(calls.length,2);assert.ok(brain.ready);
 const turn=brain.send({text:'x',runId:'r1'});await tick();
 assert.equal(brain.reload(),'after-turn');assert.equal(calls.length,2);
 calls[1].child.emitLine({type:'result',subtype:'success',is_error:false,result:'ok'});await turn;
 assert.equal(calls.length,3);assert.ok(brain.ready);
 brain.stop();
});
