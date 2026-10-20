import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Discord,INTENTS,addressed,allowedChannel,chunks,cleanContent} from '../relay/discord.mjs';

const bot='1472810297415700672';
test('guild messages need a mention or a reply to the bot; direct messages do not',()=>{
 assert.equal(addressed({guild_id:'g',content:'hi',mentions:[]},bot),false);
 assert.equal(addressed({guild_id:'g',content:'<@1472810297415700672> メモ',mentions:[{id:bot}]},bot),true);
 assert.equal(addressed({guild_id:'g',referenced_message:{author:{id:bot}}},bot),true);
 assert.equal(addressed({content:'dm'},bot),true);
 assert.equal(addressed({guild_id:'g',mentions:[]},bot,{requireMention:false}),true);
 assert.equal(cleanContent('<@1472810297415700672> メモ\n',bot),'メモ');
});
test('channel policy mirrors the OpenClaw configuration: one guild, one denied channel, DMs allowed',()=>{
 const policy={guilds:{'1472809915801403503':{deny:['1472851499708190942']}}};
 assert.equal(allowedChannel({guild_id:'1472809915801403503',channel_id:'1472809918645010535'},policy),true);
 assert.equal(allowedChannel({guild_id:'1472809915801403503',channel_id:'1472851499708190942'},policy),false);
 assert.equal(allowedChannel({guild_id:'other',channel_id:'1'},policy),false);
 assert.equal(allowedChannel({channel_id:'dm'},policy),true);
 assert.equal(allowedChannel({channel_id:'dm'},{dm:false}),false);
 assert.deepEqual(chunks('a'.repeat(4000)).map(c=>c.length),[1900,1900,200]);
 assert.deepEqual(chunks(''),['（返答が空でした）']);
});
test('gateway flow: hello → identify, ready, message dispatch, heartbeat ack, resume after close',async()=>{
 const sockets=[];
 class FakeSocket extends EventEmitter{constructor(url){super();this.url=url;this.sent=[];sockets.push(this);}send(s){this.sent.push(JSON.parse(s));}close(code){this.emit('close',code,'');}terminate(){this.emit('close',1006,'');}}
 const d=new Discord({token:'t',log:{log(){},error(){}},WebSocketImpl:FakeSocket});
 const messages=[];d.on('message',m=>messages.push(m));
 d.connect();const s=sockets[0];
 assert.match(s.url,/^wss:\/\/gateway\.discord\.gg\/\?v=10/);
 s.emit('message',JSON.stringify({op:10,d:{heartbeat_interval:45000}}));
 assert.equal(s.sent[0].op,2);assert.equal(s.sent[0].d.intents,INTENTS);assert.equal(s.sent[0].d.token,'t');
 s.emit('message',JSON.stringify({op:0,t:'READY',s:1,d:{session_id:'sess',resume_gateway_url:'wss://resume.example',user:{id:bot,username:'gonta'}}}));
 assert.equal(d.ready,true);assert.equal(d.user.id,bot);
 s.emit('message',JSON.stringify({op:0,t:'MESSAGE_CREATE',s:2,d:{id:'m1',content:'hi',channel_id:'c'}}));
 assert.equal(messages.length,1);
 s.emit('message',JSON.stringify({op:11}));assert.equal(d.acked,true);
 d.backoff=1;s.close(1001);
 assert.equal(d.ready,false);
 await new Promise(r=>setTimeout(r,10));
 const s2=sockets[1];assert.match(s2.url,/^wss:\/\/resume\.example/);
 s2.emit('message',JSON.stringify({op:10,d:{heartbeat_interval:45000}}));
 assert.deepEqual(s2.sent[0],{op:6,d:{token:'t',session_id:'sess',seq:2}});
 d.stop();
});
