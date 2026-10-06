import { DatabaseSync } from 'node:sqlite';
import { combatCheck } from './combat.ts';
import { canonical } from './manifest.ts';
import type { CombatCheckpoint } from '../adapters/combat.ts';
import type { Command } from './protocol.ts';

/** Private adapter database. One latest checkpoint/world; no pruning of economic receipts. */
export class CombatJournal {
  #db:DatabaseSync;
  constructor(filename:string){
    this.#db=new DatabaseSync(filename);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS combat_checkpoints (
        world_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        commands TEXT NOT NULL, applied INTEGER NOT NULL CHECK(applied IN (0,1))
      );`);
  }
  close(){this.#db.close();}
  pending(worldId:string):CombatCheckpoint|null {
    const r=this.#db.prepare('SELECT payload FROM combat_checkpoints WHERE world_id=? AND applied=0').get(worldId);
    return r?JSON.parse(String(r.payload)):null;
  }
  stage(checkpoint:CombatCheckpoint,resolve:()=>Command[]):{commands:Command[];applied:boolean}{
    combatCheck(checkpoint.state.version===1&&Number.isSafeInteger(checkpoint.revision)&&checkpoint.revision>0,'INVALID_COMBAT_CHECKPOINT');
    combatCheck(checkpoint.id===`${checkpoint.state.worldId}:combat:${checkpoint.revision}`,'INVALID_COMBAT_CHECKPOINT');
    const payload=canonical(checkpoint),world=checkpoint.state.worldId;
    this.#db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.#db.prepare('SELECT * FROM combat_checkpoints WHERE world_id=?').get(world);
      if(row&&row.revision===checkpoint.revision){
        combatCheck(row.payload===payload,'COMBAT_CHECKPOINT_REUSED');
        this.#db.exec('COMMIT');return {commands:JSON.parse(String(row.commands)),applied:row.applied===1};
      }
      combatCheck(!row||row.applied===1,'COMBAT_CHECKPOINT_PENDING');
      combatCheck(checkpoint.revision===(row?Number(row.revision)+1:1),'COMBAT_CHECKPOINT_ORDER');
      const commands:Command[]=JSON.parse(JSON.stringify(resolve()));
      this.#db.prepare(`INSERT INTO combat_checkpoints VALUES (?,?,?,?,0)
        ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,commands=excluded.commands,applied=0`)
        .run(world,checkpoint.revision,payload,canonical(commands));
      this.#db.exec('COMMIT');return {commands,applied:false};
    }catch(e){this.#db.exec('ROLLBACK');throw e;}
  }
  acknowledge(checkpoint:CombatCheckpoint){
    const result=this.#db.prepare('UPDATE combat_checkpoints SET applied=1 WHERE world_id=? AND revision=? AND payload=?')
      .run(checkpoint.state.worldId,checkpoint.revision,canonical(checkpoint));
    combatCheck(result.changes===1,'COMBAT_CHECKPOINT_MISMATCH');
  }
}
