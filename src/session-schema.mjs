// Rebuild with foreign_keys disabled BEFORE the transaction; the caller runs foreign_key_check.
export const SESSION_SCHEMA = `
  CREATE TABLE participants_v2 (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
    raid_id TEXT NOT NULL REFERENCES raids(id),
    status TEXT NOT NULL CHECK(status IN ('ACTIVE','DEAD','EXTRACTED','FORFEITED'))
  );
  INSERT INTO participants_v2 SELECT id, player_id, raid_id, status FROM participants;
  DROP TABLE participants;
  ALTER TABLE participants_v2 RENAME TO participants;
  CREATE UNIQUE INDEX one_active_raid_per_player ON participants(player_id) WHERE status = 'ACTIVE';
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
  PRAGMA user_version = 2;
`;
