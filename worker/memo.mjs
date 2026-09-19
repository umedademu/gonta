const MAX_LENGTH = 100000;
const MAX_BYTES = 650000;
const encoder = new TextEncoder();
export async function tokenHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2,'0')).join('');
}
function equalHash(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 64 || b.length !== 64) return false;
  let diff = 0;
  for (let i=0;i<64;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError(); }
    chunks.push(value);
  }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk,offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(body));
}
export default {async fetch(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set(['https://gonta-sand.vercel.app', 'http://127.0.0.1:18890', 'http://localhost:18890']);
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Methods':'GET, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  if (allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (body,status=200) => new Response(JSON.stringify(body), {status,headers});
  if (new URL(request.url).pathname !== '/api/memo') return reply({error:'Not found'},404);
  if (origin && !allowed.has(origin)) return reply({error:'Origin not allowed'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (!env.MEMO_TOKEN_HASH || !env.DB) return reply({error:'Not configured'},503);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!bearer || !equalHash(await tokenHash(bearer), env.MEMO_TOKEN_HASH)) return reply({error:'Unauthorized'},401);
  try {
    if (request.method === 'GET') return reply(await env.DB.prepare('SELECT content, version, updated_at AS updatedAt FROM memo WHERE id = 1').first());
    if (request.method !== 'PUT') return reply({error:'Method not allowed'},405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({error:'Expected JSON'},415);
    const body = await readBody(request);
    if (!body || typeof body.content !== 'string' || body.content.length > MAX_LENGTH || !Number.isSafeInteger(body.version) || body.version < 0) return reply({error:'Invalid memo'},400);
    const updatedAt = new Date().toISOString();
    // Compare-and-swap is one atomic SQL statement, including simultaneous tabs.
    const result = await env.DB.prepare('UPDATE memo SET content = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ? RETURNING content, version, updated_at AS updatedAt').bind(body.content,updatedAt,body.version).first();
    if (result) return reply(result);
    return reply(await env.DB.prepare('SELECT content, version, updated_at AS updatedAt FROM memo WHERE id = 1').first(),409);
  } catch (error) {
    if (error instanceof RangeError) return reply({error:'Too large'},413);
    if (error instanceof SyntaxError) return reply({error:'Invalid JSON'},400);
    return reply({error:'Memo unavailable'},503);
  }
}};
