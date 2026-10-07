import {ITEMS} from './catalog.mjs';
import {combatCheck,type Weapon} from './combat.ts';
export interface Loadout {weaponId:string; shieldId?:string; armorId?:string}
import {WEAPON_MAP,CONSUMABLE_EFFECTS as effects,GEAR_RULES} from './raid-rules.mjs';
const weaponMap=WEAPON_MAP as Record<string,Weapon>;
export const CONSUMABLE_EFFECTS=effects as Record<string,{hp?:number;stamina?:number;magicka?:number;resistance?:number;element?:'fire'|'frost'}>;
export function resolveGear(items:{id:string;template:string;quantity:number}[],raw:Loadout){
 combatCheck(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).every(k=>['weaponId','shieldId','armorId'].includes(k)),'INVALID_LOADOUT');
 const selected=[raw.weaponId,...[raw.shieldId,raw.armorId].filter(x=>x!==undefined)];
 combatCheck(selected.every(x=>typeof x==='string')&&new Set(selected).size===selected.length,'INVALID_LOADOUT');
 const owned=(id:string)=>{const item=items.find(x=>x.id===id);combatCheck(item,'ITEM_NOT_IN_INVENTORY');return item;};
 const weapon=weaponMap[owned(raw.weaponId).template];combatCheck(weapon,'UNSUPPORTED_WEAPON');
 if(raw.shieldId)combatCheck(owned(raw.shieldId).template==='iron_shield'&&!['bow','staff'].includes(weapon),'INVALID_SHIELD');
 const armor=raw.armorId?owned(raw.armorId).template:null;combatCheck(!armor||['leather_armor','iron_armor'].includes(armor),'INVALID_ARMOR');
 const weight=items.reduce((n,x)=>n+(ITEMS as Record<string,{weight:number}>)[x.template].weight*x.quantity,0);
 return {weapon,shield:!!raw.shieldId,weight:weight<GEAR_RULES.lightBelow?'light' as const:weight<GEAR_RULES.mediumBelow?'medium' as const:'heavy' as const,armor:armor==='iron_armor'?GEAR_RULES.ironArmor:armor==='leather_armor'?GEAR_RULES.leatherArmor:0};
}
