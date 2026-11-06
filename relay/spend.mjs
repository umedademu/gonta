// What Gonta spends of the Claude API credit that comes with the user's plan ($200 a month,
// shared by all of the user's bots, gone at the end of the month). Every API turn adds rows to
// the ledger the bots share, and Gonta's monthly share is checked against the same ledger.
// The other bots write to it too, so rows are only ever appended, under the same lock file.
import {closeSync,existsSync,mkdirSync,openSync,readFileSync,readSync,statSync,unlinkSync,appendFileSync} from 'node:fs';
import path from 'node:path';

export const SPEND_FILE='C:\\Users\\USER\\Desktop\\bot-office\\.local\\APIクレジット\\使った額.csv';
export const HEADER=['日時','部門','使い道','モデル','入力','出力','キャッシュ読み','キャッシュ書き','ドル'];
export const DEPARTMENT='gonta';
const JST=9*3600000;
export const jstTime=(ms=Date.now())=>new Date(ms+JST).toISOString().replace('T',' ').slice(0,19);
export const jstMonth=(ms=Date.now())=>jstTime(ms).slice(0,7);

export function parseCsvLine(line){
 const out=[];let field='',quoted=false;
 for(let i=0;i<line.length;i++){
  const c=line[i];
  if(quoted){if(c!=='"')field+=c;else if(line[i+1]==='"'){field+='"';i++;}else quoted=false;}
  else if(c==='"')quoted=true;
  else if(c===','){out.push(field);field='';}
  else field+=c;
 }
 out.push(field);return out;
}
const csvField=v=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};

// Gonta's dollars in the ledger for the month (Japan time) that `ms` falls in.
export function monthSpend(file=SPEND_FILE,ms=Date.now()){
 if(!existsSync(file))return 0;
 const month=jstMonth(ms);let total=0;
 for(const line of readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).slice(1)){
  const row=parseCsvLine(line);
  if(row[1]===DEPARTMENT&&row[0].startsWith(month)){const usd=Number(row[8]);if(Number.isFinite(usd))total+=usd;}
 }
 return total;
}

// Appends rows, creating the file with its header when needed. The other bots take the lock by
// creating "使った額.csv.lock" exclusively; a lock older than 30 seconds is left over from a crash.
export async function appendRows(rows,file=SPEND_FILE,{wait=5000,stale=30000}={}){
 mkdirSync(path.dirname(file),{recursive:true});
 const lock=file+'.lock',deadline=Date.now()+wait;let fd;
 for(;;){
  try{fd=openSync(lock,'wx');break;}
  catch(e){
   if(!['EEXIST','EPERM','EACCES'].includes(e.code))throw e;
   try{if(Date.now()-statSync(lock).mtimeMs>stale){unlinkSync(lock);continue;}}catch{}
   if(Date.now()>deadline)throw new Error(`the ledger lock ${path.basename(lock)} stayed for ${wait/1000} seconds`);
   await new Promise(r=>setTimeout(r,50));
  }
 }
 try{
  const size=existsSync(file)?statSync(file).size:0;let text='';
  if(!size)text=HEADER.join(',')+'\n';
  else{const last=Buffer.alloc(1),h=openSync(file,'r');try{readSync(h,last,0,1,size-1);}finally{closeSync(h);}if(last[0]!==10)text='\n';}
  for(const r of rows)text+=r.map(csvField).join(',')+'\n';
  if(text)appendFileSync(file,text,'utf8');
 }finally{closeSync(fd);try{unlinkSync(lock);}catch{}}
}

// Claude Code reports running totals per model, and a resumed conversation carries its earlier
// totals over, so one turn's use is how much the totals grew since the last report. The totals
// are never taken to go down: a crashed process can report zeros, and starting again from those
// would count earlier turns twice.
const FIELDS=['inputTokens','outputTokens','cacheReadInputTokens','cacheCreationInputTokens','costUSD'];
export function usageGrowth(before={},after={}){
 const totals={...before},rows=[];
 for(const [model,usage] of Object.entries(after||{})){
  const was=before[model]||{},now={},grew={};
  for(const k of FIELDS){const a=Number(was[k])||0,b=Number(usage?.[k])||0;now[k]=Math.max(a,b);grew[k]=Math.max(0,b-a);}
  totals[model]=now;
  if(FIELDS.some(k=>grew[k]>0))rows.push({model,input:grew.inputTokens,output:grew.outputTokens,cacheRead:grew.cacheReadInputTokens,cacheWrite:grew.cacheCreationInputTokens,usd:grew.costUSD});
 }
 return {rows,totals};
}

export class SpendLedger{
 constructor({file=SPEND_FILE,log=console}={}){this.file=file;this.log=log;this.unwritten=[];this.writing=null;}
 // Rows that could not be written yet still count, so a locked or missing file never lifts the limit.
 month(ms=Date.now()){
  let total=0;
  try{total=monthSpend(this.file,ms);}catch(e){this.log.error('API spend ledger could not be read:',e.message);}
  const month=jstMonth(ms);
  for(const r of this.unwritten)if(r[0].startsWith(month))total+=Number(r[8]);
  return total;
 }
 add(entries,ms=Date.now()){
  for(const e of entries)this.unwritten.push([jstTime(ms),DEPARTMENT,e.purpose,e.model,e.input,e.output,e.cacheRead,e.cacheWrite,e.usd.toFixed(6)]);
  return this.flush();
 }
 flush(){
  if(this.writing)return this.writing;
  const rows=this.unwritten.slice();if(!rows.length)return Promise.resolve();
  return this.writing=appendRows(rows,this.file).then(
   ()=>{this.unwritten.splice(0,rows.length);this.writing=null;if(this.unwritten.length)return this.flush();},
   e=>{this.writing=null;this.log.error('API spend ledger could not be written (kept for the next turn):',e.message);});
 }
}
