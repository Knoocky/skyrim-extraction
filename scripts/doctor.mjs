import { DatabaseSync } from 'node:sqlite';
const filename = process.env.EXTRACTION_DB ?? 'data/core.sqlite';
let db;
try {
  db = new DatabaseSync(filename, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000; BEGIN');
  const schema = db.prepare('PRAGMA user_version').get().user_version;
  const integrity = db.prepare('PRAGMA quick_check').get().quick_check === 'ok';
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length === 0;
  const supported = schema === 7;
  const state = supported ? db.prepare('SELECT revision, acknowledged FROM projection_state WHERE id=1').get() : null;
  const counts = supported ? {
    players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
    activeExpeditions: db.prepare("SELECT COUNT(*) AS n FROM participants WHERE status='ACTIVE'").get().n,
    receipts: db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n
  } : null;
  db.exec('COMMIT');
  console.log(JSON.stringify({ node: process.version, schema, supported, integrity, foreignKeys, projection: state, counts }, null, 2));
  if (!supported || !integrity || !foreignKeys) process.exitCode = 1;
} catch { console.error('Database diagnostic failed. Check the configured database path, permissions and service version.'); process.exitCode = 1; }
finally { db?.close(); }
