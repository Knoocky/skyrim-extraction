import test from 'node:test';
import assert from 'node:assert/strict';
import {createCombat,advanceCombat,commandCombat,contactCombat,attackProfile} from '../src/combat.ts';
import {CombatAdapter} from '../adapters/combat.ts';
const player={id:'alice',kind:'player',team:'players',weapon:'sword',weight:'medium',shield:true};
const enemy={id:'bandit',kind:'npc',team:'bandits',weapon:'sword',weight:'medium',shield:true};
const state=()=>createCombat('raid1',[player,enemy]);
const actor=(s,id='alice')=>s.actors.find(a=>a.id===id);
const cmd=(s,id,intent)=>commandCombat(s,id,actor(s,id).sequence+1,intent).state;
const hit=(s,patch={})=>contactCombat(s,{attackerId:'alice',targetId:'bandit',serial:actor(s).action.serial,tick:s.tick,distance:1,inArc:true,facing:true,clear:true,safeZone:false,...patch});
function attack(s=state(),kind='light') {return advanceCombat(cmd(s,'alice',kind),s.tick+attackProfile(actor(s).weapon,kind).windup);}
function finish(s) {return advanceCombat(s,s.tick+90);}

test('combat startup/active/recovery boundaries and immutable rejected commands',()=>{
 const initial=state(),s=cmd(initial,'alice','light');assert.equal(actor(initial).stamina,100000);
 assert.equal(actor(s).stamina,78000);
 assert.throws(()=>hit(advanceCombat(s,11)),/OUTSIDE_HIT_WINDOW/);
 const active=advanceCombat(s,12);assert.equal(hit(active).event.damage,22);
 assert.equal(hit(advanceCombat(s,17)).event.damage,22);
 assert.throws(()=>hit(advanceCombat(s,18)),/OUTSIDE_HIT_WINDOW/);
 assert.throws(()=>cmd(advanceCombat(s,35),'alice','dodge'),/COMBAT_BUSY/);
 assert.equal(actor(cmd(advanceCombat(s,36),'alice','dodge')).action.kind,'dodge');
 assert.deepEqual(s,cmd(initial,'alice','light'));
});
test('latest identical retry is stable; changed, old and skipped sequences fail',()=>{
 const r=commandCombat(state(),'alice',1,'light');
 assert.deepEqual(commandCombat(r.state,'alice',1,'light'),r);
 assert.throws(()=>commandCombat(r.state,'alice',1,'heavy'),/COMBAT_SEQUENCE_REUSED/);
 assert.throws(()=>commandCombat(r.state,'alice',3,'heavy'),/COMBAT_OUT_OF_ORDER/);
 const s=cmd(finish(r.state),'alice','heavy');
 assert.throws(()=>commandCombat(s,'alice',1,'light'),/COMBAT_OUT_OF_ORDER/);
});
test('one swing hits a target once, stale swing cannot hit on a later attack',()=>{
 let s=attack();const first=hit(s);assert.equal(actor(first.state,'bandit').hp,78);
 assert.equal(hit(first.state).event,null);
 s=attack(finish(first.state));assert.throws(()=>hit(s,{serial:1}),/STALE_COMBAT_ATTACK/);
 assert.equal(hit(s).event.damage,22);
});
test('heavy attack has higher stamina, damage and recovery costs',()=>{
 const s=attack(state(),'heavy');assert.equal(actor(s).stamina,64000);assert.equal(hit(s).event.damage,38);
 assert.throws(()=>cmd(advanceCombat(s,63),'alice','light'),/COMBAT_BUSY/);
 assert.equal(actor(advanceCombat(s,64)).action.kind,'idle');
});
test('light combo follows recovery, ends after three links or a delayed input',()=>{
 let s=state();
 for(const combo of [1,2,3,1]){s=cmd(s,'alice','light');assert.equal(actor(s).action.combo,combo);s=advanceCombat(s,s.tick+36);}
 s=advanceCombat(s,s.tick+60);assert.equal(actor(cmd(s,'alice','light')).action.combo,1);
});
test('stamina cannot go negative, regenerates only after delay and at bounded rate',()=>{
 let s=state();for(let i=0;i<3;i++){s=cmd(s,'alice','dodge');s=advanceCombat(s,s.tick+32);}
 assert.equal(actor(s).stamina,10000);assert.throws(()=>cmd(s,'alice','dodge'),/COMBAT_STAMINA_LOW/);
 const t=s.tick;s=advanceCombat(s,123);assert.equal(actor(s).stamina,10000);
 s=advanceCombat(s,124);assert.equal(actor(s).stamina,10300);assert.ok(t<124);
 for(let i=0;i<10;i++)s=advanceCombat(s,s.tick+120);
 assert.equal(actor(s).stamina,100000);
});
test('weight controls dodge cost, invulnerability boundaries and recovery',()=>{
 for(const [weight,cost,begin,end,duration] of [['light',24000,2,12,26],['medium',30000,3,12,32],['heavy',38000,5,11,42]]){
  // Start target dodge so each tested contact falls inside attack's active window.
  for(const [age,dodged] of [[begin-1,false],[begin,true],[end-1,true],[end,false]]){
   let s=createCombat('raid1',[player,{...enemy,weight}]);s=cmd(s,'alice','heavy');
   s=advanceCombat(s,26-age);s=cmd(s,'bandit','dodge');assert.equal(actor(s,'bandit').stamina,100000-cost);
   s=advanceCombat(s,26);assert.equal(hit(s).event.outcome,dodged?'dodged':'hit');
  }
  let s=createCombat('raid1',[player,{...enemy,weight}]);s=cmd(s,'bandit','dodge');
  assert.equal(actor(advanceCombat(s,duration-1),'bandit').action.kind,'dodge');
  assert.equal(actor(advanceCombat(s,duration),'bandit').action.kind,'idle');
 }
});
test('front shield blocks; back hit bypasses; guard cannot refresh via spam',()=>{
 let s=cmd(state(),'bandit','guard');assert.throws(()=>cmd(s,'bandit','guard'),/ALREADY_GUARDING/);
 s=attack(s);const r=hit(s);assert.equal(r.event.outcome,'blocked');assert.equal(actor(r.state,'bandit').hp,100);
 assert.equal(actor(r.state,'bandit').stamina,65000);
 assert.equal(hit(s,{facing:false}).event.outcome,'hit');
 assert.equal(actor(cmd(r.state,'bandit','releaseGuard'),'bandit').action.kind,'idle');
});
test('guard break spends remaining stamina, staggers and deals chip damage',()=>{
 let s=cmd(state(),'bandit','guard');s=hit(attack(s,'heavy')).state;
 s=finish(s);s=attack(s,'heavy');const r=hit(s);
 assert.equal(r.event.outcome,'guardBreak');assert.equal(r.event.damage,19);
 assert.equal(actor(r.state,'bandit').stamina,0);assert.equal(actor(r.state,'bandit').action.kind,'stagger');
});
test('parry has startup, finite directional window and exposes recovery',()=>{
 for(const [age,success] of [[2,false],[3,true],[8,true],[9,false]]){
  let s=cmd(state(),'alice','heavy');s=advanceCombat(s,26-age);s=cmd(s,'bandit','parry');s=advanceCombat(s,26);
  const r=hit(s);assert.equal(r.event.outcome,success?'parried':'hit');
  if(success){assert.equal(actor(r.state).action.kind,'stagger');assert.equal(actor(r.state,'bandit').hp,100);}
  assert.equal(hit(s,{facing:false}).event.outcome,'hit');
 }
});
test('poise accumulates stagger and recovers after quiet interval',()=>{
 let s=hit(attack(state(),'heavy')).state;assert.equal(actor(s,'bandit').poise,35);
 s=hit(attack(finish(s),'heavy')).state;assert.equal(actor(s,'bandit').action.kind,'stagger');
 assert.throws(()=>cmd(s,'bandit','light'),/COMBAT_BUSY/);
 s=advanceCombat(s,s.tick+120);s=advanceCombat(s,s.tick+60);assert.equal(actor(s,'bandit').poise,100);
});
test('range, arc, obstruction, safe zones and friendly fire suppress damage',()=>{
 const s=attack();
 for(const patch of [{distance:2.3},{inArc:false},{clear:false},{safeZone:true}])assert.equal(hit(s,patch).event,null);
 assert.equal(hit(attack(createCombat('raid1',[player,{...enemy,team:'players'}]))).event,null);
 for(const pvp of [false,true]){
  const s=attack(createCombat('raid1',[player,{...enemy,kind:'player'}],pvp));assert.equal(hit(s).event!==null,pvp);
 }
});
test('death emits once, cannot act or regenerate and input state remains intact',()=>{
 let s=state(),death;
 for(let i=0;i<3;i++){const r=hit(attack(s,'heavy'));death=r.event;s=finish(r.state);}
 assert.equal(death.killed,true);assert.equal(actor(s,'bandit').hp,0);
 assert.equal(actor(s,'bandit').action.kind,'dead');assert.throws(()=>cmd(s,'bandit','dodge'),/COMBAT_ACTOR_DEAD/);
 assert.throws(()=>hit(attack(s)),/INVALID_COMBAT_TARGET/);
});
test('untrusted numeric/boolean values, unsupported profiles and excessive rosters fail',()=>{
 for(const tick of [NaN,Infinity,-1,0.5,121])assert.throws(()=>advanceCombat(state(),tick),/INVALID_COMBAT_TICK/);
 for(const patch of [{distance:NaN},{distance:-1},{clear:1},{safeZone:'false'},{tick:0},{serial:NaN}])assert.throws(()=>hit(attack(),patch));
 for(const patch of [{weapon:'unknown'},{weight:'unknown'},{shield:'true'},{id:'bad:id'},{team:''}])assert.throws(()=>createCombat('world',[{...player,...patch}]));
 assert.throws(()=>createCombat('world',[player,player]),/DUPLICATE_COMBAT_ACTOR/);
 assert.throws(()=>createCombat('world',Array.from({length:5},(_,i)=>({...player,id:'p'+i}))),/COMBAT_CAPACITY/);
 assert.throws(()=>cmd(createCombat('world',[{...player,shield:false}]),'alice','parry'),/SHIELD_REQUIRED/);
});
function harness(overrides={}){
 const log=[];let ready=true;
 const port={ready:()=>ready,session:id=>id==='socket'?{actorId:'alice',worldId:'raid1'}:null,
  observe:()=>({distance:1,inArc:true,facing:true,clear:true,safeZone:false}),
  applyAndVerify:async p=>{log.push(p);return true;},freeze:async()=>{},resume:async()=>{},...overrides};
 const host=new CombatAdapter('raid1',[player,enemy],port);
 return {host,log,port,loseLease:()=>{ready=false;}};
}
const packet=(sequence=1,intent='light')=>({version:1,sequence,intent});
test('adapter requires verified identity; client cannot submit damage, positions or target',async()=>{
 const {host,log}=harness();await host.start();
 await assert.rejects(host.execute('intruder',packet()),/COMBAT_LOGIN_REQUIRED/);
 for(const extra of [{actorId:'bandit'},{damage:999},{tick:12},{targetId:'bandit'}])await assert.rejects(host.execute('socket',{...packet(),...extra}),/INVALID_COMBAT_PACKET/);
 await host.execute('socket',packet());const n=log.length;await host.execute('socket',packet());assert.equal(log.length,n);
 await assert.rejects(host.execute('socket',packet(2,'recordDeath')),/UNKNOWN_COMBAT_INTENT/);
 await assert.rejects(host.execute('socket',{...packet(2),version:2}),/COMBAT_VERSION_MISMATCH/);
});
test('adapter serializes concurrent actions instead of losing state during await',async()=>{
 let release;const h=harness();await h.host.start();
 h.port.applyAndVerify=()=>new Promise(r=>{release=r;});
 const first=h.host.execute('socket',packet());
 await assert.rejects(h.host.execute('socket',packet()),/COMBAT_BUSY/);
 release(true);await first;assert.equal(actor(h.host.snapshot()).stamina,78000);
});
test('uncertain projection freezes; retry delivers same checkpoint and effects',async()=>{
 let failing=false,frozen=0;const ids=[];
 const h=harness({freeze:async()=>{frozen++;},applyAndVerify:async p=>{ids.push(p.id);if(failing)throw Error('lost response');return true;}});
 await h.host.start();failing=true;await assert.rejects(h.host.execute('socket',packet()),/lost response/);
 await assert.rejects(h.host.advance(12),/COMBAT_NOT_READY/);failing=false;await h.host.retry();
 assert.equal(ids.at(-1),ids.at(-2));assert.ok(frozen>=2);assert.equal(actor(h.host.snapshot()).stamina,78000);
 await h.host.execute('socket',packet());assert.equal(ids.length,3);
});
test('lease loss and stop during projection cannot resume a live combat session',async()=>{
 const h=harness();await h.host.start();h.loseLease();await assert.rejects(h.host.advance(1),/COMBAT_LEASE_LOST/);
 const x=harness();await x.host.start();let release;
 x.port.applyAndVerify=()=>new Promise(r=>{release=r;});const pending=x.host.execute('socket',packet());
 await new Promise(r=>setImmediate(r));await x.host.stop();release(true);
 await assert.rejects(pending,/COMBAT_LEASE_LOST/);await assert.rejects(x.host.retry(),/COMBAT_NOT_RETRYABLE/);
});
test('engine collision is mandatory; death event retry preserves economic receipt key',async()=>{
 const h=harness();await h.host.start();
 for(let i=1;i<=3;i++){
  await h.host.execute('socket',packet(i,'heavy'));await h.host.advance(h.host.snapshot().tick+26);
  if(i===1){h.port.observe=()=>null;assert.equal(await h.host.contact('alice','bandit',i),null);h.port.observe=()=>({distance:1,inArc:true,facing:true,clear:true,safeZone:false});}
  if(i===3){
   const received=[];let fail=true;h.port.applyAndVerify=async p=>{received.push(p);if(fail)throw Error('after commit');return true;};
   await assert.rejects(h.host.contact('alice','bandit',i),/after commit/);fail=false;await h.host.retry();
   assert.deepEqual(received[0],received[1]);assert.equal(received[0].events[0].id,'raid1:alice:3:bandit');assert.equal(received[0].events[0].killed,true);
  }else {await h.host.contact('alice','bandit',i);await h.host.advance(h.host.snapshot().tick+90);}
 }
});
test('snapshot cannot mutate live state; NPC actions require trusted AI route',async()=>{
 const h=harness();await h.host.start();const s=h.host.snapshot();actor(s).hp=0;
 assert.equal(actor(h.host.snapshot()).hp,100);await assert.rejects(h.host.npc('alice',1,'light'),/COMBAT_NPC_REQUIRED/);
 await h.host.npc('bandit',1,'light');assert.equal(actor(h.host.snapshot(),'bandit').action.kind,'light');
});

test('frame batching is deterministic across all weapon profiles',()=>{
 for(const weapon of ['sword','axe','dagger']){
  const s=cmd(createCombat('raid1',[{...player,weapon},enemy]),'alice','light');
  let fine=s;for(let i=1;i<=120;i++)fine=advanceCombat(fine,i);
  assert.deepEqual(fine,advanceCombat(s,120));
 }
});
