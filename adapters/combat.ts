import {
  COMBAT_VERSION, combatCheck, combatId, createCombat, advanceCombat, commandCombat, contactCombat,
  type CombatState, type FighterSpec, type Intent, type Contact, type HitEvent
} from '../src/combat.ts';

export interface CombatCheckpoint {id:string; revision:number; state:CombatState; events:HitEvent[]}
export interface CombatSession {worldId:string; actorId:string}
export interface CombatPort {
  /** Must include adapter lease health. Never accept client-supplied identity or authority. */
  ready():boolean;
  session(transportId:string):CombatSession|null;
  /** Engine-observed contact, positions/LOS/safe zones. null means no confirmed collision. */
  observe(attackerId:string,targetId:string):Omit<Contact,'attackerId'|'targetId'|'serial'|'tick'>|null;
  /** Idempotent durable checkpoint + effects/readback. Resolve true only after verification.
   * Death events must use event.id as the economic recordDeath receipt key. */
  applyAndVerify(checkpoint:CombatCheckpoint):Promise<boolean>;
  freeze():Promise<void>;
  resume():Promise<void>;
}
/** Optional server-side integration component, not wired to an unverified Skyrim callback.
 * A failed projection blocks every further action; retry uses the SAME checkpoint/events.
 * A new process must recover/close the old world; construction is NOT a restore procedure. */
export class CombatAdapter {
  #state:CombatState;
  #port:CombatPort;
  #revision=0;
  #pending:CombatCheckpoint|null=null;
  #busy=false;
  #started=false;
  #stopped=false;
  constructor(worldId:string,actors:readonly FighterSpec[],port:CombatPort,pvp=false){
    this.#state=createCombat(worldId,actors,pvp);this.#port=port;
  }
  get manifest(){return {combatVersion:COMBAT_VERSION,hz:60};}
  snapshot(){return structuredClone(this.#state);}
  private async available(){
    if(this.#port.ready()!==true){
      this.#started=false;await this.#port.freeze();combatCheck(false,'COMBAT_LEASE_LOST');
    }
    combatCheck(this.#started&&!this.#stopped&&!this.#pending,'COMBAT_NOT_READY');
  }
  private async flush(){
    const p=this.#pending;combatCheck(p,'COMBAT_NO_CHECKPOINT');
    try{
      combatCheck(!this.#stopped&&this.#port.ready()===true,'COMBAT_LEASE_LOST');
      combatCheck(await this.#port.applyAndVerify(structuredClone(p))===true,'COMBAT_PROJECTION_MISMATCH');
      combatCheck(!this.#stopped&&this.#port.ready()===true,'COMBAT_LEASE_LOST');
      await this.#port.resume();
      combatCheck(!this.#stopped&&this.#port.ready()===true,'COMBAT_LEASE_LOST');
      this.#pending=null;this.#started=true;
    }catch(error){this.#started=false;await this.#port.freeze();throw error;}
  }
  private async run<T>(body:()=>Promise<T>):Promise<T>{
    combatCheck(!this.#busy,'COMBAT_BUSY');this.#busy=true;
    try{await this.available();return await body();}finally{this.#busy=false;}
  }
  private async publish(state:CombatState,events:HitEvent[]=[]){
    this.#state=state;
    this.#pending={id:`${state.worldId}:combat:${++this.#revision}`,revision:this.#revision,state:structuredClone(state),events};
    await this.flush();
  }
  async start(){
    combatCheck(!this.#started&&!this.#pending&&!this.#busy&&!this.#stopped&&this.#revision===0,'COMBAT_ALREADY_STARTED');
    this.#busy=true;
    try{await this.#port.freeze();await this.publish(this.#state);}finally{this.#busy=false;}
  }
  async retry(){
    combatCheck(!this.#busy&&!this.#stopped&&this.#pending,'COMBAT_NOT_RETRYABLE');
    this.#busy=true;try{await this.flush();}finally{this.#busy=false;}
  }
  /** Stop is terminal. A lease change requires recovery, never transparent combat restart. */
  async stop(){this.#stopped=true;this.#started=false;await this.#port.freeze();}
  async advance(tick:number){return this.run(()=>this.publish(advanceCombat(this.#state,tick)));}
  async execute(transportId:string,raw:unknown){
    return this.run(async()=>{
    const session=this.#port.session(transportId);
    combatCheck(session&&session.worldId===this.#state.worldId,'COMBAT_LOGIN_REQUIRED');
    combatCheck(this.#state.actors.some(a=>a.id===session.actorId&&a.kind==='player'),'COMBAT_PLAYER_REQUIRED');
    combatCheck(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_COMBAT_PACKET');
    const p=raw as Record<string,unknown>;
    combatCheck(Object.keys(p).length===3&&['version','sequence','intent'].every(k=>Object.hasOwn(p,k)),'INVALID_COMBAT_PACKET');
    combatCheck(p.version===COMBAT_VERSION,'COMBAT_VERSION_MISMATCH');
    const result=commandCombat(this.#state,session.actorId,p.sequence as number,p.intent as Intent);
    // A receipt retry cannot replay projection, damage, or death effects.
    if(this.#state.actors.find(a=>a.id===session.actorId)!.sequence===p.sequence)return result.receipt;
    await this.publish(result.state);return result.receipt;
    });
  }
  /** Called by trusted server AI, never routed from transport packets. */
  async npc(actorId:string,sequence:number,intent:Intent){
    return this.run(async()=>{
    combatCheck(this.#state.actors.some(a=>a.id===actorId&&a.kind==='npc'),'COMBAT_NPC_REQUIRED');
    const result=commandCombat(this.#state,actorId,sequence,intent);
    await this.publish(result.state);return result.receipt;
    });
  }
  /** Only an engine collision callback calls this method. No client hit endpoint exists. */
  async contact(attackerId:string,targetId:string,serial:number){
    return this.run(async()=>{
    combatId(attackerId);combatId(targetId);
    const observation=this.#port.observe(attackerId,targetId);if(!observation)return null;
    const result=contactCombat(this.#state,{...observation,attackerId,targetId,serial,tick:this.#state.tick});
    if(result.event)await this.publish(result.state,[result.event]);return result.event;
    });
  }
}
