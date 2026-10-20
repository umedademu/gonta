import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityTracker,activityKind} from '../relay/activity.mjs';
test('Obsidian activity is isolated, redacted, and lasts until every tool finishes',()=>{
 const tracker=new ActivityTracker();
 const event=(phase,id,name,input,runId='run')=>({runId,phase,id,name,input});
 assert.equal(tracker.event(event('start','a','Read',{file_path:'C:\\private\\other.md'})).kind,'pc');
 const result=tracker.event(event('start','b','Read',{file_path:'C:\\Users\\USER\\repo\\my-vault\\secret.md'}));
 assert.deepEqual(result,{kind:'obsidian',runId:'run'});
 assert.equal(JSON.stringify(result).includes('secret'),false);
 tracker.event(event('start','c','PowerShell',{command:'Select-String obsidian confidential'}));
 assert.equal(tracker.event(event('end','a')).kind,'obsidian');
 assert.equal(tracker.event(event('end','b')).kind,'obsidian');
 assert.equal(tracker.event(event('end','c')),null);
 assert.equal(tracker.event(event('end','zzz')),undefined);
 tracker.event(event('start','d','Read',{file_path:'C:\\obsidian\\note.md'}));
 assert.equal(tracker.clear(),null);assert.equal(tracker.get(),null);assert.equal(tracker.clear(),undefined);
});
test('PC inspection classification and a new run replaces the old one',()=>{
 assert.equal(activityKind('PowerShell',{command:'Get-ChildItem .\\public'}),'pc');
 assert.equal(activityKind('Read',{file_path:'C:\\Users\\USER\\Desktop\\W-History\\README.md'}),'pc');
 assert.equal(activityKind('WebSearch',{query:'PC ファイル'}),null);
 assert.equal(activityKind('Skill',{skill:'diary-writer'}),null);
 const tracker=new ActivityTracker();
 tracker.event({runId:'one',phase:'start',id:'a',name:'Bash',input:{command:'ls'}});
 assert.deepEqual(tracker.event({runId:'two',phase:'start',id:'b',name:'Grep',input:{pattern:'x'}}),{kind:'pc',runId:'two'});
 assert.equal(tracker.event({runId:'two',phase:'end',id:'a'}),undefined);
 assert.equal(tracker.event({runId:'two',phase:'end',id:'b'}),null);
});
