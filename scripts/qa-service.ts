import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ExtractionCore} from '../src/core.mjs';
import {createCoreServer} from '../src/server.ts';
import type {Item} from '../src/client.ts';
import {FencedCoreClient} from '../src/fenced-client.ts';
import {ProjectionBridge} from '../src/bridge.ts';
const seconds=Number(process.argv[2]??30);
if(!Number.isInteger(seconds)||seconds<1||seconds>3600)throw new Error('INVALID_DURATION');
const dir=mkdtempSync(join(tmpdir(),'extraction-soak-')),c=new ExtractionCore(join(dir,'core.sqlite')),token=randomBytes(32).toString('hex');
const server=createCoreServer(c,token,{requireLease:true});server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();if(!address||typeof address==='string')throw new Error('BAD_ADDRESS');
const client=new FencedCoreClient('http://127.0.0.1:'+address.port,token);await client.acquire('service-soak');
let frozen=true,heartbeatFailed=false;
const bridge=new ProjectionBridge(client,{freeze(){frozen=true;},replaceAndVerify(state){assert.equal(frozen,true);assert.deepEqual(state,c.projection());},resume(){frozen=false;}});
const stop=client.watchLease(()=>{heartbeatFailed=true;frozen=true;});
const sessions:string[]=[];let count=0;const durations:number[]=[];
try{
 for(let i=0;i<4;i++){
  await bridge.execute({protocolVersion:1,requestId:'register-'+i,operation:'registerPlayer',payload:{playerId:'p'+i}});
  const result=await bridge.execute<{connectionId:string}>({protocolVersion:1,requestId:'connect-'+i,operation:'openConnection',payload:{playerId:'p'+i}});sessions.push(result.result.connectionId);
 }
 const {result:world}=await bridge.execute<{raidId:string}>({protocolVersion:1,requestId:'world',operation:'createWorld',payload:{loot:[]}});
 await delay(1000);
 const started=performance.now();
 while(performance.now()-started<seconds*1000){
  const actor=count%4,state=c.snapshot('p'+actor),before=performance.now();
  await bridge.execute({protocolVersion:1,requestId:'step-'+count,operation:state.active?'extract':'beginExpedition',connectionId:sessions[actor],
   ...(state.active?{worldApproved:true}:{}),payload:state.active?{worldId:world.raidId,expeditionId:state.active.expeditionId,exitId:'north_gate'}:{worldId:world.raidId,itemIds:state.stash.map((i:Item)=>i.id)}});
  durations.push(performance.now()-before);count++;await delay(100);
  if(count%100===0)console.log(JSON.stringify({serviceCommands:count,elapsedSeconds:Math.round((performance.now()-started)/1000)}));
 }
 assert.equal(heartbeatFailed,false);assert.equal(frozen,false);assert.equal(c.economicTotals().units,12);assert.equal(c.economicTotals().gold,0);
 durations.sort((a,b)=>a-b);
 console.log(JSON.stringify({seconds,commands:count,commandMs:{p50:durations[Math.floor(count*.5)],p95:durations[Math.floor(count*.95)],max:durations.at(-1)},diagnostics:c.diagnostics(),rssBytes:process.memoryUsage().rss}));
}finally{stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));c.close();rmSync(dir,{recursive:true,force:true});}
