import {ExtractionCore} from '../src/core.mjs';
import {RaidService,RaidCoordinator,AdapterGateway,COMBAT_MANIFEST} from '../adapters/raid-runtime.ts';
import {ADAPTER_MANIFEST} from '../src/manifest.ts';
import {attackProfile} from '../src/combat.ts';
import {SimulatedRaidProjector} from '../src/raid-projector.ts';
import {ITEMS} from '../src/catalog.mjs';
import {canonical} from '../src/manifest.ts';
import {randomUUID} from 'node:crypto';
/** Isolated offline fixture. All identities and geometry here are deliberately fake. */
export async function createRaidSandbox(filename,projectionFilename,{players=1,npcs=1}={}){
 const core=new ExtractionCore(filename,{authority:{canPickup:()=>true}}),projector=new SimulatedRaidProjector(projectionFilename);
 const loot=['iron_shield','leather_armor','iron_armor','fire_staff',{template:'iron_arrow',quantity:30},{template:'healing_potion',quantity:5},{template:'magicka_potion',quantity:3},{template:'stamina_potion',quantity:3}];
 const world=core.createRaid(randomUUID(),loot),bindings=[],sessions={};
 for(let i=0;i<players;i++){
  const playerId='player'+i,r=core.registerPlayer('register'+i,playerId),expedition=core.joinRaid('join'+i,playerId,world.raidId,r.items.map(x=>x.id));
  bindings.push({playerId,expeditionId:expedition.expeditionId,loadout:{weaponId:r.items.find(x=>x.template==='iron_sword').id}});
  sessions[playerId]=core.openConnection('connect'+i,playerId).connectionId;
 }
 for(const item of world.items)core.pickup('pickup'+item.id,'player0',world.raidId,world.containerId,item.id,bindings[0].expeditionId);
 bindings[0].loadout.shieldId=world.items.find(x=>x.template==='iron_shield').id;
 const service=new RaidService(core);service.create(world.raidId,bindings,Array.from({length:npcs},(_,i)=>({id:'enemy'+i,kind:'npc',team:'bandits',weapon:'sword',weight:'medium',shield:true,target:'bandit'})));
 const gateway=new AdapterGateway(core),lease=gateway.handshake({requestId:'sandbox',holderId:'simulation',manifest:ADAPTER_MANIFEST});
 let failNext=false;
 const port={session:t=>sessions[t]??null,freeze:async epoch=>projector.freeze(epoch),
  replaceAndVerify:async(s,epoch)=>{const ok=projector.apply(s,epoch);if(failNext){failNext=false;throw Error('SIMULATED_REPLY_LOSS');}return ok;},
  heartbeat:async(epoch,deadline)=>projector.heartbeat(epoch,deadline),resume:async(s,epoch,deadline)=>projector.resume(s,epoch,deadline),observe:()=>({distance:1,inArc:true,facing:true,clear:true,safeZone:false})};
 const host=new RaidCoordinator(service,gateway,lease,world.raidId,port);await host.start();
 const events=[],receipts=new Map();let busy=false;
 const state=()=>({ready:host.ready,snapshot:host.snapshot(),manifest:COMBAT_MANIFEST,items:ITEMS,events:events.slice(-30)});
 async function step(ticks){
  if(!Number.isInteger(ticks)||ticks<1||ticks>120)throw Error('INVALID_COMBAT_TICK');
  const end=host.snapshot().combat.tick+ticks;let nextHeartbeat=performance.now()+5000;
  while(host.snapshot().combat.tick<end){
   if(performance.now()>=nextHeartbeat){await host.heartbeat();nextHeartbeat=performance.now()+5000;}
   const current=host.snapshot().combat;
   const contacts=current.actors.filter(a=>a.hp>0&&['light','heavy'].includes(a.action.kind)).map(a=>a.action.start+attackProfile(a.weapon,a.action.kind).windup).filter(t=>t>current.tick);
   await host.advance(Math.min(end,...contacts));
   for(const id of host.snapshot().combat.actors.map(a=>a.id)){
    // Earlier contacts at this same tick can interrupt or kill a later attacker.
    const latest=host.snapshot().combat,a=latest.actors.find(a=>a.id===id);
    if(!a||!['light','heavy'].includes(a.action.kind)||a.hp===0)continue;
    if(latest.tick-a.action.start!==attackProfile(a.weapon,a.action.kind).windup)continue;
    const target=latest.actors.find(b=>b.team!==a.team&&b.hp>0);if(!target)continue;
    const hit=await host.contact('contact-'+a.id+'-'+a.action.serial+'-'+target.id,a.id,target.id,a.action.serial);
    if(hit.result)events.push(hit.result);if(events.length>30)events.shift();
   }
  }
 }
 return {core,host,projector,bindings,state,async execute(raw){
  if(busy)throw Error('RAID_BUSY');busy=true;
  try{
   if(!raw||typeof raw.requestId!=='string'||raw.requestId.length<1||raw.requestId.length>200||typeof raw.operation!=='string'||!raw.payload||typeof raw.payload!=='object'||Array.isArray(raw.payload)||Object.keys(raw).some(k=>!['operation','requestId','payload'].includes(k)))throw Error('INVALID_DEMO_INTENT');
   const key=raw.requestId,body=canonical(raw),old=receipts.get(key);if(old){if(old.body!==body)throw Error('REQUEST_ID_REUSED');return state();}
   await host.heartbeat();
   if(raw.operation==='retry')await host.retry();
   else if(raw.operation==='step')await step(raw.payload.ticks);
   else if(raw.operation==='enemy'){
    const enemy=host.snapshot().combat.actors.find(a=>a.kind==='npc'&&a.hp>0);if(!enemy)throw Error('NO_ENEMY');
    await host.npc(key,enemy.id,enemy.sequence+1,raw.payload.intent??'light');
   }else if(raw.operation==='fault'){failNext=true;}
   else if(raw.operation==='recover')await host.recover(key);
   else await host.execute('player0',raw);
   receipts.set(key,{body});if(receipts.size>2000)receipts.delete(receipts.keys().next().value);return state();
  }finally{busy=false;}
 },close(){projector.close();core.close();}};
}
