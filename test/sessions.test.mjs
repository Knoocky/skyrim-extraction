import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExtractionCore } from '../src/core.mjs';
import { SimulatedProjector } from '../src/projector.ts';

const fails = (code, fn) => assert.throws(fn, e => e.code === code);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-sessions-'));
  const core = new ExtractionCore(join(directory, 'state.sqlite'), { authority: { canPickup: () => true, canConsume: () => true, canExtract: () => true } });
  t.after(() => { core.close(); rmSync(directory, { recursive: true, force: true }); });
  core.registerPlayer('alice', 'alice'); core.registerPlayer('bob', 'bob');
  const world = core.createRaid('world');
  return { directory, core, world };
}

test('personal expeditions can return to one persistent world without resetting another player', t => {
  const { core, world } = fixture(t);
  const first = core.beginExpedition('first', 'alice', world.raidId, []);
  const bob = core.beginExpedition('bob-first', 'bob', world.raidId, []);
  core.extract('exit', 'alice', world.raidId, 'north', first.expeditionId);
  const second = core.beginExpedition('second', 'alice', world.raidId, []);
  assert.notEqual(first.expeditionId, second.expeditionId);
  assert.equal(core.snapshot('bob').active.expeditionId, bob.expeditionId);
  assert.equal(core.itemsAt(world.containerId).length, 2);
  fails('STALE_EXPEDITION', () => core.recordDeath('late-death', 'alice', world.raidId, first.expeditionId));
  fails('STALE_EXPEDITION', () => core.pickup('late-pickup', 'alice', world.raidId, world.containerId, world.items[0].id, first.expeditionId));
  assert.equal(core.snapshot('alice').active.expeditionId, second.expeditionId);
  // Historical retry returns its old outcome and does not terminate the second expedition.
  core.extract('exit', 'alice', world.raidId, 'north', first.expeditionId);
  assert.equal(core.snapshot('alice').active.expeditionId, second.expeditionId);
});

test('reconnect invalidates the previous connection even for receipt retries', t => {
  const { core, world } = fixture(t);
  const old = core.openConnection('connect-1', 'alice');
  const run = () => core.executeConnected(old.connectionId, player => core.beginExpedition('enter', player, world.raidId, []));
  const expedition = run();
  const current = core.openConnection('connect-2', 'alice');
  assert.equal(current.generation, old.generation + 1);
  fails('STALE_CONNECTION', run);
  assert.equal(core.executeConnected(current.connectionId, player => core.snapshot(player)).active.expeditionId, expedition.expeditionId);
  core.closeConnection('disconnect', current.connectionId);
  fails('STALE_CONNECTION', () => core.executeConnected(current.connectionId, player => core.snapshot(player)));
  assert.equal(core.snapshot('alice').active.expeditionId, expedition.expeditionId);
});

test('economic change, revision and latest-state outbox commit or roll back together', t => {
  const { core, world } = fixture(t);
  core.beginExpedition('enter', 'alice', world.raidId, []);
  const before = core.projection();
  core.db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON projection_outbox BEGIN SELECT RAISE(ABORT, 'outbox failure'); END;");
  assert.throws(() => core.pickup('take', 'alice', world.raidId, world.containerId, world.items[0].id), /outbox failure/);
  assert.deepEqual(core.projection(), before);
  assert.equal(core.snapshot('alice').active.items.length, 0);
  assert.equal(core.itemsAt(world.containerId).length, 2);
  core.db.exec('DROP TRIGGER fail_outbox');
  const taken = core.pickup('take', 'alice', world.raidId, world.containerId, world.items[0].id);
  assert.equal(core.projection().revision, before.revision + 1);
  const after = core.projection();
  assert.deepEqual(core.pickup('take', 'alice', world.raidId, world.containerId, world.items[0].id), taken);
  assert.deepEqual(core.projection(), after);
});

test('acknowledging old state cannot discard new state; restart can request even acknowledged state', t => {
  const { core } = fixture(t);
  const before = core.projection();
  core.openConnection('connect', 'alice');
  const current = core.projection();
  core.acknowledgeProjection(before.databaseId, before.revision);
  assert.deepEqual(core.projection(), current);
  core.acknowledgeProjection(current.databaseId, current.revision);
  assert.deepEqual(core.projection(), current);
  fails('FUTURE_REVISION', () => core.acknowledgeProjection(current.databaseId, current.revision + 1));
  fails('WRONG_DATABASE', () => core.acknowledgeProjection('other', current.revision));
});

test('durable simulated projection survives lost acknowledgement and ignores reordered deliveries', t => {
  const { core, directory } = fixture(t);
  const filename = join(directory, 'adapter.sqlite');
  let adapter = new SimulatedProjector(filename);
  const before = core.projection();
  adapter.apply(before);
  core.openConnection('connect', 'alice');
  const latest = core.projection();
  adapter.apply(latest);
  adapter.close(); // Crash after local application and before acknowledgement.
  adapter = new SimulatedProjector(filename);
  try {
    assert.equal(adapter.apply(latest).applied, false);
    assert.equal(adapter.apply(before).applied, false);
    assert.deepEqual(adapter.state(), latest);
    assert.throws(() => adapter.apply({ ...latest, players: [] }), /REVISION_CONFLICT/);
    assert.throws(() => adapter.apply({ ...latest, databaseId: 'different-database' }), /DATABASE_CHANGED/);
  } finally { adapter.close(); }
});

test('v1 migration preserves active inventory references while allowing another expedition', t => {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-v1-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'v1.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(readFileSync(new URL('./fixtures/schema-v1.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO players VALUES ('alice'); INSERT INTO raids VALUES ('world','OPEN');
    INSERT INTO participants VALUES ('old-expedition','alice','world','ACTIVE');
    INSERT INTO locations VALUES ('stash','STASH','alice',NULL,NULL);
    INSERT INTO locations VALUES ('inventory','INVENTORY','alice','world','old-expedition');
    INSERT INTO items VALUES ('item','healing_potion','inventory',3);`);
  db.close();
  const core = new ExtractionCore(filename);
  try {
    assert.deepEqual(core.snapshot('alice').active.items, [{ id: 'item', template: 'healing_potion', quantity: 3 }]);
    core.recordDeath('death', 'alice', 'world', 'old-expedition');
    core.beginExpedition('again', 'alice', 'world', []);
    assert.deepEqual(core.rows('PRAGMA foreign_key_check'), []);
    assert.equal(core.row('PRAGMA foreign_keys').foreign_keys, 1);
    assert.throws(() => core.run("UPDATE items SET location_id = 'missing'"), /FOREIGN KEY/);
  } finally { core.close(); }
});
