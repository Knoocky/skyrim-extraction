import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { ExtractionCore } from '../src/core.mjs';

const allowed = { canPickup: () => true, canExtract: () => true };
function fixture(t, authority = allowed) {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-test-'));
  const filename = join(directory, 'test.sqlite');
  const holder = { core: new ExtractionCore(filename, { authority }), filename };
  t.after(() => { holder.core.close(); rmSync(directory, { recursive: true, force: true }); });
  holder.alice = holder.core.registerPlayer('alice', 'alice');
  holder.bob = holder.core.registerPlayer('bob', 'bob');
  holder.raid = holder.core.createRaid('raid');
  holder.join = (player = 'alice', items = []) => holder.core.joinRaid('join', player, holder.raid.raidId, items);
  return holder;
}
const fails = (code, operation) => assert.throws(operation, error => error.code === code);

test('loadout moves exact item identities out of stash; untouched equipment survives', t => {
  const f = fixture(t), item = f.alice.items[0];
  f.join('alice', [item.id]);
  const state = f.core.snapshot('alice');
  assert.equal(state.stash.length, 2);
  assert.deepEqual(state.active.items.map(i => i.id), [item.id]);
});

test('invalid mixed loadout rolls back without taking any item', t => {
  const f = fixture(t);
  fails('ITEM_NOT_IN_STASH', () => f.join('alice', [f.alice.items[0].id, f.bob.items[0].id]));
  assert.equal(f.core.snapshot('alice').stash.length, 3);
  assert.equal(f.core.snapshot('alice').active, null);
});

test('duplicate loadout IDs and simultaneous membership are rejected', t => {
  const f = fixture(t), item = f.alice.items[0].id;
  fails('INVALID_LOADOUT', () => f.join('alice', [item, item]));
  f.join();
  const other = f.core.createRaid('other');
  fails('ALREADY_ACTIVE', () => f.core.joinRaid('join-other', 'alice', other.raidId, []));
});

test('death transfers equipment and loot; survivor extracts those same instances', t => {
  const f = fixture(t), sword = f.alice.items[0], loot = f.raid.items[0];
  f.join('alice', [sword.id]); f.join('bob');
  f.core.pickup('take', 'alice', f.raid.raidId, f.raid.containerId, loot.id);
  const death = f.core.recordDeath('death', 'alice', f.raid.raidId);
  assert.equal(death.items.length, 2);
  assert.equal(f.core.snapshot('alice').stash.length, 2);
  assert.equal(f.core.snapshot('alice').active, null);
  fails('NOT_ACTIVE', () => f.core.extract('exit', 'alice', f.raid.raidId, 'north'));
  for (const item of death.items) f.core.pickup(item.id, 'bob', f.raid.raidId, death.containerId, item.id);
  f.core.extract('exit', 'bob', f.raid.raidId, 'north');
  const stash = f.core.snapshot('bob').stash;
  assert.equal(stash.length, 5);
  assert.equal(stash.filter(item => item.id === sword.id).length, 1);
  assert.equal(stash.filter(item => item.id === loot.id).length, 1);
});

test('successful command retries return receipts without replaying effects', t => {
  const f = fixture(t); f.join();
  const args = ['take', 'alice', f.raid.raidId, f.raid.containerId, f.raid.items[0].id];
  assert.deepEqual(f.core.pickup(...args), f.core.pickup(...args));
  const first = f.core.extract('exit', 'alice', f.raid.raidId, 'north');
  assert.deepEqual(f.core.extract('exit', 'alice', f.raid.raidId, 'north'), first);
  // An old successful pickup receipt after extraction MUST NOT recreate raid inventory.
  f.core.pickup(...args);
  assert.equal(f.core.snapshot('alice').stash.length, 4);
  assert.equal(f.core.snapshot('alice').active, null);
  fails('REQUEST_ID_REUSED', () => f.core.extract('exit', 'alice', f.raid.raidId, 'south'));
});

test('death event retries do not create additional bags; dead players cannot rejoin', t => {
  const f = fixture(t); f.join('alice', [f.alice.items[0].id]);
  const result = f.core.recordDeath('death', 'alice', f.raid.raidId);
  assert.deepEqual(f.core.recordDeath('death', 'alice', f.raid.raidId), result);
  fails('NOT_ACTIVE', () => f.core.recordDeath('death-again', 'alice', f.raid.raidId));
  fails('ALREADY_PARTICIPATED', () => f.core.joinRaid('rejoin', 'alice', f.raid.raidId, []));
});

test('default authority denies pickup and extraction; failed commands leave state intact', t => {
  const f = fixture(t, {}); f.join('alice', [f.alice.items[0].id]);
  fails('PICKUP_NOT_AUTHORIZED', () => f.core.pickup('take', 'alice', f.raid.raidId, f.raid.containerId, f.raid.items[0].id));
  fails('EXTRACTION_NOT_AUTHORIZED', () => f.core.extract('exit', 'alice', f.raid.raidId, 'north'));
  assert.equal(f.core.snapshot('alice').active.items.length, 1);
  assert.equal(f.core.itemsAt(f.raid.containerId).length, 2);
});

test('asynchronous authority callbacks are not silently treated as permission', t => {
  const f = fixture(t, { canExtract: async () => true }); f.join();
  fails('EXTRACTION_NOT_AUTHORIZED', () => f.core.extract('exit', 'alice', f.raid.raidId, 'north'));
});

test('items from another raid cannot be picked up', t => {
  const f = fixture(t); f.join();
  const other = f.core.createRaid('other');
  fails('WRONG_CONTAINER', () => f.core.pickup('take', 'alice', f.raid.raidId, other.containerId, other.items[0].id));
});

test('a second pickup of an owned item is rejected even with a fresh request ID', t => {
  const f = fixture(t); f.join(); f.join('bob');
  f.core.pickup('take', 'alice', f.raid.raidId, f.raid.containerId, f.raid.items[0].id);
  fails('ITEM_UNAVAILABLE', () => f.core.pickup('take', 'bob', f.raid.raidId, f.raid.containerId, f.raid.items[0].id));
});

test('reopening database preserves active inventory and extraction receipts', t => {
  const f = fixture(t); f.join('alice', [f.alice.items[0].id]);
  const before = f.core.snapshot('alice');
  f.core.close(); f.core = new ExtractionCore(f.filename, { authority: allowed });
  assert.deepEqual(f.core.snapshot('alice'), before);
  const receipt = f.core.extract('exit', 'alice', f.raid.raidId, 'north');
  f.core.close(); f.core = new ExtractionCore(f.filename, { authority: allowed });
  assert.deepEqual(f.core.extract('exit', 'alice', f.raid.raidId, 'north'), receipt);
  assert.equal(f.core.snapshot('alice').stash.length, 3);
});

test('raid closure forfeits outstanding inventory, preserves stash and extracted loot', t => {
  const f = fixture(t); f.join('alice', [f.alice.items[0].id]); f.join('bob', [f.bob.items[0].id]);
  f.core.pickup('take', 'bob', f.raid.raidId, f.raid.containerId, f.raid.items[0].id);
  f.core.extract('exit', 'bob', f.raid.raidId, 'north');
  const closed = f.core.closeRaid('close', f.raid.raidId);
  assert.equal(closed.lostItems, 2);
  assert.deepEqual(f.core.closeRaid('close', f.raid.raidId), closed);
  assert.equal(f.core.snapshot('alice').stash.length, 2);
  assert.equal(f.core.snapshot('alice').active, null);
  assert.equal(f.core.snapshot('bob').stash.length, 4);
  fails('NOT_ACTIVE', () => f.core.extract('exit', 'alice', f.raid.raidId, 'north'));
  fails('RAID_NOT_OPEN', () => f.core.joinRaid('join-again', 'alice', f.raid.raidId, []));
});

test('exception during mutation rolls back both inventory and receipt', t => {
  const f = fixture(t); f.join('alice', [f.alice.items[0].id]);
  const before = f.core.snapshot('alice');
  // Simulate a database failure after the item transfer but before terminal status.
  f.core.db.exec(`CREATE TRIGGER fail_extract BEFORE UPDATE OF status ON participants
    WHEN NEW.status = 'EXTRACTED' BEGIN SELECT RAISE(ABORT, 'injected fault'); END;`);
  assert.throws(() => f.core.extract('exit', 'alice', f.raid.raidId, 'north'), /injected fault/);
  assert.deepEqual(f.core.snapshot('alice'), before);
  f.core.db.exec('DROP TRIGGER fail_extract');
  f.core.extract('exit', 'alice', f.raid.raidId, 'north');
  assert.equal(f.core.snapshot('alice').stash.length, 3);
});

test('two independent connections racing for one item produce exactly one winner', { timeout: 15000 }, async t => {
  const f = fixture(t); f.join(); f.join('bob');
  const workers = ['alice', 'bob'].map(player => new Worker(new URL('./race-worker.mjs', import.meta.url), {
    workerData: { filename: f.filename, args: ['race', player, f.raid.raidId, f.raid.containerId, f.raid.items[0].id] }
  }));
  try {
    await Promise.all(workers.map(worker => once(worker, 'message')));
    const results = workers.map(worker => once(worker, 'message'));
    for (const worker of workers) worker.postMessage('start');
    const replies = (await Promise.all(results)).map(([reply]) => reply);
    assert.equal(replies.filter(r => r.ok).length, 1);
    assert.equal(replies.filter(r => r.code === 'ITEM_UNAVAILABLE').length, 1);
    assert.equal(f.core.snapshot('alice').active.items.length + f.core.snapshot('bob').active.items.length, 1);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});
