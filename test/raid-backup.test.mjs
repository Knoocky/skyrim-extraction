import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {raidFixture,hurt} from './raid-fixture.mjs';
import {backupDatabase} from '../src/backup.mjs';
import {restoreDatabase} from '../src/restore.mjs';
import {ExtractionCore} from '../src/core.mjs';
import {RaidService} from '../src/raid-service.ts';
import {raidDiagnostics} from '../src/raid-diagnostics.mjs';
test('one backup includes pending combat, consumed items and receipts; restore fences old sessions',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'raid-backup-')),source=join(dir,'source.sqlite'),backup=join(dir,'backup.sqlite'),target=join(dir,'restore.sqlite');
 const f=raidFixture(source);t.after(()=>{f.core.close();rmSync(dir,{recursive:true,force:true});});hurt(f);f.ack();const item=f.item('healing_potion');f.service.use(f.world,'player0','heal',item.id);
 const before=f.host.snapshot();backupDatabase(source,backup);restoreDatabase(backup,target);
 const core=new ExtractionCore(target);try{
  const service=new RaidService(core),s=service.snapshot(f.world);assert.deepEqual(s.combat,before.combat);assert.equal(s.revision,before.revision);assert.notEqual(s.economy.databaseId,before.economy.databaseId);
  assert.throws(()=>core.connection(f.connections.player0),/STALE_CONNECTION/);assert.equal(core.row('SELECT status FROM adapter_lease').status,'FROZEN');
  assert.equal(raidDiagnostics(core.db).pending,1);assert.deepEqual(raidDiagnostics(core.db).violations,[]);
  const qty=core.row('SELECT quantity FROM items WHERE id=?',item.id).quantity;
  service.use(f.world,'player0','heal',item.id);assert.equal(core.row('SELECT quantity FROM items WHERE id=?',item.id).quantity,qty);
  service.recover(f.world,'recover');assert.equal(service.snapshot(f.world).status,'CLOSED');assert.deepEqual(raidDiagnostics(core.db).violations,[]);
  assert.equal(core.snapshot('player0').stash.some(x=>x.id===item.id),false); // Picked-up loot isn't compensated.
 }finally{core.close();}
 assert.equal(f.host.snapshot().status,'OPEN');
});
test('doctor detects mixed combat/economy state without exposing identifiers',t=>{
 const f=raidFixture();t.after(()=>f.core.close());f.core.run("UPDATE participants SET status='DEAD' WHERE id=?",f.bindings[0].expeditionId);
 const report=raidDiagnostics(f.core.db);assert.ok(report.violations.includes('COMBAT_ECONOMY_MISMATCH'));assert.ok(!JSON.stringify(report).includes(f.bindings[0].expeditionId));
});
