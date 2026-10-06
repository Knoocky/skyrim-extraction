import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCombat,advanceCombat,commandCombat,contactCombat} from '../src/combat.ts';
const count=Number(process.argv[2]??100),first=Number(process.argv[3]??1);
if(!Number.isSafeInteger(count)||count<1||count>1000||!Number.isSafeInteger(first)||first<1||first+count>0x7fffffff)throw Error('usage: node scripts/qa-combat.mjs [1..1000] [firstSeed]');
const hash=createHash('sha256');let deaths=0,contacts=0,accepted=0,rejected=0,timeouts=0;
const weapons=['sword','axe','dagger'],weights=['light','medium','heavy'],intents=['light','light','heavy','dodge','guard','releaseGuard','parry'];
for(let seed=first;seed<first+count;seed++){
 let rng=seed>>>0;const random=n=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%n;};
 let s=createCombat('seed'+seed,['a','b'].map(id=>({id,kind:id==='a'?'player':'npc',team:id,weapon:weapons[random(3)],weight:weights[random(3)],shield:true})),true);
 const events=new Set();const trace=[];
 try{
  for(let tick=1;tick<=3600&&!s.actors.some(a=>a.hp===0);tick++){
   s=advanceCombat(s,tick);
   for(const id of tick%2?['a','b']:['b','a']){
    let a=s.actors.find(x=>x.id===id);
    if(tick%6===0){
     const intent=intents[random(intents.length)],before=JSON.stringify(s);
     try{
      const r=commandCombat(s,id,a.sequence+1,intent);s=r.state;accepted++;
      assert.deepEqual(commandCombat(s,id,r.receipt.sequence,intent).state,s);
      trace.push([tick,id,intent]);if(trace.length>20)trace.shift();
     }catch(e){assert.ok(['COMBAT_BUSY','NOT_GUARDING','ALREADY_GUARDING','COMBAT_STAMINA_LOW','COMBAT_ACTOR_DEAD'].includes(e.code),e.message);assert.equal(JSON.stringify(s),before);rejected++;}
    }
    a=s.actors.find(x=>x.id===id);
    if(a.action.kind==='light'||a.action.kind==='heavy'){
     const c={attackerId:id,targetId:id==='a'?'b':'a',serial:a.action.serial,tick,distance:random(4)?1:3,inArc:random(5)!==0,facing:random(3)!==0,clear:random(8)!==0,safeZone:false};
     try{const r=contactCombat(s,c);s=r.state;if(r.event){assert.ok(!events.has(r.event.id));events.add(r.event.id);contacts++;if(r.event.killed)deaths++;}}
     catch(e){assert.ok(['OUTSIDE_HIT_WINDOW','INVALID_COMBAT_TARGET'].includes(e.code),e.message);}
    }
   }
   for(const a of s.actors){assert.ok(Number.isInteger(a.hp)&&a.hp>=0&&a.hp<=100);assert.ok(Number.isInteger(a.stamina)&&a.stamina>=0&&a.stamina<=100000);assert.ok(a.poise>=0&&a.poise<=100);assert.equal(a.action.kind==='dead',a.hp===0);}
  }
  if(!s.actors.some(a=>a.hp===0))timeouts++;
  hash.update(JSON.stringify(s));
 }catch(e){console.error(JSON.stringify({seed,trace,tick:s.tick}));throw e;}
}
console.log(JSON.stringify({sequences:count,firstSeed:first,accepted,rejected,contacts,deaths,timeouts,outcomeHash:hash.digest('hex')}));
