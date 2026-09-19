import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEmotion} from '../public/room.js';

test('reply tone selects the seven expressions, with a calm fallback',()=>{
 const examples={
  joy:['合格おめでとう！ よく頑張ったね。','完成して嬉しいよ！'],
  anger:['それは理不尽だね。納得いかないね。','それは本当にひどいよ。'],
  sadness:['会えなくなるのは寂しいね。','それは残念だったね。'],
  relaxed:['おやすみ。今日はゆっくり休んでね。','のんびり過ごそう。'],
  empathy:['つらかったね。話してくれてありがとう。','その気持ちはわかるよ。'],
  encouragement:['きっと大丈夫。焦らなくていいよ。','一歩ずつ進んでいこう。'],
  cheering:['応援してるよ！ ファイト！','頑張れ！ いけるぞ！'],
  neutral:['ファイルを3件確認しました。','こんにちは。今日は何をしようか？','怒りについて調べます。','嬉しくないですね。','大丈夫とは言えない状況です。','嬉しいとは思わない。'],
 };
 for(const [emotion,replies] of Object.entries(examples))for(const reply of replies)assert.equal(classifyEmotion(reply),emotion,reply);
 assert.equal(classifyEmotion(), 'neutral');
 assert.equal(classifyEmotion('つらかったね。これからも応援してるし、話せて嬉しいよ。'),'empathy','comfort takes precedence over generic encouragement');
});

test('code and quoted source material do not become Gonta’s emotions',()=>{
 for(const reply of [
  '```js\nconsole.log("おめでとう！");\n```\nコードを確認しました。',
  '~~~\n応援しています\n~~~',
  '```text\nつらかったね。',
  '> 悲しいね。\n> 応援してるよ。\n記録を確認しました。',
  '日記には「おめでとう」とありました。',
  '設定値は `嬉しい` です。',
 ])assert.equal(classifyEmotion(reply),'neutral',reply);
 assert.equal(classifyEmotion('> 悲しいね。\n\nきっと大丈夫。一歩ずつ進もう。'),'encouragement','Gonta’s own reply still counts');
});
