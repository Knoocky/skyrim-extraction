import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {ExtractionCore} from '../src/core.mjs';
import {createCoreServer} from '../src/server.ts';
import {CoreClient} from '../src/client.ts';
import {FencedCoreClient} from '../src/fenced-client.ts';
import {ProjectionBridge} from '../src/bridge.ts';
import {IntentRouter} from '../adapters/intent-router.ts';
const token='2'.repeat(64); // Public test credential, never used by deployment.
async function fixture(t,options={}){
 const core=new ExtractionCore(':memory:'),server=createCoreServer(core,token,{requireLease:true,...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));core.close();});
 return {core,url,client:new FencedCoreClient(url,token)};
}
test('production HTTP requires lease; lost committed reply retries same ordered event and one receipt',async t=>{
 const {client,core,url}=await fixture(t);
 const plain=new CoreClient(url,token);
 const command={protocolVersion:1,requestId:'register',operation:'registerPlayer',payload:{playerId:'a'}};
 await assert.rejects(()=>plain.command(command),e=>e.code==='ADAPTER_LEASE_REQUIRED');
 await client.acquire('adapter');let frozen=false;
 const bridge=new ProjectionBridge(client,{freeze(){frozen=true;},replaceAndVerify(){assert.equal(frozen,true);},resume(){frozen=false;}});
 const original=client.request.bind(client);let dropped=false;
 client.request=async(path,body)=>{const result=await original(path,body);if(path.endsWith('/command')&&!dropped){dropped=true;throw new Error('LOST_REPLY');}return result;};
 await assert.rejects(()=>bridge.execute(command),/LOST_REPLY/);assert.equal(frozen,true);assert.equal(core.snapshot('a').stash.length,3);
 await assert.rejects(()=>bridge.execute({...command,requestId:'different'}),/PREVIOUS_COMMAND_UNCERTAIN/);
 await bridge.execute(command);assert.equal(frozen,false);assert.equal(core.snapshot('a').stash.length,3);
 assert.equal(core.row('SELECT COUNT(*) AS n FROM receipts').n,1);
 const diagnostics=await plain.request('/v1/diagnostics');assert.equal(diagnostics.players,1);assert.ok(!JSON.stringify(diagnostics).includes('token'));
});
test('bounded queue rejects overload without touching the world and resumes after a blocked application',async()=>{
 let unblock;const wait=new Promise(resolve=>unblock=resolve),calls=[];
 const client={projection:async()=>{await wait;return {revision:1};},acknowledge:async()=>{},command:async()=>{}};
 const bridge=new ProjectionBridge(client,{freeze(){calls.push('freeze');},replaceAndVerify(){},resume(){}},1);
 const first=bridge.synchronize();await assert.rejects(()=>bridge.synchronize(),e=>e.code==='QUEUE_FULL');assert.equal(bridge.pending,1);
 unblock();await first;assert.equal(bridge.pending,0);assert.deepEqual(calls,['freeze']);
});
test('global request limits bound unauthenticated traffic and authenticate diagnostics',async t=>{
 const {url}=await fixture(t,{requestsPerSecond:2});
 assert.equal((await fetch(url+'/v1/diagnostics')).status,401);
 assert.equal((await fetch(url+'/v1/health')).status,401);
 assert.equal((await fetch(url+'/v1/health')).status,429);
});
test('intent router uses verified transport session and rejects identity/authority/system injection',async()=>{
 const sent=[],bridge={execute:async command=>sent.push(command)};
 const auth={session:id=>id==='verified'?{subject:'alice',connectionId:'alice-connection',worldId:'world'}:null,approve:()=>false};
 const router=new IntentRouter(bridge,auth),raw={requestId:'req',operation:'buy',payload:{offerId:'potion',quantity:1}};
 assert.throws(()=>router.execute('fake',raw),e=>e.code==='LOGIN_NOT_VERIFIED');
 assert.throws(()=>router.execute('verified',{...raw,worldApproved:true}),e=>e.code==='INVALID_FIELDS');
 assert.throws(()=>router.execute('verified',{...raw,payload:{...raw.payload,playerId:'bob'}}),e=>e.code==='INVALID_FIELDS');
 assert.throws(()=>router.execute('verified',{...raw,operation:'registerPlayer',payload:{playerId:'bob'}}),e=>e.code==='CLIENT_OPERATION_FORBIDDEN');
 await router.execute('verified',raw);assert.equal(sent[0].connectionId,'alice-connection');assert.equal(sent[0].worldApproved,undefined);
 assert.throws(()=>router.execute('verified',{...raw,operation:'extract',payload:{worldId:'world',expeditionId:'e',exitId:'exit'}}),e=>e.code==='WORLD_INTENT_DENIED');
});
