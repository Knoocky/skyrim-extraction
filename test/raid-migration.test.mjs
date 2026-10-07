import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExtractionCore} from '../src/core.mjs';
import {ITEMS} from '../src/catalog.mjs';
import {CONSUMABLE_EFFECTS} from '../src/raid-gear.ts';
test('schema 7 upgrade preserves inventory/receipts, adds equipment stock and refreshes once',t=>{
 const dir=mkdtempSync(join(tmpdir(),'raid-migration-')),path=join(dir,'core.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let core=new ExtractionCore(path);const registered=core.registerPlayer('old','old'),baseline=core.projectionMetadata();
 // Exact schema-7 tables are unchanged; remove only new tables and catalog-stock rows.
 core.db.exec("DROP TABLE raid_receipts; DROP TABLE raid_combat; DELETE FROM market_stock WHERE offer_id IN ('shield','light_armor','heavy_armor','arrows','staff'); PRAGMA user_version=7;");core.close();
 core=new ExtractionCore(path);try{
  assert.equal(core.row('PRAGMA user_version').user_version,8);assert.deepEqual(core.registerPlayer('old','old'),registered);assert.equal(core.projectionMetadata().revision,baseline.revision+1);
  assert.equal(core.row("SELECT quantity FROM market_stock WHERE offer_id='arrows'").quantity,1000);core.createRaid('new',['iron_shield','leather_armor','iron_armor','fire_staff',{template:'iron_arrow',quantity:12}]);
 }finally{core.close();}
 core=new ExtractionCore(path);try{assert.equal(core.projectionMetadata().revision,baseline.revision+2);}finally{core.close();}
});
test('every catalog consumable has a bounded original effect and immutable balance',()=>{
 const ids=Object.entries(ITEMS).filter(([,i])=>i.kind==='consumable').map(([id])=>id).sort();assert.deepEqual(Object.keys(CONSUMABLE_EFFECTS).sort(),ids);
 for(const effect of Object.values(CONSUMABLE_EFFECTS)){assert.ok(Object.isFrozen(effect));assert.ok(Object.values(effect).every(v=>typeof v==='string'||(Number.isInteger(v)&&v>0&&v<=100000)));}
});
