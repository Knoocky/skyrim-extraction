-- Original schema from commit 72505e2, before quantity migration.
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
