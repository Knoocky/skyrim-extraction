// CI-only probe: invoked explicitly in an isolated disposable Docker volume.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { FencedCoreClient } from '../src/fenced-client.ts';
const client = new FencedCoreClient('http://127.0.0.1:8787', readFileSync('data/server-token.key', 'utf8').trim());
await client.acquire('ci-smoke');
await client.acknowledge(await client.projection());
await client.command({ protocolVersion: 1, requestId: 'ci-register', operation: 'registerPlayer', payload: { playerId: 'ci-test' } });
const { result } = await client.command<{ connectionId: string }>({ protocolVersion: 1, requestId: 'ci-connect', operation: 'openConnection', payload: { playerId: 'ci-test' } });
const state = await client.snapshot(result.connectionId);
assert.equal(state.stash.length, 3); assert.equal(state.progression.gold, 0);
console.log('Persistent container smoke: OK');
