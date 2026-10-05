import { FencedCoreClient } from '../src/fenced-client.ts';
import { ProjectionBridge, type WorldProjectionPort } from '../src/bridge.ts';
import { IntentRouter, type AuthenticationPort } from './intent-router.ts';
/** Engine callbacks are mandatory dependencies. No production fallback to simulated approval. */
export class AdapterRuntime {
  client:FencedCoreClient;
  bridge:ProjectionBridge;
  router:IntentRouter;
  #stopHeartbeat:(()=>void)|null=null;
  #ready=false;
  constructor(client:FencedCoreClient,port:WorldProjectionPort,auth:AuthenticationPort) {
    this.client=client;this.bridge=new ProjectionBridge(client,{
      freeze:()=>port.freeze(), replaceAndVerify:state=>port.replaceAndVerify(state),
      resume:async()=>{
        if(!client.healthy){await port.freeze();throw new Error('LEASE_LOST');}
        await port.resume();
        if(!client.healthy){await port.freeze();throw new Error('LEASE_LOST');}
      }
    });this.router=new IntentRouter(this.bridge,auth);
  }
  async start(holderId:string) {
    this.#ready=false;this.#stopHeartbeat?.();await this.bridge.port.freeze();
    try {
      await this.client.acquire(holderId);
      this.#stopHeartbeat=this.client.watchLease(async()=>{this.#ready=false;await this.bridge.port.freeze();});
      await this.bridge.synchronize();if(!this.client.healthy)throw new Error('LEASE_LOST');this.#ready=true;
    }catch(error){this.#stopHeartbeat?.();await this.bridge.port.freeze();throw error;}
  }
  execute(transportId:string,intent:unknown) {
    if(!this.#ready||!this.client.healthy)throw new Error('ADAPTER_NOT_READY');
    return this.router.execute(transportId,intent);
  }
  async stop(){this.#ready=false;this.#stopHeartbeat?.();this.#stopHeartbeat=null;await this.bridge.port.freeze();}
}
