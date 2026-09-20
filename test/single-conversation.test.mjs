import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const ready=app.slice(app.indexOf("  if(f.type==='ready'){"),app.indexOf("  if(f.type==='response'){"));
test('initial connection and reconnect always open the intended conversation regardless of list order',async()=>{
 for(const selected of [null,'agent:main:discord:channel:1472851354211844176']){
  const opened=[],nodes=new Map();
  const context=vm.createContext({selected,conversationKey:'agent:main:discord:channel:1472809918645010535',
   sessionList:[{key:'agent:main:discord:channel:1472851354211844176'}],f:{type:'ready',status:{}},timer:0,c:{},connected:false,
   $:id=>{if(!nodes.has(id))nodes.set(id,{close(){}});return nodes.get(id);},clearTimeout(){},setStatus(){},notice(){},
   sessionStorage:{setItem(){}},localStorage:{setItem(){},removeItem(){}},remember:{checked:false},
   refreshSessions:async()=>{},selectSession:async key=>opened.push(key)
  });
  await vm.runInContext(`(async()=>{${ready}})()`,context);
  assert.deepEqual(opened,['agent:main:discord:channel:1472809918645010535']);
 }
});
