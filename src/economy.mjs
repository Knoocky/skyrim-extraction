// Versioned, server-owned starter balance. No game FormIDs or client-provided prices.
import { freeze } from './catalog.mjs';
export const ECONOMY = freeze({
  version: 3,
  offers: [
    { id: 'sword', trader: 'smith', template: 'iron_sword', buy: 100, sell: 25, stock: 20 },
    { id: 'bow', trader: 'smith', template: 'hunting_bow', buy: 100, sell: 25, stock: 20 },
    { id: 'potion', trader: 'apothecary', template: 'healing_potion', buy: 20, sell: 5, stock: 100 },
    { id: 'ring', trader: 'antiquarian', template: 'silver_ring', buy: 150, sell: 60, stock: 10 },
    { id: 'relic', trader: 'antiquarian', template: 'dwemer_relic', buy: 300, sell: 120, stock: 5 },
    { id: 'herb', trader: 'apothecary', template: 'mountain_herb', buy: 8, sell: 2, stock: 100 },
    { id: 'ingot', trader: 'smith', template: 'iron_ingot', buy: 20, sell: 5, stock: 100 },
    { id: 'leather', trader: 'smith', template: 'leather', buy: 15, sell: 4, stock: 100 },
    { id: 'meat', trader: 'apothecary', template: 'raw_meat', buy: 10, sell: 2, stock: 100 },
    { id: 'ration', trader: 'apothecary', template: 'food_ration', buy: 15, sell: 3, stock: 100 }
  ],
  contracts: [
    { id: 'supplies', name: 'Запас для лекаря', template: 'healing_potion', quantity: 3, gold: 80, xp: 100, requires: null, archive: 0 },
    { id: 'silver', name: 'Серебро из руин', template: 'silver_ring', quantity: 1, gold: 180, xp: 100, requires: 'supplies', archive: 0 },
    { id: 'relic', name: 'Двемерский след', template: 'dwemer_relic', quantity: 1, gold: 350, xp: 150, requires: 'silver', archive: 1 }
  ],
  modules: [
    { id: 'workshop', name: 'Мастерская', costs: [100, 200, 400], description: 'Скидка 5% за уровень на покупки.' },
    { id: 'archive', name: 'Архив', costs: [100], description: 'Открывает контракт «Двемерский след».' },
    { id: 'storage', name: 'Схрон', costs: [100, 200, 400], description: '+50 мест для экземпляров/стеков за уровень.' },
    { id: 'alchemy', name: 'Алхимическая стойка', costs: [50, 100], description: 'Снижает плату за партию зелий на 1 золото за уровень.' },
    { id: 'kitchen', name: 'Кухня', costs: [30, 60], description: 'Снижает плату за партию пайков на 1 золото за уровень.' },
    { id: 'scouting', name: 'Стол разведки', costs: [100, 200, 400], description: '+10% опыта за новые контракты за уровень.' }
  ],
  skills: [{ id: 'bargaining', name: 'Переговоры', maxRank: 3, description: '+5% золота за новые контракты за ранг.' }]
});
export const ECONOMY_SCHEMA = `
CREATE TABLE progression (
 player_id TEXT PRIMARY KEY REFERENCES players(id),
 gold INTEGER NOT NULL DEFAULT 0 CHECK(typeof(gold)='integer' AND gold BETWEEN 0 AND 1000000000),
 xp INTEGER NOT NULL DEFAULT 0 CHECK(typeof(xp)='integer' AND xp BETWEEN 0 AND 1000000000),
 bargaining INTEGER NOT NULL DEFAULT 0 CHECK(bargaining BETWEEN 0 AND 3),
 workshop INTEGER NOT NULL DEFAULT 0 CHECK(workshop BETWEEN 0 AND 3),
 archive INTEGER NOT NULL DEFAULT 0 CHECK(archive BETWEEN 0 AND 1)
);
INSERT INTO progression(player_id) SELECT id FROM players;
CREATE TABLE player_contracts (
 player_id TEXT NOT NULL REFERENCES players(id), contract_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ACCEPTED','COMPLETED')), terms TEXT NOT NULL,
 PRIMARY KEY(player_id,contract_id)
);
CREATE TABLE loot_provenance (
 item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
 extracted INTEGER NOT NULL DEFAULT 0 CHECK(extracted IN (0,1))
);
PRAGMA user_version = 3;
`;
