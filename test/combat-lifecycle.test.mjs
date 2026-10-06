import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COMBAT_MANIFEST,createCombat,advanceCombat,commandCombat,contactCombat} from '../src/combat.ts';
import {lifecycleCombat} from '../src/combat-lifecycle.ts';
import {CombatAdapter} from '../adapters/combat.ts';
import {CombatJournal} from '../src/combat-journal.ts';
const p={id:'player1',kind:'player',team:'players',weapon:'sword',weight:'medium',shield:true};
const n={...p,id:'npc1',kind:'npc',team:'enemies'};
const initial=()=>createCombat('world',[p,n]);
const actor=(s,id='player1')=>s.actors.find(a=>a.id===id);
const life=(s,c)=>lifecycleCombat(s,s.systemSequence+1,c);
const equip={kind:'equip',actorId:'player1',weapon:'axe',weight:'heavy',shield:false};
const packet=(sequence=1)=>({version:COMBAT_MANIFEST.version,rulesHash:COMBAT_MANIFEST.rulesHash,sequence,intent:'light'});
test('equipment switch preserves health/resources/sequence and imposes recovery',()=>{
 let s=commandCombat(initial(),'player1',1,'light').state;s=advanceCombat(s,36);
 const before=structuredClone(s);s=life(s,equip);
 assert.equal(actor(s).weapon,'axe');assert.equal(actor(s).hp,actor(before).hp);assert.equal(actor(s).stamina,actor(before).stamina);assert.equal(actor(s).sequence,1);
 assert.throws(()=>commandCombat(s,'player1',2,'light'),/COMBAT_BUSY/);
 assert.throws(()=>commandCombat(advanceCombat(s,53),'player1',2,'light'),/COMBAT_BUSY/);
 assert.equal(actor(commandCombat(advanceCombat(s,54),'player1',2,'light').state).action.combo,1);
 assert.throws(()=>life(commandCombat(initial(),'player1',1,'heavy').state,equip),/COMBAT_BUSY/);
 assert.deepEqual(before,advanceCombat(commandCombat(initial(),'player1',1,'light').state,36));
});
test('disconnect drops guard and keeps actor vulnerable; reconnect never refills or resets sequence',()=>{
 let s=commandCombat(initial(),'player1',1,'guard').state;s=life(s,{kind:'disconnect',actorId:'player1'});
 assert.equal(actor(s).connected,false);assert.equal(actor(s).action.kind,'idle');
 assert.throws(()=>commandCombat(s,'player1',2,'dodge'),/COMBAT_DISCONNECTED/);
 s=commandCombat(s,'npc1',1,'light').state;s=advanceCombat(s,12);
 s=contactCombat(s,{attackerId:'npc1',targetId:'player1',serial:1,tick:12,distance:1,inArc:true,facing:true,clear:true,safeZone:false}).state;
 assert.equal(actor(s).hp,78);s=life(s,{kind:'reconnect',actorId:'player1'});
 assert.equal(actor(s).hp,78);assert.equal(actor(s).sequence,1);
 assert.throws(()=>commandCombat(s,'player1',1,'dodge'),/COMBAT_SEQUENCE_REUSED/);
});
test('spawn enforces capacity and uniqueness; retirement cannot erase a dangerous live actor',()=>{
 let s=initial();assert.throws(()=>life(s,{kind:'retire',actorId:'player1',safeZone:false}),/COMBAT_RETIRE_UNSAFE/);
 s=life(s,{kind:'spawn',fighter:{...n,id:'npc2'}});assert.equal(s.actors.length,3);
 assert.throws(()=>life(s,{kind:'spawn',fighter:n}),/DUPLICATE_COMBAT_ACTOR/);
 s=life(s,{kind:'retire',actorId:'npc2',safeZone:true});assert.equal(s.actors.length,2);
 assert.throws(()=>life(s,{kind:'spawn',fighter:{...n,id:'npc2'}}),/COMBAT_ID_RETIRED/);
 s=life(s,{kind:'disconnect',actorId:'player1'});
 assert.throws(()=>life(s,{kind:'retire',actorId:'player1',safeZone:true}),/COMBAT_RETIRE_UNSAFE/);
 let full=createCombat('world',Array.from({length:32},(_,i)=>({...n,id:'n'+i})));
 assert.throws(()=>life(full,{kind:'spawn',fighter:p}),/COMBAT_CAPACITY/);
});
test('new life needs new actor ID; dead actor can retire but reconnect does not resurrect',()=>{
 let s=initial();actor(s).hp=0;actor(s).action.kind='dead';
 s=life(s,{kind:'reconnect',actorId:'player1'});assert.equal(actor(s).hp,0);
 assert.throws(()=>life(s,equip),/COMBAT_ACTOR_DEAD/);
 s=life(s,{kind:'retire',actorId:'player1',safeZone:false});
 assert.throws(()=>life(s,{kind:'spawn',fighter:p}),/COMBAT_ID_RETIRED/);
 s=life(s,{kind:'spawn',fighter:{...p,id:'player2'}});assert.equal(actor(s,'player2').hp,100);
});
test('lifecycle sequences are independently ordered with normalized exact retry',()=>{
 const first=lifecycleCombat(initial(),1,equip);
 assert.deepEqual(lifecycleCombat(first,1,{shield:false,weight:'heavy',weapon:'axe',actorId:'player1',kind:'equip'}),first);
 assert.throws(()=>lifecycleCombat(first,1,{...equip,weapon:'dagger'}),/SYSTEM_SEQUENCE_REUSED/);
 assert.throws(()=>lifecycleCombat(first,3,{kind:'disconnect',actorId:'player1'}),/SYSTEM_OUT_OF_ORDER/);
 for(const c of [{...equip,hp:100},{...equip,weapon:'constructor'},{kind:'retire',actorId:'player1',safeZone:1},{kind:'heal',actorId:'player1'},{kind:'spawn',fighter:{...n,id:'x',hp:999}}])assert.throws(()=>life(first,c));
});
test('adapter verifies rules hash and explicit lifecycle authority; retries do not reapply',async()=>{
 let applied=0;const port={ready:()=>true,session:()=>({worldId:'world',actorId:'player1'}),observe:()=>null,applyAndVerify:async()=>{applied++;return true;},freeze:async()=>{},resume:async()=>{}};
 const a=new CombatAdapter('world',[p,n],port);await a.start();
 await assert.rejects(a.execute('socket',{...packet(),rulesHash:'wrong'}),/COMBAT_VERSION_MISMATCH/);
 await assert.rejects(a.execute('socket',{...packet(),version:1}),/COMBAT_VERSION_MISMATCH/);
 await assert.rejects(a.lifecycle(1,equip),/COMBAT_LIFECYCLE_DENIED/);
 port.approveLifecycle=()=>1;await assert.rejects(a.lifecycle(1,equip),/COMBAT_LIFECYCLE_DENIED/);
 port.approveLifecycle=()=>true;await a.lifecycle(1,equip);const count=applied;
 port.approveLifecycle=()=>false;await a.lifecycle(1,equip);assert.equal(applied,count);
 await assert.rejects(a.execute('socket',{...packet(),intent:'equip'}),/UNKNOWN_COMBAT_INTENT/);
});
test('lost lifecycle projection retries the same system sequence and snapshot',async()=>{
 let fail=false;const received=[];const port={ready:()=>true,session:()=>null,approveLifecycle:()=>true,observe:()=>null,
 applyAndVerify:async c=>{received.push(c);if(fail)throw Error('lost');return true;},freeze:async()=>{},resume:async()=>{}};
 const a=new CombatAdapter('world',[p,n],port);await a.start();fail=true;
 await assert.rejects(a.lifecycle(1,equip),/lost/);fail=false;await a.retry();
 assert.deepEqual(received.at(-1),received.at(-2));assert.equal(a.snapshot().systemSequence,1);
});
test('journal closure is durable, refuses pending effects and forbids reopening a world',t=>{
 const dir=mkdtempSync(join(tmpdir(),'combat-seal-')),file=join(dir,'state.sqlite');let j=new CombatJournal(file);
 t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true});});
 const c={id:'world:combat:1',revision:1,state:initial(),events:[]};j.stage(c,()=>[]);
 assert.throws(()=>j.seal('world'),/COMBAT_CHECKPOINT_PENDING/);j.acknowledge(c);j.seal('world');j.close();j=new CombatJournal(file);
 assert.throws(()=>j.stage(c,()=>[]),/COMBAT_WORLD_CLOSED/);
 assert.throws(()=>j.stage({...c,id:'world:combat:2',revision:2},()=>[]),/COMBAT_WORLD_CLOSED/);
 j.seal('world');
 const other={...c,id:'newworld:combat:1',state:createCombat('newworld',[p])};j.stage(other,()=>[]);
});
test('legacy combat state is refused instead of silently resetting it',t=>{
 const j=new CombatJournal(':memory:');t.after(()=>j.close());
 const c={id:'world:combat:1',revision:1,state:{...initial(),version:1},events:[]};
 assert.throws(()=>j.stage(c,()=>[]),/INVALID_COMBAT_CHECKPOINT/);assert.equal(j.pending('world'),null);
});
