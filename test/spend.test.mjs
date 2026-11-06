import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,unlinkSync,utimesSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SpendLedger,appendRows,jstMonth,jstTime,monthSpend,parseCsvLine,usageGrowth} from '../relay/spend.mjs';

const file=()=>path.join(mkdtempSync(path.join(os.tmpdir(),'gonta-spend-test-')),'APIクレジット','使った額.csv');

test('times are Japan time and the month is the Japanese calendar month',()=>{
 const utc=Date.UTC(2026,10,30,16,30,0);// 2026-12-01 01:30 in Japan
 assert.equal(jstTime(utc),'2026-12-01 01:30:00');assert.equal(jstMonth(utc),'2026-12');
});

test('rows are appended under the shared lock, with the header on a new file, quoting, and a line break if one is missing',async()=>{
 const csv=file();
 await appendRows([['2026-11-06 22:00:00','gonta','Webの会話','claude-sonnet-5-5',1,2,3,4,'0.100000']],csv);
 writeFileSync(csv,readFileSync(csv,'utf8')+'2026-11-06 22:01:00,経済指標,"判断表, 3回",claude-opus-5-5,1,1,1,1,2.5');// another bot left no line break
 await appendRows([['2026-11-06 22:02:00','gonta','日記','claude-sonnet-5-5',1,2,3,4,'0.200000']],csv);
 const lines=readFileSync(csv,'utf8').trim().split('\n');
 assert.equal(lines[0],'日時,部門,使い道,モデル,入力,出力,キャッシュ読み,キャッシュ書き,ドル');
 assert.equal(lines.length,4);assert.deepEqual(parseCsvLine(lines[2]).slice(1,3),['経済指標','判断表, 3回']);
 assert.equal(monthSpend(csv,Date.UTC(2026,10,6,13)),0.30000000000000004);
 assert.equal(existsSync(csv+'.lock'),false,'the lock is released');
});

test('a lock held by another bot is waited for, and one left by a crash is taken over',async()=>{
 const csv=file();await appendRows([],csv);
 writeFileSync(csv+'.lock','');
 await assert.rejects(appendRows([['t','gonta','x','m',0,0,0,0,'0']],csv,{wait:120}),/stayed/);
 const old=(Date.now()-60000)/1000;utimesSync(csv+'.lock',old,old);
 await appendRows([['t','gonta','x','m',0,0,0,0,'0']],csv,{wait:120});
 assert.equal(readFileSync(csv,'utf8').trim().split('\n').length,2);
});

test('rows waiting for the lock already count toward the month, and count once when written',async()=>{
 const csv=file();await appendRows([],csv);
 const errors=[];const ledger=new SpendLedger({file:csv,log:{log(){},error:(...a)=>errors.push(a.join(' '))}});
 writeFileSync(csv+'.lock','');// another bot is writing
 const pending=ledger.add([{purpose:'Webの会話',model:'claude-sonnet-5-5',input:1,output:1,cacheRead:0,cacheWrite:0,usd:1.25}]);
 assert.equal(ledger.month(),1.25,'counted before it is written');
 await new Promise(r=>setTimeout(r,100));
 unlinkSync(csv+'.lock');
 await pending;
 assert.equal(ledger.unwritten.length,0);assert.equal(ledger.month(),1.25,'counted once after it is written');
 assert.deepEqual(errors,[]);
});

test('usage growth: only what grew is counted, a new model counts whole, and zeros never restart the count',()=>{
 const u=(i,o,r,w,c)=>({inputTokens:i,outputTokens:o,cacheReadInputTokens:r,cacheCreationInputTokens:w,costUSD:c});
 const first=usageGrowth({},{a:u(1,2,3,4,0.5)});
 assert.deepEqual(first.rows,[{model:'a',input:1,output:2,cacheRead:3,cacheWrite:4,usd:0.5}]);
 const second=usageGrowth(first.totals,{a:u(2,2,3,4,0.75),b:u(5,0,0,0,0.01)});
 assert.deepEqual(second.rows,[{model:'a',input:1,output:0,cacheRead:0,cacheWrite:0,usd:0.25},{model:'b',input:5,output:0,cacheRead:0,cacheWrite:0,usd:0.01}]);
 const zeroed=usageGrowth(second.totals,{a:u(0,0,0,0,0)});
 assert.deepEqual(zeroed.rows,[]);
 assert.deepEqual(usageGrowth(zeroed.totals,{a:u(3,2,3,4,1)}).rows,[{model:'a',input:1,output:0,cacheRead:0,cacheWrite:0,usd:0.25}]);
});
