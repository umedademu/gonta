import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the real event handler with UI/network boundaries replaced by spies.
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=app.indexOf("  if(f.type==='chat'&&f.sessionKey===selected){");
const end=app.indexOf('\n };\n current.onclose',start);
assert.ok(start>=0&&end>start);
const handler=app.slice(start,end);
test('completion never renders an empty stream before its final message exists',async()=>{
 for(const state of ['final','aborted','error']){
  const frames=[];
  const context={f:{type:'chat',sessionKey:'one',state,text:state==='final'?'こんにちは、私はゴンタです。':''},selected:'one',queuePauses:new Map(),dispatches:new Map(),scheduleQueue(){},runId:'run',stream:'こんにちは、私はゴンタ',activity:null,historyGeneration:4,messages:[{role:'user',text:'自己紹介して'}],notice(){},refreshSessions(){},loadHistory(){throw Error('Must not replace the completed reply with a history request');}};
  context.renderMessages=context.updateComposer=()=>frames.push(context.messages.at(-1).text);
  await vm.runInNewContext(`(async()=>{${handler}})()`,context);
  assert.ok(frames.length>0);assert.ok(frames.every(text=>text.startsWith('こんにちは、私はゴンタ')));
  assert.equal(context.runId,null);assert.equal(context.historyGeneration,5);
 }
});
test('new stream data invalidates older history requests',async()=>{
 const context={f:{type:'chat',sessionKey:'one',state:'delta',runId:'run',text:'続き'},selected:'one',queuePauses:new Map(),dispatches:new Map(),scheduleQueue(){},historyGeneration:3,renderMessages(){},updateComposer(){}};
 await vm.runInNewContext(`(async()=>{${handler}})()`,context);
 assert.equal(context.historyGeneration,4);assert.equal(context.stream,'続き');
});
const history=app.slice(app.indexOf('async function loadHistory('),app.indexOf('\nasync function newChat('));
test('history keeps a newer stream and can still recover a missed completion',async()=>{
 let renders=0;
 const context={selected:'one',queuePauses:new Map(),dispatches:new Map(),scheduleQueue(){},historyGeneration:0,runId:'run',stream:'こんにちは、私はゴンタ',messages:[],notice(){},renderMessages(){renders++;},updateComposer(){},rpc:async()=>({messages:[],inFlightRun:{runId:'run',text:'こんにちは'}})};
 await vm.runInNewContext(`${history};loadHistory()`,context);
 assert.equal(context.stream,'こんにちは、私はゴンタ');assert.equal(renders,0);
 context.rpc=async()=>({messages:[{role:'assistant',text:'こんにちは、私はゴンタです。'}],inFlightRun:null,sessionInfo:{hasActiveRun:false}});
 await vm.runInNewContext(`${history};loadHistory()`,context);
 assert.equal(context.runId,null);assert.equal(context.messages[0].text,'こんにちは、私はゴンタです。');assert.equal(renders,1);
});
