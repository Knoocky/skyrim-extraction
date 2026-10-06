import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CombatJournal} from '../src/combat-journal.ts';
import {CombatDelivery} from '../adapters/combat-delivery.ts';
import {ExtractionCore} from '../src/core.mjs';
import {dispatch,decodeCommand} from '../src/protocol.ts';
import {createCombat} from '../src/combat.ts';
const spec={id:'alice',kind:'player',team:'players',weapon:'sword',weight:'medium',shield:true};
function checkpoint(world='world',revision=1){return {id:`${world}:combat:${revision}`,revision,state:createCombat(world,[spec]),events:[]};}
function journal(t){const dir=mkdtempSync(join(tmpdir(),'combat-'));const path=join(dir,'combat.sqlite');let db=new CombatJournal(path);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});return {get db(){return db;},reopen(){db.close();db=new CombatJournal(path);return db;}};}
test('checkpoint journal enforces order, exact retry and pending recovery across reopen',t=>{
 const j=journal(t),p=checkpoint();j.db.stage(p,()=>[]);assert.deepEqual(j.reopen().pending('world'),p);
 assert.throws(()=>j.db.stage(checkpoint('world',2),()=>[]),/COMBAT_CHECKPOINT_PENDING/);
 const changed=structuredClone(p);changed.state.tick=1;assert.throws(()=>j.db.stage(changed,()=>[]),/COMBAT_CHECKPOINT_REUSED/);
 j.db.acknowledge(p);assert.equal(j.db.pending('world'),null);
 assert.throws(()=>j.db.stage(checkpoint('world',3),()=>[]),/COMBAT_CHECKPOINT_ORDER/);
 j.db.stage(checkpoint('world',2),()=>[]);assert.throws(()=>j.db.acknowledge(p),/COMBAT_CHECKPOINT_MISMATCH/);
});
test('death committed then response lost: reopened journal replays original expedition exactly once',async t=>{
 const j=journal(t),core=new ExtractionCore(':memory:');t.after(()=>core.close());
 const registration=core.registerPlayer('register','alice'),world=core.createRaid('world').raidId;
 const expedition=core.joinRaid('join','alice',world,[registration.items[0].id]);
 const binding={playerId:'alice',worldId:world,expeditionId:expedition.expeditionId};
 const p=checkpoint(world);p.state.actors[0].hp=0;p.state.actors[0].action.kind='dead';
 p.events=[{id:`${world}:bandit:1:alice`,tick:0,attackerId:'bandit',targetId:'alice',outcome:'hit',damage:100,killed:true}];
 let fail=true;const commands=[];
 const port={ready:()=>true,expedition:()=>binding,project:async()=>true,
  execute:async c=>{commands.push(c);const result=dispatch(core,decodeCommand(c));if(fail)throw Error('response lost');return result;}};
 let delivery=new CombatDelivery(j.db,port);await assert.rejects(delivery.deliver(p),/response lost/);
 assert.equal(core.snapshot('alice').active,null);
 fail=false;port.expedition=()=>{throw Error('must use durable original binding');};
 delivery=new CombatDelivery(j.reopen(),port);await delivery.deliver(j.db.pending(world));
 assert.deepEqual(commands[0],commands[1]);assert.equal(j.db.pending(world),null);
 assert.equal(Number(core.row("SELECT COUNT(*) AS n FROM receipts WHERE actor='system' AND request_id=?",p.events[0].id).n),1);
 assert.equal(core.rows("SELECT * FROM items WHERE id=?",registration.items[0].id).length,1);
 await delivery.deliver(p);assert.equal(commands.length,2);
});
test('projection mismatch stays pending; wrong/missing expedition cannot dispatch death',async t=>{
 const j=journal(t),p=checkpoint();p.state.actors[0].hp=0;
 p.events=[{id:'world:bandit:1:alice',tick:0,attackerId:'bandit',targetId:'alice',outcome:'hit',damage:100,killed:true}];
 let sent=0;const port={ready:()=>true,expedition:()=>null,execute:async()=>{sent++;},project:async()=>false};
 let delivery=new CombatDelivery(j.db,port);await assert.rejects(delivery.deliver(p),/COMBAT_EXPEDITION_MISSING/);assert.equal(sent,0);assert.equal(j.db.pending('world'),null);
 port.expedition=()=>({playerId:'alice',worldId:'world',expeditionId:'exp1'});
 await assert.rejects(delivery.deliver(p),/COMBAT_PROJECTION_MISMATCH/);assert.deepEqual(j.db.pending('world'),p);
});
test('journal resolution failure is atomic and leases are checked before side effects',async t=>{
 const j=journal(t),p=checkpoint();assert.throws(()=>j.db.stage(p,()=>{throw Error('binding failed');}),/binding failed/);
 assert.equal(j.db.pending('world'),null);
 const d=new CombatDelivery(j.db,{ready:()=>false,expedition:()=>null,execute:async()=>{assert.fail();},project:async()=>{assert.fail();}});
 await assert.rejects(d.deliver(p),/COMBAT_LEASE_LOST/);assert.equal(j.db.pending('world'),null);
});
