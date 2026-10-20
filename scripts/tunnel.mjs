// Runs on the PC. Quick Tunnel URLs change after restart; keep LINE and the
// local connection sheet in sync. Use a named tunnel for a permanent hostname.
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishEndpoint} from './publish-endpoint.mjs';
const directory=process.env.GONTA_STATE_DIR||path.join(os.homedir(),'.gonta');
const output=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.local');
const port=Number(process.env.PORT||18890);
export function resolveCloudflared(env=process.env){
 if(env.GONTA_CLOUDFLARED)return env.GONTA_CLOUDFLARED;
 const candidates=process.platform==='win32'
  ?[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Microsoft','WinGet','Links','cloudflared.exe'),path.join(env.ProgramFiles||'C:\\Program Files','cloudflared','cloudflared.exe'),path.join(env['ProgramFiles(x86)']||'C:\\Program Files (x86)','cloudflared','cloudflared.exe'),path.join(os.homedir(),'.local','bin','cloudflared.exe')]
  :[path.join(os.homedir(),'.local','bin','cloudflared'),'/usr/local/bin/cloudflared','/usr/bin/cloudflared'];
 for(const c of candidates)if(c&&existsSync(c))return c;
 return 'cloudflared';
}
// Quick Tunnels can default to QUIC without falling back when UDP is blocked.
// Use HTTP/2 explicitly: this PC can reach Cloudflare over TCP, but not QUIC.
const p=spawn(resolveCloudflared(),['tunnel','--no-autoupdate','--protocol','http2','--url',`http://127.0.0.1:${port}`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let buffer='',current='',syncing=false;
function capture(data){process.stdout.write(data);buffer=(buffer+data).slice(-10000);const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match&&!current){current=match[0];writeFileSync(path.join(directory,'tunnel-url.txt'),current,{mode:0o600});void sync();}}
p.stdout.on('data',capture);p.stderr.on('data',capture);
p.on('error',e=>{console.error('cloudflared could not start:',e.message);process.exit(1);});
async function sync(){
 if(!current||syncing)return;syncing=true;
 try{
  const c=JSON.parse(readFileSync(path.join(directory,'config.json')));
  const site=c.siteUrl||current;
  const link=site+'/#'+new URLSearchParams({relay:current,key:c.passcode});
  const sheet=`Gonta 接続情報（秘密・共有しないでください）\n\nWebアプリ: ${site}\n接続先URL: ${current}\nアクセスキー: ${c.passcode}\n\n自動接続リンク: ${link}\nLINE Webhook: ${current}/line/webhook\n\nPCの再起動などで接続先URLが変わる場合は、このファイルの最新情報を使ってください。\n`;
  writeFileSync(path.join(output,'接続情報.txt'),sheet,{mode:0o600});
  writeFileSync(path.join(output,'Gontaを開く.url'),'[InternetShortcut]\r\nURL='+link+'\r\n',{mode:0o600});
  // The relay re-reads allowedOrigins on every connection, so no restart is needed.
  const origins=new Set(c.allowedOrigins);origins.add(current);if(c.siteUrl)origins.add(c.siteUrl);
  if(origins.size!==c.allowedOrigins.length){c.allowedOrigins=[...origins];writeFileSync(path.join(directory,'config.json'),JSON.stringify(c,null,2),{mode:0o600});}
  if(c.line?.token){
   const endpoint=current+'/line/webhook';
   const r=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{headers:{Authorization:'Bearer '+c.line.token},signal:AbortSignal.timeout(10000)});
   if(r.ok){const state=await r.json();if(state.endpoint!==endpoint){const update=await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint',{method:'PUT',headers:{Authorization:'Bearer '+c.line.token,'Content-Type':'application/json'},body:JSON.stringify({endpoint}),signal:AbortSignal.timeout(10000)});console.log('LINE endpoint sync:',update.status);}}
  }
  await publishEndpoint(current);
 }catch(e){console.error('Connection information sync:',e.message);}finally{syncing=false;}
}
const timer=setInterval(sync,30000);
process.on('SIGTERM',()=>{clearInterval(timer);p.kill('SIGTERM');});
process.on('SIGINT',()=>{clearInterval(timer);p.kill('SIGTERM');});
p.on('exit',code=>{clearInterval(timer);process.exit(code||1);});
