import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtractionCore } from './src/core.mjs';

// Simulation ONLY: no game clients, movement, combat or authentication.
const directory = mkdtempSync(join(tmpdir(), 'extraction-demo-'));
const filename = join(directory, 'demo.sqlite');
const authority = { canPickup: () => true, canExtract: () => true };
let core = new ExtractionCore(filename, { authority });
try {
  const alice = core.registerPlayer('provision-alice', 'Alice');
  const bob = core.registerPlayer('provision-bob', 'Bob');
  const raid = core.createRaid('provision-raid');
  const sword = alice.items.find(item => item.template === 'iron_sword');
  const bow = bob.items.find(item => item.template === 'hunting_bow');
  core.joinRaid('join', 'Alice', raid.raidId, [sword.id]);
  core.joinRaid('join', 'Bob', raid.raidId, [bow.id]);
  core.pickup('pickup-relic', 'Alice', raid.raidId, raid.containerId, raid.items[0].id);
  console.log('1. Alice и Bob вошли в рейд. Alice нашла добычу.');
  const death = core.recordDeath('world-death-alice', 'Alice', raid.raidId);
  for (const item of death.items) core.pickup('loot-' + item.id, 'Bob', raid.raidId, death.containerId, item.id);
  console.log('2. Имитирована смерть Alice. Bob забрал её меч и добычу.');
  const extracted = core.extract('exit', 'Bob', raid.raidId, 'north-gate');
  core.extract('exit', 'Bob', raid.raidId, 'north-gate');
  console.log('3. Bob эвакуировался. Повтор запроса не удвоил предметы.');
  core.close();
  core = new ExtractionCore(filename, { authority });
  console.log('4. Ядро перезапущено; SQLite сохранила результат.');
  console.log(JSON.stringify({ extracted: extracted.items.map(i => i.template), alice: core.snapshot('Alice'), bob: core.snapshot('Bob') }, null, 2));
  core.closeRaid('expire', raid.raidId);
} finally {
  core.close();
  rmSync(directory, { recursive: true, force: true });
}
