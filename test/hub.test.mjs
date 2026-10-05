import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractionCore } from '../src/core.mjs';
const deny = (code, fn) => assert.throws(fn, e => e.code === code);
function fixture(t) {
  const c = new ExtractionCore(':memory:', { authority: { canPickup: () => true, canExtract: () => true } });
  t.after(() => c.close()); c.registerPlayer('a', 'a');
  // Test-only provisioning budget, outside public protocol.
  c.run("UPDATE progression SET gold=2000 WHERE player_id='a'");
  return c;
}
test('storage reserves room for returning inventory; overflow pickup/buy/split is atomic', t => {
  const c = fixture(t);
  const w = c.createRaid('world', [{ template: 'healing_potion', quantity: 2 }, ...Array(99).fill('silver_ring')]);
  const active = c.beginExpedition('in', 'a', w.raidId, []);
  const potion = w.items.find(i => i.template === 'healing_potion');
  c.pickup('potion', 'a', w.raidId, w.containerId, potion.id, active.expeditionId);
  const rings = w.items.filter(i => i.template === 'silver_ring');
  for (const item of rings.slice(0, 96)) c.pickup(item.id, 'a', w.raidId, w.containerId, item.id, active.expeditionId);
  assert.deepEqual(c.storageState('a'), { used: 100, limit: 100 });
  const before = c.projection();
  deny('STORAGE_FULL', () => c.pickup('overflow', 'a', w.raidId, w.containerId, rings[96].id, active.expeditionId));
  assert.deepEqual(c.projection(), before);
  c.extract('out', 'a', w.raidId, 'exit', active.expeditionId); // Always fits: pickup reserved the slot.
  deny('STORAGE_FULL', () => c.buy('buy', 'a', 'potion', 1));
  deny('STORAGE_FULL', () => c.splitStack('split', 'a', potion.id, 1));
  c.upgrade('storage', 'a', 'storage', 0);
  assert.deepEqual(c.storageState('a'), { used: 100, limit: 150 });
  c.splitStack('split', 'a', potion.id, 1);
  assert.equal(c.storageState('a').used, 101);
});
test('alchemy and kitchen reduce crafting fees; scouting fixes XP when accepting a contract', t => {
  const c = fixture(t);
  c.upgrade('alchemy-1', 'a', 'alchemy', 0); c.upgrade('alchemy-2', 'a', 'alchemy', 1);
  c.upgrade('kitchen-1', 'a', 'kitchen', 0); c.upgrade('workshop', 'a', 'workshop', 0);
  c.buy('herbs', 'a', 'herb', 3); c.buy('meat', 'a', 'meat', 2);
  assert.equal(c.craft('brew', 'a', 'brew_potion', 1).cost, 0);
  assert.equal(c.craft('cook', 'a', 'cook_rations', 1).cost, 1);
  c.upgrade('scouting-1', 'a', 'scouting', 0);
  const accepted = c.acceptContract('contract', 'a', 'supplies');
  assert.equal(accepted.terms.xp, 110);
  c.upgrade('scouting-2', 'a', 'scouting', 1);
  assert.equal(c.progression('a').contracts[0].terms.xp, 110);
  deny('MAX_LEVEL', () => c.upgrade('alchemy-3', 'a', 'alchemy', 2));
  assert.equal(c.progression('a').alchemy, 2);
});
test('craft can free input slots but cannot leave over-capacity outputs after rollback', t => {
  const c = fixture(t);
  c.buy('herbs', 'a', 'herb', 1); c.buy('meat', 'a', 'meat', 2);
  for (let i = 0; i < 95; i++) c.run('INSERT INTO items(id,template,location_id,quantity) VALUES (?,?,?,?)', 'fill-' + i, 'silver_ring', c.stash('a'), 1);
  assert.equal(c.storageState('a').used, 100);
  c.craft('cook', 'a', 'cook_rations', 1);
  assert.equal(c.storageState('a').used, 99);
  assert.equal(c.snapshot('a').stash.find(i => i.template === 'food_ration').quantity, 2);
});

test('v4 migration preserves oversized legacy stash instead of deleting or trapping its contents', t => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-migration-')), filename = join(dir, 'v4.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('./fixtures/schema-v4.sql', import.meta.url), 'utf8'));
  old.exec(`INSERT INTO players VALUES ('legacy'); INSERT INTO progression VALUES ('legacy',250,200,1,1,0);
    INSERT INTO locations VALUES ('stash','STASH','legacy',NULL,NULL);
    INSERT INTO projection_state VALUES (1,'database',10,10); INSERT INTO projection_outbox VALUES (1,10,'{}');
    INSERT INTO market_cycle VALUES (1,7); INSERT INTO market_stock VALUES ('potion',3);`);
  for (let i = 0; i < 120; i++) old.prepare("INSERT INTO items VALUES (?,'silver_ring','stash',1,NULL)").run('item-'+i);
  old.close();
  const c = new ExtractionCore(filename);
  try {
    assert.deepEqual(c.storageState('legacy'), { used: 120, limit: 120 });
    assert.equal(c.snapshot('legacy').stash.length, 120); assert.equal(c.market().cycle, 7);
    assert.equal(c.market().stock[0].quantity, 3); assert.equal(c.projection().revision, 11);
    deny('STORAGE_FULL', () => c.buy('buy', 'legacy', 'potion', 1));
    c.upgrade('upgrade', 'legacy', 'storage', 0);
    assert.deepEqual(c.storageState('legacy'), { used: 120, limit: 170 });
    c.buy('buy', 'legacy', 'potion', 1);
    assert.equal(c.snapshot('legacy').stash.length, 121);
  } finally { c.close(); }
});
test('crafting partial stacks at capacity rolls back ingredients and gold when output has no slot', t => {
  const c = fixture(t);
  c.buy('herbs', 'a', 'herb', 2); c.buy('meat', 'a', 'meat', 3);
  for (let i = 0; i < 95; i++) c.run('INSERT INTO items(id,template,location_id,quantity) VALUES (?,?,?,?)', 'fill-' + i, 'silver_ring', c.stash('a'), 1);
  const before = c.projection();
  deny('STORAGE_FULL', () => c.craft('cook', 'a', 'cook_rations', 1));
  assert.deepEqual(c.projection(), before);
  assert.equal(c.snapshot('a').stash.find(i => i.template === 'raw_meat').quantity, 3);
});
