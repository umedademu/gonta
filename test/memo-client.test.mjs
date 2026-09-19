import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoState,memoToken,MAX_MEMO_LENGTH} from '../public/memo-state.js';
const source=readFileSync(new URL('../public/memo.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(cache=new Map()) {
  const nodes=new Map(),timers=new Map(),events=new Map();let timerId=0;
  const element=()=>({value:'',textContent:'',disabled:false,hidden:false,dataset:{},attrs:{},events:new Map(),setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},addEventListener(k,fn){this.events.set(k,fn);},focus(){},inert:false});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  let remote={content:'元のメモ',version:1},mode='ok',release;
  const calls=[];
  const context=vm.createContext({MemoState,memoToken,MAX_MEMO_LENGTH,AbortSignal,JSON,Error,Object,String,setInterval(){},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
    document:{getElementById:$,hidden:false,body:{classList:{toggle(){}}},addEventListener:(k,fn)=>events.set(k,fn)},
    window:{addEventListener:(k,fn)=>events.set(k,fn)},matchMedia:()=>({matches:false,addEventListener(){}}),
    async fetch(url,options){
      calls.push(options);
      if(mode==='offline')throw Error('offline');
      if(mode==='slow')await new Promise(resolve=>{release=resolve;});
      let status=200;
      if(options.method==='PUT'){
        const data=JSON.parse(options.body);
        if(data.version!==remote.version)status=409;
        else remote={content:data.content,version:remote.version+1};
      }
      return {ok:status===200,status,json:async()=>({...remote})};
    }
  });
  vm.runInContext(source,context);
  return {$,cache,calls,events,api:context.createMemo(),setMode(value){mode=value;},release(){release();},get remote(){return remote;},
    input(text){$('memo-editor').value=text;$('memo-editor').events.get('input')();},
    async ready(){await this.api.setCredential('memo-test-key-00000000000000000');await tick();},
    async flush(){const pending=[...timers.values()];timers.clear();for(const t of pending)t.fn();await tick();}
  };
}
test('client defers IME composition, autosaves after completion, and preserves the memo across closing',async()=>{
 const t=setup();await t.ready();
 t.$('memo-editor').events.get('compositionstart')();t.input('日本語を変換中');await t.flush();
 assert.equal(t.calls.filter(c=>c.method==='PUT').length,0);
 t.$('memo-editor').events.get('compositionend')();await t.flush();
 assert.equal(t.remote.content,'日本語を変換中');
 t.$('memo-toggle').onclick();t.$('memo-toggle').onclick();await tick();
 assert.equal(t.$('memo-editor').value,'日本語を変換中');
});
test('client keeps later typing during save and sends it after the first request completes',async()=>{
 const t=setup();await t.ready();t.setMode('slow');t.input('最初');await t.flush();
 t.input('最初＋続き');t.setMode('ok');t.release();await tick();
 assert.equal(t.$('memo-editor').value,'最初＋続き');await t.flush();
 assert.equal(t.remote.content,'最初＋続き');
 assert.equal(t.calls.filter(c=>c.method==='PUT').length,2);
});
test('offline draft can be restored and edited before network recovery',async()=>{
 const t=setup();await t.ready();t.setMode('offline');t.input('通信中断後の下書き');await t.flush();
 assert.match(t.$('memo-status').textContent,/下書き保存/);
 const restored=setup(t.cache);restored.setMode('offline');await restored.ready();
 assert.equal(restored.$('memo-editor').value,'通信中断後の下書き');
 assert.equal(restored.$('memo-editor').disabled,false);
 restored.input('さらに追記');restored.setMode('ok');await restored.flush();
 assert.equal(restored.remote.content,'さらに追記');
});
test('disconnect clears visible private text and ignores an in-flight response',async()=>{
 const t=setup();await t.ready();t.setMode('slow');t.input('保存中');await t.flush();
 await t.api.setCredential(null);t.setMode('ok');t.release();await tick();
 assert.equal(t.$('memo-editor').value,'');assert.equal(t.$('memo-editor').disabled,true);
 assert.match(t.$('memo-status').textContent,/接続設定/);
});
