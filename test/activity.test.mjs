import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityTracker} from '../relay/activity.mjs';
test('Obsidian activity is isolated, redacted, and lasts until every tool finishes',()=>{
 const tracker=new ActivityTracker(),sessionKey='agent:main:discord:channel:123';
 const event=(phase,id,args,session=sessionKey)=>({event:'agent',payload:{sessionKey:session,runId:'run',stream:'tool',data:{phase,toolCallId:id,name:'read',args}}});
 assert.equal(tracker.event(event('start','a',{path:'/private/other.md'})),null);
 assert.equal(tracker.event(event('start','x',{path:'/obsidian/secret.md'},'agent:main:cron:secret')),null);
 const result=tracker.event(event('start','a',{path:'/private/obsidian/secret.md'}));
 assert.deepEqual(result,{sessionKey,activity:{kind:'obsidian',runId:'run'}});
 assert.equal(JSON.stringify(result).includes('secret'),false);
 tracker.event(event('start','b',{command:'obsidian search confidential'}));
 tracker.event(event('result','a'));assert.ok(tracker.get(sessionKey));
 assert.deepEqual(tracker.event(event('result','b')),{sessionKey,activity:null});
 tracker.event(event('start','c',{path:'/obsidian/note.md'}));
 tracker.event({event:'chat',payload:{sessionKey,runId:'run',state:'aborted'}});assert.equal(tracker.get(sessionKey),null);
});
