import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {MemoState, memoToken} from '../public/memo-state.js';
import worker, {tokenHash} from '../worker/memo.mjs';

const remote = (content,version=1) => ({content,version});
test('offline drafts survive refresh and never replace a changed remote memo silently', () => {
  const state = new MemoState({content:'下書き',base:'元の文',version:2});
  state.accept(remote('別の端末で更新',3));
  assert.equal(state.content,'下書き');
  assert.equal(state.conflict.content,'別の端末で更新');
  state.resolve(true);
  assert.equal(state.content,'下書き');
  assert.equal(state.version,3);
  assert.equal(state.dirty,true);
  const restored = new MemoState(state.snapshot());
  assert.equal(restored.content,'下書き');
  restored.accept(remote('さらに更新',4));
  restored.resolve(false);
  assert.equal(restored.content,'さらに更新');
  assert.equal(restored.dirty,false);
});
test('a save response preserves typing that happened during the request', () => {
  const state = new MemoState();
  state.accept(remote('初期',0));
  state.content = '送信した文';
  const sent = state.content;
  state.content += '＋入力中の続き';
  state.acknowledge(remote(sent,1),sent);
  assert.equal(state.content,'送信した文＋入力中の続き');
  assert.equal(state.dirty,true);
  assert.equal(state.version,1);
});
test('reconnect recognizes a saved memo after the response was lost, including empty text', () => {
  const state = new MemoState({content:'',base:'消す前',version:1});
  state.accept(remote('',2));
  assert.equal(state.conflict,null);
  assert.equal(state.dirty,false);
  assert.equal(state.version,2);
});
test('unchanged server content permits syncing an offline draft; a clean tab follows remote edits', () => {
  const state = new MemoState({content:'追記',base:'元の文',version:1});
  state.accept(remote('元の文',2));
  assert.equal(state.conflict,null);
  assert.equal(state.content,'追記');
  assert.equal(state.version,2);
  state.acknowledge(remote('追記',3),'追記');
  state.accept(remote('他の画面の更新',4));
  assert.equal(state.content,'他の画面の更新');
});

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/migrations/0001_memo.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../worker/migrations/0002_memo_tabs.sql',import.meta.url),'utf8'));
  t.after(() => db.close());
  const token = await memoToken('test-only-passcode-with-more-than-24-characters');
  const env = {MEMO_TOKEN_HASH:await tokenHash(token),DB:{prepare(sql){
    let params=[];
    return {bind(...values){params=values;return this;},async first(){return db.prepare(sql).get(...params) || null;}};
  }}};
  return {env,token,send(method='GET',body,headers={},query='') {
    return worker.fetch(new Request('https://example.com/api/memo'+query,{
      method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},
      ...(body !== undefined ? {body:typeof body==='string' ? body : JSON.stringify(body)} : {})
    }),env);
  }};
}
test('memo API authenticates all reads/writes, rejects other origins, and fails closed without configuration',async t => {
  const f = await fixture(t);
  assert.equal((await f.send('GET',undefined,{Authorization:''})).status,401);
  assert.equal((await f.send('PUT',{content:'attack',version:0},{Authorization:'Bearer '+'a'.repeat(64)})).status,401);
  assert.equal((await f.send('GET',undefined,{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await worker.fetch(new Request('https://example.com/api/memo'),{})).status,503);
  const r = await f.send();
  assert.equal(r.status,200);
  assert.equal(r.headers.get('Cache-Control'),'no-store, private');
  assert.equal((await r.json()).content,'');
});
test('D1 compare-and-swap saves Japanese, line breaks, and empty notes while rejecting stale writes',async t => {
  const f = await fixture(t);
  const text = 'ゴンタのメモ\n日本語と絵文字🐶\n';
  const saved = await f.send('PUT',{content:text,version:0});
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).content,text);
  const stale = await f.send('PUT',{content:'古い画面から上書き',version:0});
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).content,text);
  assert.equal((await (await f.send()).json()).content,text);
  assert.equal((await f.send('PUT',{content:'',version:1})).status,200);
  assert.equal((await (await f.send()).json()).content,'');
});
test('memo API validates request shape and bounded body; preflight does not expose data',async t => {
  const f = await fixture(t);
  for (const body of [{content:2,version:0},{content:'x',version:-1},{content:'x',version:0.5},{content:'x'.repeat(100001),version:0}]) {
    assert.equal((await f.send('PUT',body)).status,400);
  }
  assert.equal((await f.send('PUT','{broken')).status,400);
  assert.equal((await f.send('PUT','x'.repeat(650001))).status,413);
  assert.equal((await f.send('PUT','{}',{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.send('DELETE')).status,405);
  const preflight = await f.send('OPTIONS',undefined,{Origin:'https://gonta-sand.vercel.app',Authorization:''});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://gonta-sand.vercel.app');
  assert.equal(await preflight.text(),'');
});

test('tab migration preserves the original content, version, and timestamp',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(readFileSync(new URL('../worker/migrations/0001_memo.sql',import.meta.url),'utf8'));
 const text='以前から使っているメモ\n日本語🐶';
 db.prepare('UPDATE memo SET content=?,version=7,updated_at=? WHERE id=1').run(text,'2026-09-26T00:00:00Z');
 db.exec(readFileSync(new URL('../worker/migrations/0002_memo_tabs.sql',import.meta.url),'utf8'));
 const rows=db.prepare('SELECT * FROM memo ORDER BY id').all();
 assert.equal(rows.length,5);assert.equal(rows[0].content,text);assert.equal(rows[0].version,7);
 assert.equal(rows[0].updated_at,'2026-09-26T00:00:00Z');
 for(const row of rows.slice(1)){assert.equal(row.content,'');assert.equal(row.version,0);}
 assert.throws(()=>db.prepare('INSERT INTO memo(id,updated_at) VALUES(6,?)').run('now'));
});

test('five memos use independent versions and the legacy endpoint still reads tab 1',async t=>{
 const f=await fixture(t);
 for(let id=1;id<=5;id++){
  const result=await f.send('PUT',{content:`メモ${id}\n本文`,version:0},{},`?id=${id}`);
  assert.equal(result.status,200);assert.equal((await result.json()).version,1);
 }
 for(let id=1;id<=5;id++)assert.equal((await (await f.send('GET',undefined,{},`?id=${id}`)).json()).content,`メモ${id}\n本文`);
 assert.equal((await (await f.send()).json()).content,'メモ1\n本文');
 const stale=await f.send('PUT',{content:'誤った上書き',version:0},{},'?id=4');
 assert.equal(stale.status,409);assert.equal((await stale.json()).content,'メモ4\n本文');
 assert.equal((await f.send('PUT',{content:'',version:1},{},'?id=5')).status,200);
 assert.equal((await (await f.send('GET',undefined,{},'?id=5')).json()).content,'');
 assert.equal((await (await f.send('GET',undefined,{},'?id=4')).json()).content,'メモ4\n本文');
});

test('memo ids are bounded to five slots and every slot requires authentication',async t=>{
 const f=await fixture(t);
 for(const query of ['?id=0','?id=6','?id=-1','?id=1.5','?id=01','?id=abc','?id=','?id=1&id=2']){
  assert.equal((await f.send('GET',undefined,{},query)).status,400,query);
  assert.equal((await f.send('PUT',{content:'x',version:0},{},query)).status,400,query);
 }
 for(let id=1;id<=5;id++){
  assert.equal((await f.send('GET',undefined,{Authorization:''},`?id=${id}`)).status,401);
  assert.equal((await f.send('PUT',{content:'x',version:0},{Authorization:''},`?id=${id}`)).status,401);
 }
});
