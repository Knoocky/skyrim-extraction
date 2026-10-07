import type {ExtractionCore} from './core.mjs';
import {createHash} from 'node:crypto';
import {REGION} from './region.mjs';
const nestedId=(id:string)=>'raid:'+createHash('sha256').update(id).digest('hex');
import {canonical} from './manifest.ts';
import {createCombat,advanceCombat,commandCombat,contactCombat,combatCheck as check,COMBAT_MANIFEST,type CombatState,type Contact,type FighterSpec,type Intent} from './combat.ts';
import {lifecycleCombat} from './combat-lifecycle.ts';
import {resolveGear,CONSUMABLE_EFFECTS,type Loadout} from './raid-gear.ts';
import {GEAR_RULES} from './raid-rules.mjs';
import {MISSION_TARGET_NAMES} from './missions.mjs';
import {ExtractionPolicy,type Observation} from './extraction-policy.ts';
interface PlayerBinding {playerId:string;expeditionId:string;loadout:Loadout}
interface Metadata {rulesHash:string;players:Record<string,PlayerBinding>;targets:Record<string,string>;damage:Record<string,number>;lastHurt:Record<string,number>}
export interface RaidSnapshot {worldId:string;revision:number;acknowledged:number;status:string;combat:CombatState;metadata:Metadata;economy:ReturnType<ExtractionCore['projection']>}
/** Trusted server domain; all combat + inventory + mission changes share core's transaction. */
export class RaidService {
 core:ExtractionCore;
 constructor(core:ExtractionCore){this.core=core;}
 snapshot(worldId:string):RaidSnapshot{
  return this.core.transaction(()=>{const r=this.core.row('SELECT * FROM raid_combat WHERE world_id=?',worldId);check(r,'COMBAT_WORLD_MISSING');
   return {worldId,revision:Number(r.revision),acknowledged:Number(r.acknowledged),status:String(r.status),combat:JSON.parse(String(r.state)),metadata:JSON.parse(String(r.bindings)),economy:this.core.projection()};});
 }
 private inventory(b:PlayerBinding,world:string){const p=this.core.active(b.playerId,world,b.expeditionId);check(p,'NOT_ACTIVE');return this.core.itemsAt(p.inventory_id) as unknown as {id:string;template:string;quantity:number}[];}
 create(worldId:string,players:(PlayerBinding&{team?:string})[],npcs:(FighterSpec&{target?:string})[]=[],pvp=false){
  return this.core.transaction(()=>{
   check(this.core.row("SELECT id FROM raids WHERE id=? AND status='OPEN'",worldId),'RAID_NOT_OPEN');
   check(!this.core.row('SELECT world_id FROM raid_combat WHERE world_id=?',worldId),'WORLD_ALREADY_CONFIGURED');
   check(!this.core.row("SELECT world_id FROM raid_combat WHERE status='OPEN'"),'RAID_ALREADY_ACTIVE');
   check(new Set(players.map(p=>p.playerId)).size===players.length,'DUPLICATE_COMBAT_PLAYER');
   check(players.length>0&&players.length<=4,'COMBAT_CAPACITY');
   check(Number(this.core.row("SELECT COUNT(*) AS n FROM participants WHERE raid_id=? AND status='ACTIVE'",worldId)?.n)===players.length,'UNBOUND_PARTICIPANT');
   const metadata:Metadata={rulesHash:COMBAT_MANIFEST.rulesHash,players:{},targets:{},damage:{},lastHurt:{}};
   const specs:FighterSpec[]=players.map(p=>{
    const gear=resolveGear(this.inventory(p,worldId),p.loadout);metadata.players[p.expeditionId]={playerId:p.playerId,expeditionId:p.expeditionId,loadout:p.loadout};
    return {id:p.expeditionId,kind:'player',team:p.team??'players',...gear};
   });
   for(const n of npcs){check(n.kind==='npc','COMBAT_NPC_REQUIRED');if(n.target){check(Object.hasOwn(MISSION_TARGET_NAMES,n.target),'UNKNOWN_MISSION_TARGET');metadata.targets[n.id]=n.target;}specs.push(n);}
   const state=createCombat(worldId,specs,pvp);
   for(const [actor,b] of Object.entries(metadata.players))state.actors.find(a=>a.id===actor)!.armor=resolveGear(this.inventory(b,worldId),b.loadout).armor;
   this.core.run('INSERT INTO raid_combat(world_id,state,bindings) VALUES (?,?,?)',worldId,JSON.stringify(state),JSON.stringify(metadata));
   return this.snapshot(worldId);
  });
 }
 private mutate(world:string,requestId:string,operation:string,payload:unknown,work:(s:RaidSnapshot)=>unknown,receipt=true,allowPending=false){
  check(typeof requestId==='string'&&requestId.length>0&&requestId.length<=200,'INVALID_REQUEST_ID');
  const fingerprint=canonical({operation,payload});
  return this.core.transaction(()=>{
   if(receipt){const previous=this.core.row('SELECT payload,result FROM raid_receipts WHERE world_id=? AND request_id=?',world,requestId);
    if(previous){check(previous.payload===fingerprint,'REQUEST_ID_REUSED');return JSON.parse(String(previous.result));}}
   const s=this.snapshot(world);check(s.status==='OPEN','COMBAT_WORLD_CLOSED');check(allowPending||(s.combat.version===COMBAT_MANIFEST.version&&s.metadata.rulesHash===COMBAT_MANIFEST.rulesHash),'COMBAT_VERSION_MISMATCH');
   check(allowPending||s.revision===s.acknowledged,'RAID_PROJECTION_PENDING');
   const old=this.core.integratedMutation;this.core.integratedMutation=true;
   try{
    const result=work(s),revision=s.revision+1;
    this.core.run('UPDATE raid_combat SET state=?,bindings=?,revision=?,status=? WHERE world_id=?',JSON.stringify(s.combat),JSON.stringify(s.metadata),revision,s.status,world);
    const response={revision,result};
    if(receipt)this.core.run('INSERT INTO raid_receipts VALUES (?,?,?,?)',world,requestId,fingerprint,JSON.stringify(response));
    return response;
   }finally{this.core.integratedMutation=old;}
  });
 }
 acknowledge(world:string,revision:number,databaseId:string,economicRevision:number){
  return this.core.transaction(()=>{const s=this.snapshot(world);check(s.revision===revision&&s.economy.databaseId===databaseId&&s.economy.revision===economicRevision,'RECONCILE_MISMATCH');
   this.core.acknowledgeProjection(databaseId,economicRevision);this.core.run('UPDATE raid_combat SET acknowledged=? WHERE world_id=?',revision,world);});
 }
 private player(s:RaidSnapshot,playerId:string){
  const found=Object.entries(s.metadata.players).find(([,b])=>b.playerId===playerId);check(found,'COMBAT_PLAYER_REQUIRED');
  const [id,b]=found;this.inventory(b,s.worldId);const a=s.combat.actors.find(a=>a.id===id);check(a&&a.hp>0,'COMBAT_ACTOR_DEAD');return {id,b,a};
 }
 input(world:string,playerId:string,requestId:string,packet:unknown){
  return this.mutate(world,requestId,'input',{playerId,packet},s=>{
   check(packet&&typeof packet==='object'&&!Array.isArray(packet),'INVALID_COMBAT_PACKET');const p=packet as Record<string,unknown>;
   check(Object.keys(p).length===4&&['version','rulesHash','sequence','intent'].every(k=>Object.hasOwn(p,k)),'INVALID_COMBAT_PACKET');
   check(p.version===COMBAT_MANIFEST.version&&p.rulesHash===COMBAT_MANIFEST.rulesHash,'COMBAT_VERSION_MISMATCH');
   const {id,b,a}=this.player(s,playerId),gear=resolveGear(this.inventory(b,world),b.loadout);
   a.weight=gear.weight;check(a.weapon===gear.weapon&&a.shield===gear.shield,'EQUIPMENT_MISMATCH');
   const result=commandCombat(s.combat,id,p.sequence as number,p.intent as Intent);
   if(a.sequence!==p.sequence&&a.weapon==='bow'&&['light','heavy'].includes(p.intent as string)){
    const arrow=this.inventory(b,world).find((i:{template:string})=>i.template==='iron_arrow');check(arrow,'NO_AMMUNITION');
    if(arrow.quantity===1)this.core.run('DELETE FROM items WHERE id=?',arrow.id);else this.core.run('UPDATE items SET quantity=quantity-1 WHERE id=?',arrow.id);this.core.queueProjection();
   }
   s.combat=result.state;return result.receipt;
  });
 }
 npc(world:string,requestId:string,actorId:string,sequence:number,intent:Intent){return this.mutate(world,requestId,'npc',{actorId,sequence,intent},s=>{
  check(s.combat.actors.some(a=>a.id===actorId&&a.kind==='npc'),'COMBAT_NPC_REQUIRED');const r=commandCombat(s.combat,actorId,sequence,intent);s.combat=r.state;return r.receipt;
 });}
 advance(world:string,tick:number){
  const current=this.snapshot(world);if(tick===current.combat.tick)return {revision:current.revision,result:{tick}};
  return this.mutate(world,'tick-'+tick,'advance',{tick},s=>{s.combat=advanceCombat(s.combat,tick);return {tick};},false);
 }
 contact(world:string,requestId:string,observation:Contact){return this.mutate(world,requestId,'contact',observation,s=>{
  const r=contactCombat(s.combat,observation);s.combat=r.state;const e=r.event;
  if(e&&e.damage>0){s.metadata.damage[e.targetId]=(s.metadata.damage[e.targetId]??0)+1;s.metadata.lastHurt[e.targetId]=s.combat.tick;}
  if(e?.killed){
   const target=s.metadata.players[e.targetId];
   if(target)this.core.recordDeath(e.id,target.playerId,world,target.expeditionId);
   else {const killer=s.metadata.players[e.attackerId],missionTarget=s.metadata.targets[e.targetId];
    if(killer&&missionTarget)this.core.recordMissionEvent(e.id,e.id,world,'kill',missionTarget,[{playerId:killer.playerId,expeditionId:killer.expeditionId}]);}
  }
  return e;
 });}
 use(world:string,playerId:string,requestId:string,itemId:string){return this.mutate(world,requestId,'use',{playerId,itemId},s=>{
  const {a,b}=this.player(s,playerId);check(a.connected&&a.action.kind==='idle','COMBAT_BUSY');
  const item=this.inventory(b,world).find((x:{id:string})=>x.id===itemId);check(item,'ITEM_NOT_IN_INVENTORY');
  const effect=CONSUMABLE_EFFECTS[item.template];check(effect,'UNSUPPORTED_EFFECT');
  check((effect.hp&&a.hp<100)||(effect.stamina&&a.stamina<100000)||(effect.magicka&&a.magicka<100000)||effect.resistance,'EFFECT_NOT_NEEDED');
  const previous=this.core.authority;try{this.core.authority={...previous,canConsume:()=>true};this.core.consume(nestedId('use:'+requestId),playerId,world,itemId,1,b.expeditionId);}finally{this.core.authority=previous;}
  a.hp=Math.min(100,a.hp+(effect.hp??0));a.stamina=Math.min(100000,a.stamina+(effect.stamina??0));a.magicka=Math.min(100000,a.magicka+(effect.magicka??0));
  if(effect.resistance){a.resistance=effect.resistance;a.resistElement=effect.element??null;a.resistUntil=s.combat.tick+GEAR_RULES.resistTicks;}
  a.action={kind:'equip',start:s.combat.tick,serial:a.action.serial,combo:0,targets:[]};return {itemId,hp:a.hp,stamina:a.stamina,magicka:a.magicka};
 });}
 equip(world:string,playerId:string,requestId:string,loadout:Loadout){return this.mutate(world,requestId,'equip',{playerId,loadout},s=>{
  const {id,b}=this.player(s,playerId),gear=resolveGear(this.inventory(b,world),loadout);
  s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'equip',actorId:id,weapon:gear.weapon,weight:gear.weight,shield:gear.shield});
  s.combat.actors.find(a=>a.id===id)!.armor=gear.armor;b.loadout=loadout;return gear;
 });}
 join(world:string,playerId:string,requestId:string,itemIds:string[],loadout:Loadout){return this.mutate(world,requestId,'join',{playerId,itemIds,loadout},s=>{
  check(!Object.values(s.metadata.players).some(b=>b.playerId===playerId&&s.combat.actors.some(a=>a.id===b.expeditionId&&a.hp>0)),'ALREADY_ACTIVE');
  // Remove only dead prior actors, with a permanent tombstone against stale events.
  for(const [id,b] of Object.entries(s.metadata.players))if(b.playerId===playerId){s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'retire',actorId:id,safeZone:false});delete s.metadata.players[id];}
  const expedition=this.core.beginExpedition(nestedId('join:'+requestId),playerId,world,itemIds);
  const binding={playerId,expeditionId:String(expedition.expeditionId),loadout},gear=resolveGear(this.inventory(binding,world),loadout);
  s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'spawn',fighter:{id:binding.expeditionId,kind:'player',team:'players',weapon:gear.weapon,weight:gear.weight,shield:gear.shield}});
  s.combat.actors.find(a=>a.id===binding.expeditionId)!.armor=gear.armor;s.metadata.players[binding.expeditionId]=binding;return {expeditionId:binding.expeditionId};
 });}
 spawn(world:string,requestId:string,npc:FighterSpec,target?:string){return this.mutate(world,requestId,'spawn',{npc,target:target??null},s=>{
  check(npc.kind==='npc','COMBAT_NPC_REQUIRED');if(target)check(Object.hasOwn(MISSION_TARGET_NAMES,target),'UNKNOWN_MISSION_TARGET');
  s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'spawn',fighter:npc});if(target)s.metadata.targets[npc.id]=target;return {actorId:npc.id};
 });}
 retire(world:string,requestId:string,actorId:string){return this.mutate(world,requestId,'retire',{actorId},s=>{
  check(s.combat.actors.some(a=>a.id===actorId&&a.kind==='npc'),'COMBAT_NPC_REQUIRED');
  s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'retire',actorId,safeZone:false});delete s.metadata.targets[actorId];return {actorId};
 });}
 connection(world:string,playerId:string,requestId:string,connected:boolean){return this.mutate(world,requestId,'connection',{playerId,connected},s=>{
  check(typeof connected==='boolean','INVALID_LIFECYCLE');const {id}=this.player(s,playerId);s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:connected?'reconnect':'disconnect',actorId:id});return {connected};
 });}
 extractionObservation(world:string,playerId:string,sample:Observation){const s=this.snapshot(world),{id,b,a}=this.player(s,playerId);
  check(sample.playerId===playerId&&sample.worldId===world&&sample.expeditionId===b.expeditionId,'STALE_EXPEDITION');
  return {...sample,alive:a.hp>0,connected:a.connected&&sample.connected,inCombat:a.action.kind!=='idle'||s.combat.tick-(s.metadata.lastHurt[id]??-10000)<120,damageSequence:s.metadata.damage[id]??0};
 }
 extract(world:string,playerId:string,requestId:string,exitId:string,policy:ExtractionPolicy,sample:Observation){return this.mutate(world,requestId,'extract',{playerId,exitId},s=>{
  const exit=REGION.exits.find(e=>e.id===exitId);check(exit,'UNKNOWN_EXIT');
  if(exit.requires)check(this.core.progression(playerId).missions.some(m=>m.definitionId===exit.requires&&m.status==='COMPLETED'),'EXIT_LOCKED');
  const approved=this.extractionObservation(world,playerId,sample);const result=policy.update(exitId,approved);check(result.ready,'EXTRACTION_NOT_READY');
  const {id,b}=this.player(s,playerId),previous=this.core.authority;
  try{this.core.authority={...previous,canExtract:()=>true};this.core.extract(nestedId('exit:'+requestId),playerId,world,exitId,b.expeditionId);}finally{this.core.authority=previous;}
  s.combat=lifecycleCombat(s.combat,s.combat.systemSequence+1,{kind:'retire',actorId:id,safeZone:true});delete s.metadata.players[id];policy.cancel(playerId);return {exitId};
 });}
 pickup(world:string,playerId:string,requestId:string,containerId:string,itemId:string){return this.mutate(world,requestId,'pickup',{playerId,containerId,itemId},s=>{
  const {b,a}=this.player(s,playerId);check(a.connected&&a.action.kind==='idle','COMBAT_BUSY');
  const previous=this.core.authority;try{this.core.authority={...previous,canPickup:()=>true};return this.core.pickup(nestedId('pickup:'+requestId),playerId,world,containerId,itemId,b.expeditionId);}finally{this.core.authority=previous;}
 });}
 recover(world:string,requestId:string){return this.mutate(world,requestId,'recover',{},s=>{
  // Every already committed death/consumption is in this very transaction database.
  const result=this.core.recoverWorld(nestedId('recover:'+requestId),world);s.status='CLOSED';return result;
 },true,true);}
}
