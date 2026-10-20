import test from 'node:test';
import assert from 'node:assert/strict';
import {diaryDate,diaryInstruction,jstParts,messageLabel} from '../relay/diary.mjs';
test('the nightly run targets the diary day that ended at 04:00 JST, even when late',()=>{
 assert.equal(diaryDate(new Date('2026-10-20T18:00:00Z')),'2026-10-20'); // 03:00 JST on the 21st
 assert.equal(diaryDate(new Date('2026-10-21T01:00:00Z')),'2026-10-20'); // woke late, 10:00 JST
 assert.equal(diaryDate(new Date('2026-10-20T14:59:00Z')),'2026-10-19'); // 23:59 JST on the 20th
});
test('instructions carry the target date and time, and reject bad dates',()=>{
 const text=diaryInstruction('2026-10-20',new Date('2026-10-20T18:05:00Z'));
 assert.match(text,/^\[日記の定時実行 2026-10-21 03:05\]/);
 assert.match(text,/対象日: 2026-10-20/);
 assert.match(text,/DIARY_TASK\.md/);
 assert.throws(()=>diaryInstruction('20261020'));
 assert.deepEqual(jstParts(new Date('2026-12-31T15:00:00Z')),{date:'2027-01-01',time:'00:00'});
});
test('message labels name the source and the JST time without leaking anything else',()=>{
 assert.equal(messageLabel('line',new Date('2026-10-20T12:30:00Z')),'[LINE 2026-10-20 21:30]');
 assert.equal(messageLabel('web',new Date('2026-10-20T12:30:00Z')),'[Web 2026-10-20 21:30]');
 assert.equal(messageLabel('local',new Date('2026-10-20T12:30:00Z')),'[PC 2026-10-20 21:30]');
});
