import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExtractionCore} from '../src/core.mjs';
import {WorldModel} from '../src/world-model.ts';
import {AdapterGateway} from '../src/adapter-gateway.ts';
import {ADAPTER_MANIFEST} from '../src/manifest.ts';
import {MISSIONS} from '../src/missions.mjs';
import {validateReleaseContent} from '../src/content-validation.mjs';
const deny=(code,fn)=>assert.throws(fn,e=>e.code===code);
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'extraction-extensions-')),filename=join(dir,'core.sqlite');
 let core=new ExtractionCore(filename,{authority:{canPickup:()=>true,canExtract:()=>true,canConsume:()=>true}});
 t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});
 return {get c(){return core;},reopen(){core.close();core=new ExtractionCore(filename,{authority:{canPickup:()=>true,canExtract:()=>true,canConsume:()=>true}});}};
}
test('full progression reaches finale using extracted loot and verified mission events, once only',t=>{
 const {c}=fixture(t);c.registerPlayer('a','a');
 const world=c.createRaid('world',['dwemer_relic',{template:'dwarven_ingot',quantity:3}]);
 const chain=['scout_ruins','bandit_patrol','medic_rescue','ruin_guardian','survey_mine','mine_chief','surveyor_rescue','sealed_vault','beacon_parts','final_beacon'];
 let step=0;
 for(const definitionId of chain){
  const definition=MISSIONS.find(m=>m.id===definitionId),accepted=c.acceptMission('accept-'+step,'a',definitionId);
  const exp=c.beginExpedition('enter-'+step,'a',world.raidId,[]);
  if(step===0)for(const item of world.items)c.pickup('pick-'+item.id,'a',world.raidId,world.containerId,item.id,exp.expeditionId);
  for(const [index,o] of definition.objectives.entries())if(o.kind!=='delivery')for(let i=0;i<o.quantity;i++)c.recordMissionEvent('event-'+step+'-'+index+'-'+i,'event-'+step+'-'+index+'-'+i,world.raidId,o.kind,o.target,[{playerId:'a',expeditionId:exp.expeditionId}]);
  c.extract('out-'+step,'a',world.raidId,'exit',exp.expeditionId);
  const reward=c.claimMission('claim-'+step,'a',accepted.instanceId);
  assert.deepEqual(c.claimMission('claim-'+step,'a',accepted.instanceId),reward);
  deny('MISSION_NOT_ACTIVE',()=>c.claimMission('again-'+step,'a',accepted.instanceId));step++;
 }
 const p=c.progression('a');assert.equal(p.finaleCompleted,true);assert.equal(p.reputation,100);
 c.learnSkill('skill','a','fieldcraft',0);c.learnSkill('scholar','a','scholarship',0);
 assert.equal(c.progression('a').skillPoints,Math.floor(p.xp/100)-2);
 deny('STALE_RANK',()=>c.learnSkill('skill-race','a','fieldcraft',0));
 assert.equal(c.diagnostics().auditEntries,c.diagnostics().receipts);
 assert.equal(c.snapshot('a').reports.length,10);
 assert.deepEqual(validateReleaseContent(),{items:60,recipes:10,contracts:27,areas:6,exits:4});
});
test('safe area reset protects unknown actors and both transition sides across restart',t=>{
 const f=fixture(t),c=f.c;c.registerPlayer('a','a');const w=c.createRaid('w',[]);
 let model=new WorldModel(c);model.configure('configure',w.raidId);
 model.advance('tick',w.raidId,1440);assert.equal(model.state(w.raidId).night,true);
 const exp=c.beginExpedition('in','a',w.raidId,[]);
 deny('AREA_OCCUPIED',()=>model.reset('reset-unknown',w.raidId,'mine',1));
 model.observe('observe',w.raidId,'a',exp.expeditionId,'ruins',1,'mine');
 deny('AREA_OCCUPIED',()=>model.reset('reset-transition',w.raidId,'mine',1));
 deny('AREA_OCCUPIED',()=>model.reset('reset-origin',w.raidId,'ruins',1));
 model.reset('reset-vault',w.raidId,'vault',1);
 f.reopen();model=new WorldModel(f.c);
 const projected=f.c.projection().worlds.find(x=>x.id===w.raidId);assert.equal(projected.clock.minute,1440);assert.equal(projected.clock.night,true);
 assert.equal(projected.areas.find(a=>a.id==='mine').occupied,1);assert.equal(projected.areas.find(a=>a.id==='ruins').occupied,1);
 assert.equal(f.c.market().cycle,1);assert.equal(f.c.row('SELECT cycle FROM mission_cycle WHERE id=1').cycle,2);
 deny('STALE_OBSERVATION',()=>model.observe('old',w.raidId,'a',exp.expeditionId,'vault',1));
 deny('AREA_OCCUPIED',()=>model.reset('reset-restart',w.raidId,'mine',1));
 model.observe('arrive',w.raidId,'a',exp.expeditionId,'mine',2);
 model.reset('reset-ruins',w.raidId,'ruins',1);
 deny('RESET_NOT_DUE',()=>model.reset('duplicate-cycle',w.raidId,'ruins',1));
 deny('STALE_WORLD_TIME',()=>model.advance('time-back',w.raidId,1439));
});
test('four-player capacity and disconnected occupancy are persistent, never timed out to free loot',t=>{
 const {c}=fixture(t),w=c.createRaid('w',[]),model=new WorldModel(c);model.configure('conf',w.raidId);model.advance('tick',w.raidId,1440);
 for(let i=0;i<5;i++)c.registerPlayer('p'+i,'p'+i);
 for(let i=0;i<4;i++)c.beginExpedition('in','p'+i,w.raidId,[]);
 deny('WORLD_FULL',()=>c.beginExpedition('fifth','p4',w.raidId,[]));
 const conn=c.openConnection('conn','p0');c.closeConnection('disconnect',conn.connectionId);
 deny('AREA_OCCUPIED',()=>model.reset('reset',w.raidId,'mine',1));
});
test('lease fences old adapters, gates reconciliation, orders events and detects changed replay',t=>{
 const {c}=fixture(t);let now=1000;const gateway=new AdapterGateway(c,{now:()=>now});
 deny('MANIFEST_MISMATCH',()=>gateway.handshake({requestId:'h',holderId:'one',manifest:{...ADAPTER_MANIFEST,contentHash:'bad'}}));
 const grant=gateway.handshake({requestId:'h',holderId:'one',manifest:ADAPTER_MANIFEST}),lease={epoch:grant.epoch,token:grant.token};
 assert.deepEqual(gateway.handshake({requestId:'h',holderId:'one',manifest:ADAPTER_MANIFEST}),grant);
 deny('ADAPTER_ALREADY_LEASED',()=>gateway.handshake({requestId:'other',holderId:'two',manifest:ADAPTER_MANIFEST}));
 const envelope={lease,sequence:1,command:{protocolVersion:1,operation:'registerPlayer',requestId:'register',payload:{playerId:'a'}}};
 deny('ADAPTER_FROZEN',()=>gateway.execute(envelope));
 const meta=c.projectionMetadata();deny('RECONCILE_MISMATCH',()=>gateway.reconcile({lease,...meta,revision:0}));
 gateway.reconcile({lease,...meta});deny('OUT_OF_ORDER',()=>gateway.execute({...envelope,sequence:2}));
 const done=gateway.execute(envelope);assert.deepEqual(gateway.execute(envelope),done);
 deny('EVENT_ID_REUSED',()=>gateway.execute({...envelope,command:{...envelope.command,requestId:'altered'}}));
 now=17000;deny('STALE_ADAPTER',()=>gateway.execute(envelope));
 const next=gateway.handshake({requestId:'next',holderId:'two',manifest:ADAPTER_MANIFEST});assert.ok(next.epoch>grant.epoch);
 deny('STALE_ADAPTER',()=>gateway.reconcile({lease,...c.projectionMetadata()}));
 now=500;deny('CLOCK_ROLLBACK',()=>gateway.renew({epoch:next.epoch,token:next.token}));
});
test('crash compensation returns surviving initial UUIDs only and never awards loot XP',t=>{
 const f=fixture(t),c=f.c;c.registerPlayer('a','a');
 const items=c.snapshot('a').stash,w=c.createRaid('w',['dwemer_relic']);
 const exp=c.beginExpedition('in','a',w.raidId,items.map(i=>i.id));
 const potion=items.find(i=>i.template==='healing_potion');c.consume('drink','a',w.raidId,potion.id,1,exp.expeditionId);
 c.pickup('loot','a',w.raidId,w.containerId,w.items[0].id,exp.expeditionId);
 f.reopen();const restored=f.c.recoverWorld('recover',w.raidId);
 assert.equal(f.c.progression('a').xp,0);assert.deepEqual(f.c.snapshot('a').stash.map(i=>i.id).sort(),items.filter(i=>i.id!==potion.id).map(i=>i.id).sort());
 assert.equal(f.c.snapshot('a').reports[0].outcome,'RECOVERED');
 assert.deepEqual(f.c.recoverWorld('recover',w.raidId),restored);
 deny('RAID_NOT_OPEN',()=>f.c.recoverWorld('repeat',w.raidId));
 assert.equal(f.c.row('SELECT COUNT(*) AS n FROM items WHERE template=?','dwemer_relic').n,0);
});
test('a restarted gateway fences a still-unexpired adapter without changing committed economic outcomes',t=>{
 const {c}=fixture(t);const a=new AdapterGateway(c,{now:()=>1000});const grant=a.handshake({requestId:'h',holderId:'a',manifest:ADAPTER_MANIFEST});
 const lease={epoch:grant.epoch,token:grant.token};a.reconcile({lease,...c.projectionMetadata()});
 a.execute({lease,sequence:1,command:{protocolVersion:1,requestId:'new',operation:'registerPlayer',payload:{playerId:'p'}}});
 const revision=c.projectionMetadata().revision;new AdapterGateway(c,{now:()=>1001});
 deny('STALE_ADAPTER',()=>a.renew(lease));assert.equal(c.snapshot('p').stash.length,3);assert.equal(c.projectionMetadata().revision,revision);
});

test('v6 migration preserves saved terms/receipts and stock, backfills reputation and upgrades projection exactly once',async t=>{
 const {readFileSync}=await import('node:fs'),{DatabaseSync}=await import('node:sqlite');
 const dir=mkdtempSync(join(tmpdir(),'extraction-v6-')),file=join(dir,'old.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const old=new DatabaseSync(file);old.exec(readFileSync(new URL('./fixtures/schema-v6.sql',import.meta.url),'utf8'));
 old.exec(`INSERT INTO players VALUES ('legacy'); INSERT INTO progression(player_id,gold,xp) VALUES ('legacy',250,200);
 INSERT INTO locations VALUES ('stash','STASH','legacy',NULL,NULL);
 INSERT INTO items(id,template,location_id,quantity) VALUES ('kept','healing_potion','stash',3);
 INSERT INTO projection_state VALUES (1,'old-database',40,40);INSERT INTO projection_outbox VALUES (1,40,'{}');
 INSERT INTO market_cycle VALUES (1,8);INSERT INTO market_stock VALUES ('potion',3);INSERT INTO mission_cycle VALUES(1,8);
 INSERT INTO receipts VALUES('system','historical','historical-command','{"ok":true}');`);
 const terms=JSON.stringify({...MISSIONS.find(m=>m.id==='scout_ruins'),version:1});
 old.prepare("INSERT INTO mission_instances VALUES ('old-mission','legacy','scout_ruins',0,'COMPLETED',?)").run(terms);old.close();
 let c=new ExtractionCore(file);
 assert.equal(c.progression('legacy').reputation,10);assert.equal(c.progression('legacy').gold,250);
 assert.equal(c.market().stock.find(s=>s.offerId==='potion').quantity,3);assert.equal(c.snapshot('legacy').stash[0].id,'kept');
 assert.equal(c.row('SELECT terms FROM mission_instances WHERE id=?','old-mission').terms,terms);
 assert.equal(c.row('SELECT result FROM receipts WHERE request_id=?','historical').result,'{"ok":true}');
 assert.deepEqual(c.projectionMetadata(),{databaseId:'old-database',revision:41});c.close();
 c=new ExtractionCore(file);try{assert.equal(c.projectionMetadata().revision,41);assert.equal(c.progression('legacy').reputation,10);}finally{c.close();}
});
