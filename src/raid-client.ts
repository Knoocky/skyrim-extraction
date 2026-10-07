import {CoreClient,RemoteError} from './client.ts';
import type {RaidSnapshot} from './raid-service.ts';
/** Trusted adapter only. Never put this bearer key into the game/browser client. */
export class RaidClient extends CoreClient {
  state(){return this.request<{ready:boolean;snapshot:RaidSnapshot;manifest:{version:number;rulesHash:string}}>('/v1/raid');}
  async call(operation:string,payload:unknown):Promise<{result:unknown;ready:boolean}>{
    if(!['intent','advance','contact','npc','recover','retry','heartbeat','connection','spawn','retire'].includes(operation))throw Error('UNKNOWN_RAID_ROUTE');
    try{return await this.request('/v1/raid/'+operation,payload);}
    catch(error){
      // A failure can happen after the SQL commit; reconcile before retrying the same request.
      const e=error instanceof RemoteError?error:new RemoteError('RAID_NETWORK_UNCERTAIN');e.uncertain=true;throw e;
    }
  }
  execute(transportId:string,command:unknown){return this.call('intent',{transportId,command});}
  retry(){return this.call('retry',{});}
  heartbeat(){return this.call('heartbeat',{});}
}
