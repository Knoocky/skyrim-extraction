import test from 'node:test';
import assert from 'node:assert/strict';
import { SkyMpInventoryPort, installEconomicGuards } from '../adapters/skymp.ts';

const state = {
  protocolVersion: 1, databaseId: 'database', revision: 1,
  players: [{ playerId: 'alice', stash: [{ id: 'private', template: 'sword', quantity: 1 }], active: { items: [{ id: 'a', template: 'potion', quantity: 2 }, { id: 'b', template: 'potion', quantity: 3 }] } }],
  containers: [{ id: 'bag', items: [{ id: 'c', template: 'sword', quantity: 1 }] }], worlds: []
};
function fixture() {
  const game = new Map();
  let blocked = false;
  const bindings = { actor: () => 100, container: () => 200, template: t => ({ potion: 10, sword: 20 })[t], interactions: v => { blocked = v; } };
  const mp = { get: id => game.get(id), set: (id, property, value) => game.set(id, structuredClone(value)) };
  return { game, bindings, mp, port: new SkyMpInventoryPort(mp, bindings), blocked: () => blocked };
}
test('SkyMP port replaces inventory, aggregates template counts and does not expose stash', async () => {
  const f = fixture();
  await f.port.freeze();
  f.port.replaceAndVerify(state); f.port.replaceAndVerify(state);
  assert.deepEqual(f.game.get(100), { entries: [{ baseId: 10, count: 5 }] });
  assert.deepEqual(f.game.get(200), { entries: [{ baseId: 20, count: 1 }] });
  const extracted = structuredClone(state); extracted.revision++; extracted.players[0].active = null;
  f.port.replaceAndVerify(extracted);
  assert.deepEqual(f.game.get(100), { entries: [] });
  assert.throws(() => f.port.replaceAndVerify(state), /STALE_PROJECTION/);
  await f.port.resume();
  assert.equal(f.blocked(), false);
  assert.throws(() => f.port.replaceAndVerify(extracted), /FREEZE/);
});
test('unresolved or duplicate game mappings fail before any inventory mutation', async () => {
  const f = fixture(); await f.port.freeze();
  f.bindings.container = () => undefined;
  assert.throws(() => f.port.replaceAndVerify(state), /UNRESOLVED/);
  assert.equal(f.game.size, 0);
  f.bindings.container = () => 100;
  assert.throws(() => f.port.replaceAndVerify(state), /DUPLICATE/);
  assert.equal(f.game.size, 0);
});
test('partial failed readback stays frozen and a retry repairs every target', async () => {
  const f = fixture(); await f.port.freeze();
  const original = f.mp.get; f.mp.get = id => id === 200 ? { entries: [] } : original(id);
  assert.throws(() => f.port.replaceAndVerify(state), /MISMATCH/);
  assert.equal(f.blocked(), true);
  f.mp.get = original; f.port.replaceAndVerify(state);
  assert.deepEqual(f.game.get(200), { entries: [{ baseId: 20, count: 1 }] });
});
test('vanilla economy guards use actual upstream argument positions and can be disposed', () => {
  const original = () => 'previous';
  const mp = { onTakeItem: original };
  const dispose = installEconomicGuards(mp, id => id === 100);
  assert.equal(mp.onTakeItem(200, 100, 20, 1), false);
  assert.equal(mp.onPutItem(200, 100, 20, 1), false);
  assert.equal(mp.onTakeItem(100, 201, 20, 1), 'previous');
  assert.equal(mp.onDropItem(100, 20, 1), false);
  assert.equal(mp.onCraft(100, 20, 1, 1), false);
  assert.equal(mp.onEatItem(100, 20), false);
  assert.equal(mp.onUpdateEquipmentAttempt, undefined);
  dispose(); assert.equal(mp.onTakeItem, original); assert.equal(mp.onEatItem, undefined);
});
