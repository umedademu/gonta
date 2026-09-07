// Only a coarse activity flag leaves the PC; cron prompts and job names stay here.
export function isDiaryUpdate(job){
 const text=[job.name,job.description,job.payload?.message,job.payload?.text].filter(x=>typeof x==='string').join('\n');
 return /日記|diary|daily[ _-]?notes?|journal/i.test(text)&&/更新|追記|記入|執筆|作成|書[くきい]|update|append|writ|creat/i.test(text);
}
export function diaryActivity(jobs){
 return jobs.some(j=>isDiaryUpdate(j)&&Number.isFinite(j.state?.runningAtMs)&&j.state.runningAtMs>0)?{kind:'diary'}:null;
}
export class DiaryMonitor{
 constructor(request,changed){this.request=request;this.changed=changed;this.activity=null;this.generation=0;this.active=false;}
 publish(value){if(this.activity?.kind===value?.kind)return;this.activity=value;this.changed();}
 start(){this.stop();this.active=true;void this.refresh();this.timer=setInterval(()=>void this.refresh(),15000);this.timer.unref?.();}
 stop(){this.active=false;this.generation++;clearInterval(this.timer);this.publish(null);}
 async refresh(){
  if(!this.active)return;
  if(this.busy){this.again=true;return;}
  this.busy=true;const generation=this.generation;
  try{
   const jobs=[];let offset=0;
   do{
    const page=await this.request('cron.list',{includeDisabled:true,limit:200,offset});
    if(!this.active||generation!==this.generation)return;
    if(!Array.isArray(page.jobs))throw Error('Invalid cron snapshot');
    jobs.push(...page.jobs);
    if(!page.hasMore)break;
    if(!Number.isInteger(page.nextOffset)||page.nextOffset<=offset)throw Error('Invalid cron pagination');
    offset=page.nextOffset;
   }while(true);
   this.publish(diaryActivity(jobs));
  }catch{if(this.active&&generation===this.generation)this.publish(null);}
  finally{this.busy=false;if(this.again){this.again=false;void this.refresh();}}
 }
}
