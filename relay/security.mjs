import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export function signature(body,secret){return createHmac('sha256',secret).update(body).digest('base64');}
export function verifyLine(body,sig,secret){return !!secret&&typeof sig==='string'&&equal(signature(body,secret),sig);}
export function randomToken(){return randomBytes(24).toString('base64url');}
export function allowedSession(key){return typeof key==='string'&&/^agent:(main|codex):(main|discord:(channel|direct):[0-9]+|gonta:[a-f0-9-]{36})$/.test(key);}
export function textContent(message){if(typeof message?.content==='string')return message.content;return(message?.content||[]).filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n');}
