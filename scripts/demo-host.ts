import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { MISSIONS } from '../src/missions.mjs';
import { ExtractionCore } from '../src/core.mjs';
import { createCoreServer } from '../src/server.ts';
import { CoreClient, RemoteError } from '../src/client.ts';
import { ProjectionBridge } from '../src/bridge.ts';
import { SimulatedProjector } from '../src/projector.ts';
import { object, keys, id, type Command } from '../src/protocol.ts';

async function json(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const data of request) { size += data.length; if (size > 8192) throw new Error('BODY_TOO_LARGE'); chunks.push(data); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function createDemoHost() {
  const directory = mkdtempSync(join(tmpdir(), 'extraction-demo-ui-'));
  const core = new ExtractionCore(join(directory, 'core.sqlite'));
  const token = randomBytes(32).toString('hex');
  const internal = createCoreServer(core, token);
  internal.listen(0, '127.0.0.1'); await once(internal, 'listening');
  const address = internal.address();
  if (!address || typeof address === 'string') throw new Error('Invalid listening address');
  const client = new CoreClient('http://127.0.0.1:' + address.port, token);
  const projector = new SimulatedProjector(join(directory, 'adapter.sqlite'));
  const bridge = new ProjectionBridge(client, { freeze() {}, replaceAndVerify: state => { projector.apply(state); }, resume() {} });
  const sessions = new Map<string, string>();
  for (const playerId of ['alice', 'bob', 'cora']) {
    await bridge.execute({ protocolVersion: 1, operation: 'registerPlayer', requestId: 'register-' + playerId, payload: { playerId } });
    const { result } = await bridge.execute<{ connectionId: string }>({ protocolVersion: 1, operation: 'openConnection', requestId: 'connect-' + playerId, payload: { playerId } });
    sessions.set(playerId, result.connectionId);
  }
  const { result: world } = await bridge.execute<{ raidId: string }>({ protocolVersion: 1, operation: 'createWorld', requestId: 'world', payload: { loot: ['silver_ring', 'dwemer_relic', { template: 'healing_potion', quantity: 5 }, { template: 'mountain_herb', quantity: 8 }, { template: 'iron_ingot', quantity: 4 }, { template: 'leather', quantity: 2 }, { template: 'raw_meat', quantity: 4 }] } });
  const { result: finaleWorld } = await bridge.execute<{ raidId: string }>({ protocolVersion: 1, operation: 'createWorld', requestId: 'finale-world', payload: { loot: ['dwemer_relic', {template:'dwarven_ingot',quantity:3}] } });
  const allowed = new Set(['beginExpedition', 'pickup', 'consume', 'extract', 'splitStack', 'mergeStacks', 'acceptMission', 'claimMission', 'recoveryKit', 'craft', 'buy', 'sell', 'upgrade', 'learnSkill', 'acceptContract', 'turnInContract', 'demoDeath', 'demoMissionEvent']);
  const assets: Record<string, [string, string]> = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const current = server.address();
      if (!current || typeof current === 'string') throw new Error('NOT_LISTENING');
      const origin = 'http://127.0.0.1:' + current.port;
      if (request.headers.origin && request.headers.origin !== origin) return reply(403, { error: 'ORIGIN_DENIED' });
      const url = new URL(request.url ?? '/', origin);
      if (request.method === 'GET' && url.pathname === '/api/state') {
        const actor = url.searchParams.get('player') ?? '';
        if (!sessions.has(actor)) return reply(400, { error: 'UNKNOWN_DEMO_PLAYER' });
        const state = await client.projection();
        const selectedWorld = actor === 'cora' ? finaleWorld : world;
        return reply(200, { databaseId: state.databaseId, revision: state.revision, player: state.players.find(p => p.playerId === actor), worldId: selectedWorld.raidId, market: state.market, containers: state.containers.filter(c => c.worldId === selectedWorld.raidId) });
      }
      if (request.method === 'POST' && url.pathname === '/api/intent') {
        if (!request.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'JSON_REQUIRED' });
        const input = object(await json(request)); keys(input, ['actor', 'requestId', 'operation', 'payload']);
        const actor = id(input.actor), operation = id(input.operation), payload = object(input.payload);
        if (!sessions.has(actor) || !allowed.has(operation)) return reply(400, { error: 'INVALID_DEMO_INTENT' });
        const command: Command = { protocolVersion: 1, requestId: id(input.requestId), operation, payload, connectionId: sessions.get(actor)! };
        if (['pickup', 'consume', 'extract'].includes(operation)) command.worldApproved = true; // Simulation ONLY.
        if (operation === 'demoMissionEvent') {
          keys(payload, ['kind', 'target']);
          if (!MISSIONS.some(m => m.objectives.some(o => o.kind !== 'delivery' && o.kind === payload.kind && o.target === payload.target))) throw new Error('INVALID_DEMO_OBJECTIVE');
          const current = await client.snapshot(sessions.get(actor)!);
          if (!current.active) throw new Error('NOT_ACTIVE');
          command.operation = 'recordMissionEvent';
          command.payload = { eventId: 'demo-' + command.requestId, worldId: current.active.worldId, kind: payload.kind, target: payload.target, recipients: [{ playerId: actor, expeditionId: current.active.expeditionId }] };
          delete command.connectionId; command.worldApproved = true; // Demo-only event source.
        }
        if (operation === 'demoDeath') { command.operation = 'recordDeath'; command.payload = { ...payload, playerId: actor }; delete command.connectionId; command.worldApproved = true; }
        return reply(200, await bridge.execute(command));
      }
      const asset = assets[url.pathname];
      if (request.method === 'GET' && asset) {
        const contents = readFileSync(resolve('dist/ui', asset[0]));
        response.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' }); return response.end(contents);
      }
      reply(404, { error: 'NOT_FOUND' });
    } catch (error) { reply(error instanceof RemoteError && error.commandRejected ? 409 : 500, { error: error instanceof Error ? error.message : 'DEMO_ERROR' }); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  return {
    server,
    async close() {
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      internal.closeAllConnections(); await new Promise<void>(resolve => internal.close(() => resolve()));
      projector.close(); core.close(); rmSync(directory, { recursive: true, force: true });
    }
  };
}
