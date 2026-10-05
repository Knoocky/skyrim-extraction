import { ITEMS, RECIPES, validateContent } from './catalog.mjs';
import { MISSIONS, validateMissions } from './missions.mjs';
import { ECONOMY } from './economy.mjs';
import { REGION } from './region.mjs';
export function validateReleaseContent() {
  validateContent(ECONOMY); validateMissions();
  const fail=()=>{throw new Error('INVALID_RELEASE_CONTENT');};
  const targets=new Set(REGION.areas.flatMap(a=>a.targets));
  if(new Set(REGION.areas.map(a=>a.id)).size!==REGION.areas.length || REGION.maxPlayers!==4)fail();
  for(const m of MISSIONS)for(const o of m.objectives)if(o.kind!=='delivery'&&!targets.has(o.target))fail();
  for(const recipe of RECIPES)if(recipe.requires&&!MISSIONS.some(m=>m.id===recipe.requires&&!m.repeatable))fail();
  for(const area of REGION.areas)for(const entry of area.loot)if(!Object.hasOwn(ITEMS,entry.template)||!Number.isSafeInteger(entry.quantity)||entry.quantity<1||entry.quantity>9999||(!ITEMS[entry.template].stackable&&entry.quantity!==1))fail();
  if(new Set(REGION.exits.map(e=>e.id)).size!==REGION.exits.length)fail();
  for(const exit of REGION.exits)if(!['always','day','night'].includes(exit.availability)||!Number.isSafeInteger(exit.dwellMs)||exit.dwellMs<1000||!Number.isFinite(exit.radius)||exit.radius<=0||(exit.requires&&!MISSIONS.some(m=>m.id===exit.requires)))fail();
  // Repeatable delivery quests cannot mint profit from discounted merchant purchases.
  for(const mission of MISSIONS.filter(m=>m.repeatable&&m.objectives.every(o=>o.kind==='delivery'))) {
    const cost=mission.objectives.reduce((n,o)=>n+Math.min(...ECONOMY.offers.filter(x=>x.template===o.target).map(x=>Math.ceil(x.buy*.85)))*o.quantity,0);
    if(Math.floor(mission.gold*1.15)>=cost)fail();
  }
  return {items:Object.keys(ITEMS).length,recipes:RECIPES.length,contracts:MISSIONS.length+ECONOMY.contracts.length,areas:REGION.areas.length,exits:REGION.exits.length};
}
