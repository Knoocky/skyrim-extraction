import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionPolicy } from '../src/extraction-policy.ts';
function fixture(availability = 'always') {
  let now = 0;
  const policy = new ExtractionPolicy([{ id: 'exit', worldId: 'world', cellId: 'cell', x: 0, y: 0, z: 0, radius: 10, holdMs: 3000, availability }], () => now, 1000);
  const base = { playerId: 'a', worldId: 'world', expeditionId: 'exp', connectionId: 'conn', cellId: 'cell', x: 0, y: 0, z: 0, alive: true, connected: true, inCombat: false, hour: 12, damageSequence: 0 };
  return { policy, update(time, overrides = {}) { now = time; return policy.update('exit', { ...base, observedAt: now, ...overrides }); } };
}
test('exit requires continuously observed dwell, exact time and correct world/cell', () => {
  const f = fixture();
  assert.equal(f.update(0).ready, false); f.update(1000); f.update(2000);
  assert.equal(f.update(2999).ready, false); assert.equal(f.update(3000).ready, true);
  assert.equal(f.update(3001, { cellId: 'other' }).reason, 'WRONG_WORLD');
  assert.equal(f.update(3002).remainingMs, 3000);
  assert.equal(f.update(3003, { x: 11 }).reason, 'OUTSIDE_EXIT');
});
test('combat, damage, reconnect, new expedition and missing observations reset progress', () => {
  for (const overrides of [{ inCombat: true }, { alive: false }, { connected: false }, { damageSequence: 1 }, { connectionId: 'new' }, { expeditionId: 'new' }]) {
    const f = fixture(); f.update(0); f.update(1000); f.update(2000);
    assert.equal(f.update(3000, overrides).ready, false, JSON.stringify(overrides));
  }
  const f = fixture(); f.update(0); f.update(1000);
  assert.equal(f.update(3000).remainingMs, 3000);
  assert.equal(f.update(3001, { observedAt: 2000 }).reason, 'STALE_OBSERVATION');
  assert.equal(f.update(3002, { observedAt: 9999 }).reason, 'STALE_OBSERVATION');
});
test('server night schedule, malformed and replayed samples fail closed', () => {
  const f = fixture('night');
  assert.equal(f.update(0).reason, 'EXIT_CLOSED');
  assert.equal(f.update(1, { hour: 20 }).reason, 'HOLD');
  assert.equal(f.update(2, { hour: 20, observedAt: 1 }).reason, 'REORDERED_OBSERVATION');
  assert.equal(f.update(3, { hour: 24 }).reason, 'INVALID_OBSERVATION');
  assert.equal(f.update(4, { x: NaN }).reason, 'INVALID_OBSERVATION');
  assert.equal(f.update(5, { hour: 5.9 }).reason, 'HOLD');
  assert.equal(f.update(6, { hour: 6 }).reason, 'EXIT_CLOSED');
});
