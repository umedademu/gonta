// Talks to the relay's local-only entrance from this PC (never through the tunnel).
//   node scripts/local.mjs status
//   node scripts/local.mjs diary [YYYY-MM-DD]   nightly diary (default: yesterday)
//   node scripts/local.mjs say <text>           one message as if typed on the PC
//   node scripts/local.mjs restart              restart the brain so a new login/token is read
import {readFileSync,appendFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory=process.env.GONTA_STATE_DIR||path.join(os.homedir(),'.gonta');
const port=Number(process.env.GONTA_LOCAL_PORT||Number(process.env.PORT||18890)+1);
const token=readFileSync(path.join(directory,'local-token'),'utf8').trim();
const [command,...rest]=process.argv.slice(2);
const logDirectory=process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'Gonta'):directory;
function log(line){try{mkdirSync(logDirectory,{recursive:true});appendFileSync(path.join(logDirectory,'diary.log'),`${new Date().toISOString()} ${line}\n`);}catch{}}
async function call(method,pathname,body){
 const r=await fetch(`http://127.0.0.1:${port}${pathname}`,{method,headers:{'x-gonta-token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}
 if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);
 return data;
}
try{
 if(command==='status')console.log(JSON.stringify(await call('GET','/status'),null,2));
 else if(command==='diary'){
  const body={};if(rest[0])body.date=rest[0];
  log(`diary start ${body.date||'(yesterday)'}`);
  const r=await call('POST','/diary',body);
  log(`diary ${r.ok?'ok':'failed'} ${r.date} ${(r.error||'')} ${(r.text||'').replace(/\s+/g,' ').slice(0,500)}`);
  console.log(JSON.stringify(r,null,2));if(!r.ok)process.exitCode=1;
 }
 else if(command==='restart'){const r=await call('POST','/restart',{});console.log(r.when==='now'?'ゴンタの頭脳を再起動しました。':'いまの返答が終わったら再起動します。');}
 else if(command==='say'){const r=await call('POST','/say',{text:rest.join(' ')});console.log(r.text||r.error);if(!r.ok)process.exitCode=1;}
 else{console.error('usage: node scripts/local.mjs status | diary [YYYY-MM-DD] | say <text> | restart');process.exitCode=2;}
}catch(e){log(`${command} error ${e.message}`);console.error(e.message);process.exitCode=1;}
