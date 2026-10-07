import {ITEMS} from './catalog.mjs';
const all=Object.keys(ITEMS).map(x=>`'${x}'`).join(',');
const stacks=Object.entries(ITEMS).filter(([,x])=>x.stackable).map(([k])=>`'${k}'`).join(',');
export const RAID_SCHEMA = `
DROP TRIGGER item_catalog_insert;
DROP TRIGGER item_catalog_update;
CREATE TRIGGER item_catalog_insert BEFORE INSERT ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;
CREATE TRIGGER item_catalog_update BEFORE UPDATE OF template,quantity ON items
 WHEN NEW.template NOT IN (${all}) OR (NEW.template NOT IN (${stacks}) AND NEW.quantity<>1)
 BEGIN SELECT RAISE(ABORT,'invalid item template or quantity'); END;

CREATE TABLE raid_combat (
 world_id TEXT PRIMARY KEY REFERENCES raids(id), state TEXT NOT NULL,
 bindings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 acknowledged INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED'))
);
CREATE TABLE raid_receipts (
 world_id TEXT NOT NULL REFERENCES raid_combat(world_id), request_id TEXT NOT NULL,
 payload TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(world_id,request_id)
);
PRAGMA user_version=8;
`;
