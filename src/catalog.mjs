/** @template T @param {T} value @returns {T} */
export function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
export const ITEMS = freeze({
  iron_shield: {name:'Железный щит',kind:'armor',stackable:false,weight:12},
  leather_armor: {name:'Кожаная броня',kind:'armor',stackable:false,weight:6},
  iron_armor: {name:'Железная броня',kind:'armor',stackable:false,weight:30},
  iron_arrow: {name:'Железные стрелы',kind:'ammo',stackable:true,weight:0.1},
  fire_staff: {name:'Посох пламени',kind:'weapon',stackable:false,weight:8},
  steel_sword: {"name": "Стальной меч", "kind": "weapon", "stackable": false, "weight": 10},
  steel_dagger: {"name": "Стальной кинжал", "kind": "weapon", "stackable": false, "weight": 3},
  iron_axe: {"name": "Железный топор", "kind": "weapon", "stackable": false, "weight": 11},
  steel_axe: {"name": "Стальной топор", "kind": "weapon", "stackable": false, "weight": 12},
  iron_mace: {"name": "Железная булава", "kind": "weapon", "stackable": false, "weight": 13},
  steel_mace: {"name": "Стальная булава", "kind": "weapon", "stackable": false, "weight": 14},
  long_bow: {"name": "Длинный лук", "kind": "weapon", "stackable": false, "weight": 8},
  dwarven_bow: {"name": "Двемерский лук", "kind": "weapon", "stackable": false, "weight": 10},
  elven_sword: {"name": "Эльфийский меч", "kind": "weapon", "stackable": false, "weight": 12},
  dwarven_sword: {"name": "Двемерский меч", "kind": "weapon", "stackable": false, "weight": 13},
  steel_ingot: {"name": "Стальной слиток", "kind": "material", "stackable": true, "weight": 1},
  corundum_ingot: {"name": "Корундовый слиток", "kind": "material", "stackable": true, "weight": 1},
  silver_ingot: {"name": "Серебряный слиток", "kind": "material", "stackable": true, "weight": 1},
  gold_ingot: {"name": "Золотой слиток", "kind": "material", "stackable": true, "weight": 1},
  moonstone_ingot: {"name": "Очищенный лунный камень", "kind": "material", "stackable": true, "weight": 1},
  dwarven_ingot: {"name": "Двемерский слиток", "kind": "material", "stackable": true, "weight": 1},
  leather_strips: {"name": "Полоски кожи", "kind": "material", "stackable": true, "weight": 0.1},
  wolf_pelt: {"name": "Волчья шкура", "kind": "material", "stackable": true, "weight": 1},
  bear_pelt: {"name": "Медвежья шкура", "kind": "material", "stackable": true, "weight": 3},
  deer_hide: {"name": "Оленья шкура", "kind": "material", "stackable": true, "weight": 2},
  blue_flower: {"name": "Синий горноцвет", "kind": "material", "stackable": true, "weight": 0.1},
  red_flower: {"name": "Красный горноцвет", "kind": "material", "stackable": true, "weight": 0.1},
  purple_flower: {"name": "Лиловый горноцвет", "kind": "material", "stackable": true, "weight": 0.1},
  wheat: {"name": "Пшеница", "kind": "material", "stackable": true, "weight": 0.1},
  lavender: {"name": "Лаванда", "kind": "material", "stackable": true, "weight": 0.1},
  salt: {"name": "Соль", "kind": "material", "stackable": true, "weight": 0.2},
  garlic: {"name": "Чеснок", "kind": "material", "stackable": true, "weight": 0.1},
  mushroom: {"name": "Гриб", "kind": "material", "stackable": true, "weight": 0.2},
  snowberry: {"name": "Снежные ягоды", "kind": "material", "stackable": true, "weight": 0.1},
  frost_salts: {"name": "Морозная соль", "kind": "material", "stackable": true, "weight": 0.1},
  stamina_potion: {"name": "Зелье запаса сил", "kind": "consumable", "stackable": true, "weight": 0.5},
  magicka_potion: {"name": "Зелье магии", "kind": "consumable", "stackable": true, "weight": 0.5},
  strong_healing_potion: {"name": "Крепкое зелье лечения", "kind": "consumable", "stackable": true, "weight": 0.5},
  resist_frost_potion: {"name": "Зелье защиты от холода", "kind": "consumable", "stackable": true, "weight": 0.5},
  resist_fire_potion: {"name": "Зелье защиты от огня", "kind": "consumable", "stackable": true, "weight": 0.5},
  vegetable_soup: {"name": "Овощной суп", "kind": "consumable", "stackable": true, "weight": 0.5},
  venison_stew: {"name": "Похлёбка из оленины", "kind": "consumable", "stackable": true, "weight": 0.5},
  bread: {"name": "Хлеб", "kind": "consumable", "stackable": true, "weight": 0.2},
  cheese: {"name": "Сыр", "kind": "consumable", "stackable": true, "weight": 0.5},
  apple: {"name": "Яблоко", "kind": "consumable", "stackable": true, "weight": 0.1},
  gold_ring: {"name": "Золотое кольцо", "kind": "valuable", "stackable": false, "weight": 0.25},
  silver_necklace: {"name": "Серебряное ожерелье", "kind": "valuable", "stackable": false, "weight": 0.5},
  gold_necklace: {"name": "Золотое ожерелье", "kind": "valuable", "stackable": false, "weight": 0.5},
  garnet: {"name": "Гранат", "kind": "valuable", "stackable": false, "weight": 0.1},
  amethyst: {"name": "Аметист", "kind": "valuable", "stackable": false, "weight": 0.1},
  ruby: {"name": "Рубин", "kind": "valuable", "stackable": false, "weight": 0.1},
  sapphire: {"name": "Сапфир", "kind": "valuable", "stackable": false, "weight": 0.1},
  emerald: {"name": "Изумруд", "kind": "valuable", "stackable": false, "weight": 0.1},
  diamond: {"name": "Алмаз", "kind": "valuable", "stackable": false, "weight": 0.1},
  ancient_coin: {"name": "Древняя монета", "kind": "valuable", "stackable": false, "weight": 0.1},
  iron_sword: { name: 'Железный меч', kind: 'weapon', stackable: false, weight: 9 },
  hunting_bow: { name: 'Охотничий лук', kind: 'weapon', stackable: false, weight: 7 },
  healing_potion: { name: 'Зелье лечения', kind: 'consumable', stackable: true, weight: 0.5 },
  silver_ring: { name: 'Серебряное кольцо', kind: 'valuable', stackable: false, weight: 0.25 },
  dwemer_relic: { name: 'Двемерская реликвия', kind: 'valuable', stackable: false, weight: 2 },
  mountain_herb: { name: 'Горные травы', kind: 'material', stackable: true, weight: 0.1 },
  iron_ingot: { name: 'Железный слиток', kind: 'material', stackable: true, weight: 1 },
  leather: { name: 'Кожа', kind: 'material', stackable: true, weight: 1 },
  raw_meat: { name: 'Сырое мясо', kind: 'material', stackable: true, weight: 1 },
  food_ration: { name: 'Дорожный паёк', kind: 'consumable', stackable: true, weight: 0.5 }
});
export const RECIPES = freeze([
  { id: 'brew_potion', name: 'Приготовить зелье', ingredients: [{ template: 'mountain_herb', quantity: 2 }], output: { template: 'healing_potion', quantity: 1 }, gold: 2, module: 'workshop', level: 1 },
  { id: 'forge_sword', name: 'Выковать меч', ingredients: [{ template: 'iron_ingot', quantity: 3 }, { template: 'leather', quantity: 1 }], output: { template: 'iron_sword', quantity: 1 }, gold: 10, module: 'workshop', level: 1 },
  { id: 'cook_rations', name: 'Приготовить пайки', ingredients: [{ template: 'raw_meat', quantity: 2 }, { template: 'mountain_herb', quantity: 1 }], output: { template: 'food_ration', quantity: 2 }, gold: 2, module: 'workshop', level: 0 },
{"id": "temper_steel", "name": "Выплавить сталь", "ingredients": [{"template": "iron_ingot", "quantity": 2}, {"template": "corundum_ingot", "quantity": 1}], "output": {"template": "steel_ingot", "quantity": 1}, "gold": 8, "module": "workshop", "level": 1, "requires": null},
  {"id": "cut_leather", "name": "Нарезать кожу", "ingredients": [{"template": "leather", "quantity": 1}], "output": {"template": "leather_strips", "quantity": 1}, "gold": 1, "module": "workshop", "level": 0, "requires": null},
  {"id": "brew_stamina", "name": "Зелье сил", "ingredients": [{"template": "purple_flower", "quantity": 2}, {"template": "wheat", "quantity": 1}], "output": {"template": "stamina_potion", "quantity": 1}, "gold": 4, "module": "workshop", "level": 1, "requires": "medic_rescue"},
  {"id": "brew_magicka", "name": "Зелье магии", "ingredients": [{"template": "red_flower", "quantity": 2}, {"template": "lavender", "quantity": 1}], "output": {"template": "magicka_potion", "quantity": 1}, "gold": 4, "module": "workshop", "level": 1, "requires": "medic_rescue"},
  {"id": "brew_strong", "name": "Крепкое лечение", "ingredients": [{"template": "healing_potion", "quantity": 2}, {"template": "blue_flower", "quantity": 2}], "output": {"template": "strong_healing_potion", "quantity": 1}, "gold": 8, "module": "workshop", "level": 2, "requires": "ruin_guardian"},
  {"id": "forge_steel", "name": "Стальной меч", "ingredients": [{"template": "steel_ingot", "quantity": 3}, {"template": "leather_strips", "quantity": 2}], "output": {"template": "steel_sword", "quantity": 1}, "gold": 12, "module": "workshop", "level": 2, "requires": "ruin_guardian"},
  {"id": "forge_dwarven", "name": "Двемерский меч", "ingredients": [{"template": "dwarven_ingot", "quantity": 3}, {"template": "steel_ingot", "quantity": 1}], "output": {"template": "dwarven_sword", "quantity": 1}, "gold": 20, "module": "workshop", "level": 3, "requires": "final_beacon"},
]);
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
/** Validate server-owned balance before opening a database. Throws without modifying data. */
export function validateContent(economy, items = ITEMS, recipes = RECIPES) {
  const fail = () => { throw new Error('INVALID_CONTENT'); };
  const unique = list => new Set(list.map(x => x.id)).size === list.length && list.every(x => /^[a-z][a-z0-9_]*$/.test(x.id));
  if (!unique(economy.offers) || !unique(economy.contracts) || !unique(economy.modules) || !unique(economy.skills) || !unique(recipes)) fail();
  for (const [id, item] of Object.entries(items)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id) || !item.name || !['weapon', 'armor', 'ammo', 'consumable', 'valuable', 'material'].includes(item.kind)
      || typeof item.stackable !== 'boolean' || !Number.isFinite(item.weight) || item.weight < 0) fail();
  }
  for (const offer of economy.offers) {
    if (!Object.hasOwn(items, offer.template) || !integer(offer.buy, 1) || !integer(offer.sell) || !integer(offer.stock, 1)
      || offer.buy > 1000000 || offer.sell > 1000000 || offer.stock > 9999 || Math.ceil(offer.buy * 0.85) <= offer.sell) fail();
  }
  for (const skill of economy.skills) if (!integer(skill.maxRank, 1) || skill.maxRank > 100) fail();
  for (const module of economy.modules) if (!module.costs.length || !module.costs.every(n => integer(n, 1))) fail();
  const visited = new Set(), visiting = new Set();
  const visit = id => {
    if (visited.has(id)) return;
    const c = economy.contracts.find(c => c.id === id);
    if (!c || visiting.has(id) || !Object.hasOwn(items, c.template) || !integer(c.quantity, 1) || c.quantity > 9999 || !integer(c.gold) || c.gold > 1000000 || !integer(c.xp) || c.xp > 1000000 || !integer(c.archive) || c.archive > economy.modules.find(m => m.id === 'archive')?.costs.length) fail();
    visiting.add(id); if (c.requires) visit(c.requires); visiting.delete(id); visited.add(id);
  };
  for (const c of economy.contracts) visit(c.id);
  for (const recipe of recipes) {
    const module = economy.modules.find(m => m.id === recipe.module);
    const output = Object.hasOwn(items, recipe.output.template) ? items[recipe.output.template] : null;
    if (!module || !integer(recipe.level) || recipe.level > module.costs.length || !integer(recipe.gold)
      || !output || !integer(recipe.output.quantity, 1) || recipe.output.quantity > 9999 || (!output.stackable && recipe.output.quantity !== 1)
      || !recipe.ingredients.length || new Set(recipe.ingredients.map(i => i.template)).size !== recipe.ingredients.length) fail();
    for (const i of recipe.ingredients) if (!Object.hasOwn(items, i.template) || !integer(i.quantity, 1) || i.quantity > 9999) fail();
  }
  // Recipes form a DAG: no conversion loop can silently generate materials.
  const done = new Set(), active = new Set();
  const walk = template => {
    if (active.has(template)) fail(); if (done.has(template)) return;
    active.add(template);
    for (const recipe of recipes.filter(r => r.output.template === template)) for (const i of recipe.ingredients) walk(i.template);
    active.delete(template); done.add(template);
  };
  for (const id of Object.keys(items)) walk(id);
  // Cheapest acquisition with maximum allowed workshop discount, recursively including crafting.
  // Every sale must remain below that cost; this also covers multi-recipe conversion paths.
  const costs = new Map();
  const cost = template => {
    if (costs.has(template)) return costs.get(template);
    let best = Math.min(Infinity, ...economy.offers.filter(o => o.template === template).map(o => Math.ceil(o.buy * 0.85)));
    for (const r of recipes.filter(r => r.output.template === template)) {
      best = Math.min(best, (Math.max(0, r.gold - (['healing_potion', 'food_ration'].includes(r.output.template) ? 2 : 0)) + r.ingredients.reduce((sum, i) => sum + cost(i.template) * i.quantity, 0)) / r.output.quantity);
    }
    costs.set(template, best); return best;
  };
  for (const offer of economy.offers) if (offer.sell >= cost(offer.template)) fail();
  return true;
}
