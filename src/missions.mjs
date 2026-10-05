import { freeze, ITEMS } from './catalog.mjs';
export const MISSION_TARGET_NAMES = freeze({ ruins_gate: 'Вход в руины', bandit: 'Разбойники', field_medic: 'Полевой лекарь', ruin_guardian: 'Страж руин', watch_point: 'Дозорный пункт' });
export const MISSIONS = freeze([
  { id: 'herbal_supply', name: 'Сбор трав', objectives: [{ kind: 'delivery', target: 'mountain_herb', quantity: 3 }], gold: 12, xp: 15, requires: null, repeatable: true },
  { id: 'scout_ruins', name: 'Разведка руин', objectives: [{ kind: 'explore', target: 'ruins_gate', quantity: 1 }], gold: 20, xp: 30, requires: null, repeatable: false },
  { id: 'bandit_patrol', name: 'Опасный патруль', objectives: [{ kind: 'kill', target: 'bandit', quantity: 2 }], gold: 30, xp: 40, requires: 'scout_ruins', repeatable: false },
  { id: 'medic_rescue', name: 'Возвращение лекаря', objectives: [{ kind: 'rescue', target: 'field_medic', quantity: 1 }], gold: 40, xp: 60, requires: 'bandit_patrol', repeatable: false },
  { id: 'ruin_guardian', name: 'Страж руин', objectives: [{ kind: 'kill', target: 'ruin_guardian', quantity: 1 }, { kind: 'delivery', target: 'dwemer_relic', quantity: 1 }], gold: 150, xp: 100, requires: 'medic_rescue', repeatable: false },
  { id: 'watch', name: 'Повторный дозор', objectives: [{ kind: 'explore', target: 'watch_point', quantity: 1 }], gold: 15, xp: 20, requires: 'scout_ruins', repeatable: true }
]);
export const MISSION_SCHEMA = `
CREATE TABLE mission_cycle (id INTEGER PRIMARY KEY CHECK(id=1), cycle INTEGER NOT NULL);
INSERT INTO mission_cycle VALUES (1,1);
CREATE TABLE mission_instances (
 id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), definition_id TEXT NOT NULL,
 cycle INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACCEPTED','COMPLETED')), terms TEXT NOT NULL,
 UNIQUE(player_id,definition_id,cycle)
);
CREATE UNIQUE INDEX one_active_mission ON mission_instances(player_id,definition_id) WHERE status='ACCEPTED';
CREATE TABLE mission_progress (
 instance_id TEXT NOT NULL REFERENCES mission_instances(id), objective INTEGER NOT NULL,
 count INTEGER NOT NULL CHECK(count>=0), PRIMARY KEY(instance_id,objective)
);
CREATE TABLE mission_pending (
 instance_id TEXT NOT NULL REFERENCES mission_instances(id), expedition_id TEXT NOT NULL REFERENCES participants(id),
 objective INTEGER NOT NULL, count INTEGER NOT NULL CHECK(count>=0), PRIMARY KEY(instance_id,expedition_id,objective)
);
CREATE TABLE mission_events (
 world_id TEXT NOT NULL REFERENCES raids(id), event_id TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL,
 PRIMARY KEY(world_id,event_id)
);
PRAGMA user_version=6;
`;

export function validateMissions(definitions = MISSIONS) {
  const fail = () => { throw new Error('INVALID_MISSIONS'); };
  if (new Set(definitions.map(m => m.id)).size !== definitions.length) fail();
  const done = new Set(), active = new Set();
  const visit = id => {
    if (done.has(id)) return;
    const m = definitions.find(m => m.id === id);
    if (!m || active.has(id) || !/^[a-z][a-z0-9_]*$/.test(id) || typeof m.repeatable !== 'boolean'
      || ![m.gold,m.xp].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000)
      || !m.objectives.length || m.objectives.length > 10
      || new Set(m.objectives.map(o => o.kind+':'+o.target)).size !== m.objectives.length) fail();
    for (const o of m.objectives) if (!['delivery','explore','kill','rescue'].includes(o.kind)
      || !/^[a-z][a-z0-9_]*$/.test(o.target) || !Number.isSafeInteger(o.quantity) || o.quantity < 1 || o.quantity > 9999
      || (o.kind === 'delivery' && !Object.hasOwn(ITEMS,o.target))) fail();
    active.add(id); if (m.requires) visit(m.requires); active.delete(id); done.add(id);
  };
  definitions.forEach(m => visit(m.id)); return true;
}
validateMissions();
