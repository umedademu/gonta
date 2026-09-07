export const discoveryURL='https://gonta-connect.umedademu.workers.dev/';
export const publicKey={crv:'Ed25519',x:'NsNXebVHnkuxCHgb5SHmCmYOewOhoTBL6B7Q1aVQxjA',kty:'OKP'};
export async function verifyEndpoint(record,now=Date.now(),keySpec=publicKey){
 if(!record||typeof record.payload!=='string'||record.payload.length>1024||typeof record.signature!=='string')throw Error('接続情報を確認できません。');
 const key=await crypto.subtle.importKey('jwk',keySpec,{name:'Ed25519'},false,['verify']);
 const signature=Uint8Array.from(atob(record.signature),c=>c.charCodeAt(0));
 if(!await crypto.subtle.verify('Ed25519',key,signature,new TextEncoder().encode(record.payload)))throw Error('接続情報の署名が一致しません。');
 const data=JSON.parse(record.payload);
 if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.url)||!Number.isSafeInteger(data.expires)||!Number.isSafeInteger(data.issued)||data.issued>now+60000||data.expires<=now||data.expires-data.issued>172800000)throw Error('PCの接続情報が期限切れです。PCの起動を確認してください。');
 return data;
}
export async function discover(){
 const response=await fetch(discoveryURL,{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('PCの接続先を確認できません。少し待って再接続します。');
 return (await verifyEndpoint(await response.json())).url;
}
