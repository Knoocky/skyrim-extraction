-- Exact schema exported from core 0.3 (e61d422), without user data.
CREATE TABLE players (id TEXT PRIMARY KEY);
CREATE TABLE raids (
          id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED'))
        );
CREATE TABLE locations (
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
CREATE TABLE items (
          id TEXT PRIMARY KEY, template TEXT NOT NULL, location_id TEXT NOT NULL REFERENCES locations(id)
        , quantity INTEGER NOT NULL DEFAULT 1
            CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999));
CREATE TABLE receipts (
          actor TEXT NOT NULL, request_id TEXT NOT NULL, command TEXT NOT NULL,
          result TEXT NOT NULL, PRIMARY KEY(actor, request_id)
        );
CREATE TABLE "participants" (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
    raid_id TEXT NOT NULL REFERENCES raids(id),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','DEAD','EXTRACTED','FORFEITED'))
  );
CREATE TABLE connections (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    id TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL CHECK(generation > 0),
    status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED'))
  );
CREATE TABLE projection_state (
    id INTEGER PRIMARY KEY CHECK(id = 1), database_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision >= 0),
    acknowledged INTEGER NOT NULL CHECK(acknowledged >= 0 AND acknowledged <= revision)
  );
CREATE TABLE projection_outbox (
    id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL
  );
CREATE UNIQUE INDEX one_stash ON locations(player_id) WHERE kind = 'STASH';
CREATE UNIQUE INDEX one_inventory ON locations(participant_id) WHERE kind = 'INVENTORY';
CREATE INDEX items_at_location ON items(location_id);
CREATE UNIQUE INDEX one_active_raid_per_player ON participants(player_id) WHERE status = 'ACTIVE';
CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
          WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic')
            OR (NEW.template <> 'healing_potion' AND NEW.quantity <> 1)
          BEGIN SELECT RAISE(ABORT, 'invalid item template or quantity'); END;
CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template, quantity ON items
          WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic')
            OR (NEW.template <> 'healing_potion' AND NEW.quantity <> 1)
          BEGIN SELECT RAISE(ABORT, 'invalid item template or quantity'); END;
PRAGMA user_version=2;
