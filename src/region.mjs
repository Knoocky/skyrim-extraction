import { freeze } from './catalog.mjs';
// Logical content only. A binding manifest must supply verified cells/references/positions.
export const REGION = freeze({
 id: 'whiterun_frontier', name: 'Окрестности Вайтрана', maxPlayers: 4,
 areas: [
  { id:'ruins', name:'Руины дозора', loot:[{template:'silver_ring',quantity:1},{template:'mountain_herb',quantity:8}], targets:['ruins_gate','bandit','field_medic','ruin_guardian','watch_point'] },
  { id:'mine', name:'Заброшенная шахта', loot:[{template:'iron_ingot',quantity:6},{template:'corundum_ingot',quantity:3}], targets:['abandoned_mine','mine_chief','surveyor'] },
  { id:'vault', name:'Запечатанное хранилище', loot:[{template:'dwarven_ingot',quantity:4},{template:'dwemer_relic',quantity:1}], targets:['sealed_vault'] },
  { id:'tower', name:'Старая башня', loot:[{template:'wheat',quantity:6},{template:'blue_flower',quantity:4}], targets:['old_tower','river_crossing','caravaneer'] },
  { id:'crypt', name:'Крипта на холме', loot:[{template:'ancient_coin',quantity:1},{template:'frost_salts',quantity:3}], targets:['hill_crypt','crypt_guard'] },
  { id:'beacon', name:'Вершина маяка', loot:[{template:'diamond',quantity:1},{template:'leather',quantity:4}], targets:['beacon_summit','beacon_keeper','wolf','bear'] }
 ],
 exits: [
  { id:'north_gate', name:'Северная тропа', availability:'always', dwellMs:10000, radius:180 },
  { id:'river_boat', name:'Речная переправа', availability:'day', dwellMs:15000, radius:160 },
  { id:'night_tunnel', name:'Ночной тоннель', availability:'night', dwellMs:8000, radius:120 },
  { id:'beacon_route', name:'Тропа маяка', availability:'always', dwellMs:10000, radius:180, requires:'final_beacon' }
 ]
});
