import {allowedSession} from './security.mjs';

export function activityKind(data){
 const text=JSON.stringify({name:data.name,args:data.args}).slice(0,40000);
 if(/obsidian|オブシディアン/i.test(text))return 'obsidian';
 const name=String(data.name||'');
 if(/web|browser|fetch|search_query/i.test(name))return null;
 if(/^(read|read_file|list_directory|list_files|search_files|glob|grep|find_files)$/i.test(name))return 'pc';
 const args=JSON.stringify(data.args||{});
 if(/(?:[a-z]:\\|\/mnt\/[a-z]\/|\/home\/|\/Users\/)/i.test(args))return 'pc';
 if(/exec|shell|terminal/i.test(name)&&/\b(?:ls|cat|find|rg|grep|head|tail|pwd|stat)\b|Get-Content|Get-ChildItem|Select-String/i.test(args))return 'pc';
 return null;
}

// Only a small activity label leaves the PC; tool arguments and note contents do not.
export class ActivityTracker {
 constructor(){this.sessions=new Map();}
 get(key){const item=this.sessions.get(key);if(!item)return null;if(Date.now()-item.updated>600000){this.sessions.delete(key);return null;}return item.calls.size?{kind:[...item.calls.values()].includes('obsidian')?'obsidian':'pc',runId:item.runId}:null;}
 clear(key){const had=this.sessions.delete(key);return had?{sessionKey:key,activity:null}:null;}
 event(frame){
  const p=frame.payload;if(!allowedSession(p?.sessionKey))return null;
  if(frame.event==='chat'&&['final','error','aborted'].includes(p.state))return this.clear(p.sessionKey);
  if(frame.event!=='agent')return null;
  if(p.stream==='lifecycle'&&['end','error'].includes(p.data?.phase))return this.clear(p.sessionKey);
  if(p.stream!=='tool'||typeof p.runId!=='string')return null;
  const d=p.data||{},id=d.toolCallId||d.itemId;if(typeof id!=='string')return null;
  let item=this.sessions.get(p.sessionKey);
  if(d.phase==='start'){
   const kind=activityKind(d);if(!kind)return null;
   if(!item||item.runId!==p.runId)item={runId:p.runId,calls:new Map(),updated:Date.now()};
   item.calls.set(id,kind);item.updated=Date.now();this.sessions.set(p.sessionKey,item);
   return {sessionKey:p.sessionKey,activity:this.get(p.sessionKey)};
  }
  if(['result','end','error'].includes(d.phase)&&item?.runId===p.runId&&item.calls.delete(id)){
   item.updated=Date.now();const activity=this.get(p.sessionKey);if(!activity)this.sessions.delete(p.sessionKey);
   return {sessionKey:p.sessionKey,activity};
  }
  return null;
 }
}
