// Only a small activity label leaves the PC; tool arguments and note contents do not.
export function activityKind(name,input){
 const text=JSON.stringify({name,input}).slice(0,40000);
 if(/obsidian|オブシディアン|my-vault/i.test(text))return 'obsidian';
 const tool=String(name||'');
 if(/^(WebFetch|WebSearch|Skill)$/i.test(tool))return null;
 if(/^(Read|Glob|Grep|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$/i.test(tool))return 'pc';
 return null;
}

// Tracks the resident brain's tool calls for the single conversation.
export class ActivityTracker{
 constructor(){this.calls=new Map();this.runId=null;}
 get(){if(!this.calls.size)return null;return{kind:[...this.calls.values()].includes('obsidian')?'obsidian':'pc',runId:this.runId};}
 event(e){
  if(e.phase==='start'){
   const kind=activityKind(e.name,e.input);if(!kind)return undefined;
   if(this.runId!==e.runId){this.calls.clear();this.runId=e.runId;}
   this.calls.set(e.id,kind);return this.get();
  }
  if(e.phase==='end'){if(!this.calls.delete(e.id))return undefined;const activity=this.get();if(!activity)this.runId=null;return activity;}
  return undefined;
 }
 clear(){const had=this.calls.size>0||this.runId!==null;this.calls.clear();this.runId=null;return had?null:undefined;}
}
