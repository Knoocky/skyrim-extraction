import {freeze} from './catalog.mjs';
export const WEAPON_MAP=freeze({iron_sword:'sword',steel_sword:'sword',elven_sword:'sword',dwarven_sword:'sword',steel_dagger:'dagger',iron_axe:'axe',steel_axe:'axe',iron_mace:'axe',steel_mace:'axe',hunting_bow:'bow',long_bow:'bow',dwarven_bow:'bow',fire_staff:'staff'});
export const CONSUMABLE_EFFECTS=freeze({
 healing_potion:{hp:40},strong_healing_potion:{hp:75},stamina_potion:{stamina:45000},magicka_potion:{magicka:45000},
 resist_fire_potion:{resistance:40,element:"fire"},resist_frost_potion:{resistance:40,element:"frost"},vegetable_soup:{hp:15,stamina:20000},venison_stew:{hp:25},bread:{hp:5},cheese:{hp:8},apple:{hp:3},food_ration:{hp:20,stamina:15000}
});

export const GEAR_RULES=freeze({lightBelow:20,mediumBelow:40,leatherArmor:15,ironArmor:30,useTicks:18,resistTicks:600,magickaRegen:200,magickaDelay:90,staffLight:30000,staffHeavy:45000});
