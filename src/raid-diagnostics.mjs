import {COMBAT_VERSION,COMBAT_MANIFEST} from './combat.ts';
/** Read inside a consistent DB snapshot. Only counts/error codes, never player data. */
export function raidDiagnostics(db){
 const worlds=db.prepare('SELECT * FROM raid_combat').all();
 const result={worlds:worlds.length,open:0,pending:0,receipts:db.prepare('SELECT COUNT(*) AS n FROM raid_receipts').get().n,violations:[]};
 for(const row of worlds){
  if(row.status==='OPEN')result.open++;
  if(row.revision!==row.acknowledged)result.pending++;
  if(row.acknowledged>row.revision||row.acknowledged<0)result.violations.push('INVALID_RAID_REVISION');
  try{
   const state=JSON.parse(row.state),metadata=JSON.parse(row.bindings);
   if(state.version!==COMBAT_VERSION||metadata.rulesHash!==COMBAT_MANIFEST.rulesHash||state.worldId!==row.world_id||!Array.isArray(state.actors))throw Error();
   if(row.status==='OPEN')for(const [id,binding] of Object.entries(metadata.players)){
    const actor=state.actors.find(a=>a.id===id),p=db.prepare('SELECT status,player_id,raid_id FROM participants WHERE id=?').get(binding.expeditionId);
    if(!actor||!p||p.player_id!==binding.playerId||p.raid_id!==row.world_id||(actor.hp===0?p.status!=='DEAD':p.status!=='ACTIVE'))result.violations.push('COMBAT_ECONOMY_MISMATCH');
   }
   const raid=db.prepare('SELECT status FROM raids WHERE id=?').get(row.world_id);
   if(raid?.status!==row.status)result.violations.push('RAID_STATUS_MISMATCH');
  }catch{result.violations.push('INVALID_COMBAT_CHECKPOINT');}
 }
 result.violations=[...new Set(result.violations)];return result;
}
