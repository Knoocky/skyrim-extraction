import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ExtractionCore } from '../src/core.mjs';

for (const phase of ['before-commit', 'after-commit']) {
  test(`process kill ${phase} recovers quantity and retry together`, { timeout: 15000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'extraction-crash-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, 'state.sqlite');
    const authority = { canPickup: () => true, canConsume: () => true };
    let core = new ExtractionCore(filename, { authority });
    core.registerPlayer('alice', 'alice');
    const raid = core.createRaid('raid', [{ template: 'healing_potion', quantity: 5 }]);
    const itemId = raid.items[0].id;
    core.joinRaid('join', 'alice', raid.raidId, []);
    core.pickup('pickup', 'alice', raid.raidId, raid.containerId, itemId);
    const projectionBefore = core.projection();
    core.close();
    const child = spawn(process.execPath, [fileURLToPath(new URL('./crash-child.mjs', import.meta.url)), filename, phase, raid.raidId, itemId], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    try {
      const ready = await Promise.race([
        once(child.stdout, 'data').then(([data]) => data.toString()),
        exited.then(() => { throw new Error('Child exited before kill point: ' + stderr); }),
        new Promise((_, reject) => t.signal.addEventListener('abort', () => reject(new Error('Test aborted')), { once: true }))
      ]);
      assert.match(ready, /kill-point/);
      assert.equal(child.kill('SIGKILL'), true);
      await exited;
      core = new ExtractionCore(filename, { authority });
      try {
        assert.equal(core.snapshot('alice').active.items[0].quantity, phase === 'before-commit' ? 5 : 3);
        assert.equal(core.projection().revision, projectionBefore.revision + (phase === 'after-commit' ? 1 : 0));
        assert.equal(core.projection().players[0].active.items[0].quantity, phase === 'before-commit' ? 5 : 3);
        assert.equal(core.row("SELECT count(*) AS n FROM receipts WHERE request_id = 'crash-consume'").n, phase === 'before-commit' ? 0 : 1);
        const response = core.consume('crash-consume', 'alice', raid.raidId, itemId, 2);
        assert.deepEqual(response, { itemId, consumed: 2, remaining: 3 });
        assert.equal(core.snapshot('alice').active.items[0].quantity, 3);
        assert.equal(core.row('PRAGMA integrity_check').integrity_check, 'ok');
      } finally { core.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
}
