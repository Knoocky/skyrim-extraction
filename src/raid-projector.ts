import {DatabaseSync} from 'node:sqlite';
import {canonical} from './manifest.ts';
import {combatCheck as check} from './combat.ts';
import type {RaidSnapshot} from './raid-service.ts';
/** SQLite stand-in for engine readback, used only by offline simulation and QA. */
export class SimulatedRaidProjector {
  db:DatabaseSync;
  #watchdog:ReturnType<typeof setInterval>;
  constructor(filename:string){
    this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS projection(id INTEGER PRIMARY KEY CHECK(id=1),epoch INTEGER NOT NULL,frozen INTEGER NOT NULL,document TEXT,deadline INTEGER NOT NULL);
      INSERT OR IGNORE INTO projection VALUES(1,0,1,NULL,0);`);
    this.#watchdog=setInterval(()=>{this.db.prepare('UPDATE projection SET frozen=1 WHERE deadline<=?').run(Date.now());},200);this.#watchdog.unref();
  }
  heartbeat(epoch:number,expiresAt:number){
    const r=this.db.prepare('SELECT epoch FROM projection').get()!;check(r.epoch===epoch&&expiresAt>Date.now(),'STALE_PROJECTOR_EPOCH');
    this.db.prepare('UPDATE projection SET deadline=?').run(expiresAt);
  }
  freeze(epoch:number){
    const r=this.db.prepare('SELECT epoch FROM projection').get()!;check(epoch>=Number(r.epoch),'STALE_PROJECTOR_EPOCH');
    this.db.prepare('UPDATE projection SET epoch=?,frozen=1').run(epoch);
  }
  apply(snapshot:RaidSnapshot,epoch:number){
    const r=this.db.prepare('SELECT * FROM projection').get()!;check(r.epoch===epoch&&r.frozen===1,'PROJECTOR_NOT_FROZEN');
    const value=canonical(snapshot);this.db.prepare('UPDATE projection SET document=?').run(value);
    return this.db.prepare('SELECT document FROM projection').get()!.document===value;
  }
  resume(snapshot:RaidSnapshot,epoch:number,expiresAt:number){
    const r=this.db.prepare('SELECT * FROM projection').get()!;
    check(r.epoch===epoch&&r.document===canonical(snapshot)&&snapshot.status==='OPEN','PROJECTOR_STATE_MISMATCH');
    this.heartbeat(epoch,expiresAt);this.db.prepare('UPDATE projection SET frozen=0').run();return true;
  }
  close(){clearInterval(this.#watchdog);this.db.close();}
}
