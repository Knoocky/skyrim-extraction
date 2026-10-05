import { randomUUID } from 'node:crypto';
import type { ExtractionCore } from './core.mjs';
import { DomainError } from './domain-error.mjs';
import { REGION } from './region.mjs';
function check(value: unknown, code: string): asserts value { if (!value) throw new DomainError(code); }
/** Persisted logical world, called only with observations from the trusted adapter. */
export class WorldModel {
  core: ExtractionCore;
  constructor(core: ExtractionCore) { this.core = core; }
  state(worldId: string) {
    const row = this.core.row('SELECT * FROM world_clock WHERE world_id=?',worldId);
    check(row,'WORLD_NOT_CONFIGURED');
    const minute = Number(row.minute), hour = Math.floor(minute % 1440 / 60);
    return { worldId, minute, day:Math.floor(minute / 1440), hour, night:hour >= 20 || hour < 6,
      riskMultiplier:hour >= 20 || hour < 6 ? 2 : 1 };
  }
  configure(requestId: string, worldId: string) {
    const c=this.core;
    return c.command('system',requestId,'configureRegion',{worldId},()=>{
      check(c.row("SELECT id FROM raids WHERE id=? AND status='OPEN'",worldId),'RAID_NOT_OPEN');
      check(!c.row('SELECT world_id FROM world_clock WHERE world_id=?',worldId),'WORLD_ALREADY_CONFIGURED');
      const previous=c.row('SELECT MAX(minute) AS minute FROM world_clock')?.minute;
      const minimumDay=Math.max(Number(c.market().cycle),Number(c.row('SELECT cycle FROM mission_cycle WHERE id=1')?.cycle)-1);
      // Re-provisioning must not rewind the calendar behind persisted restock/mission cycles.
      const minute=previous===null||previous===undefined ? minimumDay*1440+480 : Math.max(Number(previous),minimumDay*1440);
      check(Number.isSafeInteger(minute),'INVALID_WORLD_TIME');
      c.run('INSERT INTO world_clock VALUES (?,?)',worldId,minute);
      for(const area of REGION.areas) {
        const container=randomUUID();
        c.run("INSERT INTO locations VALUES (?,'CONTAINER',NULL,?,NULL)",container,worldId);
        c.run('INSERT INTO world_areas VALUES (?,?,?,0)',worldId,area.id,container);
        this.spawn(container,area.loot);
      }
      return this.state(worldId);
    });
  }
  private spawn(container:string,loot:readonly {template:string;quantity:number}[]) {
    for(const entry of loot) {
      const item=randomUUID();
      this.core.run('INSERT INTO items(id,template,location_id,quantity) VALUES (?,?,?,?)',item,entry.template,container,entry.quantity);
      this.core.run('INSERT INTO loot_provenance(item_id) VALUES (?)',item);
    }
  }
  advance(requestId:string,worldId:string,minute:number) {
    check(Number.isSafeInteger(minute)&&minute>=0,'INVALID_WORLD_TIME');
    return this.core.command('system',requestId,'advanceWorld',{worldId,minute},()=>{
      const old=this.state(worldId);
      check(this.core.row("SELECT id FROM raids WHERE id=? AND status='OPEN'",worldId),'RAID_NOT_OPEN');
      check(minute>old.minute&&minute-old.minute<=1440,'STALE_WORLD_TIME');
      this.core.run('UPDATE world_clock SET minute=? WHERE world_id=?',minute,worldId);
      const day=Math.floor(minute/1440);
      if(day > Number(this.core.market().cycle)) this.core.restockMarket('clock-market:'+worldId+':'+day,day);
      const missionCycle=Number(this.core.row('SELECT cycle FROM mission_cycle WHERE id=1')?.cycle);
      if(day+1 > missionCycle) this.core.advanceMissionCycle('clock-missions:'+worldId+':'+day,day+1);
      return this.state(worldId);
    });
  }
  observe(requestId:string,worldId:string,playerId:string,expeditionId:string,areaId:string,sequence:number,transitionTo:string|null=null) {
    check(Number.isSafeInteger(sequence)&&sequence>0,'INVALID_SEQUENCE');
    check(REGION.areas.some(a=>a.id===areaId)&&(!transitionTo||REGION.areas.some(a=>a.id===transitionTo)),'UNKNOWN_AREA');
    const c=this.core;
    return c.command('system',requestId,'observeArea',{worldId,playerId,expeditionId,areaId,sequence,transitionTo},()=>{
      this.state(worldId); c.active(playerId,worldId,expeditionId);
      const previous=c.row('SELECT sequence FROM area_occupancy WHERE expedition_id=?',expeditionId);
      check(!previous||sequence>Number(previous.sequence),'STALE_OBSERVATION');
      c.run('INSERT INTO area_occupancy VALUES (?,?,?,?,?) ON CONFLICT(expedition_id) DO UPDATE SET area_id=excluded.area_id,transition_to=excluded.transition_to,sequence=excluded.sequence',expeditionId,worldId,areaId,transitionTo,sequence);
      return {areaId,transitionTo,sequence};
    });
  }
  reset(requestId:string,worldId:string,areaId:string,cycle:number) {
    const c=this.core;
    check(Number.isSafeInteger(cycle)&&cycle>0,'INVALID_RESET_CYCLE');
    return c.command('system',requestId,'resetArea',{worldId,areaId,cycle},()=>{
      const state=this.state(worldId), area=REGION.areas.find(a=>a.id===areaId);
      check(area,'UNKNOWN_AREA');
      check(c.row("SELECT id FROM raids WHERE id=? AND status='OPEN'",worldId),'RAID_NOT_OPEN');
      const saved=c.row('SELECT * FROM world_areas WHERE world_id=? AND area_id=?',worldId,areaId);
      check(saved&&cycle>Number(saved.cycle)&&cycle===state.day,'RESET_NOT_DUE');
      // Unknown position/disconnected actors protect the world. Transitions protect both sides.
      const occupied=c.row(`SELECT COUNT(*) AS n FROM participants p LEFT JOIN area_occupancy o ON o.expedition_id=p.id
        WHERE p.raid_id=? AND p.status='ACTIVE' AND (o.expedition_id IS NULL OR o.area_id=? OR o.transition_to=?)`,worldId,areaId,areaId);
      check(Number(occupied?.n)===0,'AREA_OCCUPIED');
      c.run('DELETE FROM items WHERE location_id=?',saved.container_id);
      this.spawn(String(saved.container_id),area.loot);
      c.run('UPDATE world_areas SET cycle=? WHERE world_id=? AND area_id=?',cycle,worldId,areaId);
      return {worldId,areaId,cycle};
    });
  }
}
