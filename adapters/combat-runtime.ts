/** Server-only, optional combat package. Requires Node 24; never load in the game client's JS VM. */
export { CombatAdapter } from './combat.ts';
export type { CombatPort, CombatSession, CombatCheckpoint } from './combat.ts';
export { CombatDelivery } from './combat-delivery.ts';
export type { CombatDeliveryPort, ExpeditionBinding } from './combat-delivery.ts';
export { CombatJournal } from '../src/combat-journal.ts';
export { COMBAT_VERSION, COMBAT_RULES, COMBAT_MANIFEST, createCombat, advanceCombat, commandCombat, contactCombat, attackProfile } from '../src/combat.ts';
export { decodeLifecycle, lifecycleCombat } from '../src/combat-lifecycle.ts';
