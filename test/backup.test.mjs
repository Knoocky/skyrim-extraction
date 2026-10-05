import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractionCore } from '../src/core.mjs';
import { backupDatabase } from '../src/backup.mjs';

test('backup includes committed WAL state, restores projection and refuses overwriting', t => {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-backup-'));
  const source = join(directory, 'source.sqlite'), destination = join(directory, 'backup.sqlite');
  const core = new ExtractionCore(source);
  t.after(() => { core.close(); rmSync(directory, { recursive: true, force: true }); });
  core.registerPlayer('alice', 'alice');
  const before = core.projection();
  backupDatabase(source, destination);
  core.registerPlayer('bob', 'bob');
  const restored = new ExtractionCore(destination);
  try {
    assert.deepEqual(restored.projection(), before);
    assert.equal(restored.snapshot('alice').stash.length, 3);
    assert.throws(() => restored.snapshot('bob'), e => e.code === 'PLAYER_NOT_FOUND');
  } finally { restored.close(); }
  assert.throws(() => backupDatabase(source, destination), { code: 'EEXIST' });
  assert.throws(() => backupDatabase(source, source), /INVALID_BACKUP_PATH/);
  assert.equal(core.snapshot('bob').stash.length, 3);
});
