import { ITEMS, RECIPES, validateContent } from '../src/catalog.mjs';
import { ECONOMY } from '../src/economy.mjs';
validateContent(ECONOMY);
console.log(`Content validated: ${Object.keys(ITEMS).length} items, ${RECIPES.length} recipes, ${ECONOMY.contracts.length} contracts; references, DAGs and trade/craft resale costs checked.`);
