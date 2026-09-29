import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoState,memoToken,MAX_MEMO_LENGTH,MAX_MEMOS,MAX_MEMO_TITLE_LENGTH} from '../public/memo-state.js';
const source=readFileSync(new URL('../public/memo.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(cache=new Map()) {
  const nodes=new Map(),timers=new Map(),events=new Map();let timerId=0;
  const element=()=>({value:'',textContent:'',disabled:false,hidden:false,dataset:{},attrs:{},events:new Map(),selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollTop:0,setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},addEventListener(k,fn){this.events.set(k,fn);},focus(){},select(){},inert:false});
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const remotes=Array.from({length:MAX_MEMOS},(_,index)=>({content:index===0?'元のメモ':'',title:'',version:index===0?1:0}));
  let mode='ok';const releases=[];
  const calls=[];
  const context=vm.createContext({MemoState,memoToken,MAX_MEMO_LENGTH,MAX_MEMOS,MAX_MEMO_TITLE_LENGTH,AbortSignal,JSON,Error,Object,String,setInterval(){},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
    document:{getElementById:$,hidden:false,body:{classList:{toggle(){}}},addEventListener:(k,fn)=>events.set(k,fn)},
    window:{addEventListener:(k,fn)=>events.set(k,fn)},matchMedia:()=>({matches:false,addEventListener(){}}),
    async fetch(url,options){
      const id=Number(new URL(url,'http://localhost').searchParams.get('id') || 1);
      calls.push({...options,id});
      if(mode==='offline')throw Error('offline');
      if(mode==='slow')await new Promise(resolve=>{releases.push(resolve);});
      let remote=remotes[id-1];
      let status=200;
      if(options.method==='PUT'){
        const data=JSON.parse(options.body);
        if(data.version!==remote.version)status=409;
        else remote=remotes[id-1]={content:data.content,title:data.title??remote.title??'',version:remote.version+1};
      }
      return {ok:status===200,status,json:async()=>({title:'',...remote,id:mode==='wrong-id'?1:id})};
    }
  });
  vm.runInContext(source,context);
  return {$,cache,calls,events,remotes,api:context.createMemo(),setMode(value){mode=value;},release(){releases.splice(0).forEach(release=>release());},get remote(){return remotes[0];},
    async select(id){$(`memo-tab-${id}`).onclick();await tick();},
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

test('all five tabs autosave separately and retain selection and caret position',async()=>{
 const t=setup();await t.ready();
 for(let id=1;id<=5;id++){
  await t.select(id);t.input(`メモ${id}の本文\n続き`);await t.flush();
 }
 assert.deepEqual(t.remotes.map(note=>note.content),Array.from({length:5},(_,index)=>`メモ${index+1}の本文\n続き`));
 await t.select(2);t.$('memo-editor').setSelectionRange(2,4,'forward');t.$('memo-editor').scrollTop=60;
 await t.select(5);await t.select(2);
 assert.equal(t.$('memo-editor').value,'メモ2の本文\n続き');
 assert.equal(t.$('memo-editor').selectionStart,2);assert.equal(t.$('memo-editor').selectionEnd,4);
 assert.equal(t.$('memo-editor').scrollTop,60);
 assert.equal(t.$('memo-tab-2').getAttribute('aria-selected'),'true');
 assert.equal(t.$('memo-tab-1').tabIndex,-1);
 assert.equal(t.$('memo-page').getAttribute('aria-labelledby'),'memo-tab-2');
 const restored=setup(t.cache);restored.setMode('offline');await restored.ready();
 assert.equal(restored.$('memo-editor').value,'メモ2の本文\n続き');
 assert.equal(restored.$('memo-tab-2').getAttribute('aria-selected'),'true');
});

test('switching tabs during an in-flight save never changes another memo',async()=>{
 const t=setup();await t.ready();t.setMode('slow');t.input('メモ1の保存中');await t.flush();
 await t.select(2);t.input('メモ2に入力');await t.flush();
 assert.equal(t.$('memo-editor').value,'メモ2に入力');
 t.setMode('ok');t.release();await tick();await t.flush();
 assert.equal(t.remotes[0].content,'メモ1の保存中');assert.equal(t.remotes[1].content,'メモ2に入力');
 assert.equal(t.$('memo-editor').value,'メモ2に入力');
 await t.select(1);assert.equal(t.$('memo-editor').value,'メモ1の保存中');
});

test('offline drafts in inactive tabs restore and sync without visiting those tabs',async()=>{
 const t=setup();await t.ready();t.setMode('offline');
 t.input('メモ1の下書き');await t.select(4);t.input('メモ4の下書き');await t.select(5);await t.flush();
 const restored=setup(t.cache);restored.setMode('offline');await restored.ready();
 assert.equal(restored.$('memo-tab-5').getAttribute('aria-selected'),'true');
 assert.equal(restored.$('memo-tab-1').dataset.pending,'true');
 assert.equal(restored.$('memo-tab-4').dataset.pending,'true');
 restored.setMode('ok');restored.events.get('online')();await tick();
 assert.equal(restored.remotes[0].content,'メモ1の下書き');
 assert.equal(restored.remotes[3].content,'メモ4の下書き');
 assert.equal(restored.$('memo-tab-4').dataset.pending,'false');
 assert.equal(restored.$('memo-editor').value,'');
});

test('a conflict belongs only to its memo and resolving it leaves other tabs intact',async()=>{
 const t=setup();await t.ready();t.input('この端末の下書き');
 t.remotes[0]={content:'別端末のメモ1',version:2};await t.flush();
 assert.equal(t.$('memo-conflict').hidden,false);
 await t.select(2);assert.equal(t.$('memo-conflict').hidden,true);
 t.input('メモ2の本文');await t.flush();
 await t.select(1);assert.equal(t.$('memo-editor').value,'この端末の下書き');
 assert.equal(t.$('memo-remote').textContent,'別端末のメモ1');
 t.$('memo-use-draft').onclick();await tick();
 assert.equal(t.remotes[0].content,'この端末の下書き');assert.equal(t.remotes[1].content,'メモ2の本文');
 assert.equal(t.$('memo-conflict').hidden,true);
});

test('legacy single-memo cache is restored in tab 1, including an unsynced draft',async()=>{
 const cacheId=await memoToken(await memoToken('memo-test-key-00000000000000000'));
 const cache=new Map([['gonta.memo.draft.'+cacheId,JSON.stringify({content:'旧メモの未送信分',base:'元のメモ',version:1})]]);
 const t=setup(cache);t.setMode('offline');await t.ready();
 assert.equal(t.$('memo-editor').value,'旧メモの未送信分');
 await t.select(2);assert.equal(t.$('memo-editor').value,'');
 t.setMode('ok');t.events.get('online')();await tick();
 assert.equal(t.remotes[0].content,'旧メモの未送信分');assert.equal(t.remotes[1].content,'');
});

test('keyboard tab selection wraps and Japanese composition stays in its original memo',async()=>{
 const t=setup();await t.ready();
 const press=(id,key)=>t.$(`memo-tab-${id}`).events.get('keydown')({key,preventDefault(){}});
 press(1,'ArrowLeft');await tick();assert.equal(t.$('memo-tab-5').getAttribute('aria-selected'),'true');
 press(5,'Home');await tick();assert.equal(t.$('memo-tab-1').getAttribute('aria-selected'),'true');
 press(1,'End');await tick();assert.equal(t.$('memo-tab-5').getAttribute('aria-selected'),'true');
 press(5,'ArrowRight');await tick();
 t.$('memo-editor').events.get('compositionstart')();t.input('日本語変換中');
 await t.select(2);assert.equal(t.$('memo-tab-1').getAttribute('aria-selected'),'true');
 t.$('memo-editor').events.get('compositionend')();await t.select(2);await t.flush();
 assert.equal(t.remotes[0].content,'日本語変換中');assert.equal(t.remotes[1].content,'');
});

test('disconnect ignores responses from multiple tabs and clears conflict previews',async()=>{
 const t=setup();await t.ready();t.setMode('slow');
 t.input('メモ1保存中');await t.flush();await t.select(3);t.input('メモ3保存中');await t.flush();
 await t.api.setCredential(null);t.setMode('ok');t.release();await tick();
 for(let id=1;id<=5;id++){
  await t.select(id);assert.equal(t.$('memo-editor').value,'');assert.equal(t.$('memo-editor').disabled,true);
  assert.equal(t.$('memo-remote').textContent,'');assert.equal(t.$('memo-conflict').hidden,true);
 }
});

test('an outdated proxy that drops the tab id cannot overwrite tab 1',async()=>{
 const t=setup();t.setMode('wrong-id');await t.ready();await t.select(2);
 assert.equal(t.$('memo-editor').disabled,true);
 assert.equal(t.calls.filter(call=>call.method==='PUT').length,0);
 assert.equal(t.remotes[0].content,'元のメモ');
});

const nameKey=(t,id,key,extra={})=>t.$(`memo-name-${id}`).events.get('keydown')({key,preventDefault(){},stopPropagation(){},...extra});
const rename=(t,id,title)=>{t.$(`memo-tab-${id}`).events.get('dblclick')();t.$(`memo-name-${id}`).value=title;nameKey(t,id,'Enter');};

test('double-click renames only its tab and blank names restore the default label',async()=>{
 const t=setup();await t.ready();
 rename(t,3,'  買い物 🐶  ');await t.flush();
 assert.equal(t.remotes[2].title,'買い物 🐶');assert.equal(t.remotes[2].content,'');
 assert.equal(t.$('memo-tab-3').textContent,'買い物 🐶');
 assert.equal(t.$('memo-editor-label').textContent,'買い物 🐶の内容');
 assert.equal(t.$('memo-name-3').hidden,true);assert.equal(t.$('memo-tab-3').hidden,false);
 assert.equal(t.remotes[0].title,'');assert.equal(t.remotes[0].content,'元のメモ');
 rename(t,3,'   ');await t.flush();
 assert.equal(t.remotes[2].title,'');assert.equal(t.$('memo-tab-3').textContent,'メモ3');
});

test('rename supports F2, cancellation, touch fallback, blur confirmation, and IME Enter',async()=>{
 const t=setup();await t.ready();
 t.$('memo-tab-1').events.get('keydown')({key:'F2',preventDefault(){}});
 assert.equal(t.$('memo-name-1').hidden,false);t.$('memo-name-1').value='取り消す名前';
 nameKey(t,1,'Escape');await t.flush();assert.equal(t.remote.title,'');
 t.$('memo-rename').onclick();t.$('memo-name-1').events.get('compositionstart')();
 t.$('memo-name-1').value='変換中';nameKey(t,1,'Enter');
 assert.equal(t.$('memo-name-1').hidden,false);assert.equal(t.remote.title,'');
 t.$('memo-name-1').events.get('compositionend')();t.$('memo-name-1').value='仕事のメモ';
 nameKey(t,1,'Enter',{keyCode:229});assert.equal(t.$('memo-name-1').hidden,false);
 t.$('memo-name-1').events.get('blur')();await t.flush();
 assert.equal(t.remote.title,'仕事のメモ');assert.equal(t.remote.content,'元のメモ');
});

test('a name edited during an in-flight body save is saved after that response',async()=>{
 const t=setup();await t.ready();t.setMode('slow');t.input('保存中の本文');await t.flush();
 rename(t,1,'後から変更した名前');await t.flush();
 t.setMode('ok');t.release();await tick();await t.flush();
 assert.equal(t.remote.content,'保存中の本文');assert.equal(t.remote.title,'後から変更した名前');
 assert.equal(t.$('memo-tab-1').textContent,'後から変更した名前');
 assert.equal(t.calls.filter(call=>call.method==='PUT').length,2);
});

test('offline name changes restore after reload and merge with a remote body edit',async()=>{
 const t=setup();await t.ready();t.setMode('offline');rename(t,2,'外出先の下書き');await t.flush();
 const restored=setup(t.cache);restored.setMode('offline');await restored.ready();
 assert.equal(restored.$('memo-tab-2').textContent,'外出先の下書き');
 restored.remotes[1]={title:'',content:'別端末で本文を追加',version:1};
 restored.setMode('ok');restored.events.get('online')();await tick();await restored.flush();
 assert.equal(restored.remotes[1].title,'外出先の下書き');
 assert.equal(restored.remotes[1].content,'別端末で本文を追加');
});

test('conflicting names display the saved name and can use the remote version',async()=>{
 const t=setup();await t.ready();rename(t,1,'この端末の名前');
 t.remotes[0]={content:'元のメモ',title:'別端末の名前',version:2};await t.flush();
 assert.equal(t.$('memo-conflict').hidden,false);
 assert.equal(t.$('memo-remote-title').textContent,'名前：別端末の名前');
 assert.equal(t.$('memo-tab-1').textContent,'この端末の名前');
 t.$('memo-use-remote').onclick();await t.flush();
 assert.equal(t.$('memo-tab-1').textContent,'別端末の名前');
 assert.equal(t.$('memo-conflict').hidden,true);
});

test('names remain literal text and disconnect removes names and open rename fields',async()=>{
 const t=setup();t.$('memo-tab-1').events.get('dblclick')();assert.equal(t.$('memo-name-1').hidden,true);
 await t.ready();rename(t,1,'<img src=x onerror=alert(1)>');await t.flush();
 assert.equal(t.$('memo-tab-1').textContent,'<img src=x onerror=alert(1)>');
 t.$('memo-tab-1').events.get('dblclick')();
 await t.api.setCredential(null);
 assert.equal(t.$('memo-tab-1').textContent,'メモ1');assert.equal(t.$('memo-name-1').value,'');
 assert.equal(t.$('memo-name-1').hidden,true);assert.equal(t.$('memo-rename').disabled,true);
});

test('opening and leaving a name untouched does not save or undo an incoming name',async()=>{
 const t=setup();await t.ready();t.$('memo-rename').onclick();
 t.$('memo-name-1').events.get('blur')();await t.flush();
 assert.equal(t.calls.filter(call=>call.method==='PUT').length,0);
 t.$('memo-rename').onclick();t.remotes[0]={content:'元のメモ',title:'別端末の最新名',version:2};
 t.events.get('online')();await tick();t.$('memo-name-1').events.get('blur')();await t.flush();
 assert.equal(t.$('memo-tab-1').textContent,'別端末の最新名');
 assert.equal(t.calls.filter(call=>call.method==='PUT').length,0);
});
