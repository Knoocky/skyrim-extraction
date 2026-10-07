import {writeSync} from 'node:fs';
import {ExtractionCore} from '../src/core.mjs';
import {RaidService} from '../src/raid-service.ts';
const [filename,phase,operation,world,actor,item]=process.argv.slice(2);
const core=new ExtractionCore(filename),service=new RaidService(core);
const block=()=>{writeSync(1,'kill-point\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
if(phase==='before-commit'){
 const run=core.run.bind(core);core.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO raid_receipts'))block();return run(sql,...args);};
}
if(operation==='use')service.use(world,'player0','crash-use',item);
else service.contact(world,'crash-death',{attackerId:'enemy0',targetId:actor,serial:1,tick:12,distance:1,inArc:true,facing:true,clear:true,safeZone:false});
block();
