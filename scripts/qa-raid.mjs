import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createRaidSandbox} from './raid-sandbox.mjs';
import {raidDiagnostics} from '../src/raid-diagnostics.mjs';
import {COMBAT_MANIFEST} from '../src/combat.ts';
const frames=Number(process.argv[2]??600);
if(!Number.isInteger(frames)||frames<60||frames>36000)throw Error('usage: node scripts/qa-raid.mjs [60..36000 frames]');
const dir=mkdtempSync(join(tmpdir(),'raid-qa-')),filename=join(dir,'core.sqlite');
const sim=await createRaidSandbox(filename,join(dir,'projection.sqlite'),{players:4,npcs:28});
const times=[];let writes=0,nextHeartbeat=performance.now()+5000;
const measure=async(fn)=>{if(performance.now()>=nextHeartbeat){await sim.host.heartbeat();nextHeartbeat=performance.now()+5000;}const start=performance.now();await fn();times.push(performance.now()-start);writes++;};
const start=performance.now();
try{
 for(let frame=1;frame<=frames;frame++){
  await measure(()=>sim.host.advance(frame));
  if(frame%90===1){
   const state=sim.host.snapshot();
   for(const a of state.combat.actors){
    if(a.kind==='player'){
     const b=state.metadata.players[a.id];
     await measure(()=>sim.host.execute(b.playerId,{requestId:'input-'+frame+'-'+a.id,operation:'input',payload:{version:COMBAT_MANIFEST.version,rulesHash:COMBAT_MANIFEST.rulesHash,sequence:a.sequence+1,intent:'light'}}));
    }else await measure(()=>sim.host.npc('npc-'+frame+'-'+a.id,a.id,a.sequence+1,'light'));
   }
  }
  // Exercise collision/readback on active NPC swings; obstructed geometry preserves the fixed load.
  if(frame%90===13){
   const state=sim.host.snapshot(),players=state.combat.actors.filter(a=>a.kind==='player'),npcs=state.combat.actors.filter(a=>a.kind==='npc');
   const original=sim.host.port.observe;sim.host.port.observe=()=>({distance:1,inArc:true,facing:true,clear:false,safeZone:false});
   try{for(const [i,a] of npcs.entries())await measure(()=>sim.host.contact('contact-'+frame+'-'+a.id,a.id,players[i%4].id,a.action.serial));}finally{sim.host.port.observe=original;}
  }
 }
 const elapsed=performance.now()-start,s=sim.host.snapshot();times.sort((a,b)=>a-b);
 assert.equal(s.revision,s.acknowledged);assert.deepEqual(raidDiagnostics(sim.core.db).violations,[]);
 assert.equal(sim.projector.db.prepare('SELECT frozen FROM projection').get().frozen,0);
 const quantile=p=>Number(times[Math.min(times.length-1,Math.floor(times.length*p))].toFixed(3));
 console.log(JSON.stringify({frames,players:4,npcs:28,projection:'SQLite FULL synchronous; replacement + readback',collision:'blocked by geometry, no damage',mutations:writes,elapsedMs:Math.round(elapsed),mutationsPerSecond:Math.round(writes*1000/elapsed),latencyMs:{p50:quantile(.5),p95:quantile(.95),p99:quantile(.99),max:quantile(1)},coreBytes:statSync(filename).size,walBytes:statSync(filename+'-wal').size,revision:s.revision,acknowledged:s.acknowledged}));
}finally{sim.close();rmSync(dir,{recursive:true,force:true});}
