(() => {
 const root=document.documentElement,system=matchMedia('(prefers-color-scheme: dark)');
 let preference=null;
 try{const saved=localStorage.getItem('gonta.theme');if(saved==='dark'||saved==='light')preference=saved;}catch{}
 function apply(){
  const dark=preference?preference==='dark':system.matches;
  root.dataset.theme=dark?'dark':'light';
  document.querySelector('meta[name="theme-color"]').content=dark?'#141b18':'#f4f5ef';
  const button=document.getElementById('theme-toggle');
  if(button){button.textContent=dark?'☀':'☾';button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'ライトモードに切り替える':'ダークモードに切り替える');button.title=button.getAttribute('aria-label');}
 }
 apply();
 system.addEventListener('change',()=>{if(!preference)apply();});
 window.addEventListener('storage',event=>{if(event.key==='gonta.theme'||event.key===null){preference=event.newValue==='dark'||event.newValue==='light'?event.newValue:null;apply();}});
 document.addEventListener('DOMContentLoaded',()=>{
  apply();document.getElementById('theme-toggle').addEventListener('click',()=>{
   preference=root.dataset.theme==='dark'?'light':'dark';
   try{localStorage.setItem('gonta.theme',preference);}catch{}
   apply();
  });
 });
})();
