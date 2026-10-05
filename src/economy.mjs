// Versioned, server-owned starter balance. No game FormIDs or client-provided prices.
/** @template T @param {T} value @returns {T} */
const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
export const ECONOMY = freeze({
  version: 1,
  offers: [
    { id: 'sword', trader: 'smith', template: 'iron_sword', buy: 100, sell: 25 },
    { id: 'bow', trader: 'smith', template: 'hunting_bow', buy: 100, sell: 25 },
    { id: 'potion', trader: 'apothecary', template: 'healing_potion', buy: 20, sell: 5 },
    { id: 'ring', trader: 'antiquarian', template: 'silver_ring', buy: 150, sell: 60 },
    { id: 'relic', trader: 'antiquarian', template: 'dwemer_relic', buy: 300, sell: 120 }
  ],
  contracts: [
    { id: 'supplies', name: 'Запас для лекаря', template: 'healing_potion', quantity: 3, gold: 80, xp: 100, requires: null, archive: 0 },
    { id: 'silver', name: 'Серебро из руин', template: 'silver_ring', quantity: 1, gold: 180, xp: 100, requires: 'supplies', archive: 0 },
    { id: 'relic', name: 'Двемерский след', template: 'dwemer_relic', quantity: 1, gold: 350, xp: 150, requires: 'silver', archive: 1 }
  ],
  modules: [
    { id: 'workshop', name: 'Мастерская', costs: [100, 200, 400], description: 'Скидка 5% за уровень на покупки.' },
    { id: 'archive', name: 'Архив', costs: [100], description: 'Открывает контракт «Двемерский след».' }
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
