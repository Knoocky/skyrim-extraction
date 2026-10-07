import test from 'node:test';
import assert from 'node:assert/strict';
import {createRaidSandbox} from '../scripts/raid-sandbox.mjs';
test('sandbox batched time preserves contact boundary and matches fine stepping',async t=>{
 const a=await createRaidSandbox(':memory:',':memory:'),b=await createRaidSandbox(':memory:',':memory:');t.after(()=>{a.close();b.close();});
 for(const sim of [a,b])await sim.execute({requestId:'enemy',operation:'enemy',payload:{intent:'light'}});
 await a.execute({requestId:'before',operation:'step',payload:{ticks:11}});assert.equal(a.state().snapshot.combat.actors[0].hp,100);
 await a.execute({requestId:'contact',operation:'step',payload:{ticks:1}});assert.equal(a.state().snapshot.combat.actors[0].hp,78);
 await a.execute({requestId:'finish',operation:'step',payload:{ticks:48}});
 await b.execute({requestId:'batch',operation:'step',payload:{ticks:60}});
 const values=sim=>sim.state().snapshot.combat.actors.map(a=>({hp:a.hp,stamina:a.stamina,poise:a.poise,sequence:a.sequence,action:a.action.kind}));
 assert.deepEqual(values(a),values(b));assert.equal(b.state().events[0].tick,12);assert.ok(b.state().snapshot.revision<a.state().snapshot.revision);
});
test('simultaneous contact rechecks attacker after an earlier lethal hit',async t=>{
 const sim=await createRaidSandbox(':memory:',':memory:');t.after(()=>sim.close());const state=sim.state(),combat=state.snapshot.combat;combat.actors[1].hp=10;sim.core.run('UPDATE raid_combat SET state=?',JSON.stringify(combat));
 await sim.execute({requestId:'player',operation:'input',payload:{version:state.manifest.version,rulesHash:state.manifest.rulesHash,sequence:1,intent:'light'}});
 await sim.execute({requestId:'enemy',operation:'enemy',payload:{intent:'light'}});await sim.execute({requestId:'step',operation:'step',payload:{ticks:60}});
 const result=sim.state();assert.equal(result.snapshot.combat.actors[0].hp,100);assert.equal(result.snapshot.combat.actors[1].hp,0);assert.equal(result.events.length,1);assert.equal(result.events[0].killed,true);assert.equal(result.ready,true);
});
