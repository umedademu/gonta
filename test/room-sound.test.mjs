import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoom} from '../public/room.js';

test('room sound follows newly revealed reply characters, never thinking or history',()=>{
 const names=['document','window','localStorage','matchMedia','setInterval','clearInterval'];
 const originals=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const elements=new Map(),listeners=new Map(),intervals=new Map(),storage=new Map([['gonta.view','room']]);let sequence=0,notes=0;
 const element=()=>{const classes=new Set();return{textContent:'',hidden:false,classes,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},setAttribute(){},append(){},querySelector(){return element();}};};
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const ticks=n=>{for(let i=0;i<n;i++)for(const cb of [...intervals.values()])cb();};
 const param={setValueAtTime(){},linearRampToValueAtTime(){}};
 try{
  globalThis.document={hidden:false,body:element(),getElementById:get,createElement:()=>element(),addEventListener:(name,fn)=>listeners.set(name,fn)};
  // Capture the dynamically inserted sound button.
  get('pixel-room').querySelector=()=>({append:button=>elements.set(button.id,button)});
  globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
  globalThis.setInterval=cb=>{intervals.set(++sequence,cb);return sequence;};globalThis.clearInterval=id=>intervals.delete(id);
  globalThis.window={AudioContext:class{state='running';currentTime=0;destination={};createOscillator(){return{frequency:param,connect(){},disconnect(){},start(){notes++;},stop(){}};}createGain(){return{gain:param,connect(){},disconnect(){}};}}};
  const room=createRoom();listeners.get('pointerdown')();
  const messages=[{role:'assistant',text:'昔の会話'}];
  const state={connected:true,gatewayReady:true,selected:'one',messages,runId:null,stream:''};
  room.update(state);ticks(20);assert.equal(notes,0,'history stays silent');
  messages.push({role:'user',text:'こんにちは'});room.update({...state,runId:'run'});
  assert.equal(get('room-text').textContent,'こんにちは','sent message appears immediately');assert.equal(get('room-speaker').textContent,'あなた');assert.equal(get('room-thinking').hidden,false);
  ticks(20);assert.equal(notes,0,'user text and thinking stay silent');
  room.update({...state,runId:'run',stream:'あい'});assert.equal(get('room-thinking').hidden,true);assert.equal(get('room-speaker').textContent,'ゴンタ');ticks(1);assert.equal(get('room-text').textContent,'あ');assert.equal(notes,1);
  room.update({...state,runId:'run',stream:'あいうえ'});ticks(3);assert.equal(notes,4,'appending a stream does not replay characters');
  room.update({...state,runId:'run',stream:'あいうえ'});ticks(5);assert.equal(notes,4,'unchanged refresh is silent');
  messages.push({role:'assistant',text:'あいうえ'});room.update(state);ticks(5);assert.equal(notes,4,'final copy of streamed text is silent');
  get('room-prev').onclick();get('room-next').onclick();ticks(20);assert.equal(notes,4,'history navigation is silent');
  get('room-sound').onclick();assert.equal(storage.get('gonta.roomSound'),'off');
  messages.push({role:'assistant',text:'無音です'});room.update(state);ticks(20);assert.equal(notes,4,'mute suppresses sound');
  get('room-sound').onclick();
  messages.push({role:'assistant',text:'新しい返答'});room.update(state);ticks(1);assert.equal(notes,5);
  get('room-reveal').onclick();ticks(20);assert.equal(notes,5,'show all cancels remaining notes');
  messages.push({role:'assistant',text:'最後の返答'});room.update(state);get('room-history').onclick();ticks(20);assert.equal(notes,5,'normal mode is silent');
  messages.push({role:'user',text:'Obsidianの日記を調べて'});room.update({...state,runId:'lookup'});
  assert.ok(get('pixel-room').classes.has('is-searching'));assert.equal(get('room-text').textContent,'Obsidianの日記を調べて');
  room.update({...state,runId:'lookup',activity:{kind:'obsidian'},stream:'調べています'});
  assert.ok(get('pixel-room').classes.has('is-searching'));assert.equal(get('room-thinking').textContent,'Obsidianのノートを調べています…');
  room.update({...state,runId:'lookup',activity:null,stream:'読み終わりました'});assert.equal(get('pixel-room').classes.has('is-searching'),false);
  room.update({...state,connected:false,activity:{kind:'obsidian'}});assert.equal(get('pixel-room').classes.has('is-searching'),false);
  messages.push({role:'user',text:'この内容はどう思いますか？ C:\\Users\\USER\\Desktop\\W-History'});
  room.update({...state,runId:'files'});assert.ok(get('pixel-room').classes.has('is-pc-working'));
  assert.equal(get('room-text').textContent,messages.at(-1).text);
  room.update({...state,runId:'files',stream:'確認します',activity:{kind:'pc'}});assert.ok(get('pixel-room').classes.has('is-pc-working'));
  assert.equal(get('room-thinking').hidden,false);
  room.update({...state,runId:'files',activity:{kind:'obsidian'}});assert.ok(get('pixel-room').classes.has('is-searching'));assert.equal(get('pixel-room').classes.has('is-pc-working'),false);
  room.update({...state,runId:null});assert.equal(get('pixel-room').classes.has('is-pc-working'),false);assert.equal(get('pixel-room').classes.has('is-searching'),false);
 }finally{for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
