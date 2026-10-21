import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {reactions} from '../public/room.js';
import {strips,workers} from '../public/anim/manifest.js';

test('every reaction has a generated strip, its timing rule and a bubble mark',()=>{
 const css=readFileSync('public/anim/sprites.css','utf8');
 assert.deepEqual(Object.keys(reactions).sort(),Object.keys(strips).sort(),'room.js and scripts/sprites.py list the same animations');
 for(const [name,[label,bubble]] of Object.entries(reactions)){
  assert.ok(existsSync(`public/anim/${name}.png`),`${name}.png`);
  const rule=css.split(/\r?\n/).find(line=>line.startsWith(`.pixel-room[data-anim=${name}] .room-sprite::before{`));
  assert.ok(rule,`${name} rule`);
  assert.match(rule,/\{background-image:url\('\/anim\/[a-z0-9]+\.png'\);width:\d+00%;animation:room-anim-[a-z0-9]+ [\d.]+s steps\(1,end\) infinite\}$/,`${name} rule shape`);
  assert.ok(css.includes(`@keyframes room-anim-${name}{0.000%{transform:translateX(0.0000%)}`),`${name} keyframes start on the first cell`);
  assert.ok(label.endsWith('ゴンタ')&&bubble.length>0&&bubble.length<=3,`${name} label and bubble`);
  assert.ok(rule.includes(`width:${strips[name].cells*100}%`)&&rule.includes(`animation:room-anim-${name} ${strips[name].ms/1000}s`),`${name} manifest matches its rule`);
 }
 for(const kind of workers)assert.ok(existsSync(`public/anim/work-${kind}.png`),`work-${kind}.png`);
 assert.ok(css.includes('@keyframes room-work{0%{background-position:0 0}25%{background-position:33.3333% 0}50%'),'work sheets step through four cells');
});
