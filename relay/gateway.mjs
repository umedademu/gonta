import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync, sign, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export class Gateway extends EventEmitter {
  constructor({url, token, directory}) {
    super(); this.url=url; this.token=token; this.pending=new Map(); this.ready=false;
    const file=directory+'/device.json';
    if (existsSync(file)) this.identity=JSON.parse(readFileSync(file,'utf8'));
    else {
      const keys=generateKeyPairSync('ed25519');
      const raw=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32);
      this.identity={id:createHash('sha256').update(raw).digest('hex'),publicKey:raw.toString('base64url'),privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'})};
      writeFileSync(file,JSON.stringify(this.identity),{mode:0o600});
    }
  }
  connect() {
    this.stopped=false;
    const ws=this.ws=new WebSocket(this.url,{maxPayload:26*1024*1024});
    const timer=setTimeout(()=>ws.terminate(),15000);
    ws.on('error',()=>{});
    ws.on('message',async data=>{
      let frame; try {frame=JSON.parse(data);} catch{return;}
      if(frame.event==='connect.challenge') {
        const {nonce,ts}=frame.payload;
        if(!Number.isSafeInteger(ts)||ts<0||typeof nonce!=='string'){ws.terminate();return;}
        const scopes=['operator.read','operator.write'];
        const proof=['v3',this.identity.id,'cli','cli','operator',scopes.join(','),String(ts),this.token,nonce,'linux',''].join('|');
        try {
          const hello=await this.request('connect',{minProtocol:4,maxProtocol:4,client:{id:'cli',displayName:'Gonta Bridge',version:'1.0.0',platform:'linux',mode:'cli'},role:'operator',scopes,caps:["tool-events"],auth:{token:this.token},device:{id:this.identity.id,publicKey:this.identity.publicKey,signature:sign(null,Buffer.from(proof),this.identity.privateKey).toString('base64url'),signedAt:ts,nonce}},true);
          clearTimeout(timer);this.ready=true;this.version=hello.server.version;this.emit('ready');
        } catch(e) {this.emit('diagnostic',e.message);ws.close();}
      } else if(frame.type==='res') {
        const p=this.pending.get(frame.id);if(!p)return;
        this.pending.delete(frame.id);clearTimeout(p.timer);
        if(frame.ok)p.resolve(frame.payload);else p.reject(Object.assign(new Error(frame.error?.message||'Gateway error'),{code:frame.error?.code,details:frame.error?.details}));
      } else if(frame.type==='event')this.emit('event',frame);
    });
    ws.on('close',()=>{
      clearTimeout(timer);this.ready=false;
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('OpenClawとの接続が切れました。履歴を確認してから再送してください。'));}
      this.pending.clear();this.emit('offline');
      if(!this.stopped)this.reconnect=setTimeout(()=>this.connect(),5000);
    });
  }
  request(method,params={},bootstrap=false) {
    if((!this.ready&&!bootstrap)||this.ws?.readyState!==WebSocket.OPEN)return Promise.reject(new Error('OpenClawに接続できません。PCの起動状態を確認してください。'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('応答の確認がタイムアウトしました。履歴を確認してください。'));},30000);
      this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({type:'req',id,method,params}));
    });
  }
  stop(){this.stopped=true;clearTimeout(this.reconnect);this.ws?.close();}
}

