/** @template T @param {T} value @returns {T} */
export function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}
export const ITEMS = freeze({
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
  { id: 'cook_rations', name: 'Приготовить пайки', ingredients: [{ template: 'raw_meat', quantity: 2 }, { template: 'mountain_herb', quantity: 1 }], output: { template: 'food_ration', quantity: 2 }, gold: 2, module: 'workshop', level: 0 }
]);
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
/** Validate server-owned balance before opening a database. Throws without modifying data. */
export function validateContent(economy, items = ITEMS, recipes = RECIPES) {
  const fail = () => { throw new Error('INVALID_CONTENT'); };
  const unique = list => new Set(list.map(x => x.id)).size === list.length && list.every(x => /^[a-z][a-z0-9_]*$/.test(x.id));
  if (!unique(economy.offers) || !unique(economy.contracts) || !unique(economy.modules) || !unique(economy.skills) || !unique(recipes)) fail();
  for (const [id, item] of Object.entries(items)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id) || !item.name || !['weapon', 'consumable', 'valuable', 'material'].includes(item.kind)
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
      best = Math.min(best, (r.gold + r.ingredients.reduce((sum, i) => sum + cost(i.template) * i.quantity, 0)) / r.output.quantity);
    }
    costs.set(template, best); return best;
  };
  for (const offer of economy.offers) if (offer.sell >= cost(offer.template)) fail();
  return true;
}
