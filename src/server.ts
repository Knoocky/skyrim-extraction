import { AdapterGateway } from './adapter-gateway.ts';
import { ADAPTER_MANIFEST } from './manifest.ts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { ExtractionCore } from './core.mjs';
import { DomainError } from './domain-error.mjs';
import { decodeCommand, dispatch, object, keys, id, integer } from './protocol.ts';

const MAX_BODY = 16384;
class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED');
  return new Promise((resolve, reject) => {
    let size = 0, rejected = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { rejected = true; chunks.length = 0; reject(new HttpError(413, 'BODY_TOO_LARGE')); }
      else if (!rejected) chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new HttpError(400, 'REQUEST_ABORTED')));
    request.once('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'INVALID_JSON')); }
    });
  });
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
/** Private service-to-service API. The bearer key grants trusted game-server authority. */
export function createCoreServer(core: ExtractionCore, token: string, { requireLease = false, maxConcurrent = 32, requestsPerSecond = 120 } = {}) {
  if (![maxConcurrent,requestsPerSecond].every(n => Number.isInteger(n) && n > 0 && n <= 10000)) throw new Error('INVALID_SERVER_LIMIT');
  const gateway = requireLease ? new AdapterGateway(core) : null;
  let inFlight = 0, windowStart = performance.now(), requests = 0;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Server token must be 32 random bytes encoded as hex');
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer(async (request, response) => {
    let counted = false;
    try {
      const now = performance.now();
      if (now - windowStart >= 1000) { windowStart = now; requests = 0; }
      if (++requests > requestsPerSecond || inFlight >= maxConcurrent) throw new HttpError(429, 'SERVER_BUSY');
      inFlight++; counted = true;
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'UNAUTHORIZED');
      if (request.headers.origin !== undefined) throw new HttpError(403, 'BROWSER_ACCESS_FORBIDDEN');
      const route = request.url;
      if (request.method === 'GET' && route === '/v1/health') return send(response, 200, { ok: true, protocolVersion: 1 });
      if (request.method === 'GET' && route === '/v1/manifest') return send(response, 200, ADAPTER_MANIFEST);
      if (request.method === 'GET' && route === '/v1/diagnostics') return send(response, 200, core.diagnostics());
      if (request.method === 'GET' && route === '/v1/projection') return send(response, 200, core.projection());
      if (request.method !== 'POST') throw new HttpError(404, 'NOT_FOUND');
      const adapterRoutes = ['/v1/adapter/handshake','/v1/adapter/renew','/v1/adapter/reconcile','/v1/adapter/command','/v1/adapter/recover'];
      if (!['/v1/command', '/v1/snapshot', '/v1/ack', ...(gateway ? adapterRoutes : [])].includes(route ?? '')) throw new HttpError(404, 'NOT_FOUND');
      if (gateway && ['/v1/command','/v1/ack'].includes(route!)) throw new HttpError(403, 'ADAPTER_LEASE_REQUIRED');
      const body = await readJson(request);
      if (gateway && adapterRoutes.includes(route!)) {
        const result = route!.endsWith('/handshake') ? gateway.handshake(body) : route!.endsWith('/renew') ? gateway.renew(body) : route!.endsWith('/reconcile') ? gateway.reconcile(body) : route!.endsWith('/recover') ? gateway.recover(body) : gateway.execute(body);
        return send(response, 200, result);
      }
      if (route === '/v1/command') {
        const result = dispatch(core, decodeCommand(body));
        return send(response, 200, { result, ...core.projectionMetadata() });
      }
      const input = object(body);
      if (route === '/v1/snapshot') {
        keys(input, ['connectionId']);
        const result = core.executeConnected(id(input.connectionId), (playerId: string) => core.snapshot(playerId));
        return send(response, 200, result);
      }
      keys(input, ['databaseId', 'revision']);
      return send(response, 200, core.acknowledgeProjection(id(input.databaseId), integer(input.revision)));
    } catch (error) {
      if (error instanceof HttpError) send(response, error.status, { error: error.code });
      else if (error instanceof DomainError) send(response, 409, { error: error.code });
      else send(response, 500, { error: 'INTERNAL_ERROR' });
    } finally { if (counted) inFlight--; }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 100;
  return server;
}
