import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {parseEndpoint,verifyEndpoint} from '../public/discovery.js';
test('discovery accepts only signed, current HTTPS tunnel destinations',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),key=publicKey.export({format:'jwk'}),now=Date.now();
 const make=(changes={})=>{const payload=JSON.stringify({url:'https://example-test.trycloudflare.com',issued:now,expires:now+86400000,...changes});return {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};};
 assert.equal((await verifyEndpoint(make(),now,key)).url,'https://example-test.trycloudflare.com');
 const tampered=make();tampered.payload=tampered.payload.replace('example-test','attacker');
 await assert.rejects(verifyEndpoint(tampered,now,key));
 for(const changes of [{url:'http://example-test.trycloudflare.com'},{url:'https://evil.example'},{expires:now-1},{issued:now+120000},{expires:now+200000000}])await assert.rejects(verifyEndpoint(make(changes),now,key));
 await assert.rejects(verifyEndpoint(make(),now));
 assert.equal(parseEndpoint(make(),now).url,'https://example-test.trycloudflare.com');
});
