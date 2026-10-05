import { ITEMS, RECIPES, validateContent } from '../src/catalog.mjs';
import { MISSIONS, validateMissions } from '../src/missions.mjs';
import { ECONOMY } from '../src/economy.mjs';
validateContent(ECONOMY);
validateMissions();
console.log(`Content validated: ${Object.keys(ITEMS).length} items, ${RECIPES.length} recipes, ${ECONOMY.contracts.length} delivery contracts, ${MISSIONS.length} missions; references, DAGs and trade/craft resale costs checked.`);
