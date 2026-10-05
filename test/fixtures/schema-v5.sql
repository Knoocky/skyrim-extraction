-- Exact schema exported from core 0.6 (fc441a1), without user data.
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
            CHECK(typeof(quantity) = 'integer' AND quantity BETWEEN 1 AND 9999), recovery_owner TEXT REFERENCES players(id)
 CHECK(recovery_owner IS NULL OR (template='iron_sword' AND quantity=1)));
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
CREATE TABLE progression (
 player_id TEXT PRIMARY KEY REFERENCES players(id),
 gold INTEGER NOT NULL DEFAULT 0 CHECK(typeof(gold)='integer' AND gold BETWEEN 0 AND 1000000000),
 xp INTEGER NOT NULL DEFAULT 0 CHECK(typeof(xp)='integer' AND xp BETWEEN 0 AND 1000000000),
 bargaining INTEGER NOT NULL DEFAULT 0 CHECK(bargaining BETWEEN 0 AND 3),
 workshop INTEGER NOT NULL DEFAULT 0 CHECK(workshop BETWEEN 0 AND 3),
 archive INTEGER NOT NULL DEFAULT 0 CHECK(archive BETWEEN 0 AND 1)
, storage INTEGER NOT NULL DEFAULT 0 CHECK(storage BETWEEN 0 AND 3), alchemy INTEGER NOT NULL DEFAULT 0 CHECK(alchemy BETWEEN 0 AND 2), kitchen INTEGER NOT NULL DEFAULT 0 CHECK(kitchen BETWEEN 0 AND 2), scouting INTEGER NOT NULL DEFAULT 0 CHECK(scouting BETWEEN 0 AND 3), capacity_floor INTEGER NOT NULL DEFAULT 100 CHECK(capacity_floor>=100));
CREATE TABLE player_contracts (
 player_id TEXT NOT NULL REFERENCES players(id), contract_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ACCEPTED','COMPLETED')), terms TEXT NOT NULL,
 PRIMARY KEY(player_id,contract_id)
);
CREATE TABLE loot_provenance (
 item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
 extracted INTEGER NOT NULL DEFAULT 0 CHECK(extracted IN (0,1))
);
CREATE TABLE market_stock (
 offer_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 0 AND 9999)
);
CREATE TABLE market_cycle (id INTEGER PRIMARY KEY CHECK(id=1), cycle INTEGER NOT NULL CHECK(cycle>=0));
CREATE UNIQUE INDEX one_stash ON locations(player_id) WHERE kind = 'STASH';
CREATE UNIQUE INDEX one_inventory ON locations(participant_id) WHERE kind = 'INVENTORY';
CREATE INDEX items_at_location ON items(location_id);
CREATE UNIQUE INDEX one_active_raid_per_player ON participants(player_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX one_recovery_item ON items(recovery_owner) WHERE recovery_owner IS NOT NULL;
CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
 WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic','mountain_herb','iron_ingot','leather','raw_meat','food_ration') OR (NEW.template NOT IN ('healing_potion','mountain_herb','iron_ingot','leather','raw_meat','food_ration') AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template,quantity ON items
 WHEN NEW.template NOT IN ('iron_sword','hunting_bow','healing_potion','silver_ring','dwemer_relic','mountain_herb','iron_ingot','leather','raw_meat','food_ration') OR (NEW.template NOT IN ('healing_potion','mountain_herb','iron_ingot','leather','raw_meat','food_ration') AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TRIGGER recovery_owner_insert BEFORE INSERT ON items
 WHEN NEW.recovery_owner IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM locations WHERE id=NEW.location_id AND player_id=NEW.recovery_owner AND kind IN ('STASH','INVENTORY'))
 BEGIN SELECT RAISE(ABORT,'invalid recovery owner'); END;
CREATE TRIGGER recovery_owner_update BEFORE UPDATE OF recovery_owner,location_id ON items
 WHEN (OLD.recovery_owner IS NOT NULL AND NEW.recovery_owner IS NOT OLD.recovery_owner) OR
 (NEW.recovery_owner IS NOT NULL AND NOT EXISTS
 (SELECT 1 FROM locations WHERE id=NEW.location_id AND player_id=NEW.recovery_owner AND kind IN ('STASH','INVENTORY')))
 BEGIN SELECT RAISE(ABORT,'invalid recovery owner'); END;
PRAGMA user_version=5;
