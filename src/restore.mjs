import { backupDatabase } from './backup.mjs';
import { ExtractionCore } from './core.mjs';
import { randomUUID } from 'node:crypto';
import { rmSync,linkSync } from 'node:fs';
/** Publish to an unused filename only; never replace a live database or its WAL. */
export function restoreDatabase(source,target) {
 const stage=target+'.restore-'+randomUUID();let core;
 try {
  backupDatabase(source,stage);core=new ExtractionCore(stage);
  core.transaction(()=>{
   core.run('UPDATE projection_state SET database_id=?,acknowledged=0 WHERE id=1',randomUUID());
   core.run("UPDATE connections SET status='CLOSED'");
   core.run("UPDATE adapter_lease SET epoch=epoch+1,token=NULL,lease_until=0,status='FROZEN' WHERE id=1");
   core.queueProjection();
  });
  core.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');core.close();core=null;
  linkSync(stage,target);
 }finally{core?.close();for(const suffix of ['','-wal','-shm'])rmSync(stage+suffix,{force:true});}
}
