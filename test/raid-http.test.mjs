import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {raidFixture,input,hurt} from './raid-fixture.mjs';
import {createCoreServer} from '../src/server.ts';
import {RaidClient} from '../src/raid-client.ts';
async function fixture(t){
 const f=raidFixture(),token=randomBytes(32).toString('hex'),server=createCoreServer(f.core,token,{raid:f.host});await f.host.start();
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));f.core.close();});return {...f,server,url,token,client:new RaidClient(url,token)};
}
test('private raid HTTP rejects browser/identity/physics injection and reordered input',async t=>{
 const f=await fixture(t);assert.equal((await fetch(f.url+'/v1/raid')).status,401);
 assert.equal((await fetch(f.url+'/v1/raid',{headers:{authorization:'Bearer '+f.token,origin:'http://attacker'}})).status,403);
 await assert.rejects(f.client.execute('forged',input('fake',1)),/COMBAT_LOGIN_REQUIRED/);await f.client.retry();
 await assert.rejects(f.client.execute('player0',input('second',2)),/COMBAT_OUT_OF_ORDER/);await f.client.retry();
 await f.client.execute('player0',input('first',1));assert.equal(f.actor().sequence,1);
 await assert.rejects(f.client.call('contact',{requestId:'fakehit',attackerId:'enemy0',targetId:f.bindings[0].expeditionId,serial:1,damage:10000}),/UNKNOWN_FIELD|INVALID/);
 assert.equal(f.actor().hp,100);
});
test('real HTTP lost committed response and delayed duplicate heal exactly once',async t=>{
 const f=await fixture(t);hurt(f);const item=f.item('healing_potion');let lose=true;
 const proxy=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await fetch(f.url+req.url,{method:req.method,headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:req.method==='POST'?Buffer.concat(chunks):undefined});const text=await response.text();
  if(lose&&req.url==='/v1/raid/intent'){lose=false;res.destroy();return;}
  res.writeHead(response.status,{'content-type':'application/json'});res.end(text);
 });proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(async()=>{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));});
 const client=new RaidClient('http://127.0.0.1:'+proxy.address().port,f.token),command={requestId:'heal',operation:'use',payload:{itemId:item.id}};
 await assert.rejects(client.execute('player0',command),e=>e.uncertain);assert.equal(f.actor().hp,70);
 await client.retry();await client.execute('player0',command);assert.equal(f.item('healing_potion').quantity,item.quantity-1);
 await client.call('advance',{tick:100});await client.execute('player0',command);assert.equal(f.actor().hp,70);assert.equal(f.item('healing_potion').quantity,item.quantity-1);
});
test('delayed projection applies backpressure and stop during await remains frozen',async t=>{
 const f=await fixture(t);let release;f.port.replaceAndVerify=()=>new Promise(r=>{release=r;});
 const pending=f.client.execute('player0',input('a',1));while(!release)await new Promise(r=>setImmediate(r));
 await assert.rejects(f.client.execute('player0',input('b',2)),/RAID_BUSY/);await f.host.stop();release(true);
 await assert.rejects(pending,/RAID_STOPPED/);assert.equal(f.core.row('SELECT status FROM adapter_lease').status,'FROZEN');
});

test('lost lethal contact response replays after tick advance without geometry or duplicate mission credit',async t=>{
 const f=await fixture(t),target='enemy0',attacker=f.bindings[0].expeditionId;
 const metadata=f.host.snapshot().metadata;metadata.targets[target]='wolf';f.core.run('UPDATE raid_combat SET bindings=?',JSON.stringify(metadata));
 for(let i=1;i<=2;i++){
  await f.client.execute('player0',input('attack'+i,i,'heavy'));await f.client.call('advance',{tick:f.host.snapshot().combat.tick+26});
  await f.client.call('contact',{requestId:'hit'+i,attackerId:attacker,targetId:target,serial:i});await f.client.call('advance',{tick:f.host.snapshot().combat.tick+90});
 }
 await f.client.execute('player0',input('attack3',3,'heavy'));await f.client.call('advance',{tick:f.host.snapshot().combat.tick+26});
 let lose=true,committed;
 const proxy=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await fetch(f.url+req.url,{method:req.method,headers:{authorization:'Bearer '+f.token,'content-type':'application/json'},body:req.method==='POST'?Buffer.concat(chunks):undefined});const text=await response.text();
  if(lose&&req.url==='/v1/raid/contact'){lose=false;committed=JSON.parse(text);res.destroy();return;}
  res.writeHead(response.status,{'content-type':'application/json'});res.end(text);
 });proxy.listen(0,'127.0.0.1');await once(proxy,'listening');t.after(async()=>{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));});
 const client=new RaidClient('http://127.0.0.1:'+proxy.address().port,f.token),command={requestId:'lethal-contact',attackerId:attacker,targetId:target,serial:3};
 await assert.rejects(client.call('contact',command),e=>e.uncertain);
 assert.equal(f.host.snapshot().combat.actors.find(a=>a.id===target).hp,0);
 await client.retry();await client.call('advance',{tick:f.host.snapshot().combat.tick+120});
 const revision=f.host.snapshot().revision;f.port.observe=()=>{throw Error('MUST_NOT_REOBSERVE_COMMITTED_CONTACT');};
 assert.deepEqual(await client.call('contact',command),committed);
 assert.equal(f.host.snapshot().revision,revision);assert.equal(f.core.row('SELECT count FROM mission_pending').count,1);
 assert.equal(f.core.row('SELECT COUNT(*) AS n FROM mission_events').n,1);
 await assert.rejects(client.call('contact',{...command,serial:4}),/REQUEST_ID_REUSED/);
});
