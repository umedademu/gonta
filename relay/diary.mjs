// The nightly diary is one hidden conversation turn: the resident brain reads
// DIARY_TASK.md in its own folder and follows it. Only the date and the time of
// the trigger are decided here, so the instructions stay editable as a file.
const JST=9*60;
export function jstParts(date=new Date()){
 const shifted=new Date(date.getTime()+JST*60000);
 const pad=n=>String(n).padStart(2,'0');
 return{date:`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth()+1)}-${pad(shifted.getUTCDate())}`,time:`${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`};
}
// The nightly run closes the diary day that ended at 04:00 of the current calendar
// date, so the default target is yesterday even when the task starts late.
export function diaryDate(now=new Date()){return jstParts(new Date(now.getTime()-86400000)).date;}
export function diaryInstruction(date,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日付は YYYY-MM-DD の形式で指定してください。');
 const stamp=jstParts(now);
 return `[日記の定時実行 ${stamp.date} ${stamp.time}]\n対象日: ${date}\nDIARY_TASK.md を読み、その手順どおりに対象日の日記を更新してください。これは梅田さんからの発言ではなく定時の作業指示です。終わったら、書き込んだファイル名と追加した出来事の数、またはスキップ理由を1〜3行で報告してください。`;
}
const SOURCE_NAMES={line:'LINE',local:'PC',discord:'Discord',web:'Web'};
// e.g. "[Web 2026-10-20 21:30]" or "[Discord #何でも 梅田 2026-10-20 21:30]"
export function messageLabel(source,now=new Date(),detail=''){const s=jstParts(now);const extra=String(detail||'').replace(/[\[\]\n]/g,' ').trim();return `[${SOURCE_NAMES[source]||'Web'}${extra?' '+extra:''} ${s.date} ${s.time}]`;}
