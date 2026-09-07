import test from 'node:test';
import assert from 'node:assert/strict';
import {DiaryMonitor,diaryActivity,isDiaryUpdate} from '../relay/diary.mjs';

const job=(id,running=true)=>({id,name:'日記更新（4時間おき）',payload:{message:'非公開の指示'},state:running?{runningAtMs:Date.now()}:{lastRunStatus:'ok'}});
test('diary activity represents running writers only and never exposes cron content',()=>{
 assert.deepEqual(diaryActivity([job('a')]),{kind:'diary'});
 assert.equal(diaryActivity([job('a',false)]),null);
 assert.equal(diaryActivity([{...job('a'),name:'日記を検索'}]),null);
 assert.equal(diaryActivity([{...job('a'),name:'workspace-auto-push'}]),null);
 assert.ok(isDiaryUpdate({name:'daily',payload:{message:'Append today’s daily note'}}));
 assert.deepEqual(diaryActivity([job('a',false),job('b')]),{kind:'diary'},'overlapping job still running');
 assert.equal(diaryActivity([{...job('a'),state:{runningAtMs:null,nextRunAtMs:Date.now()}}]),null);
});
test('monitor restores running status on connect, paginates, and clears on finish or failed read',async()=>{
 let changes=0,running=true,failed=false;
 const monitor=new DiaryMonitor(async(method,p)=>{
  assert.equal(method,'cron.list');if(failed)throw Error('offline');
  return p.offset===0?{jobs:[],hasMore:true,nextOffset:200}:{jobs:[job('secret',running)],hasMore:false};
 },()=>changes++);
 monitor.active=true;await monitor.refresh();assert.deepEqual(monitor.activity,{kind:'diary'});
 await monitor.refresh();assert.equal(changes,1,'unchanged poll does not broadcast');
 running=false;await monitor.refresh();assert.equal(monitor.activity,null);
 running=true;await monitor.refresh();failed=true;await monitor.refresh();assert.equal(monitor.activity,null);
 monitor.stop();
});
test('stale in-flight snapshot cannot restore activity after disconnect',async()=>{
 let resolve;const monitor=new DiaryMonitor(()=>new Promise(r=>resolve=r),()=>{});
 monitor.active=true;const pending=monitor.refresh();monitor.stop();resolve({jobs:[job('a')]});await pending;
 assert.equal(monitor.activity,null);
});
