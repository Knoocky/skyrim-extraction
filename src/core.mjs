import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SESSION_SCHEMA } from './session-schema.mjs';
import { ECONOMY, ECONOMY_SCHEMA } from './economy.mjs';
import { ITEMS, RECIPES, validateContent } from './catalog.mjs';
import { MISSIONS, MISSION_SCHEMA } from './missions.mjs';
import { HUB_SCHEMA } from './hub-schema.mjs';
import { craftingSchema } from './crafting-schema.mjs';
validateContent(ECONOMY);

export class DomainError extends Error {
  constructor(code) { super(code); this.name = 'DomainError'; this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new DomainError(code); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};

export const MAX_STACK = 9999;
const validQuantity = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_STACK;
const stackable = template => Object.hasOwn(ITEMS, template) && ITEMS[template].stackable;
// Equipment has quantity 1; consumable stacks retain their own UUID.
export const CATALOG = Object.freeze(Object.keys(ITEMS));

/** Trusted in-process service, NOT a public client API.
 * authority must use authoritative world state. Never forward client claims here.
 * Callbacks are synchronous, side-effect-free and must return literal true.
 */
export class ExtractionCore {
  constructor(filename, { authority = {} } = {}) {
    this.authority = authority;
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(`
        PRAGMA foreign_keys = OFF;
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        BEGIN IMMEDIATE;
      `);
      const version = this.row('PRAGMA user_version').user_version;
      requireThat(version <= 6, 'UNSUPPORTED_SCHEMA');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS raids (
          id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED'))
        );
        CREATE TABLE IF NOT EXISTS participants (
          id TEXT PRIMARY KEY,
          player_id TEXT NOT NULL REFERENCES players(id),
          raid_id TEXT NOT NULL REFERENCES raids(id),
          status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'DEAD', 'EXTRACTED', 'FORFEITED')),
          UNIQUE(player_id, raid_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_raid_per_player
          ON participants(player_id) WHERE status = 'ACTIVE';
        CREATE TABLE IF NOT EXISTS locations (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('STASH', 'INVENTORY', 'CONTAINER')),
          player_id TEXT REFERENCES players(id),
          raid_id TEXT REFERENCES raids(id),
          participant_id TEXT REFERENCES participants(id),
          CHECK (
            (kind = 'STASH' AND player_id IS NOT NULL AND raid_id IS NULL AND participant_id IS NULL) OR
            (kind = 'INVENTORY' AND player_id IS NOT NULL AND raid_id IS NOT NULL AND participant_id IS NOT NULL) OR
            (kind = 'CONTAINER' AND player_id IS NULL AND raid_id IS NOT NULL AND participant_id IS NULL)
          )
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_stash ON locations(player_id) WHERE kind = 'STASH';
        CREATE UNIQUE INDEX IF NOT EXISTS one_inventory ON locations(participant_id) WHERE kind = 'INVENTORY';
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY, template TEXT NOT NULL, location_id TEXT NOT NULL REFERENCES locations(id)
        );
        CREATE INDEX IF NOT EXISTS items_at_location ON items(location_id);
        CREATE TABLE IF NOT EXISTS receipts (
          actor TEXT NOT NULL, request_id TEXT NOT NULL, command TEXT NOT NULL,
          result TEXT NOT NULL, PRIMARY KEY(actor, request_id)
        );
      `);
      if (version === 0) {
        this.db.exec(`
          ALTER TABLE items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
            CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999);
          CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
          WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic')
            OR (NEW.template <> 'healing_potion' AND NEW.quantity <> 1)
          BEGIN SELECT RAISE(ABORT, 'invalid item template or quantity'); END;
          CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template, quantity ON items
          WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic')
            OR (NEW.template <> 'healing_potion' AND NEW.quantity <> 1)
          BEGIN SELECT RAISE(ABORT, 'invalid item template or quantity'); END;
          PRAGMA user_version = 1;
        `);
      }
      if (version < 2) {
        this.db.exec(SESSION_SCHEMA);
        this.run('INSERT INTO projection_state VALUES (1, ?, 0, 0)', randomUUID());
      }
      if (version < 3) {
        this.db.exec(ECONOMY_SCHEMA);
      }
      if (version < 4) {
        this.db.exec(craftingSchema());
        for (const offer of ECONOMY.offers) this.run('INSERT INTO market_stock VALUES (?,?)', offer.id, offer.stock);
      }
      if (version < 5) {
        this.db.exec(HUB_SCHEMA);
      }
      if (version < 6) {
        this.db.exec(MISSION_SCHEMA);
        this.queueProjection();
      }
      requireThat(this.rows('PRAGMA foreign_key_check').length === 0, 'INVALID_DATABASE_REFERENCES');
      this.db.exec('COMMIT');
      this.db.exec('PRAGMA foreign_keys = ON');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  close() { this.db.close(); }
  row(sql, ...params) { return this.db.prepare(sql).get(...params); }
  rows(sql, ...params) { return this.db.prepare(sql).all(...params).map(row => ({ ...row })); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  transaction(execute) {
    if (this.db.isTransaction) return execute();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = execute();
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  projectionMetadata() {
    const row = this.row('SELECT * FROM projection_state WHERE id = 1');
    return { databaseId: row.database_id, revision: row.revision };
  }
  readSnapshot(playerId) {
    const stash = this.itemsAt(this.stash(playerId));
    const active = this.row("SELECT * FROM participants WHERE player_id = ? AND status = 'ACTIVE'", playerId);
    return { playerId, stash, progression: this.progression(playerId), active: active ? {
      raidId: active.raid_id, worldId: active.raid_id,
      participantId: active.id, expeditionId: active.id,
      items: this.itemsAt(this.row('SELECT id FROM locations WHERE participant_id = ?', active.id).id)
    } : null };
  }
  queueProjection() {
    this.run('UPDATE projection_state SET revision = revision + 1 WHERE id = 1');
    const state = this.projectionMetadata();
    const payload = {
      protocolVersion: 1, ...state, market: this.market(),
      players: this.rows('SELECT id FROM players ORDER BY id').map(p => this.readSnapshot(p.id)),
      worlds: this.rows('SELECT id, status FROM raids ORDER BY id'),
      containers: this.rows("SELECT id, raid_id AS worldId FROM locations WHERE kind = 'CONTAINER' ORDER BY id")
        .map(container => ({ ...container, items: this.itemsAt(container.id) }))
    };
    // A coalescing outbox: complete desired state supersedes older undelivered state.
    this.run(`INSERT INTO projection_outbox VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload`, state.revision, JSON.stringify(payload));
  }
  projection() {
    return this.transaction(() => {
      const row = this.row('SELECT payload FROM projection_outbox WHERE id = 1');
      return row ? JSON.parse(row.payload) : null;
    });
  }
  acknowledgeProjection(databaseId, revision) {
    requireThat(validId(databaseId) && Number.isSafeInteger(revision) && revision >= 0, 'INVALID_PROJECTION');
    return this.transaction(() => {
      const state = this.projectionMetadata();
      requireThat(databaseId === state.databaseId, 'WRONG_DATABASE');
      requireThat(revision <= state.revision, 'FUTURE_REVISION');
      this.run('UPDATE projection_state SET acknowledged = MAX(acknowledged, ?) WHERE id = 1', revision);
      // Keep the latest payload for a restarted adapter, even after acknowledgement.
      return { ...state, acknowledged: this.row('SELECT acknowledged FROM projection_state WHERE id = 1').acknowledged };
    });
  }
  openConnection(requestId, playerId) {
    requireThat(validId(playerId), 'INVALID_PLAYER_ID');
    return this.command('system', requestId, 'openConnection', { playerId }, () => {
      this.stash(playerId);
      const previous = this.row('SELECT generation FROM connections WHERE player_id = ?', playerId);
      const connectionId = randomUUID(), generation = (previous?.generation ?? 0) + 1;
      this.run(`INSERT INTO connections VALUES (?, ?, ?, 'OPEN') ON CONFLICT(player_id)
        DO UPDATE SET id = excluded.id, generation = excluded.generation, status = 'OPEN'`, playerId, connectionId, generation);
      return { playerId, connectionId, generation };
    });
  }
  connection(connectionId) {
    requireThat(validId(connectionId), 'INVALID_CONNECTION');
    const connection = this.row("SELECT * FROM connections WHERE id = ? AND status = 'OPEN'", connectionId);
    requireThat(connection, 'STALE_CONNECTION');
    return connection;
  }
  closeConnection(requestId, connectionId) {
    requireThat(validId(connectionId), 'INVALID_CONNECTION');
    return this.command('system', requestId, 'closeConnection', { connectionId }, () => {
      const connection = this.connection(connectionId);
      this.run("UPDATE connections SET status = 'CLOSED' WHERE id = ?", connectionId);
      return { connectionId, playerId: connection.player_id, status: 'CLOSED' };
    });
  }
  executeConnected(connectionId, execute) {
    // Check and execute under the same write lock: a stale connection cannot win a race.
    return this.transaction(() => {
      const connection = this.connection(connectionId);
      const result = execute(connection.player_id);
      requireThat(!result || typeof result.then !== 'function', 'ASYNC_TRANSACTION');
      return result;
    });
  }
  itemsAt(locationId) {
    return this.rows('SELECT id, template, quantity, recovery_owner FROM items WHERE location_id = ? ORDER BY id', locationId)
      .map(({ recovery_owner, ...item }) => ({ ...item, ...(recovery_owner === null ? {} : { recovery: true }) }));
  }
  stash(playerId) {
    const stash = this.row("SELECT id FROM locations WHERE kind = 'STASH' AND player_id = ?", playerId);
    requireThat(stash, 'PLAYER_NOT_FOUND');
    return stash.id;
  }
  active(playerId, raidId, expeditionId) {
    const participant = this.row(`SELECT p.*, l.id AS inventory_id FROM participants p
      JOIN raids r ON r.id = p.raid_id JOIN locations l ON l.participant_id = p.id
      WHERE p.player_id = ? AND p.raid_id = ? AND p.status = 'ACTIVE' AND r.status = 'OPEN'`, playerId, raidId);
    requireThat(participant, 'NOT_ACTIVE');
    requireThat(expeditionId === undefined || participant.id === expeditionId, 'STALE_EXPEDITION');
    return participant;
  }
  command(actor, requestId, operation, payload, execute) {
    requireThat(validId(requestId), 'INVALID_REQUEST_ID');
    const command = canonical({ operation, payload });
    return this.transaction(() => {
      const cached = this.row('SELECT command, result FROM receipts WHERE actor = ? AND request_id = ?', actor, requestId);
      if (cached) {
        requireThat(cached.command === command, 'REQUEST_ID_REUSED');
        return JSON.parse(cached.result);
      }
      const result = execute();
      this.queueProjection();
      this.run('INSERT INTO receipts VALUES (?, ?, ?, ?)', actor, requestId, command, JSON.stringify(result));
      return result;
    });
  }
  // Provisioning only. Authenticated player identities must come from the adapter.
  registerPlayer(requestId, playerId) {
    requireThat(validId(playerId), 'INVALID_PLAYER_ID');
    return this.command('system', requestId, 'registerPlayer', { playerId }, () => {
      requireThat(!this.row('SELECT id FROM players WHERE id = ?', playerId), 'PLAYER_EXISTS');
      this.run('INSERT INTO players VALUES (?)', playerId);
      this.run('INSERT INTO progression(player_id) VALUES (?)', playerId);
      const stashId = randomUUID();
      this.run("INSERT INTO locations VALUES (?, 'STASH', ?, NULL, NULL)", stashId, playerId);
      for (const template of ['iron_sword', 'hunting_bow', 'healing_potion']) {
        this.run('INSERT INTO items (id, template, location_id) VALUES (?, ?, ?)', randomUUID(), template, stashId);
      }
      return { playerId, stashId, items: this.itemsAt(stashId) };
    });
  }
  // Trusted world provisioning. Clients cannot mint items or choose this loot table.
  createRaid(requestId, templates = ['silver_ring', 'dwemer_relic']) {
    requireThat(Array.isArray(templates) && templates.length <= 100 && Array.from(templates).every(entry => {
      if (typeof entry === 'string') return CATALOG.includes(entry);
      return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        && Object.hasOwn(entry, 'template') && Object.hasOwn(entry, 'quantity')
        && Object.keys(entry).every(key => key === 'template' || key === 'quantity')
        && CATALOG.includes(entry.template) && validQuantity(entry.quantity)
        && (stackable(entry.template) || entry.quantity === 1);
    }), 'INVALID_LOOT');
    return this.command('system', requestId, 'createRaid', { templates }, () => {
      const raidId = randomUUID(), containerId = randomUUID();
      this.run("INSERT INTO raids VALUES (?, 'OPEN')", raidId);
      this.run("INSERT INTO locations VALUES (?, 'CONTAINER', NULL, ?, NULL)", containerId, raidId);
      for (const entry of templates) {
        const { template, quantity } = typeof entry === 'string' ? { template: entry, quantity: 1 } : entry;
        const itemId = randomUUID();
        this.run('INSERT INTO items (id, template, location_id, quantity) VALUES (?, ?, ?, ?)', itemId, template, containerId, quantity);
        this.run('INSERT INTO loot_provenance(item_id) VALUES (?)', itemId);
      }
      return { raidId, containerId, items: this.itemsAt(containerId) };
    });
  }
  // Stash editing is allowed only outside an active expedition. Identity is supplied by the adapter.
  editableStash(playerId) {
    const locationId = this.stash(playerId);
    requireThat(!this.row("SELECT id FROM participants WHERE player_id = ? AND status = 'ACTIVE'", playerId), 'ALREADY_ACTIVE');
    return locationId;
  }
  splitStack(requestId, playerId, itemId, quantity) {
    requireThat([playerId, itemId].every(validId), 'INVALID_ID');
    requireThat(validQuantity(quantity), 'INVALID_QUANTITY');
    return this.command('player:' + playerId, requestId, 'splitStack', { playerId, itemId, quantity }, () => {
      const locationId = this.editableStash(playerId);
      const item = this.row('SELECT * FROM items WHERE id = ? AND location_id = ?', itemId, locationId);
      requireThat(item, 'ITEM_NOT_IN_STASH');
      requireThat(stackable(item.template), 'NOT_STACKABLE');
      requireThat(quantity < item.quantity, 'INSUFFICIENT_QUANTITY');
      this.reserveSlots(playerId, 1);
      const newItemId = randomUUID();
      this.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', quantity, itemId);
      this.run('INSERT INTO items (id, template, location_id, quantity) VALUES (?, ?, ?, ?)', newItemId, item.template, locationId, quantity);
      return { itemId, remaining: item.quantity - quantity, newItemId, quantity };
    });
  }
  mergeStacks(requestId, playerId, sourceId, targetId) {
    requireThat([playerId, sourceId, targetId].every(validId), 'INVALID_ID');
    requireThat(sourceId !== targetId, 'SAME_STACK');
    return this.command('player:' + playerId, requestId, 'mergeStacks', { playerId, sourceId, targetId }, () => {
      const locationId = this.editableStash(playerId);
      const source = this.row('SELECT * FROM items WHERE id = ? AND location_id = ?', sourceId, locationId);
      const target = this.row('SELECT * FROM items WHERE id = ? AND location_id = ?', targetId, locationId);
      requireThat(source && target, 'ITEM_NOT_IN_STASH');
      requireThat(stackable(source.template) && source.template === target.template, 'INCOMPATIBLE_STACKS');
      const quantity = source.quantity + target.quantity;
      requireThat(quantity <= MAX_STACK, 'STACK_LIMIT');
      this.run('UPDATE items SET quantity = ? WHERE id = ?', quantity, targetId);
      this.run('DELETE FROM items WHERE id = ?', sourceId);
      return { sourceId, targetId, quantity };
    });
  }
  // Records an authorized expenditure only. A receipt is NOT a replayable healing effect.
  consume(requestId, playerId, raidId, itemId, quantity = 1, expeditionId) {
    requireThat([playerId, raidId, itemId].every(validId), 'INVALID_ID');
    requireThat(validQuantity(quantity), 'INVALID_QUANTITY');
    return this.command('player:' + playerId, requestId, 'consume', { playerId, raidId, itemId, quantity, ...(expeditionId === undefined ? {} : { expeditionId }) }, () => {
      const participant = this.active(playerId, raidId, expeditionId);
      const item = this.row('SELECT * FROM items WHERE id = ? AND location_id = ?', itemId, participant.inventory_id);
      requireThat(item, 'ITEM_NOT_IN_INVENTORY');
      requireThat(ITEMS[item.template]?.kind === 'consumable', 'NOT_CONSUMABLE');
      requireThat(quantity <= item.quantity, 'INSUFFICIENT_QUANTITY');
      requireThat(this.authority.canConsume?.({ playerId, raidId, itemId, template: item.template, quantity }) === true, 'CONSUMPTION_NOT_AUTHORIZED');
      const remaining = item.quantity - quantity;
      if (remaining === 0) this.run('DELETE FROM items WHERE id = ?', itemId);
      else this.run('UPDATE items SET quantity = ? WHERE id = ?', remaining, itemId);
      return { itemId, consumed: quantity, remaining };
    });
  }
  joinRaid(requestId, playerId, raidId, itemIds) {
    return this.startExpedition(requestId, playerId, raidId, itemIds, false);
  }
  beginExpedition(requestId, playerId, worldId, itemIds) {
    return this.startExpedition(requestId, playerId, worldId, itemIds, true);
  }
  startExpedition(requestId, playerId, raidId, itemIds, allowReturn) {
    requireThat(validId(playerId) && validId(raidId), 'INVALID_ID');
    requireThat(Array.isArray(itemIds) && itemIds.length <= 100 && itemIds.every(validId) && new Set(itemIds).size === itemIds.length, 'INVALID_LOADOUT');
    return this.command('player:' + playerId, requestId, allowReturn ? 'beginExpedition' : 'joinRaid', { playerId, raidId, itemIds }, () => {
      const stashId = this.stash(playerId);
      requireThat(this.row("SELECT id FROM raids WHERE id = ? AND status = 'OPEN'", raidId), 'RAID_NOT_OPEN');
      requireThat(!this.row("SELECT id FROM participants WHERE player_id = ? AND status = 'ACTIVE'", playerId), 'ALREADY_ACTIVE');
      if (!allowReturn) requireThat(!this.row('SELECT id FROM participants WHERE player_id = ? AND raid_id = ?', playerId, raidId), 'ALREADY_PARTICIPATED');
      for (const itemId of itemIds) {
        requireThat(this.row('SELECT id FROM items WHERE id = ? AND location_id = ?', itemId, stashId), 'ITEM_NOT_IN_STASH');
      }
      const participantId = randomUUID(), inventoryId = randomUUID();
      this.run("INSERT INTO participants VALUES (?, ?, ?, 'ACTIVE')", participantId, playerId, raidId);
      this.run("INSERT INTO locations VALUES (?, 'INVENTORY', ?, ?, ?)", inventoryId, playerId, raidId, participantId);
      for (const itemId of itemIds) this.run('UPDATE items SET location_id = ? WHERE id = ?', inventoryId, itemId);
      return { participantId, expeditionId: participantId, raidId, worldId: raidId, inventoryId, items: this.itemsAt(inventoryId) };
    });
  }
  pickup(requestId, playerId, raidId, containerId, itemId, expeditionId) {
    requireThat([playerId, raidId, containerId, itemId].every(validId), 'INVALID_ID');
    return this.command('player:' + playerId, requestId, 'pickup', { playerId, raidId, containerId, itemId, ...(expeditionId === undefined ? {} : { expeditionId }) }, () => {
      const participant = this.active(playerId, raidId, expeditionId);
      requireThat(this.row("SELECT id FROM locations WHERE id = ? AND kind = 'CONTAINER' AND raid_id = ?", containerId, raidId), 'WRONG_CONTAINER');
      requireThat(this.row('SELECT id FROM items WHERE id = ? AND location_id = ?', itemId, containerId), 'ITEM_UNAVAILABLE');
      requireThat(this.authority.canPickup?.({ playerId, raidId, containerId, itemId }) === true, 'PICKUP_NOT_AUTHORIZED');
      this.reserveSlots(playerId, 1);
      this.run('UPDATE items SET location_id = ? WHERE id = ?', participant.inventory_id, itemId);
      return { itemId, inventoryId: participant.inventory_id };
    });
  }
  // Trusted death event from the world adapter, never a player-issued kill command.
  recordDeath(requestId, playerId, raidId, expeditionId) {
    requireThat([playerId, raidId].every(validId), 'INVALID_ID');
    return this.command('system', requestId, 'recordDeath', { playerId, raidId, ...(expeditionId === undefined ? {} : { expeditionId }) }, () => {
      const participant = this.active(playerId, raidId, expeditionId), containerId = randomUUID();
      this.run("INSERT INTO locations VALUES (?, 'CONTAINER', NULL, ?, NULL)", containerId, raidId);
      this.run('DELETE FROM items WHERE location_id=? AND recovery_owner IS NOT NULL', participant.inventory_id);
      this.run('UPDATE items SET location_id = ? WHERE location_id = ?', containerId, participant.inventory_id);
      this.run('DELETE FROM mission_pending WHERE expedition_id=?', participant.id);
      this.run("UPDATE participants SET status = 'DEAD' WHERE id = ?", participant.id);
      return { playerId, raidId, status: 'DEAD', containerId, items: this.itemsAt(containerId) };
    });
  }
  extract(requestId, playerId, raidId, exitId, expeditionId) {
    requireThat([playerId, raidId, exitId].every(validId), 'INVALID_ID');
    return this.command('player:' + playerId, requestId, 'extract', { playerId, raidId, exitId, ...(expeditionId === undefined ? {} : { expeditionId }) }, () => {
      const participant = this.active(playerId, raidId, expeditionId);
      requireThat(this.authority.canExtract?.({ playerId, raidId, exitId }) === true, 'EXTRACTION_NOT_AUTHORIZED');
      const items = this.itemsAt(participant.inventory_id);
      const fresh = this.row(`SELECT COALESCE(SUM(i.quantity),0) AS quantity FROM items i JOIN loot_provenance p ON p.item_id=i.id WHERE i.location_id=? AND p.extracted=0`, participant.inventory_id).quantity;
      this.run('UPDATE progression SET xp=xp+? WHERE player_id=?', fresh * 10, playerId);
      this.run('UPDATE loot_provenance SET extracted=1 WHERE item_id IN (SELECT id FROM items WHERE location_id=?)', participant.inventory_id);
      this.run('UPDATE items SET location_id = ? WHERE location_id = ?', this.stash(playerId), participant.inventory_id);
      this.commitMissionProgress(participant.id);
      this.run("UPDATE participants SET status = 'EXTRACTED' WHERE id = ?", participant.id);
      return { playerId, raidId, status: 'EXTRACTED', items };
    });
  }
  // Trusted raid expiration. Disconnect alone never returns equipment to stash.
  closeRaid(requestId, raidId) {
    requireThat(validId(raidId), 'INVALID_ID');
    return this.command('system', requestId, 'closeRaid', { raidId }, () => {
      requireThat(this.row("SELECT id FROM raids WHERE id = ? AND status = 'OPEN'", raidId), 'RAID_NOT_OPEN');
      const lost = this.run('DELETE FROM items WHERE location_id IN (SELECT id FROM locations WHERE raid_id = ?)', raidId).changes;
      this.run("UPDATE participants SET status = 'FORFEITED' WHERE raid_id = ? AND status = 'ACTIVE'", raidId);
      this.run('DELETE FROM mission_pending WHERE expedition_id IN (SELECT id FROM participants WHERE raid_id=?)', raidId);
      this.run("UPDATE raids SET status = 'CLOSED' WHERE id = ?", raidId);
      return { raidId, status: 'CLOSED', lostItems: lost };
    });
  }
  progression(playerId) {
    const p = this.row('SELECT gold, xp, bargaining, workshop, archive, storage, alchemy, kitchen, scouting FROM progression WHERE player_id=?', playerId);
    requireThat(p, 'PLAYER_NOT_FOUND');
    return { ...p, missions: this.missions(playerId), missionCycle: this.row('SELECT cycle FROM mission_cycle WHERE id=1').cycle, capacity: this.storageState(playerId), level: 1 + Math.floor(p.xp / 100), skillPoints: Math.floor(p.xp / 100) - p.bargaining,
      contracts: this.rows('SELECT contract_id AS id, status, terms FROM player_contracts WHERE player_id=? ORDER BY contract_id', playerId)
        .map(c => ({ id: c.id, status: c.status, terms: JSON.parse(c.terms) })) };
  }
  buy(requestId, playerId, offerId, quantity) {
    requireThat(validId(offerId) && validQuantity(quantity), 'INVALID_PURCHASE');
    return this.command('player:' + playerId, requestId, 'buy', { playerId, offerId, quantity }, () => {
      const stash = this.editableStash(playerId), offer = ECONOMY.offers.find(o => o.id === offerId);
      requireThat(offer && (stackable(offer.template) || quantity === 1), 'INVALID_PURCHASE');
      const p = this.progression(playerId), cost = Math.ceil(offer.buy * (100 - p.workshop * 5) / 100) * quantity;
      requireThat(p.gold >= cost, 'INSUFFICIENT_GOLD');
      requireThat(this.row('SELECT quantity FROM market_stock WHERE offer_id=?', offerId)?.quantity >= quantity, 'OUT_OF_STOCK');
      this.reserveSlots(playerId, 1);
      this.run('UPDATE market_stock SET quantity=quantity-? WHERE offer_id=?', quantity, offerId);
      const itemId = randomUUID();
      this.run('UPDATE progression SET gold=gold-? WHERE player_id=?', cost, playerId);
      this.run('INSERT INTO items(id,template,location_id,quantity) VALUES (?,?,?,?)', itemId, offer.template, stash, quantity);
      return { itemId, quantity, cost };
    });
  }
  sell(requestId, playerId, itemId, quantity) {
    requireThat(validId(itemId) && validQuantity(quantity), 'INVALID_SALE');
    return this.command('player:' + playerId, requestId, 'sell', { playerId, itemId, quantity }, () => {
      const stash = this.editableStash(playerId);
      const item = this.row('SELECT * FROM items WHERE id=? AND location_id=?', itemId, stash);
      requireThat(item && item.quantity >= quantity, 'ITEM_NOT_IN_STASH');
      requireThat(item.recovery_owner === null, 'RECOVERY_ITEM_RESTRICTED');
      const offer = ECONOMY.offers.find(o => o.template === item.template);
      requireThat(offer, 'NOT_TRADABLE');
      const earned = offer.sell * quantity;
      this.removeQuantity(item, quantity);
      this.run('UPDATE progression SET gold=gold+? WHERE player_id=?', earned, playerId);
      return { itemId, sold: quantity, earned };
    });
  }
  removeQuantity(item, quantity) {
    if (quantity === item.quantity) this.run('DELETE FROM items WHERE id=?', item.id);
    else this.run('UPDATE items SET quantity=quantity-? WHERE id=?', quantity, item.id);
  }
  upgrade(requestId, playerId, moduleId, expectedLevel) {
    requireThat(validId(moduleId) && Number.isSafeInteger(expectedLevel) && expectedLevel >= 0, 'INVALID_UPGRADE');
    return this.command('player:' + playerId, requestId, 'upgrade', { playerId, moduleId, expectedLevel }, () => {
      this.editableStash(playerId);
      const module = ECONOMY.modules.find(m => m.id === moduleId);
      requireThat(module, 'UNKNOWN_MODULE');
      const p = this.progression(playerId), level = p[moduleId], cost = module.costs[level];
      requireThat(level === expectedLevel, 'STALE_LEVEL');
      requireThat(cost !== undefined, 'MAX_LEVEL');
      requireThat(p.gold >= cost, 'INSUFFICIENT_GOLD');
      // Column name comes exclusively from the immutable module allowlist.
      this.run(`UPDATE progression SET gold=gold-?, ${moduleId}=${moduleId}+1 WHERE player_id=?`, cost, playerId);
      return { moduleId, level: level + 1, cost };
    });
  }
  learnSkill(requestId, playerId, skillId, expectedRank) {
    requireThat(skillId === 'bargaining' && Number.isSafeInteger(expectedRank), 'INVALID_SKILL');
    return this.command('player:' + playerId, requestId, 'learnSkill', { playerId, skillId, expectedRank }, () => {
      this.editableStash(playerId);
      const p = this.progression(playerId);
      requireThat(p.bargaining === expectedRank, 'STALE_RANK');
      requireThat(p.bargaining < 3 && p.skillPoints > 0, 'SKILL_UNAVAILABLE');
      this.run('UPDATE progression SET bargaining=bargaining+1 WHERE player_id=?', playerId);
      return { skillId, rank: p.bargaining + 1 };
    });
  }
  acceptContract(requestId, playerId, contractId) {
    requireThat(validId(contractId), 'INVALID_CONTRACT');
    return this.command('player:' + playerId, requestId, 'acceptContract', { playerId, contractId }, () => {
      this.editableStash(playerId);
      const definition = ECONOMY.contracts.find(c => c.id === contractId);
      requireThat(definition, 'UNKNOWN_CONTRACT');
      const p = this.progression(playerId);
      requireThat(!p.contracts.some(c => c.id === contractId), 'CONTRACT_ALREADY_ACCEPTED');
      requireThat(p.archive >= definition.archive && (!definition.requires || p.contracts.some(c => c.id === definition.requires && c.status === 'COMPLETED')), 'CONTRACT_LOCKED');
      const terms = { ...definition, version: ECONOMY.version, gold: Math.floor(definition.gold * (100 + p.bargaining * 5) / 100), xp: Math.floor(definition.xp * (100 + p.scouting * 10) / 100) };
      this.run("INSERT INTO player_contracts VALUES (?,?,'ACCEPTED',?)", playerId, contractId, JSON.stringify(terms));
      return { contractId, terms };
    });
  }
  turnInContract(requestId, playerId, contractId, itemIds) {
    requireThat(validId(contractId) && Array.isArray(itemIds) && itemIds.length > 0 && itemIds.length <= 100
      && itemIds.every(validId) && new Set(itemIds).size === itemIds.length, 'INVALID_TURN_IN');
    return this.command('player:' + playerId, requestId, 'turnInContract', { playerId, contractId, itemIds }, () => {
      const stash = this.editableStash(playerId);
      const contract = this.row('SELECT * FROM player_contracts WHERE player_id=? AND contract_id=?', playerId, contractId);
      requireThat(contract?.status === 'ACCEPTED', 'CONTRACT_NOT_ACTIVE');
      const terms = JSON.parse(contract.terms);
      const items = [...itemIds].sort().map(id => {
        const item = this.row('SELECT * FROM items WHERE id=? AND location_id=?', id, stash);
        requireThat(item && item.template === terms.template && item.recovery_owner === null, 'INVALID_CONTRACT_ITEM');
        return item;
      });
      requireThat(items.reduce((sum, item) => sum + item.quantity, 0) >= terms.quantity, 'INSUFFICIENT_ITEMS');
      let remaining = terms.quantity;
      for (const item of items) {
        const count = Math.min(remaining, item.quantity);
        if (count) this.removeQuantity(item, count);
        remaining -= count;
      }
      this.run("UPDATE player_contracts SET status='COMPLETED' WHERE player_id=? AND contract_id=?", playerId, contractId);
      this.run('UPDATE progression SET gold=gold+?, xp=xp+? WHERE player_id=?', terms.gold, terms.xp, playerId);
      return { contractId, gold: terms.gold, xp: terms.xp, delivered: terms.quantity };
    });
  }
  missions(playerId) {
    return this.rows('SELECT * FROM mission_instances WHERE player_id=? ORDER BY rowid', playerId).map(row => {
      const terms = JSON.parse(row.terms);
      const progress = terms.objectives.map((o, index) => {
        const committed = this.row('SELECT count FROM mission_progress WHERE instance_id=? AND objective=?', row.id, index)?.count ?? 0;
        const pending = this.row('SELECT COALESCE(SUM(count),0) AS n FROM mission_pending WHERE instance_id=? AND objective=?', row.id, index).n;
        const count = o.kind === 'delivery' ? this.row(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM items i JOIN locations l ON l.id=i.location_id WHERE l.kind='STASH' AND l.player_id=? AND i.template=? AND i.recovery_owner IS NULL`, playerId, o.target).n : committed;
        return { confirmed: Math.min(o.quantity, count), pending: Math.min(o.quantity - Math.min(o.quantity, count), pending) };
      });
      return { id: row.id, definitionId: row.definition_id, cycle: row.cycle, status: row.status, terms, progress };
    });
  }
  acceptMission(requestId, playerId, definitionId) {
    requireThat(validId(definitionId), 'INVALID_MISSION');
    return this.command('player:' + playerId, requestId, 'acceptMission', { playerId, definitionId }, () => {
      this.editableStash(playerId);
      const definition = MISSIONS.find(m => m.id === definitionId);
      requireThat(definition, 'UNKNOWN_MISSION');
      const history = this.missions(playerId), current = this.row('SELECT cycle FROM mission_cycle WHERE id=1').cycle;
      requireThat(!history.some(m => m.definitionId === definitionId && (m.status === 'ACCEPTED' || !definition.repeatable || m.cycle === current)), 'MISSION_ALREADY_TAKEN');
      requireThat(!definition.requires || history.some(m => m.definitionId === definition.requires && m.status === 'COMPLETED'), 'MISSION_LOCKED');
      const p = this.progression(playerId), id = randomUUID();
      const terms = { ...definition, version: 1, gold: Math.floor(definition.gold * (100 + p.bargaining * 5) / 100), xp: Math.floor(definition.xp * (100 + p.scouting * 10) / 100) };
      this.run("INSERT INTO mission_instances VALUES (?,?,?,?,'ACCEPTED',?)", id, playerId, definitionId, definition.repeatable ? current : 0, JSON.stringify(terms));
      return { instanceId: id, terms };
    });
  }
  advanceMissionCycle(requestId, cycle) {
    requireThat(Number.isSafeInteger(cycle) && cycle > 1, 'INVALID_MISSION_CYCLE');
    return this.command('system', requestId, 'advanceMissionCycle', { cycle }, () => {
      requireThat(cycle > this.row('SELECT cycle FROM mission_cycle WHERE id=1').cycle, 'STALE_MISSION_CYCLE');
      this.run('UPDATE mission_cycle SET cycle=? WHERE id=1', cycle);
      return { cycle };
    });
  }
  recordMissionEvent(requestId, eventId, worldId, kind, target, recipients) {
    requireThat([eventId, worldId, target].every(validId) && ['explore','kill','rescue'].includes(kind), 'INVALID_MISSION_EVENT');
    requireThat(Array.isArray(recipients) && recipients.length > 0 && recipients.length <= 4
      && recipients.every(r => r && typeof r === 'object' && Object.keys(r).length === 2 && validId(r.playerId) && validId(r.expeditionId))
      && new Set(recipients.map(r => r.playerId)).size === recipients.length, 'INVALID_RECIPIENTS');
    const payload = { eventId, worldId, kind, target, recipients: [...recipients].sort((a,b) => a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0) };
    return this.command('system', requestId, 'recordMissionEvent', payload, () => {
      const previous = this.row('SELECT payload,result FROM mission_events WHERE world_id=? AND event_id=?', worldId, eventId);
      if (previous) {
        requireThat(previous.payload === canonical(payload), 'EVENT_ID_REUSED');
        return JSON.parse(previous.result);
      }
      // Validate every participant before recording anything: a group event is all-or-nothing.
      for (const r of payload.recipients) this.active(r.playerId, worldId, r.expeditionId);
      let credited = 0;
      for (const r of payload.recipients) for (const mission of this.missions(r.playerId).filter(m => m.status === 'ACCEPTED')) {
        mission.terms.objectives.forEach((objective, index) => {
          if (objective.kind !== kind || objective.target !== target) return;
          const remaining = objective.quantity - mission.progress[index].confirmed - mission.progress[index].pending;
          if (remaining <= 0) return;
          this.run(`INSERT INTO mission_pending VALUES (?,?,?,1) ON CONFLICT(instance_id,expedition_id,objective) DO UPDATE SET count=count+1`, mission.id, r.expeditionId, index);
          credited++;
        });
      }
      const result = { eventId, credited };
      this.run('INSERT INTO mission_events VALUES (?,?,?,?)', worldId, eventId, canonical(payload), JSON.stringify(result));
      return result;
    });
  }
  commitMissionProgress(expeditionId) {
    const rows = this.rows('SELECT * FROM mission_pending WHERE expedition_id=?', expeditionId);
    for (const row of rows) {
      const mission = this.row('SELECT terms,status FROM mission_instances WHERE id=?', row.instance_id);
      if (mission.status !== 'ACCEPTED') continue;
      const cap = JSON.parse(mission.terms).objectives[row.objective].quantity;
      this.run(`INSERT INTO mission_progress VALUES (?,?,?) ON CONFLICT(instance_id,objective) DO UPDATE SET count=MIN(?,count+excluded.count)`, row.instance_id, row.objective, Math.min(cap,row.count), cap);
    }
    this.run('DELETE FROM mission_pending WHERE expedition_id=?', expeditionId);
  }
  claimMission(requestId, playerId, instanceId) {
    requireThat(validId(instanceId), 'INVALID_MISSION');
    return this.command('player:' + playerId, requestId, 'claimMission', { playerId, instanceId }, () => {
      const stash = this.editableStash(playerId), mission = this.missions(playerId).find(m => m.id === instanceId);
      requireThat(mission?.status === 'ACCEPTED', 'MISSION_NOT_ACTIVE');
      requireThat(mission.terms.objectives.every((o,i) => mission.progress[i].confirmed >= o.quantity), 'MISSION_NOT_READY');
      for (const o of mission.terms.objectives.filter(o => o.kind === 'delivery')) {
        let left = o.quantity;
        for (const item of this.rows('SELECT * FROM items WHERE location_id=? AND template=? AND recovery_owner IS NULL ORDER BY id', stash, o.target)) {
          const count = Math.min(left, item.quantity); if (count) this.removeQuantity(item, count); left -= count;
        }
        requireThat(left === 0, 'INSUFFICIENT_ITEMS');
      }
      this.run("UPDATE mission_instances SET status='COMPLETED' WHERE id=?", instanceId);
      this.run('UPDATE progression SET gold=gold+?,xp=xp+? WHERE player_id=?', mission.terms.gold, mission.terms.xp, playerId);
      return { instanceId, gold: mission.terms.gold, xp: mission.terms.xp };
    });
  }
  storageState(playerId) {
    const p = this.row('SELECT capacity_floor+storage*50 AS slots FROM progression WHERE player_id=?', playerId);
    requireThat(p, 'PLAYER_NOT_FOUND');
    const used = this.row('SELECT COUNT(*) AS n FROM items i JOIN locations l ON l.id=i.location_id WHERE l.player_id=?', playerId).n;
    return { used, limit: p.slots };
  }
  reserveSlots(playerId, additional) {
    const capacity = this.storageState(playerId);
    requireThat(capacity.used + additional <= capacity.limit, 'STORAGE_FULL');
  }
  market() {
    return { cycle: this.row('SELECT cycle FROM market_cycle WHERE id=1').cycle,
      stock: this.rows('SELECT offer_id AS offerId, quantity FROM market_stock ORDER BY offer_id') };
  }
  restockMarket(requestId, cycle) {
    requireThat(Number.isSafeInteger(cycle) && cycle > 0, 'INVALID_MARKET_CYCLE');
    return this.command('system', requestId, 'restockMarket', { cycle }, () => {
      requireThat(cycle > this.market().cycle, 'STALE_MARKET_CYCLE');
      for (const offer of ECONOMY.offers) this.run('UPDATE market_stock SET quantity=? WHERE offer_id=?', offer.stock, offer.id);
      this.run('UPDATE market_cycle SET cycle=? WHERE id=1', cycle);
      return this.market();
    });
  }
  recoveryKit(requestId, playerId) {
    return this.command('player:' + playerId, requestId, 'recoveryKit', { playerId }, () => {
      const stash = this.editableStash(playerId), p = this.progression(playerId);
      const cheapestWeapon = Math.min(...ECONOMY.offers.filter(o => ITEMS[o.template].kind === 'weapon').map(o => Math.ceil(o.buy * (100 - p.workshop * 5) / 100)));
      requireThat(this.itemsAt(stash).length === 0 && p.gold < cheapestWeapon, 'RECOVERY_NOT_NEEDED');
      const itemId = randomUUID();
      this.run('INSERT INTO items(id,template,location_id,quantity,recovery_owner) VALUES (?,?,?,?,?)', itemId, 'iron_sword', stash, 1, playerId);
      return { itemId, template: 'iron_sword', recovery: true };
    });
  }
  craft(requestId, playerId, recipeId, batches) {
    requireThat(validId(recipeId) && Number.isSafeInteger(batches) && batches > 0 && batches <= 100, 'INVALID_CRAFT');
    return this.command('player:' + playerId, requestId, 'craft', { playerId, recipeId, batches }, () => {
      const stash = this.editableStash(playerId), recipe = RECIPES.find(r => r.id === recipeId);
      requireThat(recipe, 'UNKNOWN_RECIPE');
      const p = this.progression(playerId);
      requireThat(p[recipe.module] >= recipe.level, 'RECIPE_LOCKED');
      const feeReduction = recipe.output.template === 'healing_potion' ? p.alchemy : recipe.output.template === 'food_ration' ? p.kitchen : 0;
      const cost = Math.max(0, recipe.gold - feeReduction) * batches;
      requireThat(p.gold >= cost, 'INSUFFICIENT_GOLD');
      const quantity = recipe.output.quantity * batches;
      requireThat(quantity <= MAX_STACK && (stackable(recipe.output.template) || batches === 1), 'INVALID_CRAFT');
      // Validate all inputs before applying; the enclosing transaction also rolls back late failures.
      const inputs = recipe.ingredients.map(input => {
        const items = this.rows('SELECT * FROM items WHERE location_id=? AND template=? AND recovery_owner IS NULL ORDER BY id', stash, input.template);
        const required = input.quantity * batches;
        requireThat(items.reduce((sum, item) => sum + item.quantity, 0) >= required, 'INSUFFICIENT_MATERIALS');
        return { items, required };
      });
      for (const input of inputs) {
        let left = input.required;
        for (const item of input.items) { const count = Math.min(left, item.quantity); if (count) this.removeQuantity(item, count); left -= count; }
      }
      this.reserveSlots(playerId, 1);
      this.run('UPDATE progression SET gold=gold-? WHERE player_id=?', cost, playerId);
      const itemId = randomUUID();
      this.run('INSERT INTO items(id,template,location_id,quantity) VALUES (?,?,?,?)', itemId, recipe.output.template, stash, quantity);
      return { recipeId, batches, itemId, template: recipe.output.template, quantity, cost };
    });
  }
  // Consistent reconnect snapshot. Adapter may project this into the game inventory.
  snapshot(playerId) {
    requireThat(validId(playerId), 'INVALID_PLAYER_ID');
    return this.transaction(() => ({ ...this.projectionMetadata(), ...this.readSnapshot(playerId), market: this.market() }));
  }
}
