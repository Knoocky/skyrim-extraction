import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ExtractionCore,DomainError} from '../src/core.mjs';
import {decodeCommand} from '../src/protocol.ts';
import {ECONOMY} from '../src/economy.mjs';
const total=Number(process.argv[2]??10000);
if(!Number.isSafeInteger(total)||total<1||total>100000)throw new Error('INVALID_SEQUENCE_COUNT');
const times=[];let transitions=0,rejected=0,replayed=0,maxProjectionBytes=0;
const started=performance.now();
for(let seed=1;seed<=total;seed++){
 let random=seed>>>0,index=0;const rng=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random>>>8;};
 const c=new ExtractionCore(':memory:',{authority:{canPickup:()=>true,canConsume:()=>true,canExtract:()=>true}});
 const trace=[],begin=performance.now();
 const invoke=(op,actor,fn)=>{
  const before=JSON.stringify(c.projection()),gold=c.economicTotals().gold,units=c.economicTotals().units;
  const request='s'+seed+'-'+index++;trace.push({op,actor});
  let result;
  try{result=fn(request);}catch(error){if(!(error instanceof DomainError))throw error;rejected++;assert.equal(JSON.stringify(c.projection()),before);return;}
  transitions++;
  const state=c.projection(),after=JSON.stringify(state);maxProjectionBytes=Math.max(maxProjectionBytes,Buffer.byteLength(after));
  if(rng()%3===0){assert.deepEqual(fn(request),result);assert.equal(JSON.stringify(c.projection()),after);replayed++;}
  // Independent projection/SQL ownership and quantity reconciliation after every accepted command.
  const projected=[...state.players.flatMap(p=>[...p.stash,...(p.active?.items??[])]),...state.containers.flatMap(x=>x.items)];
  assert.equal(new Set(projected.map(i=>i.id)).size,projected.length);
  assert.equal(projected.reduce((n,i)=>n+i.quantity,0),c.economicTotals().units);
  assert.equal(state.players.reduce((n,p)=>n+p.progression.gold,0),c.economicTotals().gold);
  if(op==='sell'){const oldItem=JSON.parse(before).players.flatMap(p=>p.stash).find(i=>i.id===result.itemId);assert.equal(result.earned,ECONOMY.offers.find(o=>o.template===oldItem.template).sell*result.sold);assert.equal(c.economicTotals().gold,gold+result.earned);assert.equal(c.economicTotals().units,units-result.sold);}
  else if(op==='buy'){assert.equal(c.economicTotals().gold,gold-result.cost);assert.equal(c.economicTotals().units,units+result.quantity);}
  else if(op==='consume')assert.equal(c.economicTotals().units,units-result.consumed);
  else if(['pickup','begin','extract','death'].includes(op)){assert.equal(c.economicTotals().units,units);assert.equal(c.economicTotals().gold,gold);}
 };
 try{
  for(const actor of ['a','b'])c.registerPlayer('register-'+actor,actor);
  const w=c.createRaid('world',[{template:'mountain_herb',quantity:1+rng()%9},{template:'healing_potion',quantity:1+rng()%9},'dwemer_relic']);
  const steps=12+rng()%21;
  for(let step=0;step<steps;step++){
   const actor=rng()%2?'a':'b',state=c.snapshot(actor),action=rng()%8;
   if(!state.active){
    if(action<3){const loadout=state.stash.filter(()=>rng()%2===0).map(i=>i.id);invoke('begin',actor,id=>c.beginExpedition(id,actor,w.raidId,loadout));}
    else if(action<6&&state.stash.length){const item=state.stash[rng()%state.stash.length];invoke('sell',actor,id=>c.sell(id,actor,item.id,1));}
    else {const offer=ECONOMY.offers[rng()%ECONOMY.offers.length];invoke('buy',actor,id=>c.buy(id,actor,offer.id,1));}
   }else{
    const active=state.active;
    if(action<4){const containers=c.projection().containers.filter(x=>x.worldId===w.raidId&&x.items.length);const container=containers.length?containers[rng()%containers.length]:{id:'missing',items:[{id:'missing'}]};const item=container.items[rng()%container.items.length];invoke('pickup',actor,id=>c.pickup(id,actor,w.raidId,container.id,item.id,active.expeditionId));}
    else if(action===4)invoke('death',actor,id=>c.recordDeath(id,actor,w.raidId,active.expeditionId));
    else if(action===5)invoke('extract',actor,id=>c.extract(id,actor,w.raidId,'simulated-exit',active.expeditionId));
    else {const potion=active.items.find(i=>i.template==='healing_potion');invoke('consume',actor,id=>c.consume(id,actor,w.raidId,potion?.id??'missing',1,active.expeditionId));}
   }
   // One independently malformed envelope per transition; parser must not accept prototype/injected fields.
   assert.throws(()=>decodeCommand({protocolVersion:1,requestId:'fuzz',operation:step%2?'constructor':'buy',payload:{offerId:'potion',quantity:rng(),playerId:'other'},connectionId:'unknown'}),e=>e instanceof DomainError);
  }
  assert.equal(c.rows('PRAGMA foreign_key_check').length,0);
 }catch(error){console.error(JSON.stringify({seed,trace}));throw error;}finally{c.close();}
 times.push(performance.now()-begin);
 if(seed%1000===0)console.log(JSON.stringify({completed:seed,total,transitions,rejected}));
}
times.sort((a,b)=>a-b);
console.log(JSON.stringify({independentSequences:total,acceptedTransitions:transitions,rejectedCommands:rejected,replayedReceipts:replayed,elapsedMs:Math.round(performance.now()-started),sequenceMs:{p50:times[Math.floor(total*.5)],p95:times[Math.floor(total*.95)],max:times.at(-1)},maxProjectionBytes,rssBytes:process.memoryUsage().rss}));
