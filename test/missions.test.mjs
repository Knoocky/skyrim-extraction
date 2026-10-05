import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ExtractionCore } from '../src/core.mjs';
import { MISSIONS, validateMissions } from '../src/missions.mjs';
const deny = (code, fn) => assert.throws(fn, e => e.code === code);
function fixture(t, loot = []) {
  const dir = mkdtempSync(join(tmpdir(), 'missions-')), file = join(dir, 'core.sqlite');
  const options = { authority: { canExtract: () => true, canPickup: () => true } };
  let c = new ExtractionCore(file, options);
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  c.registerPlayer('a', 'a'); c.registerPlayer('b', 'b');
  const world = c.createRaid('world', loot);
  return { get c() { return c; }, world,
    enter(player = 'a', id = 'enter') { return c.beginExpedition(id, player, world.raidId, []); },
    event(id, kind, target, recipients) { return c.recordMissionEvent(id, id, world.raidId, kind, target, recipients); },
    out(exp, player = 'a', id = 'out') { return c.extract(id, player, world.raidId, 'exit', exp.expeditionId); },
    reopen() { c.close(); c = new ExtractionCore(file, options); }
  };
}
test('mission event is provisional until extraction; duplicate event ID cannot advance twice', t => {
  const f = fixture(t), { instanceId } = f.c.acceptMission('accept', 'a', 'scout_ruins'), exp = f.enter();
  const recipients = [{ playerId: 'a', expeditionId: exp.expeditionId }];
  const event = f.event('observe', 'explore', 'ruins_gate', recipients);
  assert.deepEqual(f.c.progression('a').missions[0].progress, [{ confirmed: 0, pending: 1 }]);
  assert.deepEqual(f.c.recordMissionEvent('duplicate-delivery', 'observe', f.world.raidId, 'explore', 'ruins_gate', recipients), event);
  deny('EVENT_ID_REUSED', () => f.c.recordMissionEvent('spoof-event', 'observe', f.world.raidId, 'kill', 'bandit', recipients));
  deny('ALREADY_ACTIVE', () => f.c.claimMission('early', 'a', instanceId));
  f.reopen(); f.out(exp);
  assert.deepEqual(f.c.progression('a').missions[0].progress, [{ confirmed: 1, pending: 0 }]);
  const reward = f.c.claimMission('claim', 'a', instanceId);
  assert.equal(reward.gold, 20); assert.deepEqual(f.c.claimMission('claim', 'a', instanceId), reward);
  deny('MISSION_NOT_ACTIVE', () => f.c.claimMission('claim-again', 'a', instanceId));
  deny('MISSION_ALREADY_TAKEN', () => f.c.acceptMission('again', 'a', 'scout_ruins'));
});
test('group credit belongs to each expedition: death loses it, survivor can claim', t => {
  const f = fixture(t);
  const a = f.c.acceptMission('accept-a', 'a', 'scout_ruins'), b = f.c.acceptMission('accept-b', 'b', 'scout_ruins');
  const ae = f.enter(), be = f.enter('b');
  const recipients = [{ playerId: 'a', expeditionId: ae.expeditionId }, { playerId: 'b', expeditionId: be.expeditionId }];
  const group = f.event('group', 'explore', 'ruins_gate', recipients);
  assert.deepEqual(f.c.recordMissionEvent('group-reordered', 'group', f.world.raidId, 'explore', 'ruins_gate', [...recipients].reverse()), group);
  f.c.recordDeath('death', 'a', f.world.raidId, ae.expeditionId); f.out(be, 'b');
  deny('MISSION_NOT_READY', () => f.c.claimMission('a-claim', 'a', a.instanceId));
  f.c.claimMission('b-claim', 'b', b.instanceId);
  assert.equal(f.c.progression('a').gold, 0); assert.equal(f.c.progression('b').gold, 20);
  const fresh = f.enter('a', 'return');
  f.c.recordMissionEvent('replay-group', 'group', f.world.raidId, 'explore', 'ruins_gate', recipients);
  assert.deepEqual(f.c.progression('a').missions[0].progress, [{ confirmed: 0, pending: 0 }]);
  deny('STALE_EXPEDITION', () => f.event('stale', 'explore', 'ruins_gate', [{ playerId: 'a', expeditionId: ae.expeditionId }]));
  f.event('fresh', 'explore', 'ruins_gate', [{ playerId: 'a', expeditionId: fresh.expeditionId }]); f.out(fresh, 'a', 'out-again');
  f.c.claimMission('a-claim', 'a', a.instanceId);
  assert.equal(f.c.progression('a').gold, 20);
});
test('events before acceptance and invalid group recipients cannot grant retroactive progress', t => {
  const f = fixture(t), exp = f.enter();
  const recipients = [{ playerId: 'a', expeditionId: exp.expeditionId }];
  assert.equal(f.event('old', 'explore', 'ruins_gate', recipients).credited, 0);
  f.out(exp); f.c.acceptMission('accept', 'a', 'scout_ruins');
  const fresh = f.enter('a', 'again');
  f.c.recordMissionEvent('replay', 'old', f.world.raidId, 'explore', 'ruins_gate', recipients);
  const before = f.c.projection();
  deny('NOT_ACTIVE', () => f.event('group', 'explore', 'ruins_gate', [{ playerId: 'a', expeditionId: fresh.expeditionId }, { playerId: 'b', expeditionId: 'fake' }]));
  assert.deepEqual(f.c.projection(), before);
  assert.deepEqual(f.c.progression('a').missions[0].progress, [{ confirmed: 0, pending: 0 }]);
});
test('repeat delivery consumes once per cycle; old accepted instance remains valid across cycle change', t => {
  const f = fixture(t, [{ template: 'mountain_herb', quantity: 9 }]);
  const first = f.c.acceptMission('first', 'a', 'herbal_supply'), exp = f.enter();
  f.c.pickup('take', 'a', f.world.raidId, f.world.containerId, f.world.items[0].id, exp.expeditionId); f.out(exp);
  f.c.advanceMissionCycle('cycle', 2);
  deny('MISSION_ALREADY_TAKEN', () => f.c.acceptMission('too-early', 'a', 'herbal_supply'));
  f.c.claimMission('claim', 'a', first.instanceId);
  const second = f.c.acceptMission('second', 'a', 'herbal_supply');
  assert.notEqual(second.instanceId, first.instanceId);
  f.c.claimMission('claim-two', 'a', second.instanceId);
  deny('MISSION_ALREADY_TAKEN', () => f.c.acceptMission('third', 'a', 'herbal_supply'));
  deny('STALE_MISSION_CYCLE', () => f.c.advanceMissionCycle('stale-cycle', 2));
  assert.equal(f.c.snapshot('a').stash.find(i => i.id === f.world.items[0].id).quantity, 3);
  assert.equal(f.c.progression('a').gold, 24);
});
test('complete model chain supports exploration, two kills, rescue and mixed final objective', t => {
  const f = fixture(t, ['dwemer_relic']);
  deny('MISSION_LOCKED', () => f.c.acceptMission('early', 'a', 'ruin_guardian'));
  for (const id of ['scout_ruins', 'bandit_patrol', 'medic_rescue', 'ruin_guardian']) {
    const accepted = f.c.acceptMission('accept-'+id, 'a', id), exp = f.enter('a', 'in-'+id);
    for (const objective of accepted.terms.objectives) {
      if (objective.kind === 'delivery') f.c.pickup('take', 'a', f.world.raidId, f.world.containerId, f.world.items[0].id, exp.expeditionId);
      else for (let i = 0; i < objective.quantity; i++) f.event(id+i, objective.kind, objective.target, [{ playerId: 'a', expeditionId: exp.expeditionId }]);
    }
    f.out(exp, 'a', 'out-'+id); f.c.claimMission('claim-'+id, 'a', accepted.instanceId);
  }
  assert.equal(f.c.progression('a').missions.filter(m => m.status === 'COMPLETED').length, 4);
  assert.equal(f.c.progression('a').gold, 240);
  assert.equal(f.c.snapshot('a').stash.some(i => i.template === 'dwemer_relic'), false);
});
test('mission payout failure rolls back consumed delivery and status', t => {
  const f = fixture(t, [{ template: 'mountain_herb', quantity: 3 }]);
  const mission = f.c.acceptMission('accept', 'a', 'herbal_supply'), exp = f.enter();
  f.c.pickup('take', 'a', f.world.raidId, f.world.containerId, f.world.items[0].id, exp.expeditionId); f.out(exp);
  const before = f.c.projection();
  f.c.db.exec("CREATE TRIGGER reject_mission BEFORE UPDATE OF gold ON progression BEGIN SELECT RAISE(ABORT,'reward failed'); END;");
  assert.throws(() => f.c.claimMission('claim', 'a', mission.instanceId), /reward failed/);
  assert.deepEqual(f.c.projection(), before);
});
test('mission definitions reject cyclic dependencies and unknown delivery items', () => {
  assert.equal(validateMissions(), true);
  const cycle = structuredClone(MISSIONS); cycle[1].requires = 'ruin_guardian';
  assert.throws(() => validateMissions(cycle), /INVALID_MISSIONS/);
  const bad = structuredClone(MISSIONS); bad[0].objectives[0].target = 'constructor';
  assert.throws(() => validateMissions(bad), /INVALID_MISSIONS/);
});

test('mission confirmation failure rolls extraction and pending progress back together', t => {
  const f = fixture(t), accepted = f.c.acceptMission('accept', 'a', 'scout_ruins'), exp = f.enter();
  f.event('observe', 'explore', 'ruins_gate', [{ playerId: 'a', expeditionId: exp.expeditionId }]);
  const before = f.c.projection();
  f.c.db.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON mission_progress BEGIN SELECT RAISE(ABORT,'confirm failed'); END;");
  assert.throws(() => f.out(exp), /confirm failed/);
  assert.deepEqual(f.c.projection(), before);
  assert.equal(f.c.snapshot('a').active.expeditionId, exp.expeditionId);
  f.c.db.exec('DROP TRIGGER fail_confirmation'); f.out(exp);
  f.c.claimMission('claim', 'a', accepted.instanceId);
});
test('v5 migration keeps existing modules, storage, market and active expedition', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mission-migration-')), filename = join(dir, 'v5.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('./fixtures/schema-v5.sql', import.meta.url), 'utf8'));
  old.exec(`INSERT INTO players VALUES ('legacy');
    INSERT INTO progression(player_id,gold,xp,storage,alchemy,kitchen,scouting) VALUES ('legacy',70,200,1,2,1,1);
    INSERT INTO raids VALUES ('world','OPEN'); INSERT INTO participants VALUES ('exp','legacy','world','ACTIVE');
    INSERT INTO locations VALUES ('stash','STASH','legacy',NULL,NULL),('inv','INVENTORY','legacy','world','exp');
    INSERT INTO items(id,template,location_id,quantity,recovery_owner) VALUES ('kit','iron_sword','inv',1,'legacy');
    INSERT INTO market_cycle VALUES (1,3); INSERT INTO market_stock VALUES ('potion',12);
    INSERT INTO projection_state VALUES (1,'database',20,20); INSERT INTO projection_outbox VALUES (1,20,'{}');`);
  old.close();
  const c = new ExtractionCore(filename);
  try {
    const state = c.snapshot('legacy');
    assert.equal(state.progression.gold, 70); assert.equal(state.progression.alchemy, 2);
    assert.deepEqual(state.progression.capacity, { used: 1, limit: 150 });
    assert.equal(state.active.expeditionId, 'exp'); assert.equal(state.active.items[0].recovery, true);
    assert.deepEqual(state.progression.missions, []); assert.equal(state.progression.missionCycle, 1);
    assert.equal(state.revision, 21); assert.equal(state.market.cycle, 3);
    assert.deepEqual(c.rows('PRAGMA foreign_key_check'), []);
  } finally { c.close(); }
});
