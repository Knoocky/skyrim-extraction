import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { ExtractionCore } from '../src/core.mjs';
const reject = (code, fn) => assert.throws(fn, e => e.code === code);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'economy-'));
  const file = join(dir, 'core.sqlite');
  const authority = { canPickup: () => true, canExtract: () => true };
  let core = new ExtractionCore(file, { authority });
  t.after(() => { core.close(); rmSync(dir, { recursive: true, force: true }); });
  core.registerPlayer('a', 'a'); core.registerPlayer('b', 'b');
  let n = 0;
  return { get core() { return core; }, file,
    reopen() { core.close(); core = new ExtractionCore(file, { authority }); },
    loot(templates, player = 'a') {
      const id = 'loot-' + n++;
      const world = core.createRaid(id, templates);
      const expedition = core.beginExpedition(id, player, world.raidId, []);
      for (const item of world.items) core.pickup(id + item.id, player, world.raidId, world.containerId, item.id, expedition.expeditionId);
      core.extract(id + '-exit', player, world.raidId, 'exit', expedition.expeditionId);
      return world;
    }
  };
}
test('trades use server prices, preserve quantities and receipts across restart', t => {
  const f = fixture(t), c = f.core;
  const world = f.loot(['dwemer_relic']);
  const sale = c.sell('sell', 'a', world.items[0].id, 1);
  assert.equal(sale.earned, 120);
  const bought = c.buy('buy', 'a', 'potion', 5);
  assert.equal(c.snapshot('a').progression.gold, 20);
  assert.equal(c.snapshot('a').stash.find(i => i.id === bought.itemId).quantity, 5);
  f.reopen();
  assert.deepEqual(f.core.buy('buy', 'a', 'potion', 5), bought);
  assert.deepEqual(f.core.sell('sell', 'a', world.items[0].id, 1), sale);
  assert.equal(f.core.snapshot('a').progression.gold, 20);
  reject('REQUEST_ID_REUSED', () => f.core.buy('buy', 'a', 'potion', 1));
  reject('INSUFFICIENT_GOLD', () => f.core.buy('broke', 'a', 'sword', 1));
  reject('INVALID_PURCHASE', () => f.core.buy('fake', 'a', 'constructor', 1));
  reject('INVALID_PURCHASE', () => f.core.buy('equipment-stack', 'a', 'bow', 2));
  reject('INVALID_PURCHASE', () => f.core.buy('negative', 'a', 'potion', -1));
});
test('contracts consume only required units and reward once even under a new request ID', t => {
  const { core: c, loot } = fixture(t);
  const world = loot([{ template: 'healing_potion', quantity: 5 }]);
  const item = world.items[0];
  c.acceptContract('accept', 'a', 'supplies');
  const completed = c.turnInContract('turn', 'a', 'supplies', [item.id]);
  assert.equal(c.snapshot('a').stash.find(i => i.id === item.id).quantity, 2);
  assert.equal(c.snapshot('a').progression.gold, 80);
  assert.equal(c.snapshot('a').progression.xp, 150);
  assert.deepEqual(c.turnInContract('turn', 'a', 'supplies', [item.id]), completed);
  reject('CONTRACT_NOT_ACTIVE', () => c.turnInContract('again', 'a', 'supplies', [item.id]));
  reject('CONTRACT_ALREADY_ACCEPTED', () => c.acceptContract('accept-again', 'a', 'supplies'));
  assert.equal(c.snapshot('a').progression.gold, 80);
});
test('contract chain, fixed reward terms, skill spending and module effects', t => {
  const { core: c, loot } = fixture(t);
  reject('CONTRACT_LOCKED', () => c.acceptContract('early', 'a', 'relic'));
  const w = loot([{ template: 'healing_potion', quantity: 10 }, 'silver_ring', 'dwemer_relic']);
  c.acceptContract('first', 'a', 'supplies'); // 80, before learning the skill
  c.learnSkill('skill', 'a', 'bargaining', 0);
  c.turnInContract('supply', 'a', 'supplies', [w.items.find(i => i.template === 'healing_potion').id]);
  assert.equal(c.progression('a').gold, 80);
  const accepted = c.acceptContract('second', 'a', 'silver');
  assert.equal(accepted.terms.gold, 189);
  c.turnInContract('silver', 'a', 'silver', [w.items.find(i => i.template === 'silver_ring').id]);
  c.upgrade('workshop', 'a', 'workshop', 0);
  c.upgrade('archive', 'a', 'archive', 0);
  assert.equal(c.buy('discount', 'a', 'potion', 1).cost, 19);
  c.acceptContract('last', 'a', 'relic');
  c.turnInContract('relic', 'a', 'relic', [w.items.find(i => i.template === 'dwemer_relic').id]);
  assert.equal(c.progression('a').contracts.filter(x => x.status === 'COMPLETED').length, 3);
  reject('STALE_RANK', () => c.learnSkill('stale', 'a', 'bargaining', 0));
  reject('STALE_LEVEL', () => c.upgrade('stale-module', 'a', 'workshop', 0));
  assert.equal(c.upgrade('workshop', 'a', 'workshop', 0).level, 1);
});
test('foreign items, duplicate IDs, active expedition and locked progress reject without mutation', t => {
  const { core: c } = fixture(t);
  c.acceptContract('accept', 'a', 'supplies');
  const foreign = c.snapshot('b').stash.find(i => i.template === 'healing_potion').id;
  const before = c.projection();
  reject('INVALID_CONTRACT_ITEM', () => c.turnInContract('foreign', 'a', 'supplies', [foreign]));
  reject('INVALID_TURN_IN', () => c.turnInContract('duplicate', 'a', 'supplies', [foreign, foreign]));
  reject('ITEM_NOT_IN_STASH', () => c.sell('steal', 'a', foreign, 1));
  reject('SKILL_UNAVAILABLE', () => c.learnSkill('unearned', 'a', 'bargaining', 0));
  assert.deepEqual(c.projection(), before);
  const world = c.createRaid('world'); c.beginExpedition('join', 'a', world.raidId, []);
  for (const fn of [() => c.buy('buy', 'a', 'potion', 1), () => c.sell('sell', 'a', foreign, 1), () => c.upgrade('u', 'a', 'archive', 0), () => c.turnInContract('t', 'a', 'supplies', [foreign])]) reject('ALREADY_ACTIVE', fn);
});
test('reward write failure rolls back consumption, status, receipt and projection', t => {
  const { core: c, loot } = fixture(t);
  const world = loot([{ template: 'healing_potion', quantity: 3 }]);
  c.acceptContract('accept', 'a', 'supplies');
  const before = c.projection();
  c.db.exec("CREATE TRIGGER reject_reward BEFORE UPDATE OF gold ON progression BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(() => c.turnInContract('turn', 'a', 'supplies', [world.items[0].id]), /injected failure/);
  assert.deepEqual(c.projection(), before);
  assert.equal(c.row("SELECT COUNT(*) AS n FROM receipts WHERE request_id='turn'").n, 0);
  assert.equal(c.snapshot('a').progression.contracts[0].status, 'ACCEPTED');
  assert.equal(c.snapshot('a').stash.find(i => i.id === world.items[0].id).quantity, 3);
  c.db.exec('DROP TRIGGER reject_reward');
  c.turnInContract('turn', 'a', 'supplies', [world.items[0].id]);
  assert.equal(c.progression('a').gold, 80);
});
test('fresh loot grants XP once; recycling through death, another player and extraction does not', t => {
  const { core: c, loot } = fixture(t);
  const w = loot(['dwemer_relic']);
  assert.equal(c.progression('a').xp, 10);
  const first = c.beginExpedition('again', 'a', w.raidId, [w.items[0].id]);
  const dead = c.recordDeath('death', 'a', w.raidId, first.expeditionId);
  const second = c.beginExpedition('b-enter', 'b', w.raidId, []);
  c.pickup('take', 'b', w.raidId, dead.containerId, w.items[0].id, second.expeditionId);
  c.extract('exit', 'b', w.raidId, 'exit', second.expeditionId);
  assert.equal(c.progression('b').xp, 0);
  assert.equal(c.progression('a').xp, 10);
  assert.equal(c.progression('a').gold, 0);
});
test('purchase failure after debit restores wallet and receipt', t => {
  const { core: c, loot } = fixture(t);
  const w = loot(['dwemer_relic']); c.sell('sell', 'a', w.items[0].id, 1);
  const before = c.projection();
  c.db.exec("CREATE TRIGGER reject_purchase BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT,'purchase failed'); END;");
  assert.throws(() => c.buy('buy', 'a', 'potion', 2), /purchase failed/);
  assert.deepEqual(c.projection(), before);
  assert.equal(c.progression('a').gold, 120);
  c.db.exec('DROP TRIGGER reject_purchase');
  c.buy('buy', 'a', 'potion', 2);
  assert.equal(c.progression('a').gold, 80);
});
test('v2 migration retains active loot and identities, starts empty progression and refreshes projection', t => {
  const dir = mkdtempSync(join(tmpdir(), 'economy-migration-')), file = join(dir, 'v2.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(file);
  old.exec(readFileSync(new URL('./fixtures/schema-v2.sql', import.meta.url), 'utf8'));
  old.exec(`INSERT INTO players VALUES ('legacy'); INSERT INTO raids VALUES ('world','OPEN');
    INSERT INTO participants VALUES ('expedition','legacy','world','ACTIVE');
    INSERT INTO locations VALUES ('stash','STASH','legacy',NULL,NULL),('inv','INVENTORY','legacy','world','expedition');
    INSERT INTO items VALUES ('sword','iron_sword','inv',1);
    INSERT INTO projection_state VALUES (1,'database',9,9);
    INSERT INTO projection_outbox VALUES (1,9,'{}');
    INSERT INTO receipts VALUES ('system','historic','original','{"ok":true}');`);
  old.close();
  const c = new ExtractionCore(file);
  try {
    const state = c.snapshot('legacy');
    assert.equal(state.databaseId, 'database'); assert.equal(state.revision, 10);
    assert.equal(state.active.expeditionId, 'expedition'); assert.equal(state.active.items[0].id, 'sword');
    assert.equal(state.progression.gold, 0); assert.equal(state.progression.xp, 0);
    assert.deepEqual(c.rows('PRAGMA foreign_key_check'), []);
    assert.equal(c.projection().players[0].progression.gold, 0);
    assert.equal(c.row("SELECT result FROM receipts WHERE request_id='historic'").result, '{"ok":true}');
  } finally { c.close(); }
  const reopened = new ExtractionCore(file);
  try { assert.equal(reopened.snapshot('legacy').revision, 10); } finally { reopened.close(); }
});

test('two independent writers racing contract redemption grant one reward', { timeout: 15000 }, async t => {
  const f = fixture(t), c = f.core;
  const w = f.loot([{ template: 'healing_potion', quantity: 3 }]);
  c.acceptContract('accept', 'a', 'supplies');
  const workers = ['one', 'two'].map(request => new Worker(new URL('./race-worker.mjs', import.meta.url), {
    workerData: { filename: f.file, operation: 'turnInContract', args: [request, 'a', 'supplies', [w.items[0].id]] }
  }));
  try {
    await Promise.all(workers.map(worker => once(worker, 'message')));
    const messages = workers.map(worker => once(worker, 'message'));
    workers.forEach(worker => worker.postMessage('start'));
    const results = (await Promise.all(messages)).map(([result]) => result);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => r.code === 'CONTRACT_NOT_ACTIVE').length, 1);
    assert.equal(c.progression('a').gold, 80);
    assert.equal(c.progression('a').xp, 130);
    assert.equal(c.snapshot('a').stash.some(i => i.id === w.items[0].id), false);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});
