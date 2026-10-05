import { connected, decodeCommand, id, keys, object, type Command } from '../src/protocol.ts';
import { DomainError } from '../src/domain-error.mjs';
import { ProjectionBridge } from '../src/bridge.ts';
interface VerifiedSession { subject:string; connectionId:string; worldId:string }
export interface AuthenticationPort {
  /** Look up a server-verified login, never an offlineLogin/profileId from the incoming packet. */
  session(transportId:string):VerifiedSession|null;
  approve(session:VerifiedSession,command:Command):boolean;
}
/** Client packets have neither credentials nor player identity nor authority flags. */
export class IntentRouter {
  bridge:ProjectionBridge;
  auth:AuthenticationPort;
  constructor(bridge:ProjectionBridge,auth:AuthenticationPort){this.bridge=bridge;this.auth=auth;}
  execute(transportId:string,raw:unknown){
    const session=this.auth.session(transportId);
    if(!session)throw new DomainError('LOGIN_NOT_VERIFIED');
    const input=object(raw);keys(input,['requestId','operation','payload']);
    const operation=id(input.operation),payload=object(input.payload);
    if(!connected.has(operation))throw new DomainError('CLIENT_OPERATION_FORBIDDEN');
    if(payload.worldId!==undefined&&payload.worldId!==session.worldId)throw new DomainError('WRONG_WORLD');
    const command=decodeCommand({protocolVersion:1,requestId:id(input.requestId),operation,payload,connectionId:session.connectionId});
    if(['pickup','consume','extract'].includes(operation)) {
      if(this.auth.approve(session,command)!==true)throw new DomainError('WORLD_INTENT_DENIED');
      command.worldApproved=true;
    }
    return this.bridge.execute(command);
  }
}
