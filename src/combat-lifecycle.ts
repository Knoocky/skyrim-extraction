import {createCombat,combatCheck,combatId,type CombatState,type FighterSpec,type Weapon,type Weight} from './combat.ts';
export type LifecycleCommand =
  |{kind:'spawn'; fighter:FighterSpec}
  |{kind:'equip'; actorId:string; weapon:Weapon; weight:Weight; shield:boolean}
  |{kind:'disconnect'|'reconnect'; actorId:string}
  |{kind:'retire'; actorId:string; safeZone:boolean};
function record(raw:unknown,fields:string[]):Record<string,unknown>{
  combatCheck(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_LIFECYCLE');
  const r=raw as Record<string,unknown>;
  combatCheck(Object.keys(r).length===fields.length&&fields.every(k=>Object.hasOwn(r,k)),'INVALID_LIFECYCLE');return r;
}
/** No economic/client input: only a server-approved observation may reach this API. */
export function decodeLifecycle(raw:unknown):LifecycleCommand{
  combatCheck(raw!==null&&typeof raw==='object','INVALID_LIFECYCLE');
  const kind=(raw as {kind?:unknown}).kind;
  if(kind==='spawn'){
    const r=record(raw,['kind','fighter']),f=record(r.fighter,['id','kind','team','weapon','weight','shield']);
    const validated=createCombat('validation',[f as unknown as FighterSpec]).actors[0];
    return {kind,fighter:{id:validated.id,kind:validated.kind,team:validated.team,weapon:validated.weapon,weight:validated.weight,shield:validated.shield}};
  }
  if(kind==='equip'){
    const r=record(raw,['kind','actorId','weapon','weight','shield']);combatId(r.actorId);
    createCombat('validation',[{id:r.actorId,kind:'npc',team:'validation',weapon:r.weapon as Weapon,weight:r.weight as Weight,shield:r.shield as boolean}]);
    return {kind,actorId:r.actorId,weapon:r.weapon as Weapon,weight:r.weight as Weight,shield:r.shield as boolean};
  }
  if(kind==='disconnect'||kind==='reconnect'){
    const r=record(raw,['kind','actorId']);combatId(r.actorId);return {kind,actorId:r.actorId};
  }
  if(kind==='retire'){
    const r=record(raw,['kind','actorId','safeZone']);combatId(r.actorId);combatCheck(typeof r.safeZone==='boolean','INVALID_LIFECYCLE');
    return {kind,actorId:r.actorId,safeZone:r.safeZone};
  }
  combatCheck(false,'INVALID_LIFECYCLE');
}
export function lifecycleCombat(input:CombatState,sequence:number,raw:unknown):CombatState{
  const command=decodeLifecycle(raw),fingerprint=JSON.stringify(command);
  combatCheck(Number.isSafeInteger(sequence)&&sequence>0,'INVALID_SYSTEM_SEQUENCE');
  if(sequence===input.systemSequence){combatCheck(input.lastSystem===fingerprint,'SYSTEM_SEQUENCE_REUSED');return structuredClone(input);}
  combatCheck(sequence===input.systemSequence+1,'SYSTEM_OUT_OF_ORDER');
  const s=structuredClone(input);
  if(command.kind==='spawn'){
    combatCheck(!s.retired.includes(command.fighter.id),'COMBAT_ID_RETIRED');
    const validated=createCombat(s.worldId,[...s.actors,command.fighter],s.pvp);
    s.actors.push(validated.actors.at(-1)!);
  }else{
    const a=s.actors.find(a=>a.id===command.actorId);combatCheck(a,'COMBAT_ACTOR_MISSING');
    if(command.kind==='equip'){
      combatCheck(a.hp>0,'COMBAT_ACTOR_DEAD');combatCheck(a.connected,'COMBAT_DISCONNECTED');
      combatCheck(a.action.kind==='idle','COMBAT_BUSY');
      a.weapon=command.weapon;a.weight=command.weight;a.shield=command.shield;
      a.lastLightEnd=-100;a.lastCombo=0;
      a.action={kind:'equip',start:s.tick,serial:a.action.serial,combo:0,targets:[]};
    }else if(command.kind==='retire'){
      combatCheck(a.hp===0||(command.safeZone&&a.connected&&a.action.kind==='idle'),'COMBAT_RETIRE_UNSAFE');
      combatCheck(s.retired.length<4096,'COMBAT_LIFETIME_CAPACITY');
      s.retired.push(a.id);s.actors=s.actors.filter(x=>x.id!==a.id);
    }else{
      a.connected=command.kind==='reconnect';
      if(!a.connected&&a.action.kind==='guard')a.action={kind:'idle',start:s.tick,serial:a.action.serial,combo:0,targets:[]};
      // Keep HP, resources, action progress and client sequence. Disconnection is not extraction.
    }
  }
  s.systemSequence=sequence;s.lastSystem=fingerprint;return s;
}
