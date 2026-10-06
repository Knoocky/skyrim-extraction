import { combatCheck } from '../src/combat.ts';
import { CombatJournal } from '../src/combat-journal.ts';
import { decodeCommand, type Command } from '../src/protocol.ts';
import type { CombatCheckpoint } from './combat.ts';
export interface ExpeditionBinding {playerId:string;worldId:string;expeditionId:string}
export interface CombatDeliveryPort {
  /** Trusted stable mapping; resolved once and saved BEFORE a death is dispatched. */
  expedition(actorId:string):ExpeditionBinding|null;
  /** Route through the existing leased core writer / ProjectionBridge.execute. */
  execute(command:Command):Promise<unknown>;
  /** Absolute HP/stamina/action projection + readback; never subtract damage again on retry. */
  project(checkpoint:CombatCheckpoint):Promise<boolean>;
  ready():boolean;
}
/** Wire applyAndVerify to deliver(). Frozen-world recovery can also redeliver journal.pending().
 * Does not resume an old combat simulation after a crash or reacquire a lost writer lease. */
export class CombatDelivery {
  #journal:CombatJournal;
  #port:CombatDeliveryPort;
  #busy=false;
  constructor(journal:CombatJournal,port:CombatDeliveryPort){this.#journal=journal;this.#port=port;}
  async deliver(checkpoint:CombatCheckpoint):Promise<boolean>{
    combatCheck(!this.#busy,'COMBAT_DELIVERY_BUSY');this.#busy=true;
    try{
      combatCheck(this.#port.ready()===true,'COMBAT_LEASE_LOST');
      const saved=this.#journal.stage(checkpoint,()=>checkpoint.events.filter(e=>e.killed).flatMap(e=>{
        const actor=checkpoint.state.actors.find(a=>a.id===e.targetId);
        combatCheck(actor&&actor.hp===0,'INVALID_COMBAT_DEATH');
        if(actor.kind==='npc')return [];
        const binding=this.#port.expedition(e.targetId);
        combatCheck(binding&&binding.worldId===checkpoint.state.worldId,'COMBAT_EXPEDITION_MISSING');
        return [decodeCommand({protocolVersion:1,requestId:e.id,operation:'recordDeath',payload:binding,worldApproved:true})];
      }));
      if(!saved.applied)for(const command of saved.commands){
        combatCheck(this.#port.ready()===true,'COMBAT_LEASE_LOST');await this.#port.execute(command);
      }
      combatCheck(this.#port.ready()===true,'COMBAT_LEASE_LOST');
      combatCheck(await this.#port.project(structuredClone(checkpoint))===true,'COMBAT_PROJECTION_MISMATCH');
      combatCheck(this.#port.ready()===true,'COMBAT_LEASE_LOST');
      this.#journal.acknowledge(checkpoint);return true;
    }finally{this.#busy=false;}
  }
}
