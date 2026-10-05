import { randomUUID } from 'node:crypto';
import { CoreClient, RemoteError, type Projection } from './client.ts';
import { ADAPTER_MANIFEST, canonical } from './manifest.ts';
import type { Command } from './protocol.ts';
import type { Lease } from './adapter-gateway.ts';
/** Use through ProjectionBridge: serialize intents and apply/read back before acknowledging. */
export class FencedCoreClient extends CoreClient {
  lease: Lease | null = null;
  #healthy = false;
  get healthy() { return this.#healthy; }
  #sequence = 0;
  #pending: {command:Command; sequence:number; uncertain:boolean} | null = null;
  #executing = false;
  async acquire(holderId:string,requestId=randomUUID()) {
    const grant=await this.request<Lease & {sequence:number}>('/v1/adapter/handshake',{requestId,holderId,manifest:ADAPTER_MANIFEST});
    this.#healthy=true;
    this.lease={epoch:grant.epoch,token:grant.token};this.#sequence=grant.sequence;
    if(this.#pending)this.#pending.sequence=grant.sequence+1;
    return {epoch:grant.epoch}; // Never expose the token to UI/logs.
  }
  override async acknowledge(state:Projection) {
    if(!this.lease || !this.#healthy)throw new Error('ADAPTER_NOT_CONNECTED');
    await this.request('/v1/adapter/renew',this.lease);
    return this.request('/v1/adapter/reconcile',{lease:this.lease,databaseId:state.databaseId,revision:state.revision});
  }
  override async command<T=unknown>(command:Command):Promise<{result:T;databaseId:string;revision:number}> {
    if(!this.lease || !this.#healthy)throw new Error('ADAPTER_NOT_CONNECTED');
    if(this.#executing)throw new Error('CONCURRENT_ADAPTER_COMMAND');
    if(this.#pending&&canonical(this.#pending.command)!==canonical(command))throw new Error('PREVIOUS_COMMAND_UNCERTAIN');
    const pending=this.#pending??{command,sequence:this.#sequence+1,uncertain:false};
    this.#pending=pending;this.#executing=true;
    try {
      const result=await this.request<{result:T;databaseId:string;revision:number}>('/v1/adapter/command',{lease:this.lease,sequence:pending.sequence,command});
      this.#sequence=pending.sequence;this.#pending=null;return result;
    } catch(error) {
      if(error instanceof RemoteError&&error.status>=400&&error.status<500&&!pending.uncertain) this.#pending=null;
      else {pending.uncertain=true;if(error instanceof RemoteError)error.uncertain=true;}
      throw error;
    } finally {this.#executing=false;}
  }
  watchLease(onLost: (error: unknown) => void | Promise<void>, intervalMs = 5000) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 5000) throw new Error('INVALID_HEARTBEAT_INTERVAL');
    let busy = false, stopped = false;
    const timer = setInterval(() => {
      if (busy || stopped) return;
      busy = true;
      void this.request('/v1/adapter/renew', this.lease).catch(async error => {
        this.#healthy = false; stopped = true; clearInterval(timer); await onLost(error);
      }).catch(() => { /* The owner must keep interactions frozen if its freeze callback fails. */ }).finally(() => { busy = false; });
    }, intervalMs);
    timer.unref();
    return () => { stopped = true; clearInterval(timer); };
  }
  recoverWorld(requestId:string,worldId:string) {
    if(!this.lease || !this.#healthy)throw new Error('ADAPTER_NOT_CONNECTED');
    return this.request('/v1/adapter/recover',{lease:this.lease,requestId,worldId});
  }
}
