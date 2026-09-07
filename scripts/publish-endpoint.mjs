import {readFileSync} from 'node:fs';
import {sign} from 'node:crypto';
import os from 'node:os';
const discoveryURL='https://gonta-connect.umedademu.workers.dev/';
let lastURL='',lastPublished=0;
export async function publishEndpoint(url){
 if(url===lastURL&&Date.now()-lastPublished<14400000)return;
 const issued=Date.now();
 const payload=JSON.stringify({url,issued,expires:issued+86400000});
 const signature=sign(null,Buffer.from(payload),readFileSync(os.homedir()+'/.gonta/discovery-private.pem')).toString('base64');
 const response=await fetch(discoveryURL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,signature}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`Endpoint publication failed (${response.status})`);
 lastURL=url;lastPublished=issued;
}
