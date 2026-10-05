import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SESSION_SCHEMA } from './session-schema.mjs';

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
const stackable = template => template === 'healing_potion';
// Equipment has quantity 1; consumable stacks retain their own UUID.
export const CATALOG = Object.freeze(['iron_sword', 'hunting_bow', 'healing_potion', 'silver_ring', 'dwemer_relic']);

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
      requireThat(version <= 2, 'UNSUPPORTED_SCHEMA');
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
    return { playerId, stash, active: active ? {
      raidId: active.raid_id, worldId: active.raid_id,
      participantId: active.id, expeditionId: active.id,
      items: this.itemsAt(this.row('SELECT id FROM locations WHERE participant_id = ?', active.id).id)
    } : null };
  }
  queueProjection() {
    this.run('UPDATE projection_state SET revision = revision + 1 WHERE id = 1');
    const state = this.projectionMetadata();
    const payload = {
      protocolVersion: 1, ...state,
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
    return this.rows('SELECT id, template, quantity FROM items WHERE location_id = ? ORDER BY id', locationId);
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
        this.run('INSERT INTO items (id, template, location_id, quantity) VALUES (?, ?, ?, ?)', randomUUID(), template, containerId, quantity);
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
      requireThat(stackable(item.template), 'NOT_CONSUMABLE');
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
      this.run('UPDATE items SET location_id = ? WHERE location_id = ?', containerId, participant.inventory_id);
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
      this.run('UPDATE items SET location_id = ? WHERE location_id = ?', this.stash(playerId), participant.inventory_id);
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
      this.run("UPDATE raids SET status = 'CLOSED' WHERE id = ?", raidId);
      return { raidId, status: 'CLOSED', lostItems: lost };
    });
  }
  // Consistent reconnect snapshot. Adapter may project this into the game inventory.
  snapshot(playerId) {
    requireThat(validId(playerId), 'INVALID_PLAYER_ID');
    return this.transaction(() => ({ ...this.projectionMetadata(), ...this.readSnapshot(playerId) }));
  }
}
