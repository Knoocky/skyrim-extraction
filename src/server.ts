import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { DomainError, ExtractionCore } from './core.mjs';
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
export function createCoreServer(core: ExtractionCore, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Server token must be 32 random bytes encoded as hex');
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer(async (request, response) => {
    try {
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'UNAUTHORIZED');
      if (request.headers.origin !== undefined) throw new HttpError(403, 'BROWSER_ACCESS_FORBIDDEN');
      const route = request.url;
      if (request.method === 'GET' && route === '/v1/health') return send(response, 200, { ok: true, protocolVersion: 1 });
      if (request.method === 'GET' && route === '/v1/projection') return send(response, 200, core.projection());
      if (request.method !== 'POST') throw new HttpError(404, 'NOT_FOUND');
      if (!['/v1/command', '/v1/snapshot', '/v1/ack'].includes(route ?? '')) throw new HttpError(404, 'NOT_FOUND');
      const body = await readJson(request);
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
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 100;
  return server;
}
