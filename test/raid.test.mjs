import test from 'node:test';
import assert from 'node:assert/strict';
import {raidFixture,input,hurt} from './raid-fixture.mjs';
import {RaidCoordinator,AdapterGateway} from '../adapters/raid-runtime.ts';
import {ADAPTER_MANIFEST} from '../src/manifest.ts';
import {ExtractionPolicy} from '../src/extraction-policy.ts';
import {REGION} from '../src/region.mjs';
import {createCombat,commandCombat,advanceCombat,contactCombat} from '../src/combat.ts';
const setup=t=>{const f=raidFixture();t.after(()=>f.core.close());return f;};
test('idle heartbeat lease loss immediately freezes engine and refuses later inputs',async t=>{
 const f=setup(t);await f.host.start();f.gateway.now=()=>Date.now()+20000;
 await assert.rejects(f.host.heartbeat(),/STALE_ADAPTER/);assert.equal(f.frozen,true);assert.equal(f.host.ready,false);
 await assert.rejects(f.host.execute('player0',input('a',1)),/RAID_NOT_READY/);
});
test('player admission and NPC lifecycle are atomic, bounded and preserve tombstones',async t=>{
 const f=setup(t),r=f.core.registerPlayer('new','new');f.connections.new=f.core.openConnection('connect-new','new').connectionId;
 await f.host.start();const weapon=r.items.find(x=>x.template==='iron_sword');
 const request={requestId:'join-new',operation:'join',payload:{itemIds:r.items.map(x=>x.id),loadout:{weaponId:weapon.id}}};
 await f.host.execute('new',request);await f.host.execute('new',request);assert.equal(f.host.snapshot().combat.actors.filter(a=>a.kind==='player').length,2);
 const npc={id:'newnpc',kind:'npc',team:'bandits',weapon:'bow',weight:'light',shield:false};await f.host.spawn('spawn',npc,'wolf');
 await assert.rejects(f.host.retire('retire-live','newnpc'),/COMBAT_RETIRE_UNSAFE/);await f.host.retry();
 const s=f.host.snapshot().combat;s.actors.find(a=>a.id==='newnpc').hp=0;s.actors.find(a=>a.id==='newnpc').action.kind='dead';f.core.run('UPDATE raid_combat SET state=?',JSON.stringify(s));
 await f.host.retire('retire','newnpc');await assert.rejects(f.host.spawn('respawn',npc,'wolf'),/COMBAT_ID_RETIRED/);assert.ok(f.host.snapshot().combat.retired.includes('newnpc'));
});
test('one projection barrier holds economy and combat frozen until both verify',async t=>{
 const f=setup(t);await f.host.start();hurt(f);const item=f.item('healing_potion'),before=item.quantity;f.log.length=0;
 f.port.replaceAndVerify=async()=>{f.log.push('failed-project');return false;};
 const command={requestId:'heal',operation:'use',payload:{itemId:item.id}};
 await assert.rejects(f.host.execute('player0',command),/RAID_PROJECTION_MISMATCH/);
 assert.equal(f.actor().hp,70);assert.equal(f.item('healing_potion').quantity,before-1);assert.equal(f.frozen,true);assert.ok(!f.log.includes('resume'));
 await assert.rejects(f.host.advance(1),/RAID_NOT_READY/);
 f.port.replaceAndVerify=async s=>{assert.equal(s.combat.actors[0].hp,70);assert.equal(s.economy.players[0].active.items.find(x=>x.id===item.id).quantity,before-1);return true;};
 await f.host.retry();const r=await f.host.execute('player0',command);assert.equal(r.result.hp,70);assert.equal(f.item('healing_potion').quantity,before-1);assert.equal(f.frozen,false);
 await assert.rejects(f.host.execute('player0',{...command,payload:{itemId:'different'}}),/REQUEST_ID_REUSED/);
});
test('new frozen lease recovers pending death without refunding dead loadout',async t=>{
 const f=setup(t);await f.host.start();hurt(f,20);await f.host.npc('attack','enemy0',1,'light');await f.host.advance(12);
 f.port.replaceAndVerify=async()=>false;await assert.rejects(f.host.contact('death','enemy0',f.bindings[0].expeditionId,1),/RAID_PROJECTION_MISMATCH/);
 assert.equal(f.core.snapshot('player0').active,null);assert.equal(f.actor().hp,0);
 const gateway=new AdapterGateway(f.core),lease=gateway.handshake({requestId:'restart',holderId:'new',manifest:ADAPTER_MANIFEST});
 f.port.replaceAndVerify=async()=>true;const host=new RaidCoordinator(f.service,gateway,lease,f.world,f.port);f.log.length=0;
 await host.recover('recovery');assert.equal(host.snapshot().status,'CLOSED');assert.equal(f.core.snapshot('player0').stash.length,0);
 assert.ok(!f.log.includes('resume'));assert.equal(f.core.row('SELECT status FROM adapter_lease').status,'FROZEN');
 await assert.rejects(f.host.retry(),/STALE_ADAPTER/);
});
test('in-flight writer losing its epoch cannot acknowledge or resume',async t=>{
 const f=setup(t);await f.host.start();let release;f.port.replaceAndVerify=()=>new Promise(r=>{release=r;});
 const pending=f.host.execute('player0',input('first',1));await new Promise(r=>setImmediate(r));
 await assert.rejects(f.host.execute('player0',input('second',2)),/RAID_BUSY/);
 new AdapterGateway(f.core);release(true);await assert.rejects(pending,/STALE_ADAPTER/);assert.equal(f.frozen,true);
 assert.notEqual(f.host.snapshot().revision,f.host.snapshot().acknowledged);
});
test('authenticated connection, exact envelopes and engine observation are mandatory',async t=>{
 const f=setup(t);await f.host.start();
 await assert.rejects(f.host.execute('intruder',input('a',1)),/COMBAT_LOGIN_REQUIRED/);await f.host.retry();
 await assert.rejects(f.host.execute('player0',{...input('a',1),payload:{...input('a',1).payload,damage:999}}),/INVALID_COMBAT_PACKET/);await f.host.retry();
 f.core.closeConnection('disconnect',f.connections.player0);
 await assert.rejects(f.host.execute('player0',input('a',1)),/STALE_CONNECTION/);await f.host.retry();
 f.port.observe=()=>null;await assert.rejects(f.host.contact('a','enemy0',f.bindings[0].expeditionId,1),/COMBAT_OBSERVATION_REQUIRED/);
});
test('legacy economic mutations cannot bypass integrated combat',t=>{
 const f=setup(t),b=f.bindings[0];
 for(const call of [()=>f.core.consume('x','player0',f.world,f.item('healing_potion').id),()=>f.core.recordDeath('x','player0',f.world,b.expeditionId),()=>f.core.extract('x','player0',f.world,'exit'),()=>f.core.closeRaid('x',f.world),()=>f.core.recoverWorld('x',f.world),()=>f.core.beginExpedition('x','player0',f.world,[])])assert.throws(call,/RAID_COORDINATOR_REQUIRED/);
});
test('equipment derives owned UUIDs, armor and carried weight; busy swaps fail',async t=>{
 const f=setup(t);await f.host.start();
 const loadout={weaponId:f.bindings[0].loadout.weaponId,shieldId:f.item('iron_shield').id,armorId:f.item('iron_armor').id};
 await f.host.execute('player0',{requestId:'equip',operation:'equip',payload:loadout});assert.equal(f.actor().armor,30);assert.equal(f.actor().weight,'heavy');
 await assert.rejects(f.host.execute('player0',{requestId:'bad',operation:'equip',payload:{weaponId:'not-owned'}}),/ITEM_NOT_IN_INVENTORY/);await f.host.retry();
 await assert.rejects(f.host.execute('player0',input('attack',1)),/COMBAT_BUSY/);await f.host.retry();await f.host.advance(18);
 await f.host.npc('npc','enemy0',1,'light');await f.host.advance(30);const hit=await f.host.contact('hit','enemy0',f.bindings[0].expeditionId,1);assert.equal(hit.result.damage,16);
});
test('bow consumes exactly one arrow per accepted attack; missing ammo rolls everything back',async t=>{
 const f=setup(t);await f.host.start();await f.host.execute('player0',{requestId:'bow',operation:'equip',payload:{weaponId:f.item('hunting_bow').id}});await f.host.advance(18);
 const before=f.item('iron_arrow').quantity,request=input('shoot',1);await f.host.execute('player0',request);await f.host.execute('player0',request);assert.equal(f.item('iron_arrow').quantity,before-1);
 await f.host.advance(100);const arrow=f.item('iron_arrow');f.core.run('DELETE FROM items WHERE id=?',arrow.id);const state=f.actor();
 await assert.rejects(f.host.execute('player0',input('no-ammo',2)),/NO_AMMUNITION/);assert.deepEqual(f.actor(),state);
});
test('staff spends bounded magicka; typed resistance expires and does not protect other elements',()=>{
 const specs=[{id:'a',kind:'player',team:'a',weapon:'staff',weight:'light',shield:false},{id:'b',kind:'npc',team:'b',weapon:'sword',weight:'light',shield:true}];
 for(const [element,damage] of [['fire',18],['frost',30]]){
  let s=createCombat('world',specs);s.actors[1].resistance=40;s.actors[1].resistElement=element;s.actors[1].resistUntil=60;
  s=commandCombat(s,'a',1,'light').state;assert.equal(s.actors[0].magicka,70000);s=advanceCombat(s,20);
  const r=contactCombat(s,{attackerId:'a',targetId:'b',tick:20,serial:1,distance:10,inArc:true,facing:true,clear:true,safeZone:false});assert.equal(r.event.damage,damage);
  s=advanceCombat(s,60);assert.equal(s.actors[1].resistance,0);
 }
 let s=createCombat('world',specs);s.actors[0].magicka=29999;assert.throws(()=>commandCombat(s,'a',1,'light'),/COMBAT_MAGICKA_LOW/);
});
test('death and kill objective progress commit once; extraction damage resets hold',async t=>{
 const f=setup(t);
 const meta=f.host.snapshot().metadata;meta.targets.enemy0='wolf';f.core.run('UPDATE raid_combat SET bindings=?',JSON.stringify(meta));
 await f.host.start();
 for(let i=1;i<=3;i++){await f.host.execute('player0',input('attack'+i,i,'heavy'));await f.host.advance(f.host.snapshot().combat.tick+26);await f.host.contact('hit'+i,f.bindings[0].expeditionId,'enemy0',i);if(i<3)await f.host.advance(f.host.snapshot().combat.tick+90);}
 assert.equal(f.core.row('SELECT count FROM mission_pending').count,1);assert.equal(f.core.row('SELECT COUNT(*) AS n FROM mission_events').n,1);
 const before=f.host.snapshot();const receipt=f.service.contact(f.world,'hit3',{attackerId:f.bindings[0].expeditionId,targetId:'enemy0',serial:3,tick:before.combat.tick,distance:1,inArc:true,facing:true,clear:true,safeZone:false});assert.equal(receipt.result.killed,true);assert.equal(f.core.row('SELECT count FROM mission_pending').count,1);
 let clock=0;const exitId=REGION.exits.find(e=>!e.requires).id,policy=new ExtractionPolicy([{id:exitId,worldId:f.world,cellId:'test',x:0,y:0,z:0,radius:5,holdMs:2000,availability:'always'}],()=>clock);
 const sample=()=>({playerId:'player0',worldId:f.world,expeditionId:f.bindings[0].expeditionId,connectionId:f.connections.player0,cellId:'test',x:0,y:0,z:0,alive:true,connected:true,inCombat:false,observedAt:clock,hour:12,damageSequence:0});
 await f.host.advance(before.combat.tick+120);policy.update(exitId,f.service.extractionObservation(f.world,'player0',sample()));clock=1000;policy.update(exitId,f.service.extractionObservation(f.world,'player0',sample()));
 const bindings=f.host.snapshot().metadata;bindings.damage[f.bindings[0].expeditionId]=1;f.core.run('UPDATE raid_combat SET bindings=?',JSON.stringify(bindings));clock=2000;
 assert.equal(policy.update(exitId,f.service.extractionObservation(f.world,'player0',sample())).remainingMs,2000);
 clock=3000;policy.update(exitId,f.service.extractionObservation(f.world,'player0',sample()));clock=4000;const result=f.service.extract(f.world,'player0','extract',exitId,policy,sample());
 assert.equal(result.result.exitId,exitId);assert.equal(f.core.snapshot('player0').active,null);assert.equal(f.host.snapshot().combat.actors.some(a=>a.kind==='player'),false);assert.equal(f.core.row('SELECT count FROM mission_progress').count,1);
 assert.deepEqual(f.service.extract(f.world,'player0','extract',exitId,policy,sample()),result);
});

test('committed contact retries preserve their original observation after ticks and geometry change',async t=>{
 const f=setup(t);await f.host.start();await f.host.npc('attack','enemy0',1,'light');await f.host.advance(12);
 const target=f.bindings[0].expeditionId,receipt=await f.host.contact('contact-replay','enemy0',target,1),hp=f.actor().hp;
 await f.host.advance(100);const revision=f.host.snapshot().revision;let observations=0;
 f.port.observe=()=>{observations++;return {distance:99,inArc:false,facing:false,clear:false,safeZone:true};};
 assert.deepEqual(await f.host.contact('contact-replay','enemy0',target,1),receipt);
 f.port.observe=()=>{observations++;return null;};
 assert.deepEqual(await f.host.contact('contact-replay','enemy0',target,1),receipt);
 assert.equal(observations,0);assert.equal(f.actor().hp,hp);assert.equal(f.host.snapshot().revision,revision);
 for(const [attacker,targetId,serial] of [['other',target,1],['enemy0','other',1],['enemy0',target,2]]){
  await assert.rejects(f.host.contact('contact-replay',attacker,targetId,serial),/REQUEST_ID_REUSED/);await f.host.retry();
 }
 assert.equal(observations,0);
 await assert.rejects(f.host.contact('attack','enemy0',target,1),/REQUEST_ID_REUSED/);await f.host.retry();
 await assert.rejects(f.host.contact('fresh-contact','enemy0',target,1),/COMBAT_OBSERVATION_REQUIRED/);
});

test('pickup receipt remains replayable after the item is no longer in reach',async t=>{
 const f=setup(t),itemId=f.item('healing_potion').id;
 const containerId=String(f.core.row("SELECT id FROM locations WHERE kind='CONTAINER' AND raid_id=?",f.world).id);
 f.core.run('UPDATE items SET location_id=? WHERE id=?',containerId,itemId);
 await f.host.start();const command={requestId:'pickup-replay',operation:'pickup',payload:{containerId,itemId}};
 const receipt=await f.host.execute('player0',command),revision=f.host.snapshot().revision;f.port.canPickup=()=>false;
 assert.deepEqual(await f.host.execute('player0',command),receipt);assert.equal(f.host.snapshot().revision,revision);
 for(const payload of [{containerId:'different',itemId},{containerId,itemId:'different'}]){
  await assert.rejects(f.host.execute('player0',{...command,payload}),/REQUEST_ID_REUSED/);await f.host.retry();
 }
 f.core.registerPlayer('register-other','other');f.connections.other=f.core.openConnection('connect-other','other').connectionId;
 await assert.rejects(f.host.execute('other',command),/REQUEST_ID_REUSED/);await f.host.retry();
 await assert.rejects(f.host.execute('intruder',command),/COMBAT_LOGIN_REQUIRED/);await f.host.retry();
 await assert.rejects(f.host.execute('player0',{...command,requestId:'fresh-pickup'}),/PICKUP_NOT_AUTHORIZED/);await f.host.retry();
 f.core.closeConnection('close-player',f.connections.player0);
 await assert.rejects(f.host.execute('player0',command),/STALE_CONNECTION/);
});

test('extraction receipt remains replayable after its actor leaves the world',async t=>{
 const f=setup(t);let clock=0;const exitId=REGION.exits.find(e=>!e.requires).id;
 const policy=new ExtractionPolicy([{id:exitId,worldId:f.world,cellId:'test',x:0,y:0,z:0,radius:5,holdMs:2000,availability:'always'}],()=>clock);
 f.port.extraction=()=>({playerId:'player0',worldId:f.world,expeditionId:f.bindings[0].expeditionId,connectionId:f.connections.player0,cellId:'test',x:0,y:0,z:0,alive:true,connected:true,inCombat:false,observedAt:clock,hour:12,damageSequence:0});
 const host=new RaidCoordinator(f.service,f.gateway,f.lease,f.world,f.port,policy);await host.start();
 host.observeExtraction('player0',exitId);clock=1000;host.observeExtraction('player0',exitId);clock=2000;
 const command={requestId:'extract-replay',operation:'extract',payload:{exitId}},receipt=await host.execute('player0',command);
 const revision=host.snapshot().revision,stash=f.core.snapshot('player0').stash;
 f.port.extraction=()=>null;assert.deepEqual(await host.execute('player0',command),receipt);
 assert.equal(host.snapshot().revision,revision);assert.deepEqual(f.core.snapshot('player0').stash,stash);
 await assert.rejects(host.execute('player0',{...command,payload:{exitId:'different'}}),/REQUEST_ID_REUSED/);await host.retry();
 await assert.rejects(host.execute('player0',{...command,requestId:'fresh-extract'}),/EXTRACTION_OBSERVATION_REQUIRED/);await host.retry();
 f.core.closeConnection('close-player',f.connections.player0);
 await assert.rejects(host.execute('player0',command),/STALE_CONNECTION/);
});
