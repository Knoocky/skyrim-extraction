import { ITEMS } from './catalog.mjs';
// IDs are validated before generating SQL; definitions are source-controlled server data.
export function craftingSchema() {
  const all = Object.keys(ITEMS).map(id => `'${id}'`).join(',');
  const stacks = Object.entries(ITEMS).filter(([, item]) => item.stackable).map(([id]) => `'${id}'`).join(',');
  return `
ALTER TABLE items ADD COLUMN recovery_owner TEXT REFERENCES players(id)
 CHECK(recovery_owner IS NULL OR (template='iron_sword' AND quantity=1));
CREATE UNIQUE INDEX one_recovery_item ON items(recovery_owner) WHERE recovery_owner IS NOT NULL;
DROP TRIGGER item_catalog_insert;
DROP TRIGGER item_catalog_update;
CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template,quantity ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
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
CREATE TABLE market_stock (
 offer_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 0 AND 9999)
);
CREATE TABLE market_cycle (id INTEGER PRIMARY KEY CHECK(id=1), cycle INTEGER NOT NULL CHECK(cycle>=0));
INSERT INTO market_cycle VALUES (1,0);
PRAGMA user_version=4;
`;
}
