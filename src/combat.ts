import { DomainError } from './domain-error.mjs';

/** Original balance values. No Elden Ring code, timings, animations or assets. */
export const COMBAT_VERSION = 1;
export const COMBAT_RULES = Object.freeze({hz:60, maxActors:32, maxPlayers:4, maxStep:120,
  maxHp:100, maxStamina:100000, regen:300, regenDelay:60, maxPoise:100, poiseDelay:180});
export type Weapon = 'sword'|'axe'|'dagger';
export type Weight = 'light'|'medium'|'heavy';
export type Intent = 'light'|'heavy'|'dodge'|'guard'|'releaseGuard'|'parry';
export type ActionKind = 'idle'|'light'|'heavy'|'dodge'|'guard'|'parry'|'stagger'|'dead';
export interface FighterSpec {id:string; kind:'player'|'npc'; team:string; weapon:Weapon; weight:Weight; shield:boolean}
export interface Action {kind:ActionKind; start:number; serial:number; combo:number; targets:string[]}
export interface Fighter extends FighterSpec {
  hp:number; stamina:number; poise:number; regenAt:number; poiseAt:number;
  action:Action; sequence:number; lastIntent:Intent|null; lastLightEnd:number; lastCombo:number;
}
export interface CombatState {version:1; worldId:string; tick:number; pvp:boolean; actors:Fighter[]}
export interface Receipt {actorId:string; sequence:number; intent:Intent}
export interface Contact {attackerId:string; targetId:string; serial:number; tick:number; distance:number; inArc:boolean; facing:boolean; clear:boolean; safeZone:boolean}
export interface HitEvent {id:string; tick:number; attackerId:string; targetId:string; outcome:'hit'|'dodged'|'blocked'|'guardBreak'|'parried'; damage:number; killed:boolean}
const WEAPONS = {
  sword:{light:[12,6,18,22,22,30,35],heavy:[26,8,30,36,38,65,70]},
  axe:{light:[17,7,23,28,28,40,45],heavy:[32,9,35,44,45,85,90]},
  dagger:{light:[7,4,12,14,14,18,22],heavy:[18,5,22,25,25,40,45]}
} as const;
const ROLLS = {light:[26,2,12,24],medium:[32,3,12,30],heavy:[42,5,11,38]} as const;
export function combatCheck(value:unknown,code:string):asserts value {if(!value)throw new DomainError(code);}
export function combatId(value:unknown):asserts value is string {
  combatCheck(typeof value==='string'&&/^[A-Za-z0-9_-]{1,48}$/.test(value),'INVALID_COMBAT_ID');
}
function fighter(state:CombatState,id:string):Fighter {
  const a=state.actors.find(a=>a.id===id);combatCheck(a,'COMBAT_ACTOR_MISSING');return a;
}
export function attackProfile(weapon:Weapon,kind:'light'|'heavy') {
  const [windup,active,recovery,cost,damage,poise,guard]=WEAPONS[weapon][kind];
  return {windup,active,recovery,cost:cost*1000,damage,poise,guard:guard*1000,reach:weapon==='dagger'?1.5:2.2};
}
export function createCombat(worldId:string,specs:readonly FighterSpec[],pvp=false):CombatState {
  combatId(worldId);combatCheck(typeof pvp==='boolean','INVALID_COMBAT_CONFIG');
  combatCheck(Array.isArray(specs)&&specs.length>0&&specs.length<=COMBAT_RULES.maxActors,'COMBAT_CAPACITY');
  combatCheck(specs.filter(a=>a.kind==='player').length<=COMBAT_RULES.maxPlayers,'COMBAT_CAPACITY');
  const seen=new Set<string>();
  const actors=specs.map(s=>{
    combatId(s.id);combatId(s.team);
    combatCheck(!seen.has(s.id),'DUPLICATE_COMBAT_ACTOR');seen.add(s.id);
    combatCheck((s.kind==='player'||s.kind==='npc')&&Object.hasOwn(WEAPONS,s.weapon)&&Object.hasOwn(ROLLS,s.weight)&&typeof s.shield==='boolean','INVALID_COMBAT_CONFIG');
    return {id:s.id,kind:s.kind,team:s.team,weapon:s.weapon,weight:s.weight,shield:s.shield,
      hp:100,stamina:100000,poise:100,regenAt:0,poiseAt:0,
      action:{kind:'idle' as const,start:0,serial:0,combo:0,targets:[]},sequence:0,lastIntent:null,lastLightEnd:-100,lastCombo:0};
  });
  return {version:1,worldId,tick:0,pvp,actors};
}
function duration(a:Fighter):number {
  const k=a.action.kind;
  if(k==='light'||k==='heavy'){const p=attackProfile(a.weapon,k);return p.windup+p.active+p.recovery;}
  if(k==='dodge')return ROLLS[a.weight][0];
  if(k==='parry')return 36;
  if(k==='stagger')return 45;
  return Infinity;
}
function interrupt(a:Fighter,tick:number,kind:'stagger'|'dead') {
  a.action={kind,start:tick,serial:a.action.serial,combo:0,targets:[]};a.lastLightEnd=-100;a.lastCombo=0;
}
/** Only the server advances this clock. No wall clock, RNG or client timestamps. */
export function advanceCombat(input:CombatState,tick:number):CombatState {
  combatCheck(Number.isSafeInteger(tick)&&tick>=input.tick&&tick-input.tick<=COMBAT_RULES.maxStep,'INVALID_COMBAT_TICK');
  const s=structuredClone(input);
  while(s.tick<tick){
    s.tick++;
    for(const a of s.actors){
      if(a.hp===0)continue;
      if(s.tick-a.action.start>=duration(a)){
        if(a.action.kind==='light'){a.lastLightEnd=s.tick;a.lastCombo=a.action.combo;}
        a.action={kind:'idle',start:s.tick,serial:a.action.serial,combo:0,targets:[]};
      }
      if(s.tick>=a.regenAt&&(a.action.kind==='idle'||a.action.kind==='guard'))
        a.stamina=Math.min(100000,a.stamina+(a.action.kind==='guard'?150:300));
      if(s.tick>=a.poiseAt)a.poise=100;
    }
  }
  return s;
}
/** Accepted sequence numbers never reset on reconnect. Retry only the latest identical intent. */
export function commandCombat(input:CombatState,actorId:string,sequence:number,intent:Intent):{state:CombatState;receipt:Receipt} {
  const s=structuredClone(input),a=fighter(s,actorId);
  combatCheck(Number.isSafeInteger(sequence)&&sequence>0,'INVALID_COMBAT_SEQUENCE');
  combatCheck(['light','heavy','dodge','guard','releaseGuard','parry'].includes(intent),'UNKNOWN_COMBAT_INTENT');
  const receipt={actorId,sequence,intent};
  if(sequence===a.sequence){combatCheck(intent===a.lastIntent,'COMBAT_SEQUENCE_REUSED');return {state:s,receipt};}
  combatCheck(sequence===a.sequence+1,'COMBAT_OUT_OF_ORDER');combatCheck(a.hp>0,'COMBAT_ACTOR_DEAD');
  let cost=0;
  if(intent==='releaseGuard'){
    combatCheck(a.action.kind==='guard','NOT_GUARDING');
    a.action={kind:'idle',start:s.tick,serial:a.action.serial,combo:0,targets:[]};
  }else{
    combatCheck(a.action.kind==='idle'||a.action.kind==='guard','COMBAT_BUSY');
    if(intent==='guard'||intent==='parry')combatCheck(a.shield,'SHIELD_REQUIRED');
    if(intent==='guard')combatCheck(a.action.kind!=='guard','ALREADY_GUARDING');
    if(intent==='light'||intent==='heavy')cost=attackProfile(a.weapon,intent).cost;
    if(intent==='dodge')cost=ROLLS[a.weight][3]*1000;
    if(intent==='parry')cost=18000;
    combatCheck(a.stamina>=cost,'COMBAT_STAMINA_LOW');
    // A finite chain continues only after recovery, never by cancelling an attack.
    const combo=intent==='light'&&s.tick-a.lastLightEnd<=12?a.lastCombo%3+1:1;
    a.action={kind:intent,start:s.tick,serial:sequence,combo,targets:[]};
    if(intent!=='light'){a.lastLightEnd=-100;a.lastCombo=0;}
  }
  a.stamina-=cost;if(cost)a.regenAt=s.tick+60;
  a.sequence=sequence;a.lastIntent=intent;
  return {state:s,receipt};
}
/** Trusted physics observation, NOT a client packet. Metres and facing come from the engine port. */
export function contactCombat(input:CombatState,c:Contact):{state:CombatState;event:HitEvent|null} {
  const s=structuredClone(input),a=fighter(s,c.attackerId),b=fighter(s,c.targetId);
  combatCheck(Number.isSafeInteger(c.tick)&&c.tick===s.tick&&Number.isSafeInteger(c.serial),'STALE_COMBAT_CONTACT');
  combatCheck(Number.isFinite(c.distance)&&c.distance>=0&&[c.inArc,c.facing,c.clear,c.safeZone].every(x=>typeof x==='boolean'),'INVALID_COMBAT_CONTACT');
  combatCheck(a.id!==b.id&&a.hp>0&&b.hp>0,'INVALID_COMBAT_TARGET');
  const k=a.action.kind;combatCheck((k==='light'||k==='heavy')&&c.serial===a.action.serial,'STALE_COMBAT_ATTACK');
  const p=attackProfile(a.weapon,k),elapsed=s.tick-a.action.start;
  combatCheck(elapsed>=p.windup&&elapsed<p.windup+p.active,'OUTSIDE_HIT_WINDOW');
  if(a.action.targets.includes(b.id))return {state:s,event:null};
  if(c.safeZone||a.team===b.team||(!s.pvp&&a.kind==='player'&&b.kind==='player')||!c.clear||!c.inArc||c.distance>p.reach)return {state:s,event:null};
  a.action.targets.push(b.id);
  const ev:HitEvent={id:`${s.worldId}:${a.id}:${c.serial}:${b.id}`,tick:s.tick,attackerId:a.id,targetId:b.id,outcome:'hit',damage:0,killed:false};
  const age=s.tick-b.action.start,roll=ROLLS[b.weight];
  if(b.action.kind==='dodge'&&age>=roll[1]&&age<roll[2])ev.outcome='dodged';
  else if(b.action.kind==='parry'&&age>=3&&age<9&&c.facing){
    ev.outcome='parried';interrupt(a,s.tick,'stagger');a.poise=0;a.poiseAt=s.tick+180;
  }else if(b.action.kind==='guard'&&c.facing){
    b.regenAt=s.tick+60;
    if(b.stamina>=p.guard){b.stamina-=p.guard;ev.outcome='blocked';}
    else {b.stamina=0;ev.outcome='guardBreak';ev.damage=Math.ceil(p.damage/2);interrupt(b,s.tick,'stagger');b.poise=0;b.poiseAt=s.tick+180;}
  }else{
    ev.damage=p.damage+(k==='light'?2*(a.action.combo-1):0);
    b.poise=Math.max(0,b.poise-p.poise);b.poiseAt=s.tick+180;
    if(b.poise===0){interrupt(b,s.tick,'stagger');b.poise=100;}
  }
  b.hp=Math.max(0,b.hp-ev.damage);
  if(b.hp===0){interrupt(b,s.tick,'dead');ev.killed=true;}
  return {state:s,event:ev};
}
