import {ExtractionCore} from '../src/core.mjs';
import {RaidService,RaidCoordinator,AdapterGateway,COMBAT_MANIFEST} from '../adapters/raid-runtime.ts';
import {ADAPTER_MANIFEST} from '../src/manifest.ts';
export function raidFixture(filename=':memory:',players=1,npcs=1){
 const core=new ExtractionCore(filename,{authority:{canPickup:()=>true}});
 const loot=['iron_shield','leather_armor','iron_armor','fire_staff',{template:'iron_arrow',quantity:20},{template:'healing_potion',quantity:5},{template:'stamina_potion',quantity:5},{template:'magicka_potion',quantity:5},{template:'resist_fire_potion',quantity:5},{template:'resist_frost_potion',quantity:5}];
 const world=core.createRaid('fixture-world',loot),bindings=[],connections={};
 for(let i=0;i<players;i++){
  const playerId='player'+i,r=core.registerPlayer('register-'+i,playerId);core.acceptMission('quest-'+i,playerId,'wolf_hunt');const e=core.joinRaid('join-'+i,playerId,world.raidId,r.items.map(x=>x.id));
  const loadout={weaponId:r.items.find(x=>x.template==='iron_sword').id};
  bindings.push({playerId,expeditionId:e.expeditionId,loadout});connections[playerId]=core.openConnection('connect-'+i,playerId).connectionId;
 }
 for(const item of world.items)core.pickup('pick-'+item.id,'player0',world.raidId,world.containerId,item.id,bindings[0].expeditionId);
 const enemies=Array.from({length:npcs},(_,i)=>({id:'enemy'+i,kind:'npc',team:'bandits',weapon:'sword',weight:'medium',shield:true,target:'bandit'}));
 const service=new RaidService(core);service.create(world.raidId,bindings,enemies);
 const gateway=new AdapterGateway(core),lease=gateway.handshake({requestId:'lease',holderId:'fixture',manifest:ADAPTER_MANIFEST});
 const log=[];let applied=null,frozen=true;
 const port={heartbeat:async()=>{},session:t=>connections[t]??null,freeze:async()=>{frozen=true;log.push('freeze');},
  replaceAndVerify:async s=>{applied=structuredClone(s);log.push('project');return true;},
  resume:async()=>{frozen=false;log.push('resume');return true;},
  observe:()=>({distance:1,inArc:true,facing:true,clear:true,safeZone:false}),canPickup:()=>true};
 const host=new RaidCoordinator(service,gateway,lease,world.raidId,port);
 const ack=()=>{const s=service.snapshot(world.raidId);service.acknowledge(world.raidId,s.revision,s.economy.databaseId,s.economy.revision);};
 const actor=(id=bindings[0].expeditionId)=>service.snapshot(world.raidId).combat.actors.find(x=>x.id===id);
 const item=template=>{const items=core.snapshot('player0').active.items;return items.find(x=>x.id===world.items.find(x=>x.template===template)?.id)??items.find(x=>x.template===template);};
 return {core,world:world.raidId,bindings,connections,service,gateway,lease,host,port,log,ack,actor,item,get applied(){return applied;},get frozen(){return frozen;}};
}
export const input=(requestId,sequence,intent='light')=>({requestId,operation:'input',payload:{version:COMBAT_MANIFEST.version,rulesHash:COMBAT_MANIFEST.rulesHash,sequence,intent}});
export function hurt(f,hp=30){const s=f.service.snapshot(f.world).combat;s.actors[0].hp=hp;f.core.run('UPDATE raid_combat SET state=? WHERE world_id=?',JSON.stringify(s),f.world);}
