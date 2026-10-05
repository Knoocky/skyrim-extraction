import { freeze, ITEMS } from './catalog.mjs';
export const MISSION_TARGET_NAMES = freeze({ "abandoned_mine":"Заброшенная шахта","mine_chief":"Главарь шахты","surveyor":"Спасение картографа","sealed_vault":"Запечатанное хранилище","beacon_summit":"Последний маяк","river_crossing":"Речной дозор","old_tower":"Старая башня","hill_crypt":"Крипта на холме","crypt_guard":"Страж крипты","wolf":"Волчья тропа","bear":"Медвежье логово","caravaneer":"Пропавший караванщик", beacon_keeper: 'Хранитель маяка', ruins_gate: 'Вход в руины', bandit: 'Разбойники', field_medic: 'Полевой лекарь', ruin_guardian: 'Страж руин', watch_point: 'Дозорный пункт' });
export const MISSIONS = freeze([
  { id: 'herbal_supply', name: 'Сбор трав', objectives: [{ kind: 'delivery', target: 'mountain_herb', quantity: 3 }], gold: 12, xp: 15, requires: null, repeatable: true },
  { id: 'scout_ruins', name: 'Разведка руин', objectives: [{ kind: 'explore', target: 'ruins_gate', quantity: 1 }], gold: 20, xp: 30, requires: null, repeatable: false },
  { id: 'bandit_patrol', name: 'Опасный патруль', objectives: [{ kind: 'kill', target: 'bandit', quantity: 2 }], gold: 30, xp: 40, requires: 'scout_ruins', repeatable: false },
  { id: 'medic_rescue', name: 'Возвращение лекаря', objectives: [{ kind: 'rescue', target: 'field_medic', quantity: 1 }], gold: 40, xp: 60, requires: 'bandit_patrol', repeatable: false },
  { id: 'ruin_guardian', name: 'Страж руин', objectives: [{ kind: 'kill', target: 'ruin_guardian', quantity: 1 }, { kind: 'delivery', target: 'dwemer_relic', quantity: 1 }], gold: 150, xp: 100, requires: 'medic_rescue', repeatable: false },
  { id: 'watch', name: 'Повторный дозор', objectives: [{ kind: 'explore', target: 'watch_point', quantity: 1 }], gold: 15, xp: 20, requires: 'scout_ruins', repeatable: true },
{"id": "survey_mine", "name": "Заброшенная шахта", "objectives": [{"kind": "explore", "target": "abandoned_mine", "quantity": 1}], "gold": 25, "xp": 35, "requires": "ruin_guardian", "repeatable": false},
  {"id": "mine_chief", "name": "Главарь шахты", "objectives": [{"kind": "kill", "target": "mine_chief", "quantity": 1}], "gold": 60, "xp": 60, "requires": "survey_mine", "repeatable": false},
  {"id": "surveyor_rescue", "name": "Спасение картографа", "objectives": [{"kind": "rescue", "target": "surveyor", "quantity": 1}], "gold": 70, "xp": 70, "requires": "mine_chief", "repeatable": false},
  {"id": "sealed_vault", "name": "Запечатанное хранилище", "objectives": [{"kind": "explore", "target": "sealed_vault", "quantity": 1}], "gold": 80, "xp": 80, "requires": "surveyor_rescue", "repeatable": false},
  {"id": "beacon_parts", "name": "Детали маяка", "objectives": [{"kind": "delivery", "target": "dwarven_ingot", "quantity": 3}], "gold": 120, "xp": 90, "requires": "sealed_vault", "repeatable": false},
  {"id": "final_beacon", "requiresReputation": 90, "name": "Последний маяк", "objectives": [{"kind": "explore", "target": "beacon_summit", "quantity": 1}, {"kind": "kill", "target": "beacon_keeper", "quantity": 1}], "gold": 300, "xp": 200, "requires": "beacon_parts", "repeatable": false},
  {"id": "wheat_supply", "name": "Зерно для убежища", "objectives": [{"kind": "delivery", "target": "wheat", "quantity": 4}], "gold": 12, "xp": 12, "requires": null, "repeatable": true},
  {"id": "leather_supply", "name": "Запас кожи", "objectives": [{"kind": "delivery", "target": "leather", "quantity": 3}], "gold": 15, "xp": 15, "requires": null, "repeatable": true},
  {"id": "iron_supply", "name": "Железный запас", "objectives": [{"kind": "delivery", "target": "iron_ingot", "quantity": 3}], "gold": 18, "xp": 15, "requires": null, "repeatable": true},
  {"id": "frost_research", "name": "Морозные образцы", "objectives": [{"kind": "delivery", "target": "frost_salts", "quantity": 2}], "gold": 15, "xp": 20, "requires": "scout_ruins", "repeatable": true},
  {"id": "river_watch", "name": "Речной дозор", "objectives": [{"kind": "explore", "target": "river_crossing", "quantity": 1}], "gold": 18, "xp": 20, "requires": "scout_ruins", "repeatable": true},
  {"id": "tower_watch", "name": "Старая башня", "objectives": [{"kind": "explore", "target": "old_tower", "quantity": 1}], "gold": 25, "xp": 30, "requires": "scout_ruins", "repeatable": false},
  {"id": "crypt_survey", "name": "Крипта на холме", "objectives": [{"kind": "explore", "target": "hill_crypt", "quantity": 1}], "gold": 30, "xp": 35, "requires": "tower_watch", "repeatable": false},
  {"id": "crypt_guard", "name": "Страж крипты", "objectives": [{"kind": "kill", "target": "crypt_guard", "quantity": 1}], "gold": 45, "xp": 45, "requires": "crypt_survey", "repeatable": false},
  {"id": "wolf_hunt", "name": "Волчья тропа", "objectives": [{"kind": "kill", "target": "wolf", "quantity": 3}], "gold": 20, "xp": 25, "requires": null, "repeatable": true},
  {"id": "bear_hunt", "name": "Медвежье логово", "objectives": [{"kind": "kill", "target": "bear", "quantity": 1}], "gold": 30, "xp": 30, "requires": "wolf_hunt", "repeatable": true},
  {"id": "caravan_rescue", "name": "Пропавший караванщик", "objectives": [{"kind": "rescue", "target": "caravaneer", "quantity": 1}], "gold": 40, "xp": 45, "requires": "scout_ruins", "repeatable": false},
  {"id": "healer_stock", "name": "Травы для лекаря", "objectives": [{"kind": "delivery", "target": "blue_flower", "quantity": 3}], "gold": 15, "xp": 20, "requires": "medic_rescue", "repeatable": true},
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
      || !Number.isSafeInteger(m.requiresReputation ?? 0) || (m.requiresReputation ?? 0) < 0
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
