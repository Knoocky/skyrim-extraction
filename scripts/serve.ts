import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ExtractionCore } from '../src/core.mjs';
import { createCoreServer } from '../src/server.ts';

const filename = resolve(process.env.EXTRACTION_DB ?? 'data/core.sqlite');
const token = readFileSync(process.env.EXTRACTION_TOKEN_FILE ?? 'data/server-token.key', 'utf8').trim();
const port = Number(process.env.EXTRACTION_PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
const core = new ExtractionCore(filename);
const server = createCoreServer(core, token);
server.listen(port, process.env.EXTRACTION_BIND ?? '127.0.0.1', () => console.log(`Extraction core listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(() => core.close());
  server.closeIdleConnections();
});
