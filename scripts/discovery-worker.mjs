// Generated deployment bundles this import for the dashboard editor.
import {verifyEndpoint} from '../public/discovery.js';
export default {async fetch(request,env){
 const headers={'Access-Control-Allow-Origin':'https://gonta-sand.vercel.app','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(new URL(request.url).pathname!=='/')return reply({error:'Not found'},404);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  if(request.method==='GET'){
   const stored=await env.ENDPOINTS.get('current','json');
   if(!stored)return reply({error:'Offline'},503);
   await verifyEndpoint(stored);return reply(stored);
  }
  if(request.method!=='POST')return reply({error:'Method not allowed'},405);
  if(Number(request.headers.get('content-length'))>4096)return reply({error:'Too large'},413);
  const text=await request.text();if(text.length>4096)return reply({error:'Too large'},413);
  const record=JSON.parse(text),data=await verifyEndpoint(record);
  const previous=await env.ENDPOINTS.get('current','json');
  if(previous&&JSON.parse(previous.payload).issued>=data.issued)return reply({error:'Stale update'},409);
  await env.ENDPOINTS.put('current',JSON.stringify({payload:record.payload,signature:record.signature}));
  return reply({ok:true});
 }catch{return reply({error:'Unavailable or invalid record'},400);}
}};
