import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const queue=app.slice(app.indexOf('function currentQueue('),app.indexOf("$('message').onkeydown="));
const handler=app.slice(app.indexOf("  if(f.type==='chat'&&f.sessionKey===selected){"),app.indexOf('\n };\n current.onclose'));
function setup(){
 const nodes=new Map(),scheduled=[],sent=[];
 const element=()=>({value:'',style:{},children:[],setAttribute(){},append(...v){this.children.push(...v);},replaceChildren(){this.children=[];},focus(){},oninput(){}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const c=vm.createContext({$,document:{createElement:element},crypto:{randomUUID:()=>`id-${++c.ids}`},ids:0,selected:'one',connected:true,gatewayReady:true,historyReady:true,historyActive:true,runId:'first',stream:'返答',messages:[],activity:null,historyGeneration:0,editingQueued:null,sendQueues:new Map(),queuePauses:new Map(),dispatches:new Map(),setTimeout:fn=>scheduled.push(fn),notice(){},renderMessages(){},refreshSessions(){},loadHistory:async()=>{},rpc:async(method,params)=>{sent.push(params);return {runId:params.idempotencyKey};}});
 vm.runInContext(queue,c);c.updateComposer=()=>c.renderQueue();
 return {c,$,sent,async submit(text){$('message').value=text;$('composer').onsubmit({preventDefault(){}});await this.flush();},async flush(){while(scheduled.length)await scheduled.shift()();},async finish(state='final'){c.f={type:'chat',sessionKey:c.selected,state,runId:c.runId,text:'完了'};await vm.runInContext(`(async()=>{${handler}})()`,c);await this.flush();}};
}
test('messages wait during a reply, then dispatch exactly one at a time in order',async()=>{
 const t=setup();await t.submit('二つ目');await t.submit('三つ目');assert.equal(t.sent.length,0);assert.equal(t.c.currentQueue().length,2);
 await t.finish();assert.deepEqual(t.sent.map(x=>x.message),['二つ目']);assert.equal(t.c.currentQueue().length,1);
 await t.flush();assert.equal(t.sent.length,1);await t.finish();assert.deepEqual(t.sent.map(x=>x.message),['二つ目','三つ目']);
});
test('queued editing preserves order and cancelling an item removes it before send',async()=>{
 const t=setup();await t.submit('編集前');await t.submit('取り消す');
 t.$('queue-items').children[0].children[1].onclick();await t.finish();assert.equal(t.sent.length,0);
 await t.submit('編集後');assert.equal(t.sent[0].message,'編集後');
 t.$('queue-items').children[0].children[2].onclick();await t.finish();assert.equal(t.sent.length,1);
});
test('changing conversations cannot send a queued message to the other conversation',async()=>{
 const t=setup();await t.submit('元の会話宛');t.c.selected='two';t.c.runId=null;t.c.historyActive=false;await t.flush();assert.equal(t.sent.length,0);
 t.c.selected='one';t.c.historyReady=false;await t.c.drainQueue();assert.equal(t.sent.length,0);
 t.c.historyReady=true;await t.c.drainQueue();assert.equal(t.sent[0].sessionKey,'one');
});
test('uncertain send pauses and retains idempotency key for explicit retry',async()=>{
 const t=setup();await t.submit('追加');t.c.rpc=async()=>{throw Error('offline');};await t.finish();
 const item=t.c.currentQueue()[0];assert.equal(item.message,'追加');assert.equal(item.uncertain,true);assert.ok(t.c.queuePauses.has('one'));
 t.c.historyReady=true;t.c.historyActive=false;t.c.runId=null;await t.c.drainQueue();assert.equal(t.c.currentQueue().length,1);
 t.c.queuePauses.clear();t.c.rpc=async(_,p)=>{t.sent.push(p);return {runId:p.idempotencyKey};};await t.c.drainQueue();assert.equal(t.sent[0].idempotencyKey,item.id);
});
test('stopped and failed replies leave additional messages paused',async()=>{
 for(const state of ['aborted','error']){const t=setup();await t.submit('次');await t.finish(state);assert.equal(t.sent.length,0);assert.equal(t.c.currentQueue().length,1);assert.ok(t.c.queuePauses.has('one'));}
});
test('fast completion before send acknowledgement still sends the next item once',async()=>{
 const t=setup();await t.submit('二つ目');await t.submit('三つ目');let acknowledge;
 t.c.rpc=(_,p)=>{t.sent.push(p);return new Promise(r=>{acknowledge=r;});};
 t.c.historyActive=false;t.c.runId=null;const sending=t.c.drainQueue();await t.finish();assert.equal(t.sent.length,1);
 t.c.rpc=async(_,p)=>{t.sent.push(p);return {runId:p.idempotencyKey};};acknowledge({runId:t.sent[0].idempotencyKey});await sending;await t.flush();assert.equal(t.sent.length,2);
});
