import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoHost } from '../scripts/demo-host.ts';

test('UI demo uses real HTTP/core: death loot can be extracted by the other demo player', async t => {
  const host = await createDemoHost();
  host.server.listen(0, '127.0.0.1'); await once(host.server, 'listening');
  t.after(() => host.close());
  const base = 'http://127.0.0.1:' + host.server.address().port;
  const state = async actor => (await fetch(base + '/api/state?player=' + actor)).json();
  const act = async (actor, operation, payload) => {
    const response = await fetch(base + '/api/intent', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ actor, operation, payload, requestId: crypto.randomUUID() }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const alice = await state('alice');
  const sword = alice.player.stash.find(i => i.template === 'iron_sword');
  await act('alice', 'beginExpedition', { worldId: alice.worldId, itemIds: [sword.id] });
  const activeAlice = (await state('alice')).player.active;
  await act('alice', 'demoDeath', { worldId: alice.worldId, expeditionId: activeAlice.expeditionId });
  await act('bob', 'beginExpedition', { worldId: alice.worldId, itemIds: [] });
  const bob = await state('bob'), context = { worldId: alice.worldId, expeditionId: bob.player.active.expeditionId };
  const bag = bob.containers.find(c => c.items.some(i => i.id === sword.id));
  await act('bob', 'pickup', { ...context, containerId: bag.id, itemId: sword.id });
  await act('bob', 'extract', { ...context, exitId: 'demo-north' });
  assert.equal((await state('bob')).player.stash.filter(i => i.id === sword.id).length, 1);
  const denied = await fetch(base + '/api/intent', { method: 'POST', headers: { origin: 'https://example.com' }, body: '{}' });
  assert.equal(denied.status, 403);
  assert.equal((await fetch(base + '/api/state?player=unknown')).status, 400);
});
