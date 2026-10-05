import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { ExtractionCore, MAX_STACK } from '../src/core.mjs';

const allowed = { canPickup: () => true, canExtract: () => true, canConsume: () => true };
const fails = (code, fn) => assert.throws(fn, error => error.code === code);
function fixture(t, authority = allowed, quantity = 5) {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-stacks-'));
  const filename = join(directory, 'state.sqlite');
  const core = new ExtractionCore(filename, { authority });
  t.after(() => { core.close(); rmSync(directory, { recursive: true, force: true }); });
  core.registerPlayer('alice', 'alice'); core.registerPlayer('bob', 'bob');
  const raid = core.createRaid('raid', [{ template: 'healing_potion', quantity }]);
  const itemId = raid.items[0].id;
  core.joinRaid('join', 'alice', raid.raidId, []);
  core.pickup('pickup', 'alice', raid.raidId, raid.containerId, itemId);
  return { core, filename, raidId: raid.raidId, itemId };
}

test('stack quantity survives death, other-player loot and extraction', t => {
  const f = fixture(t), { core, raidId, itemId } = f;
  core.consume('drink', 'alice', raidId, itemId, 2);
  const death = core.recordDeath('death', 'alice', raidId);
  assert.deepEqual(death.items, [{ id: itemId, template: 'healing_potion', quantity: 3 }]);
  core.joinRaid('join', 'bob', raidId, []);
  core.pickup('pickup', 'bob', raidId, death.containerId, itemId);
  core.extract('exit', 'bob', raidId, 'north');
  assert.equal(core.snapshot('bob').stash.find(i => i.id === itemId).quantity, 3);
});

test('consumption retries cannot spend twice, including after the last unit is deleted', t => {
  const { core, raidId, itemId } = fixture(t);
  const first = core.consume('drink', 'alice', raidId, itemId, 2);
  assert.deepEqual(core.consume('drink', 'alice', raidId, itemId, 2), first);
  fails('REQUEST_ID_REUSED', () => core.consume('drink', 'alice', raidId, itemId, 3));
  fails('INSUFFICIENT_QUANTITY', () => core.consume('too-many', 'alice', raidId, itemId, 4));
  const last = core.consume('last', 'alice', raidId, itemId, 3);
  assert.deepEqual(last, { itemId, consumed: 3, remaining: 0 });
  assert.deepEqual(core.consume('last', 'alice', raidId, itemId, 3), last);
  assert.deepEqual(core.snapshot('alice').active.items, []);
  fails('ITEM_NOT_IN_INVENTORY', () => core.consume('new', 'alice', raidId, itemId));
});

test('consumption denies missing/async authority, foreign ownership and equipment', t => {
  const { core, raidId, itemId } = fixture(t, { canPickup: () => true });
  fails('CONSUMPTION_NOT_AUTHORIZED', () => core.consume('drink', 'alice', raidId, itemId));
  core.authority.canConsume = async () => true;
  fails('CONSUMPTION_NOT_AUTHORIZED', () => core.consume('drink', 'alice', raidId, itemId));
  const sword = core.snapshot('bob').stash.find(i => i.template === 'iron_sword');
  core.joinRaid('join', 'bob', raidId, [sword.id]);
  fails('ITEM_NOT_IN_INVENTORY', () => core.consume('drink', 'bob', raidId, itemId));
  fails('NOT_CONSUMABLE', () => core.consume('sword', 'bob', raidId, sword.id));
  assert.equal(core.snapshot('alice').active.items[0].quantity, 5);
  assert.equal(core.row("SELECT count(*) AS n FROM receipts WHERE request_id = 'drink'").n, 0);
});

test('invalid quantities and nonstackable loot are rejected without mutation', t => {
  const { core, raidId, itemId } = fixture(t);
  for (const quantity of [0, -1, 0.5, NaN, Infinity, '2', MAX_STACK + 1, Number.MAX_SAFE_INTEGER]) {
    fails('INVALID_QUANTITY', () => core.consume('bad', 'alice', raidId, itemId, quantity));
    fails('INVALID_LOOT', () => core.createRaid('bad-loot', [{ template: 'healing_potion', quantity }]));
  }
  fails('INVALID_LOOT', () => core.createRaid('bad-sword', [{ template: 'iron_sword', quantity: 2 }]));
  assert.equal(core.snapshot('alice').active.items[0].quantity, 5);
  assert.throws(() => core.run('UPDATE items SET quantity = 0 WHERE id = ?', itemId), /CHECK/);
  assert.throws(() => core.run('UPDATE items SET quantity = 1.5 WHERE id = ?', itemId), /CHECK/);
  assert.throws(() => core.run("UPDATE items SET quantity = 2 WHERE template = 'iron_sword'"), /invalid item/);
});

test('split and merge preserve totals and IDs across historical retries', t => {
  const { core, raidId, itemId } = fixture(t);
  fails('ALREADY_ACTIVE', () => core.splitStack('split', 'alice', itemId, 2));
  core.extract('exit', 'alice', raidId, 'north');
  const split = core.splitStack('split', 'alice', itemId, 2);
  assert.deepEqual(core.splitStack('split', 'alice', itemId, 2), split);
  assert.equal(core.snapshot('alice').stash.find(i => i.id === itemId).quantity, 3);
  const merged = core.mergeStacks('merge', 'alice', split.newItemId, itemId);
  assert.equal(merged.quantity, 5);
  assert.deepEqual(core.mergeStacks('merge', 'alice', split.newItemId, itemId), merged);
  core.splitStack('split', 'alice', itemId, 2); // Old receipt must not recreate the merged UUID.
  assert.equal(core.row('SELECT count(*) AS n FROM items WHERE id = ?', split.newItemId).n, 0);
  fails('ITEM_NOT_IN_STASH', () => core.splitStack('foreign', 'bob', itemId, 1));
  fails('SAME_STACK', () => core.mergeStacks('same', 'alice', itemId, itemId));
  fails('INSUFFICIENT_QUANTITY', () => core.splitStack('all', 'alice', itemId, 5));
  const sword = core.snapshot('alice').stash.find(i => i.template === 'iron_sword');
  fails('NOT_STACKABLE', () => core.splitStack('sword', 'alice', sword.id, 1));
  fails('INCOMPATIBLE_STACKS', () => core.mergeStacks('wrong-type', 'alice', itemId, sword.id));
});

test('overflow and injected split failure roll back every affected stack', t => {
  const { core, raidId, itemId } = fixture(t, allowed, MAX_STACK);
  core.extract('exit', 'alice', raidId, 'north');
  const other = core.snapshot('alice').stash.find(i => i.template === 'healing_potion' && i.id !== itemId);
  const before = core.snapshot('alice');
  fails('STACK_LIMIT', () => core.mergeStacks('overflow', 'alice', other.id, itemId));
  core.db.exec("CREATE TRIGGER fail_split BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  assert.throws(() => core.splitStack('split', 'alice', itemId, 2), /injected/);
  assert.deepEqual(core.snapshot('alice'), before);
  assert.equal(core.row("SELECT count(*) AS n FROM receipts WHERE request_id = 'split'").n, 0);
  core.db.exec('DROP TRIGGER fail_split');
  core.splitStack('split', 'alice', itemId, 2);
});

test('two connections cannot both consume the last unit', { timeout: 15000 }, async t => {
  const { core, filename, raidId, itemId } = fixture(t, allowed, 1);
  const workers = ['a', 'b'].map(id => new Worker(new URL('./race-worker.mjs', import.meta.url), {
    workerData: { filename, operation: 'consume', args: [id, 'alice', raidId, itemId, 1] }
  }));
  try {
    await Promise.all(workers.map(w => once(w, 'message')));
    const replies = workers.map(w => once(w, 'message'));
    workers.forEach(w => w.postMessage('start'));
    const results = (await Promise.all(replies)).map(([r]) => r);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => r.code === 'ITEM_NOT_IN_INVENTORY').length, 1);
    assert.deepEqual(core.snapshot('alice').active.items, []);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
});

test('v0 migration preserves UUIDs and historical receipts; reopening is repeatable', t => {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-migrate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'v0.sqlite');
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('./fixtures/schema-v0.sql', import.meta.url), 'utf8'));
  old.exec(`INSERT INTO players VALUES ('alice');
    INSERT INTO locations VALUES ('stash','STASH','alice',NULL,NULL);
    INSERT INTO items VALUES ('potion','healing_potion','stash');
    INSERT INTO receipts VALUES ('system','historical','{}','{"old":true}');`);
  old.close();
  for (let i = 0; i < 2; i++) {
    const core = new ExtractionCore(filename);
    try {
      assert.equal(core.row('PRAGMA user_version').user_version, 5);
      assert.deepEqual(core.snapshot('alice').stash, [{ id: 'potion', template: 'healing_potion', quantity: 1 }]);
      assert.equal(core.row("SELECT result FROM receipts WHERE request_id = 'historical'").result, '{"old":true}');
      assert.deepEqual(core.rows('PRAGMA foreign_key_check'), []);
    } finally { core.close(); }
  }
});

test('future schema is refused without creating tables or keeping a lock', t => {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-future-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'future.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA user_version = 6'); db.close();
  fails('UNSUPPORTED_SCHEMA', () => new ExtractionCore(filename));
  const check = new DatabaseSync(filename);
  try {
    check.exec('BEGIN EXCLUSIVE');
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 6);
    assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
    check.exec('ROLLBACK');
  } finally { check.close(); }
});
