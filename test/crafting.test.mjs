import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { ExtractionCore } from '../src/core.mjs';
import { ECONOMY } from '../src/economy.mjs';
import { ITEMS, RECIPES, validateContent } from '../src/catalog.mjs';
const deny = (code, fn) => assert.throws(fn, e => e.code === code);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'craft-')), filename = join(dir, 'core.sqlite');
  const authority = { canPickup: () => true, canExtract: () => true, canConsume: () => true };
  let core = new ExtractionCore(filename, { authority }), seq = 0;
  t.after(() => { core.close(); rmSync(dir, { recursive: true, force: true }); });
  core.registerPlayer('a', 'a'); core.registerPlayer('b', 'b');
  const loot = (templates, player = 'a') => {
    const id = 'loot-' + seq++, w = core.createRaid(id, templates);
    const active = core.beginExpedition(id, player, w.raidId, []);
    for (const item of w.items) core.pickup(item.id, player, w.raidId, w.containerId, item.id, active.expeditionId);
    core.extract(id + '-out', player, w.raidId, 'exit', active.expeditionId); return w;
  };
  return { get core() { return core; }, filename, loot,
    fund(player = 'a') { const w = loot(['dwemer_relic', 'dwemer_relic'], player); for (const i of w.items) core.sell('sell-' + i.id, player, i.id, 1); },
    reopen() { core.close(); core = new ExtractionCore(filename, { authority }); } };
}
test('content validation rejects unknown references, cycles and profitable buy/craft/resell paths', () => {
  assert.equal(validateContent(ECONOMY), true);
  const unknown = structuredClone(ECONOMY); unknown.offers[0].template = 'missing';
  assert.throws(() => validateContent(unknown), /INVALID_CONTENT/);
  const cyclic = structuredClone(ECONOMY); cyclic.contracts[0].requires = 'relic';
  assert.throws(() => validateContent(cyclic), /INVALID_CONTENT/);
  const badRecipes = structuredClone(RECIPES); badRecipes[0].ingredients[0].template = 'healing_potion';
  assert.throws(() => validateContent(ECONOMY, ITEMS, badRecipes), /INVALID_CONTENT/);
  const profit = structuredClone(RECIPES); profit[0].output.quantity = 100;
  assert.throws(() => validateContent(ECONOMY, ITEMS, profit), /INVALID_CONTENT/);
});
test('craft consumes exact materials across split stacks, charges gold and survives retries/restart', t => {
  const f = fixture(t); f.fund(); const c = f.core;
  const w = f.loot([{ template: 'mountain_herb', quantity: 7 }]);
  c.splitStack('split', 'a', w.items[0].id, 3);
  deny('RECIPE_LOCKED', () => c.craft('locked', 'a', 'brew_potion', 2));
  c.upgrade('workshop', 'a', 'workshop', 0);
  const gold = c.progression('a').gold;
  const made = c.craft('craft', 'a', 'brew_potion', 2);
  assert.equal(made.quantity, 2); assert.equal(c.progression('a').gold, gold - 4);
  assert.equal(c.snapshot('a').stash.filter(i => i.template === 'mountain_herb').reduce((n, i) => n + i.quantity, 0), 3);
  f.reopen(); assert.deepEqual(f.core.craft('craft', 'a', 'brew_potion', 2), made);
  assert.equal(f.core.snapshot('a').stash.find(i => i.id === made.itemId).quantity, 2);
  deny('INVALID_CRAFT', () => f.core.craft('negative', 'a', 'brew_potion', -1));
  deny('UNKNOWN_RECIPE', () => f.core.craft('unknown', 'a', 'constructor', 1));
  deny('INVALID_CRAFT', () => f.core.craft('swords', 'a', 'forge_sword', 2));
});
test('failed output insertion rolls back materials, gold, provenance, receipt and projection', t => {
  const f = fixture(t); f.fund(); const c = f.core;
  f.loot([{ template: 'raw_meat', quantity: 2 }, { template: 'mountain_herb', quantity: 1 }]);
  const before = c.projection(), provenance = c.rows('SELECT * FROM loot_provenance ORDER BY item_id');
  c.db.exec("CREATE TRIGGER fail_craft BEFORE INSERT ON items WHEN NEW.template='food_ration' BEGIN SELECT RAISE(ABORT,'craft failed'); END;");
  assert.throws(() => c.craft('craft', 'a', 'cook_rations', 1), /craft failed/);
  assert.deepEqual(c.projection(), before); assert.deepEqual(c.rows('SELECT * FROM loot_provenance ORDER BY item_id'), provenance);
  assert.equal(c.row("SELECT COUNT(*) AS n FROM receipts WHERE request_id='craft'").n, 0);
  c.db.exec('DROP TRIGGER fail_craft'); c.craft('craft', 'a', 'cook_rations', 1);
});
test('materials cannot be consumed; crafted items never mint fresh-loot XP on extraction', t => {
  const f = fixture(t); f.fund(); const c = f.core;
  const w = f.loot([{ template: 'raw_meat', quantity: 3 }, { template: 'mountain_herb', quantity: 1 }]);
  const made = c.craft('craft', 'a', 'cook_rations', 1);
  const xp = c.progression('a').xp;
  const meat = w.items.find(i => i.template === 'raw_meat');
  const active = c.beginExpedition('in', 'a', w.raidId, [made.itemId, meat.id]);
  deny('NOT_CONSUMABLE', () => c.consume('eat-metal', 'a', w.raidId, meat.id, 1, active.expeditionId));
  c.consume('eat', 'a', w.raidId, made.itemId, 1, active.expeditionId);
  c.extract('out', 'a', w.raidId, 'exit', active.expeditionId);
  assert.equal(c.progression('a').xp, xp);
});
test('recovery kit works after bankruptcy but cannot be sold, transferred or looted after death', t => {
  const f = fixture(t), c = f.core;
  deny('RECOVERY_NOT_NEEDED', () => c.recoveryKit('early', 'a'));
  const world = c.createRaid('world', []);
  const first = c.beginExpedition('in', 'a', world.raidId, c.snapshot('a').stash.map(i => i.id));
  c.recordDeath('dead', 'a', world.raidId, first.expeditionId);
  const kit = c.recoveryKit('kit', 'a');
  assert.deepEqual(c.recoveryKit('kit', 'a'), kit);
  assert.equal(c.snapshot('a').stash[0].recovery, true);
  deny('RECOVERY_NOT_NEEDED', () => c.recoveryKit('extra', 'a'));
  deny('RECOVERY_ITEM_RESTRICTED', () => c.sell('sale', 'a', kit.itemId, 1));
  assert.throws(() => c.run('UPDATE items SET recovery_owner=NULL WHERE id=?', kit.itemId), /invalid recovery owner/);
  assert.throws(() => c.run('UPDATE items SET location_id=? WHERE id=?', c.stash('b'), kit.itemId), /invalid recovery owner/);
  const next = c.beginExpedition('again', 'a', world.raidId, [kit.itemId]);
  deny('ALREADY_ACTIVE', () => c.recoveryKit('active-kit', 'a'));
  const death = c.recordDeath('dead-again', 'a', world.raidId, next.expeditionId);
  assert.deepEqual(death.items, []); assert.equal(c.row('SELECT id FROM items WHERE id=?', kit.itemId), undefined);
  const replacement = c.recoveryKit('replacement', 'a'); assert.notEqual(replacement.itemId, kit.itemId);
  assert.equal(c.progression('a').gold, 0); assert.equal(c.progression('a').xp, 0);
  f.reopen(); assert.equal(f.core.snapshot('a').stash[0].recovery, true);
});
test('market is global and durable; only a newer server cycle restocks it', t => {
  const f = fixture(t); f.fund(); const c = f.core;
  const before = c.market().stock.find(s => s.offerId === 'potion').quantity;
  c.buy('buy', 'a', 'potion', 2);
  assert.equal(c.snapshot('b').market.stock.find(s => s.offerId === 'potion').quantity, before - 2);
  f.reopen(); assert.equal(f.core.market().stock.find(s => s.offerId === 'potion').quantity, before - 2);
  const restocked = f.core.restockMarket('restock', 1);
  f.core.buy('later', 'a', 'potion', 1);
  assert.deepEqual(f.core.restockMarket('restock', 1), restocked);
  assert.equal(f.core.market().stock.find(s => s.offerId === 'potion').quantity, before - 1);
  deny('STALE_MARKET_CYCLE', () => f.core.restockMarket('old', 1));
  deny('INVALID_MARKET_CYCLE', () => f.core.restockMarket('bad', 1.5));
});
test('concurrent buyers of the last unit charge exactly one wallet', { timeout: 15000 }, async t => {
  const f = fixture(t); f.fund('a'); f.fund('b'); const c = f.core;
  c.run("UPDATE market_stock SET quantity=1 WHERE offer_id='potion'");
  const workers = ['a', 'b'].map(player => new Worker(new URL('./race-worker.mjs', import.meta.url), {
    workerData: { filename: f.filename, operation: 'buy', args: ['buy', player, 'potion', 1] }
  }));
  try {
    await Promise.all(workers.map(w => once(w, 'message')));
    const replies = workers.map(w => once(w, 'message')); workers.forEach(w => w.postMessage('start'));
    const results = (await Promise.all(replies)).map(([r]) => r);
    assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.filter(r => r.code === 'OUT_OF_STOCK').length, 1);
    assert.equal(c.progression('a').gold + c.progression('b').gold, 460);
    assert.equal(c.market().stock.find(s => s.offerId === 'potion').quantity, 0);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
});
test('v3 migration preserves money, skills, accepted terms, active identities and old item flags', t => {
  const dir = mkdtempSync(join(tmpdir(), 'craft-migrate-')), file = join(dir, 'old.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(file);
  old.exec(readFileSync(new URL('./fixtures/schema-v3.sql', import.meta.url), 'utf8'));
  old.exec(`INSERT INTO players VALUES ('legacy'); INSERT INTO progression VALUES ('legacy',73,200,1,1,0);
    INSERT INTO raids VALUES ('world','OPEN'); INSERT INTO participants VALUES ('exp','legacy','world','ACTIVE');
    INSERT INTO locations VALUES ('stash','STASH','legacy',NULL,NULL),('inv','INVENTORY','legacy','world','exp');
    INSERT INTO items VALUES ('sword','iron_sword','inv',1);
    INSERT INTO projection_state VALUES (1,'database',8,8); INSERT INTO projection_outbox VALUES (1,8,'{}');`);
  const terms = { ...ECONOMY.contracts[0], version: 1, gold: 80 };
  old.prepare("INSERT INTO player_contracts VALUES ('legacy','supplies','ACCEPTED',?)").run(JSON.stringify(terms));
  old.close();
  const core = new ExtractionCore(file);
  try {
    const state = core.snapshot('legacy');
    assert.equal(state.databaseId, 'database'); assert.equal(state.revision, 9);
    assert.equal(state.active.expeditionId, 'exp'); assert.deepEqual(state.active.items, [{ id: 'sword', template: 'iron_sword', quantity: 1 }]);
    assert.equal(state.progression.gold, 73); assert.equal(state.progression.bargaining, 1);
    assert.deepEqual(state.progression.contracts[0].terms, terms);
    assert.equal(state.market.stock.find(s => s.offerId === 'potion').quantity, 100);
    assert.deepEqual(core.rows('PRAGMA foreign_key_check'), []);
  } finally { core.close(); }
  const again = new ExtractionCore(file);
  try { assert.equal(again.projection().revision, 9); } finally { again.close(); }
});
test('purchase output failure also restores finite stock', t => {
  const f = fixture(t); f.fund(); const c = f.core;
  const before = c.projection();
  c.db.exec("CREATE TRIGGER fail_buy BEFORE INSERT ON items BEGIN SELECT RAISE(ABORT,'failed output'); END;");
  assert.throws(() => c.buy('buy', 'a', 'potion', 1), /failed output/);
  assert.deepEqual(c.projection(), before);
  assert.equal(c.market().stock.find(s => s.offerId === 'potion').quantity, 100);
});
