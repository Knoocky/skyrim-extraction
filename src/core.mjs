import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

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

// Deliberately small catalog. Each row is ONE instance, including potions.
export const CATALOG = Object.freeze(['iron_sword', 'hunting_bow', 'healing_potion', 'silver_ring', 'dwemer_relic']);

/** Trusted in-process service, NOT a public client API.
 * authority must use authoritative world state. Never forward client claims here.
 * Callbacks are synchronous, side-effect-free and must return literal true.
 */
export class ExtractionCore {
  constructor(filename, { authority = {} } = {}) {
    this.authority = authority;
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
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
  }
  close() { this.db.close(); }
  row(sql, ...params) { return this.db.prepare(sql).get(...params); }
  rows(sql, ...params) { return this.db.prepare(sql).all(...params).map(row => ({ ...row })); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  itemsAt(locationId) {
    return this.rows('SELECT id, template FROM items WHERE location_id = ? ORDER BY id', locationId);
  }
  stash(playerId) {
    const stash = this.row("SELECT id FROM locations WHERE kind = 'STASH' AND player_id = ?", playerId);
    requireThat(stash, 'PLAYER_NOT_FOUND');
    return stash.id;
  }
  active(playerId, raidId) {
    const participant = this.row(`SELECT p.*, l.id AS inventory_id FROM participants p
      JOIN raids r ON r.id = p.raid_id JOIN locations l ON l.participant_id = p.id
      WHERE p.player_id = ? AND p.raid_id = ? AND p.status = 'ACTIVE' AND r.status = 'OPEN'`, playerId, raidId);
    requireThat(participant, 'NOT_ACTIVE');
    return participant;
  }
  command(actor, requestId, operation, payload, execute) {
    requireThat(validId(requestId), 'INVALID_REQUEST_ID');
    const command = canonical({ operation, payload });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cached = this.row('SELECT command, result FROM receipts WHERE actor = ? AND request_id = ?', actor, requestId);
      if (cached) {
        requireThat(cached.command === command, 'REQUEST_ID_REUSED');
        this.db.exec('COMMIT');
        return JSON.parse(cached.result);
      }
      const result = execute();
      this.run('INSERT INTO receipts VALUES (?, ?, ?, ?)', actor, requestId, command, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
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
        this.run('INSERT INTO items VALUES (?, ?, ?)', randomUUID(), template, stashId);
      }
      return { playerId, stashId, items: this.itemsAt(stashId) };
    });
  }
  // Trusted world provisioning. Clients cannot mint items or choose this loot table.
  createRaid(requestId, templates = ['silver_ring', 'dwemer_relic']) {
    requireThat(Array.isArray(templates) && templates.length <= 100 && templates.every(t => CATALOG.includes(t)), 'INVALID_LOOT');
    return this.command('system', requestId, 'createRaid', { templates }, () => {
      const raidId = randomUUID(), containerId = randomUUID();
      this.run("INSERT INTO raids VALUES (?, 'OPEN')", raidId);
      this.run("INSERT INTO locations VALUES (?, 'CONTAINER', NULL, ?, NULL)", containerId, raidId);
      for (const template of templates) this.run('INSERT INTO items VALUES (?, ?, ?)', randomUUID(), template, containerId);
      return { raidId, containerId, items: this.itemsAt(containerId) };
    });
  }
  joinRaid(requestId, playerId, raidId, itemIds) {
    requireThat(validId(playerId) && validId(raidId), 'INVALID_ID');
    requireThat(Array.isArray(itemIds) && itemIds.length <= 100 && itemIds.every(validId) && new Set(itemIds).size === itemIds.length, 'INVALID_LOADOUT');
    return this.command('player:' + playerId, requestId, 'joinRaid', { playerId, raidId, itemIds }, () => {
      const stashId = this.stash(playerId);
      requireThat(this.row("SELECT id FROM raids WHERE id = ? AND status = 'OPEN'", raidId), 'RAID_NOT_OPEN');
      requireThat(!this.row("SELECT id FROM participants WHERE player_id = ? AND status = 'ACTIVE'", playerId), 'ALREADY_ACTIVE');
      requireThat(!this.row('SELECT id FROM participants WHERE player_id = ? AND raid_id = ?', playerId, raidId), 'ALREADY_PARTICIPATED');
      for (const itemId of itemIds) {
        requireThat(this.row('SELECT id FROM items WHERE id = ? AND location_id = ?', itemId, stashId), 'ITEM_NOT_IN_STASH');
      }
      const participantId = randomUUID(), inventoryId = randomUUID();
      this.run("INSERT INTO participants VALUES (?, ?, ?, 'ACTIVE')", participantId, playerId, raidId);
      this.run("INSERT INTO locations VALUES (?, 'INVENTORY', ?, ?, ?)", inventoryId, playerId, raidId, participantId);
      for (const itemId of itemIds) this.run('UPDATE items SET location_id = ? WHERE id = ?', inventoryId, itemId);
      return { participantId, raidId, inventoryId, items: this.itemsAt(inventoryId) };
    });
  }
  pickup(requestId, playerId, raidId, containerId, itemId) {
    requireThat([playerId, raidId, containerId, itemId].every(validId), 'INVALID_ID');
    return this.command('player:' + playerId, requestId, 'pickup', { playerId, raidId, containerId, itemId }, () => {
      const participant = this.active(playerId, raidId);
      requireThat(this.row("SELECT id FROM locations WHERE id = ? AND kind = 'CONTAINER' AND raid_id = ?", containerId, raidId), 'WRONG_CONTAINER');
      requireThat(this.row('SELECT id FROM items WHERE id = ? AND location_id = ?', itemId, containerId), 'ITEM_UNAVAILABLE');
      requireThat(this.authority.canPickup?.({ playerId, raidId, containerId, itemId }) === true, 'PICKUP_NOT_AUTHORIZED');
      this.run('UPDATE items SET location_id = ? WHERE id = ?', participant.inventory_id, itemId);
      return { itemId, inventoryId: participant.inventory_id };
    });
  }
  // Trusted death event from the world adapter, never a player-issued kill command.
  recordDeath(requestId, playerId, raidId) {
    requireThat([playerId, raidId].every(validId), 'INVALID_ID');
    return this.command('system', requestId, 'recordDeath', { playerId, raidId }, () => {
      const participant = this.active(playerId, raidId), containerId = randomUUID();
      this.run("INSERT INTO locations VALUES (?, 'CONTAINER', NULL, ?, NULL)", containerId, raidId);
      this.run('UPDATE items SET location_id = ? WHERE location_id = ?', containerId, participant.inventory_id);
      this.run("UPDATE participants SET status = 'DEAD' WHERE id = ?", participant.id);
      return { playerId, raidId, status: 'DEAD', containerId, items: this.itemsAt(containerId) };
    });
  }
  extract(requestId, playerId, raidId, exitId) {
    requireThat([playerId, raidId, exitId].every(validId), 'INVALID_ID');
    return this.command('player:' + playerId, requestId, 'extract', { playerId, raidId, exitId }, () => {
      const participant = this.active(playerId, raidId);
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
    this.db.exec('BEGIN');
    try {
      const stash = this.itemsAt(this.stash(playerId));
      const active = this.row("SELECT * FROM participants WHERE player_id = ? AND status = 'ACTIVE'", playerId);
      const result = { playerId, stash, active: active ? {
        raidId: active.raid_id, participantId: active.id,
        items: this.itemsAt(this.row("SELECT id FROM locations WHERE participant_id = ?", active.id).id)
      } : null };
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
