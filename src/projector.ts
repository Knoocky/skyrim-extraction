import { DatabaseSync } from 'node:sqlite';
import type { Projection } from './client.ts';

/** Durable TEST adapter. Proves replace-state delivery semantics; does not modify Skyrim. */
export class SimulatedProjector {
  db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS applied (id INTEGER PRIMARY KEY CHECK(id = 1), database_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL);`);
  }
  apply(state: Projection) {
    if (state.protocolVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1) throw new Error('INVALID_PROJECTION');
    const payload = JSON.stringify(state);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT * FROM applied WHERE id = 1').get();
      if (previous) {
        if (previous.database_id !== state.databaseId) throw new Error('DATABASE_CHANGED');
        if (state.revision === previous.revision && previous.payload !== payload) throw new Error('REVISION_CONFLICT');
        if (state.revision <= (previous.revision as number)) {
          this.db.exec('COMMIT');
          return { applied: false, revision: previous.revision as number };
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO applied VALUES (1, ?, ?, ?)').run(state.databaseId, state.revision, payload);
      this.db.exec('COMMIT');
      return { applied: true, revision: state.revision };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  state(): Projection | null {
    const row = this.db.prepare('SELECT payload FROM applied WHERE id = 1').get();
    return row ? JSON.parse(row.payload as string) as Projection : null;
  }
  close() { this.db.close(); }
}
