export const HUB_SCHEMA = `
ALTER TABLE progression ADD COLUMN storage INTEGER NOT NULL DEFAULT 0 CHECK(storage BETWEEN 0 AND 3);
ALTER TABLE progression ADD COLUMN alchemy INTEGER NOT NULL DEFAULT 0 CHECK(alchemy BETWEEN 0 AND 2);
ALTER TABLE progression ADD COLUMN kitchen INTEGER NOT NULL DEFAULT 0 CHECK(kitchen BETWEEN 0 AND 2);
ALTER TABLE progression ADD COLUMN scouting INTEGER NOT NULL DEFAULT 0 CHECK(scouting BETWEEN 0 AND 3);
ALTER TABLE progression ADD COLUMN capacity_floor INTEGER NOT NULL DEFAULT 100 CHECK(capacity_floor>=100);
UPDATE progression SET capacity_floor=MAX(100,(
 SELECT COUNT(*) FROM items i JOIN locations l ON l.id=i.location_id WHERE l.player_id=progression.player_id
));
PRAGMA user_version=5;
`;
