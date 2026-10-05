import { ITEMS } from './catalog.mjs';
export function extensionSchema() {
  const all = Object.keys(ITEMS).map(id => `'${id}'`).join(',');
  const stacks = Object.entries(ITEMS).filter(([,i]) => i.stackable).map(([id]) => `'${id}'`).join(',');
  return `
ALTER TABLE progression ADD COLUMN fieldcraft INTEGER NOT NULL DEFAULT 0 CHECK(fieldcraft BETWEEN 0 AND 3);
ALTER TABLE progression ADD COLUMN scholarship INTEGER NOT NULL DEFAULT 0 CHECK(scholarship BETWEEN 0 AND 3);
ALTER TABLE progression ADD COLUMN reputation INTEGER NOT NULL DEFAULT 0 CHECK(reputation BETWEEN 0 AND 1000000000);
UPDATE progression SET reputation=(SELECT COALESCE(SUM(CASE WHEN json_extract(terms,'$.repeatable')=1 THEN 1 ELSE 10 END),0) FROM mission_instances WHERE player_id=progression.player_id AND status='COMPLETED');
CREATE TABLE economy_audit (
 sequence INTEGER PRIMARY KEY, revision INTEGER NOT NULL, actor TEXT NOT NULL, request_id TEXT NOT NULL,
 operation TEXT NOT NULL, gold_before INTEGER NOT NULL, gold_after INTEGER NOT NULL,
 units_before INTEGER NOT NULL, units_after INTEGER NOT NULL
);
CREATE TABLE expedition_reports (
 expedition_id TEXT PRIMARY KEY REFERENCES participants(id), player_id TEXT NOT NULL REFERENCES players(id),
 outcome TEXT NOT NULL CHECK(outcome IN ('EXTRACTED','DEAD','FORFEITED','RECOVERED')), items TEXT NOT NULL, xp INTEGER NOT NULL
);
DROP TRIGGER item_catalog_insert;
DROP TRIGGER item_catalog_update;
CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template,quantity ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TABLE world_clock (world_id TEXT PRIMARY KEY REFERENCES raids(id), minute INTEGER NOT NULL);
CREATE TABLE world_areas (world_id TEXT REFERENCES raids(id), area_id TEXT, container_id TEXT REFERENCES locations(id), cycle INTEGER NOT NULL, PRIMARY KEY(world_id,area_id));
CREATE TABLE area_occupancy (expedition_id TEXT PRIMARY KEY REFERENCES participants(id),world_id TEXT REFERENCES raids(id),area_id TEXT NOT NULL,transition_to TEXT,sequence INTEGER NOT NULL);
CREATE TABLE expedition_loadout (expedition_id TEXT REFERENCES participants(id),item_id TEXT NOT NULL,PRIMARY KEY(expedition_id,item_id));
CREATE TABLE adapter_lease (id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,token TEXT,holder TEXT,request_id TEXT,lease_until INTEGER NOT NULL,sequence INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('FROZEN','LIVE')),last_clock INTEGER NOT NULL);
INSERT INTO adapter_lease VALUES (1,0,NULL,NULL,NULL,0,0,'FROZEN',0);
CREATE TABLE adapter_events (epoch INTEGER NOT NULL,sequence INTEGER NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(epoch,sequence));
PRAGMA user_version=7;
`;
}
