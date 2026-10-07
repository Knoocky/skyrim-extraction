import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {raidFixture,hurt} from './raid-fixture.mjs';
import {ExtractionCore} from '../src/core.mjs';
import {RaidService} from '../src/raid-service.ts';
for(const phase of ['before-commit','after-commit'])for(const operation of ['use','death'])test(`integrated ${operation}: process kill ${phase} preserves all-or-nothing effects`,{timeout:15000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'raid-crash-')),filename=join(dir,'core.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=raidFixture(filename);hurt(f,20);f.ack();const item=f.item('healing_potion'),actor=f.bindings[0].expeditionId;
 if(operation==='death'){f.service.npc(f.world,'npc','enemy0',1,'light');f.ack();f.service.advance(f.world,12);f.ack();}
 const baseline=f.service.snapshot(f.world);f.core.close();
 const child=spawn(process.execPath,[fileURLToPath(new URL('./raid-crash-child.mjs',import.meta.url)),filename,phase,operation,f.world,actor,item.id],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>{stderr+=b;});const exited=once(child,'exit');
 try{
  const ready=await Promise.race([once(child.stdout,'data').then(([d])=>d.toString()),exited.then(()=>{throw Error(stderr);}),new Promise((_,reject)=>t.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))]);
  assert.match(ready,/kill-point/);child.kill('SIGKILL');await exited;
  const core=new ExtractionCore(filename);try{
   const service=new RaidService(core),state=service.snapshot(f.world),committed=phase==='after-commit';
   assert.equal(state.revision,baseline.revision+(committed?1:0));assert.equal(core.row('SELECT COUNT(*) AS n FROM raid_receipts WHERE request_id=?','crash-'+operation).n,committed?1:0);
   assert.equal(state.combat.actors[0].hp,committed?(operation==='death'?0:60):20);
   if(operation==='use'){
    assert.equal(core.row('SELECT quantity FROM items WHERE id=?',item.id).quantity,item.quantity-(committed?1:0));
    service.use(f.world,'player0','crash-use',item.id);assert.equal(service.snapshot(f.world).combat.actors[0].hp,60);assert.equal(core.row('SELECT quantity FROM items WHERE id=?',item.id).quantity,item.quantity-1);
   }else{
    assert.equal(core.row('SELECT status FROM participants WHERE id=?',actor).status,committed?'DEAD':'ACTIVE');
    service.contact(f.world,'crash-death',{attackerId:'enemy0',targetId:actor,serial:1,tick:12,distance:1,inArc:true,facing:true,clear:true,safeZone:false});
    assert.equal(core.row('SELECT COUNT(*) AS n FROM expedition_reports').n,1);assert.equal(core.snapshot('player0').active,null);
   }
   assert.equal(core.row('PRAGMA integrity_check').integrity_check,'ok');assert.equal(core.rows('PRAGMA foreign_key_check').length,0);
  }finally{core.close();}
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
});
