import {RaidService,type RaidSnapshot} from '../src/raid-service.ts';
import {AdapterGateway,type Lease} from '../src/adapter-gateway.ts';
import {COMBAT_MANIFEST,combatCheck as check,type Contact,type Intent,type FighterSpec} from '../src/combat.ts';
import {object,keys,id} from '../src/protocol.ts';
import {ExtractionPolicy,type Observation} from '../src/extraction-policy.ts';
import type {Loadout} from '../src/raid-gear.ts';

export interface RaidEnginePort {
  // Credentials and these methods belong only to the trusted server adapter.
  session(transportId:string):string|null;
  freeze(epoch:number):Promise<void>;
  replaceAndVerify(snapshot:RaidSnapshot,epoch:number):Promise<boolean>;
  resume(snapshot:RaidSnapshot,epoch:number,expiresAt:number):Promise<boolean>;
  heartbeat(epoch:number,expiresAt:number):Promise<void>;
  observe(attackerId:string,targetId:string,serial:number,tick:number):Omit<Contact,'attackerId'|'targetId'|'serial'|'tick'>|null;
  extraction?(playerId:string):Observation|null;
  canPickup?(playerId:string,containerId:string,itemId:string):boolean;
}
/** One coordinator per database. No client-supplied identity, physics or damage.
 * Engine port must fence epochs, apply both projections as replacements and read back
 * both before returning true. A process restart must freeze the engine before start(). */
export class RaidCoordinator {
  readonly service:RaidService;
  readonly gateway:AdapterGateway;
  readonly lease:Lease;
  readonly worldId:string;
  readonly port:RaidEnginePort;
  readonly policy?:ExtractionPolicy;
  #busy=false; #ready=false; #stopped=false;
  constructor(service:RaidService,gateway:AdapterGateway,lease:Lease,worldId:string,port:RaidEnginePort,policy?:ExtractionPolicy){
    check(service.core===gateway.core,'RAID_DATABASE_MISMATCH');
    this.service=service;this.gateway=gateway;this.lease={epoch:lease.epoch,token:lease.token};this.worldId=worldId;this.port=port;this.policy=policy;
  }
  get ready(){return this.#ready&&!this.#busy&&!this.#stopped;}
  snapshot(){return this.service.snapshot(this.worldId);}
  private guard<T>(work:()=>T){check(!this.#stopped,'RAID_STOPPED');return this.gateway.guarded(this.lease,work);}
  private async frozen(){this.guard(()=>this.gateway.suspend(this.lease));await this.port.freeze(this.lease.epoch);this.guard(()=>{});}
  private async flush(){
    const state=this.guard(()=>this.snapshot());
    check(state.status==='CLOSED'||(state.combat.version===COMBAT_MANIFEST.version&&state.metadata.rulesHash===COMBAT_MANIFEST.rulesHash),'COMBAT_VERSION_MISMATCH');
    check(await this.port.replaceAndVerify(structuredClone(state),this.lease.epoch)===true,'RAID_PROJECTION_MISMATCH');
    this.guard(()=>{
      this.service.acknowledge(this.worldId,state.revision,state.economy.databaseId,state.economy.revision);
      if(state.status==='OPEN')this.gateway.reconcile({lease:this.lease,databaseId:state.economy.databaseId,revision:state.economy.revision});
    });
    if(state.status==='OPEN'){
      const deadline=this.guard(()=>Number(this.service.core.row('SELECT lease_until FROM adapter_lease WHERE id=1')?.lease_until));
      check(await this.port.resume(structuredClone(state),this.lease.epoch,deadline)===true,'RAID_RESUME_MISMATCH');
      this.guard(()=>{const latest=this.snapshot();check(latest.revision===state.revision&&latest.economy.revision===state.economy.revision,'RECONCILE_MISMATCH');});
      this.#ready=true;
    }
  }
  private async run<T>(work:()=>T,recovery=false):Promise<T>{
    check(!this.#busy,'RAID_BUSY');check(!this.#stopped,'RAID_STOPPED');
    check(recovery||this.#ready,'RAID_NOT_READY');this.#busy=true;this.#ready=false;
    try{
      await this.frozen();const result=this.guard(work);await this.flush();return result;
    }catch(error){
      // No economic bridge is allowed to resume independently of combat readback.
      this.#ready=false;try{this.gateway.suspend(this.lease);}catch{}
      try{await this.port.freeze(this.lease.epoch);}catch{}
      throw error;
    }finally{this.#busy=false;}
  }
  start(){return this.run(()=>{},true);}
  retry(){return this.run(()=>{},true);}
  recover(requestId:string){return this.run(()=>this.service.recover(this.worldId,requestId),true);}
  async stop(){this.#stopped=true;this.#ready=false;try{this.gateway.suspend(this.lease);}catch{}await this.port.freeze(this.lease.epoch);}
  /** Call on a regular server heartbeat, also when no one sends inputs. */
  async heartbeat(){
    try{const result=this.guard(()=>this.gateway.renew(this.lease));await this.port.heartbeat(this.lease.epoch,result.expiresAt);this.guard(()=>{});return result;}
    catch(error){this.#ready=false;try{await this.port.freeze(this.lease.epoch);}catch{}throw error;}
  }
  execute(transportId:string,raw:unknown){return this.run(()=>{
    const connectionId=this.port.session(transportId);check(connectionId,'COMBAT_LOGIN_REQUIRED');
    const input=object(raw);keys(input,['requestId','operation','payload']);const requestId=id(input.requestId);
    return this.service.core.executeConnected(connectionId,(player:unknown)=>{
      const playerId=String(player),p=object(input.payload);
      if(input.operation==='input')return this.service.input(this.worldId,playerId,requestId,p);
      if(input.operation==='use'){keys(p,['itemId']);return this.service.use(this.worldId,playerId,requestId,id(p.itemId));}
      if(input.operation==='equip')return this.service.equip(this.worldId,playerId,requestId,p as unknown as Loadout);
      if(input.operation==='join'){
        keys(p,['itemIds','loadout']);check(Array.isArray(p.itemIds),'INVALID_LOADOUT');
        return this.service.join(this.worldId,playerId,requestId,p.itemIds.map(x=>id(x)),object(p.loadout) as unknown as Loadout);
      }
      if(input.operation==='pickup'){
        keys(p,['containerId','itemId']);const container=id(p.containerId),item=id(p.itemId);
        const replay=this.service.replayObservedIntent(this.worldId,requestId,'pickup',{playerId,containerId:container,itemId:item});if(replay!==undefined)return replay;
        check(this.port.canPickup?.(playerId,container,item)===true,'PICKUP_NOT_AUTHORIZED');
        return this.service.pickup(this.worldId,playerId,requestId,container,item);
      }
      if(input.operation==='extract'){
        keys(p,['exitId']);const exitId=id(p.exitId);
        const replay=this.service.replayObservedIntent(this.worldId,requestId,'extract',{playerId,exitId});if(replay!==undefined)return replay;
        const sample=this.port.extraction?.(playerId);check(sample&&this.policy,'EXTRACTION_OBSERVATION_REQUIRED');
        check(sample.connectionId===connectionId,'STALE_CONNECTION');
        return this.service.extract(this.worldId,playerId,requestId,exitId,this.policy,sample);
      }
      check(false,'UNKNOWN_RAID_INTENT');
    });
  });}
  advance(tick:number){return this.run(()=>this.service.advance(this.worldId,tick));}
  npc(requestId:string,actorId:string,sequence:number,intent:Intent){return this.run(()=>this.service.npc(this.worldId,requestId,actorId,sequence,intent));}
  connection(requestId:string,playerId:string,connected:boolean){return this.run(()=>this.service.connection(this.worldId,playerId,requestId,connected));}
  spawn(requestId:string,npc:FighterSpec,target?:string){return this.run(()=>this.service.spawn(this.worldId,requestId,npc,target));}
  retire(requestId:string,actorId:string){return this.run(()=>this.service.retire(this.worldId,requestId,actorId));}
  contact(requestId:string,attackerId:string,targetId:string,serial:number){return this.run(()=>
    this.service.observeContact(this.worldId,requestId,{attackerId,targetId,serial},tick=>this.port.observe(attackerId,targetId,serial,tick))
  );}
  observeExtraction(transportId:string,exitId:string){return this.guard(()=>{
    check(this.ready,'RAID_NOT_READY');const connection=this.port.session(transportId);check(connection,'COMBAT_LOGIN_REQUIRED');
    return this.service.core.executeConnected(connection,(player:unknown)=>{
      const playerId=String(player),sample=this.port.extraction?.(playerId);check(sample&&this.policy,'EXTRACTION_OBSERVATION_REQUIRED');check(sample.connectionId===connection,'STALE_CONNECTION');
      return this.policy.update(exitId,this.service.extractionObservation(this.worldId,playerId,sample));
    });
  });}
}
export {RaidService,AdapterGateway};
export {COMBAT_MANIFEST} from '../src/combat.ts';
