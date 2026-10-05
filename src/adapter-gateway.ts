import { REGION } from './region.mjs';
import { randomUUID } from 'node:crypto';
import type { ExtractionCore } from './core.mjs';
import { DomainError } from './domain-error.mjs';
import { ADAPTER_MANIFEST, canonical } from './manifest.ts';
import { decodeCommand, dispatch, id, integer, object, keys } from './protocol.ts';
function check(value:unknown,code:string):asserts value { if(!value) throw new DomainError(code); }
export interface Lease { epoch:number; token:string }
/** One trusted adapter writer. Credentials stay on the server; epoch fences zombie processes. */
export class AdapterGateway {
  core:ExtractionCore;
  now:()=>number;
  constructor(core:ExtractionCore, {now=Date.now, fenceOnStart=true}:{now?:()=>number;fenceOnStart?:boolean}={}) {
    this.core=core; this.now=now;
    if(fenceOnStart) core.transaction(()=>core.run("UPDATE adapter_lease SET epoch=epoch+1, token=NULL, lease_until=0, status='FROZEN' WHERE id=1"));
  }
  private clock() {
    const now=this.now(),last=Number(this.core.row('SELECT last_clock FROM adapter_lease WHERE id=1')?.last_clock);
    check(Number.isSafeInteger(now)&&now>=last,'CLOCK_ROLLBACK');
    this.core.run('UPDATE adapter_lease SET last_clock=? WHERE id=1',now);return now;
  }
  handshake(raw:unknown) {
    const input=object(raw); keys(input,['requestId','holderId','manifest']);
    const requestId=id(input.requestId),holderId=id(input.holderId);
    check(canonical(input.manifest)===canonical(ADAPTER_MANIFEST),'MANIFEST_MISMATCH');
    return this.core.transaction(()=>{
      const now=this.clock(),old=this.core.row('SELECT * FROM adapter_lease WHERE id=1');
      check(old,'LEASE_STATE_MISSING');
      if(Number(old.lease_until)>now) {
        check(old.holder===holderId&&old.request_id===requestId,'ADAPTER_ALREADY_LEASED');
        return {epoch:Number(old.epoch),token:String(old.token),expiresAt:Number(old.lease_until),sequence:Number(old.sequence),manifest:ADAPTER_MANIFEST};
      }
      const epoch=Number(old.epoch)+1,token=randomUUID(),expiresAt=now+15000;
      this.core.run("UPDATE adapter_lease SET epoch=?,token=?,holder=?,request_id=?,lease_until=?,sequence=0,status='FROZEN' WHERE id=1",epoch,token,holderId,requestId,expiresAt);
      return {epoch,token,expiresAt,sequence:0,manifest:ADAPTER_MANIFEST};
    });
  }
  private lease(raw:unknown,live=false) {
    const input=object(raw); keys(input,['epoch','token']); integer(input.epoch);id(input.token);
    const now=this.clock(),saved=this.core.row('SELECT * FROM adapter_lease WHERE id=1');
    check(saved,'LEASE_STATE_MISSING');
    check(input.epoch===saved.epoch&&input.token===saved.token&&Number(saved.lease_until)>now,'STALE_ADAPTER');
    if(live)check(saved.status==='LIVE','ADAPTER_FROZEN');
    return saved;
  }
  renew(raw:unknown) {
    return this.core.transaction(()=>{
      this.lease(raw);const expiresAt=this.now()+15000;
      this.core.run('UPDATE adapter_lease SET lease_until=? WHERE id=1',expiresAt);return {expiresAt};
    });
  }
  reconcile(raw:unknown) {
    const input=object(raw);keys(input,['lease','databaseId','revision']);
    return this.core.transaction(()=>{
      this.lease(input.lease);const state=this.core.projectionMetadata();
      check(input.databaseId===state.databaseId&&input.revision===state.revision,'RECONCILE_MISMATCH');
      const result=this.core.acknowledgeProjection(state.databaseId,state.revision);
      this.core.run("UPDATE adapter_lease SET status='LIVE' WHERE id=1");return result;
    });
  }
  execute(raw:unknown) {
    const input=object(raw);keys(input,['lease','sequence','command']);const seq=integer(input.sequence);
    check(seq>0,'INVALID_SEQUENCE');const command=decodeCommand(input.command),payload=canonical(input.command);
    return this.core.transaction(()=>{
      const lease=this.lease(input.lease,true),previous=this.core.row('SELECT payload,result FROM adapter_events WHERE epoch=? AND sequence=?',lease.epoch,seq);
      if(previous){check(previous.payload===payload,'EVENT_ID_REUSED');return JSON.parse(String(previous.result));}
      check(seq===Number(lease.sequence)+1,'OUT_OF_ORDER');
      if(command.operation==='extract') {
        const exit=REGION.exits.find(e=>e.id===command.payload.exitId);check(exit,'UNKNOWN_EXIT');
        const connection=this.core.connection(command.connectionId);check(connection,'STALE_CONNECTION');
        const playerId=String(connection.player_id);
        if(exit.requires)check(this.core.progression(playerId).missions.some(m=>m.definitionId===exit.requires&&m.status==='COMPLETED'),'EXIT_LOCKED');
      }
      const result={result:dispatch(this.core,command),...this.core.projectionMetadata()};
      this.core.run('INSERT INTO adapter_events VALUES (?,?,?,?)',lease.epoch,seq,payload,JSON.stringify(result));
      this.core.run('UPDATE adapter_lease SET sequence=? WHERE id=1',seq);
      return result;
    });
  }
  recover(raw:unknown) {
    const input=object(raw);keys(input,['lease','requestId','worldId']);
    return this.core.transaction(()=>{
      const lease=this.lease(input.lease);check(lease.status==='FROZEN','RECOVERY_REQUIRES_FREEZE');
      return this.core.recoverWorld(id(input.requestId),id(input.worldId));
    });
  }
}
