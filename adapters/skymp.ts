import type { Item, Projection } from '../src/client.ts';
import type { WorldProjectionPort } from '../src/bridge.ts';

export interface SkyMpApi {
  get(formId: number, property: string): unknown;
  set(formId: number, property: string, value: unknown): void;
}
export interface SkyMpBindings {
  actor(playerId: string): number | undefined;
  container(containerId: string): number | undefined;
  // Resolve from the verified plugin/load-order manifest, never a hardcoded global FormID.
  template(template: string): number | undefined;
  interactions(blocked: boolean): void | Promise<void>;
}
type Inventory = { entries: { baseId: number; count: number }[] };
function formId(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value! <= 0 || value! > 0xffffffff) throw new Error('UNRESOLVED_GAME_FORM');
  return value!;
}
function inventory(items: Item[], bindings: SkyMpBindings): Inventory {
  const counts = new Map<number, number>();
  for (const item of items) {
    const baseId = formId(bindings.template(item.template));
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error('INVALID_ITEM_QUANTITY');
    const count = (counts.get(baseId) ?? 0) + item.quantity;
    if (count > 0xffffffff) throw new Error('GAME_COUNT_OVERFLOW');
    counts.set(baseId, count);
  }
  return { entries: [...counts.entries()].sort(([a], [b]) => a - b).map(([baseId, count]) => ({ baseId, count })) };
}
function canonicalInventory(value: unknown): string {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Inventory).entries)) throw new Error('INVALID_GAME_INVENTORY');
  const totals = new Map<number, number>();
  for (const entry of (value as Inventory).entries) {
    formId(entry.baseId);
    if (!Number.isSafeInteger(entry.count) || entry.count < 1) throw new Error('INVALID_GAME_INVENTORY');
    // This first adapter supports plain templates only, no hidden upgrades or enchantments.
    if (Object.entries(entry as Record<string, unknown>).some(([key, extra]) => !['baseId', 'count'].includes(key) && extra !== undefined && extra !== null && extra !== false)) throw new Error('UNSUPPORTED_ITEM_PROPERTIES');
    totals.set(entry.baseId, (totals.get(entry.baseId) ?? 0) + entry.count);
  }
  return JSON.stringify([...totals.entries()].sort(([a], [b]) => a - b));
}

/** Experimental server inventory port. A successful readback is NOT client/gameplay verification. */
export class SkyMpInventoryPort implements WorldProjectionPort {
  mp: SkyMpApi;
  bindings: SkyMpBindings;
  blocked = true;
  #databaseId: string | undefined;
  #revision = 0;
  #payload: string | undefined;
  constructor(mp: SkyMpApi, bindings: SkyMpBindings) { this.mp = mp; this.bindings = bindings; }
  async freeze() { this.blocked = true; await this.bindings.interactions(true); }
  async resume() { await this.bindings.interactions(false); this.blocked = false; }
  replaceAndVerify(state: Projection) {
    if (!this.blocked) throw new Error('PROJECTION_REQUIRES_FREEZE');
    if (state.protocolVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error('INVALID_PROJECTION');
    if (this.#databaseId !== undefined && this.#databaseId !== state.databaseId) throw new Error('DATABASE_CHANGED');
    if (state.revision < this.#revision) throw new Error('STALE_PROJECTION');
    const payload = JSON.stringify(state);
    if (state.revision === this.#revision && this.#payload !== payload) throw new Error('REVISION_CONFLICT');
    const targets = new Map<number, Inventory>();
    const add = (target: number | undefined, items: Item[]) => {
      const id = formId(target);
      if (targets.has(id)) throw new Error('DUPLICATE_GAME_BINDING');
      targets.set(id, inventory(items, this.bindings));
    };
    // Validate all bindings first. Hub stash stays in the database/UI, not the physical actor inventory.
    for (const player of state.players) add(this.bindings.actor(player.playerId), player.active?.items ?? []);
    for (const container of state.containers) add(this.bindings.container(container.id), container.items);
    for (const [target, desired] of targets) {
      this.mp.set(target, 'inventory', desired);
      if (canonicalInventory(this.mp.get(target, 'inventory')) !== canonicalInventory(desired)) throw new Error('GAME_INVENTORY_MISMATCH');
    }
    // Mark only after every target succeeds; a partial application is retried while frozen.
    this.#databaseId = state.databaseId; this.#revision = state.revision; this.#payload = payload;
  }
}

type GameMode = Record<string, unknown>;
type Handler = (...args: number[]) => unknown;
/** Installs server-side vetoes for managed actors. onEatItem requires our upstream consumption patch. */
export function installEconomicGuards(mp: GameMode, managed: (actorId: number) => boolean): () => void {
  const actorIndex: Record<string, number> = { onTakeItem: 1, onPutItem: 1, onDropItem: 0, onCraft: 0, onEatItem: 0 };
  const originals = new Map<string, unknown>();
  const wrappers = new Map<string, Handler>();
  for (const [event, index] of Object.entries(actorIndex)) {
    const previous = mp[event]; originals.set(event, previous);
    const handler: Handler = (...args) => {
      if (managed(args[index])) return false;
      return typeof previous === 'function' ? previous(...args) : true;
    };
    wrappers.set(event, handler); mp[event] = handler;
  }
  return () => {
    for (const [event, previous] of originals) if (mp[event] === wrappers.get(event)) {
      if (previous === undefined) delete mp[event]; else mp[event] = previous;
    }
  };
}
