import { DatabaseSync } from 'node:sqlite';
import { chmodSync, linkSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** SQLite snapshot including committed WAL data; never overwrite an existing backup. */
export function backupDatabase(source, destination) {
  const filename = resolve(source), target = resolve(destination);
  if (filename === target || !statSync(filename).isFile()) throw new Error('INVALID_BACKUP_PATH');
  const temp = mkdtempSync(join(dirname(target), '.extraction-backup-'));
  const staging = join(temp, 'snapshot.sqlite');
  let db;
  try {
    db = new DatabaseSync(filename, { readOnly: true });
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('VACUUM INTO ?').run(staging);
    db.close(); db = undefined;
    const check = new DatabaseSync(staging, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok'
          || check.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('INVALID_BACKUP');
    } finally { check.close(); }
    chmodSync(staging, 0o600);
    linkSync(staging, target); // Atomic exclusive publication on the same filesystem.
    return target;
  } finally { db?.close(); rmSync(temp, { recursive: true, force: true }); }
}
