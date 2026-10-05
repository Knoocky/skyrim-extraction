import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractionCore } from '../src/core.mjs';
import { createCoreServer } from '../src/server.ts';
import { CoreClient } from '../src/client.ts';
import { ProjectionBridge } from '../src/bridge.ts';
import { SimulatedProjector } from '../src/projector.ts';

const token = '1'.repeat(64); // Deliberately public test-only fixture.
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-http-'));
  const core = new ExtractionCore(join(directory, 'core.sqlite'));
  const server = createCoreServer(core, token);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  const client = new CoreClient(url, token);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); core.close(); rmSync(directory, { recursive: true, force: true }); });
  const command = (operation, payload, requestId = operation, extra = {}) => client.command({ protocolVersion: 1, requestId, operation, payload, ...extra });
  return { core, server, client, url, command, directory };
}
const rejected = (code, fn) => assert.rejects(fn, error => error.code === code);

test('private HTTP API rejects missing credentials, browser origins, malformed and oversized JSON', async t => {
  const { url, client } = await fixture(t);
  assert.equal((await fetch(url + '/v1/projection')).status, 401);
  assert.equal((await fetch(url + '/v1/projection', { headers: { authorization: 'Bearer ' + token, origin: 'https://example.com' } })).status, 403);
  for (const [body, status] of [['{', 400], ['x'.repeat(17000), 413]]) {
    const response = await fetch(url + '/v1/command', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body });
    assert.equal(response.status, status);
  }
  await rejected('UNSUPPORTED_PROTOCOL', () => client.request('/v1/command', { protocolVersion: 2, requestId: 'x', operation: 'registerPlayer', payload: { playerId: 'alice' } }));
  await rejected('UNKNOWN_OPERATION', () => client.request('/v1/command', { protocolVersion: 1, requestId: 'x', operation: 'constructor', payload: {} }));
});

test('HTTP loop binds identity to connection and requires explicit server approval', async t => {
  const { command, client } = await fixture(t);
  await command('registerPlayer', { playerId: 'alice' });
  const { result: session } = await command('openConnection', { playerId: 'alice' });
  const { result: world } = await command('createWorld', { loot: [{ template: 'healing_potion', quantity: 3 }] });
  const extra = { connectionId: session.connectionId };
  const { result: expedition } = await command('beginExpedition', { worldId: world.raidId, itemIds: [] }, 'enter', extra);
  const payload = { worldId: world.raidId, expeditionId: expedition.expeditionId, containerId: world.containerId, itemId: world.items[0].id };
  await rejected('INVALID_FIELDS', () => command('pickup', { ...payload, playerId: 'bob' }, 'spoof', extra));
  await rejected('PICKUP_NOT_AUTHORIZED', () => command('pickup', payload, 'take', extra));
  await command('pickup', payload, 'take', { ...extra, worldApproved: true });
  await command('consume', { worldId: world.raidId, expeditionId: expedition.expeditionId, itemId: world.items[0].id, quantity: 1 }, 'drink', { ...extra, worldApproved: true });
  assert.equal((await client.snapshot(session.connectionId)).active.items[0].quantity, 2);
  const { result: newSession } = await command('openConnection', { playerId: 'alice' }, 'reconnect');
  await rejected('STALE_CONNECTION', () => command('pickup', payload, 'take', { ...extra, worldApproved: true }));
  assert.equal((await client.snapshot(newSession.connectionId)).active.expeditionId, expedition.expeditionId);
});

test('bridge leaves interactions frozen when projection fails, then recovers without duplicate mutation', async t => {
  const { client, directory, core } = await fixture(t);
  const adapter = new SimulatedProjector(join(directory, 'adapter.sqlite'));
  try {
  let frozen = true, failOnRevision = null;
  const bridge = new ProjectionBridge(client, {
    freeze() { frozen = true; },
    replaceAndVerify(state) { if (state.revision === failOnRevision) throw new Error('adapter offline'); adapter.apply(state); },
    resume() { frozen = false; }
  });
  const command = { protocolVersion: 1, operation: 'registerPlayer', requestId: 'register', payload: { playerId: 'alice' } };
  failOnRevision = core.projection().revision + 1;
  await assert.rejects(bridge.execute(command), /adapter offline/);
  assert.equal(frozen, true);
  assert.equal(core.snapshot('alice').stash.length, 3);
  failOnRevision = null;
  await bridge.execute(command);
  assert.equal(frozen, false);
  assert.equal(adapter.state().players[0].stash.length, 3);
  assert.equal(core.projection().revision, 2);
  } finally { adapter.close(); }
});

test('HTTP stale death from a previous expedition cannot affect the next one', async t => {
  const { command, client } = await fixture(t);
  await command('registerPlayer', { playerId: 'alice' });
  const { result: session } = await command('openConnection', { playerId: 'alice' });
  const { result: world } = await command('createWorld', { loot: [] });
  const extra = { connectionId: session.connectionId };
  const { result: first } = await command('beginExpedition', { worldId: world.raidId, itemIds: [] }, 'first', extra);
  await command('recordDeath', { playerId: 'alice', worldId: world.raidId, expeditionId: first.expeditionId }, 'death', { worldApproved: true });
  const { result: next } = await command('beginExpedition', { worldId: world.raidId, itemIds: [] }, 'next', extra);
  await rejected('STALE_EXPEDITION', () => command('recordDeath', { playerId: 'alice', worldId: world.raidId, expeditionId: first.expeditionId }, 'late', { worldApproved: true }));
  assert.equal((await client.snapshot(session.connectionId)).active.expeditionId, next.expeditionId);
});
