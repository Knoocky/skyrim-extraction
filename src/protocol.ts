import { DomainError, ExtractionCore } from './core.mjs';

export const PROTOCOL_VERSION = 1;
export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_OBJECT');
  return value as ObjectValue;
}
export function keys(value: ObjectValue, required: string[], optional: string[] = []): void {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) {
    throw new DomainError('INVALID_FIELDS');
  }
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) throw new DomainError('INVALID_ID');
  return value;
}
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new DomainError('INVALID_INTEGER');
  return value as number;
}
export interface Command {
  protocolVersion: 1;
  requestId: string;
  operation: string;
  payload: ObjectValue;
  connectionId?: string;
  // A decision made by the authenticated SERVER adapter, never copied from a player packet.
  worldApproved?: boolean;
}
const fields: Record<string, string[]> = {
  acceptMission: ['definitionId'], claimMission: ['instanceId'], advanceMissionCycle: ['cycle'],
  recordMissionEvent: ['eventId', 'worldId', 'kind', 'target', 'recipients'],
  recoveryKit: [], craft: ['recipeId', 'batches'], restockMarket: ['cycle'],
  registerPlayer: ['playerId'], createWorld: ['loot'], openConnection: ['playerId'],
  closeConnection: ['connectionId'], closeWorld: ['worldId'],
  recordDeath: ['playerId', 'worldId', 'expeditionId'],
  beginExpedition: ['worldId', 'itemIds'],
  pickup: ['worldId', 'expeditionId', 'containerId', 'itemId'],
  consume: ['worldId', 'expeditionId', 'itemId', 'quantity'],
  extract: ['worldId', 'expeditionId', 'exitId'],
  buy: ['offerId', 'quantity'], sell: ['itemId', 'quantity'],
  upgrade: ['moduleId', 'expectedLevel'], learnSkill: ['skillId', 'expectedRank'],
  acceptContract: ['contractId'], turnInContract: ['contractId', 'itemIds'],
  splitStack: ['itemId', 'quantity'], mergeStacks: ['sourceId', 'targetId']
};
const connected = new Set(['beginExpedition', 'pickup', 'consume', 'extract', 'splitStack', 'mergeStacks', 'acceptMission', 'claimMission', 'recoveryKit', 'craft', 'buy', 'sell', 'upgrade', 'learnSkill', 'acceptContract', 'turnInContract']);
const needsApproval = new Set(['pickup', 'consume', 'extract', 'recordDeath', 'recordMissionEvent']);

export function decodeCommand(raw: unknown): Command {
  const input = object(raw);
  keys(input, ['protocolVersion', 'requestId', 'operation', 'payload'], ['connectionId', 'worldApproved']);
  if (input.protocolVersion !== PROTOCOL_VERSION) throw new DomainError('UNSUPPORTED_PROTOCOL');
  const operation = id(input.operation), requestId = id(input.requestId);
  if (!Object.hasOwn(fields, operation)) throw new DomainError('UNKNOWN_OPERATION');
  const payload = object(input.payload);
  keys(payload, fields[operation]);
  for (const name of fields[operation]) {
    if (name.endsWith('Id')) id(payload[name]);
    if (['quantity', 'expectedLevel', 'expectedRank', 'batches', 'cycle'].includes(name)) integer(payload[name]);
  }
  if (['beginExpedition', 'turnInContract'].includes(operation) && (!Array.isArray(payload.itemIds) || payload.itemIds.length > 100 || !payload.itemIds.every(x => { id(x); return true; }))) {
    throw new DomainError('INVALID_LOADOUT');
  }
  if (connected.has(operation)) id(input.connectionId);
  else if (input.connectionId !== undefined) throw new DomainError('INVALID_FIELDS');
  if (input.worldApproved !== undefined && (!needsApproval.has(operation) || typeof input.worldApproved !== 'boolean')) throw new DomainError('INVALID_FIELDS');
  return { protocolVersion: 1, requestId, operation, payload, connectionId: input.connectionId as string | undefined, worldApproved: input.worldApproved as boolean | undefined };
}

export function dispatch(core: ExtractionCore, command: Command): unknown {
  const { requestId: r, operation: op, payload: p } = command;
  const previous = core.authority;
  // This function is synchronous. The decision cannot leak into the next HTTP request.
  core.authority = {
    canPickup: () => command.worldApproved === true && op === 'pickup',
    canExtract: () => command.worldApproved === true && op === 'extract',
    canConsume: () => command.worldApproved === true && op === 'consume'
  };
  try {
    if (connected.has(op)) return core.executeConnected(command.connectionId!, (playerId: string) => {
      switch (op) {
        case 'acceptMission': return core.acceptMission(r, playerId, p.definitionId);
        case 'claimMission': return core.claimMission(r, playerId, p.instanceId);
        case 'recoveryKit': return core.recoveryKit(r, playerId);
        case 'craft': return core.craft(r, playerId, p.recipeId, p.batches);
        case 'buy': return core.buy(r, playerId, p.offerId, p.quantity);
        case 'sell': return core.sell(r, playerId, p.itemId, p.quantity);
        case 'upgrade': return core.upgrade(r, playerId, p.moduleId, p.expectedLevel);
        case 'learnSkill': return core.learnSkill(r, playerId, p.skillId, p.expectedRank);
        case 'acceptContract': return core.acceptContract(r, playerId, p.contractId);
        case 'turnInContract': return core.turnInContract(r, playerId, p.contractId, p.itemIds);
        case 'beginExpedition': return core.beginExpedition(r, playerId, p.worldId, p.itemIds);
        case 'pickup': return core.pickup(r, playerId, p.worldId, p.containerId, p.itemId, p.expeditionId);
        case 'consume': return core.consume(r, playerId, p.worldId, p.itemId, p.quantity as number, p.expeditionId);
        case 'extract': return core.extract(r, playerId, p.worldId, p.exitId, p.expeditionId);
        case 'splitStack': return core.splitStack(r, playerId, p.itemId, p.quantity);
        case 'mergeStacks': return core.mergeStacks(r, playerId, p.sourceId, p.targetId);
      }
    });
    switch (op) {
      case 'advanceMissionCycle': return core.advanceMissionCycle(r, p.cycle);
      case 'recordMissionEvent':
        if (command.worldApproved !== true) throw new DomainError('MISSION_EVENT_NOT_AUTHORIZED');
        return core.recordMissionEvent(r, p.eventId, p.worldId, p.kind, p.target, p.recipients);
      case 'restockMarket': return core.restockMarket(r, p.cycle);
      case 'registerPlayer': return core.registerPlayer(r, p.playerId);
      case 'createWorld': return core.createRaid(r, p.loot as string[]);
      case 'openConnection': return core.openConnection(r, p.playerId);
      case 'closeConnection': return core.closeConnection(r, p.connectionId);
      case 'closeWorld': return core.closeRaid(r, p.worldId);
      case 'recordDeath':
        if (command.worldApproved !== true) throw new DomainError('DEATH_NOT_AUTHORIZED');
        return core.recordDeath(r, p.playerId, p.worldId, p.expeditionId);
      default: throw new DomainError('UNKNOWN_OPERATION');
    }
  } finally { core.authority = previous; }
}
