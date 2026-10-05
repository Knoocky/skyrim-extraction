import type { Command } from './protocol.ts';

export interface Item { id: string; template: string; quantity: number; recovery?: boolean }
export interface ContractTerms { id: string; name: string; template: string; quantity: number; gold: number; xp: number; version: number }
export interface MissionTerms { id: string; name: string; objectives: { kind: string; target: string; quantity: number }[]; gold: number; xp: number; repeatable: boolean }
export interface Mission { id: string; definitionId: string; cycle: number; status: 'ACCEPTED' | 'COMPLETED'; terms: MissionTerms; progress: { confirmed: number; pending: number }[] }
export interface Progression {
  missions: Mission[]; missionCycle: number;
  fieldcraft: number; scholarship: number; reputation: number; finaleCompleted: boolean;
  gold: number; xp: number; level: number; skillPoints: number;
  bargaining: number; workshop: number; archive: number;
  storage: number; alchemy: number; kitchen: number; scouting: number; capacity: { used: number; limit: number };
  contracts: { id: string; status: 'ACCEPTED' | 'COMPLETED'; terms: ContractTerms }[];
}
export interface PlayerState {
  reports?: { expeditionId: string; outcome: string; items: Item[]; xp: number }[];
  progression: Progression;
  playerId: string;
  stash: Item[];
  active: null | { raidId: string; worldId: string; participantId: string; expeditionId: string; items: Item[] };
}
export interface Market { cycle: number; stock: { offerId: string; quantity: number }[] }
export interface Projection {
  market: Market;
  protocolVersion: 1;
  databaseId: string;
  revision: number;
  players: PlayerState[];
  worlds: { id: string; status: 'OPEN' | 'CLOSED' }[];
  containers: { id: string; worldId: string; items: Item[] }[];
}
export class RemoteError extends Error {
  code: string;
  status: number;
  commandRejected = false;
  uncertain = false;
  constructor(code: string, status = 0) { super(code); this.code = code; this.status = status; }
}
export class CoreClient {
  baseUrl: string;
  #token: string;
  constructor(baseUrl: string, token: string) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid core URL');
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.#token = token;
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { authorization: 'Bearer ' + this.#token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });
    const value = await response.json() as { error?: string };
    if (!response.ok) throw new RemoteError(value.error ?? 'HTTP_ERROR', response.status);
    return value as T;
  }
  command<T = unknown>(command: Command) {
    return this.request<{ result: T; databaseId: string; revision: number }>('/v1/command', command);
  }
  projection() { return this.request<Projection>('/v1/projection'); }
  snapshot(connectionId: string) { return this.request<PlayerState & { databaseId: string; revision: number; market: Market }>('/v1/snapshot', { connectionId }); }
  acknowledge(state: Projection) { return this.request('/v1/ack', { databaseId: state.databaseId, revision: state.revision }); }
}
