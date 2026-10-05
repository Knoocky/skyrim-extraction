import { readFileSync } from 'node:fs';
import { CoreClient } from '../src/client.ts';
const token = readFileSync(process.env.EXTRACTION_TOKEN_FILE ?? 'data/server-token.key', 'utf8').trim();
try {
  const client = new CoreClient('http://127.0.0.1:' + (process.env.EXTRACTION_PORT ?? '8787'), token);
  const result = await client.request<{ ok: boolean; protocolVersion: number }>('/v1/health');
  if (!result.ok || result.protocolVersion !== 1) throw new Error('Unhealthy');
  console.log('Core health: OK');
} catch { console.error('Core health: FAILED'); process.exitCode = 1; }
