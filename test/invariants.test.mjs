import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionCore } from '../src/core.mjs';

test('100 seeded scenarios / 10000 transitions conserve supply through retries, deaths and stack edits', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let random = seed;
    const choose = count => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % count; };
    const core = new ExtractionCore(':memory:', { authority: { canPickup: () => true, canConsume: () => true, canExtract: () => true } });
    try {
      for (const p of ['alice', 'bob']) core.registerPlayer(p, p);
      const world = core.createRaid('world', [{ template: 'healing_potion', quantity: 20 }, { template: 'healing_potion', quantity: 20 }]);
      let expectedSupply = 46;
      const history = [];
      for (let step = 0; step < 100; step++) {
        const beforeRevision = core.projectionMetadata().revision;
        if (history.length && choose(5) === 0) {
          const operation = history[choose(history.length)];
          assert.deepEqual(operation.call(), operation.result);
          assert.equal(core.projectionMetadata().revision, beforeRevision);
        } else {
          const player = choose(2) ? 'alice' : 'bob', state = core.snapshot(player);
          const request = seed + ':' + step;
          let call;
          if (!state.active) {
            const stacks = state.stash.filter(i => i.template === 'healing_potion');
            if (stacks.some(i => i.quantity > 1) && choose(3) === 0) {
              const stack = stacks.find(i => i.quantity > 1);
              call = () => core.splitStack(request, player, stack.id, 1);
            } else if (stacks.length > 1 && choose(2) === 0) {
              call = () => core.mergeStacks(request, player, stacks[0].id, stacks[1].id);
            } else call = () => core.beginExpedition(request, player, world.raidId, state.stash.map(i => i.id));
          } else {
            const active = state.active, action = choose(4);
            const potion = active.items.find(i => i.template === 'healing_potion');
            const available = core.rows(`SELECT i.id, i.location_id FROM items i JOIN locations l ON l.id = i.location_id WHERE l.kind = 'CONTAINER' AND l.raid_id = ? ORDER BY i.id`, world.raidId);
            if (action === 0 && potion) {
              call = () => core.consume(request, player, world.raidId, potion.id, 1, active.expeditionId);
              expectedSupply--;
            } else if (action === 1 && available.length) {
              const item = available[choose(available.length)];
              call = () => core.pickup(request, player, world.raidId, item.location_id, item.id, active.expeditionId);
            } else if (action === 2) call = () => core.extract(request, player, world.raidId, 'exit', active.expeditionId);
            else call = () => core.recordDeath(request, player, world.raidId, active.expeditionId);
          }
          const result = call(); history.push({ call, result });
        }
        assert.equal(core.row('SELECT COALESCE(SUM(quantity),0) AS total FROM items').total, expectedSupply, `seed=${seed}, step=${step}`);
        assert.deepEqual(core.rows('PRAGMA foreign_key_check'), []);
        const projection = core.projection();
        assert.equal(projection.revision, core.projectionMetadata().revision);
        for (const player of projection.players) {
          const { databaseId, revision, market, ...snapshot } = core.snapshot(player.playerId);
          assert.deepEqual(player, snapshot);
        }
      }
    } finally { core.close(); }
  }
});
