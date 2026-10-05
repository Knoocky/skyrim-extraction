/** Server-side extraction gate. Feed authoritative engine observations, NEVER client packets.
 * This is an integration component; it does not establish authority of SkyMP positions/combat.
 */
export interface ExitZone {
  id: string; worldId: string; cellId: string;
  x: number; y: number; z: number; radius: number; holdMs: number;
  availability: 'always' | 'day' | 'night';
}
export interface Observation {
  playerId: string; worldId: string; expeditionId: string; connectionId: string; cellId: string;
  x: number; y: number; z: number; alive: boolean; connected: boolean; inCombat: boolean;
  // Clock/hour and damage sequence must originate on the server.
  observedAt: number; hour: number; damageSequence: number;
}
interface Attempt { signature: string; start: number; last: number; sample: number; damage: number }
export class ExtractionPolicy {
  #zones: Map<string, ExitZone>;
  #attempts = new Map<string, Attempt>();
  #clock: () => number;
  #maxGap: number;
  constructor(zones: ExitZone[], clock: () => number = () => performance.now(), maxGapMs = 1500) {
    if (!Number.isFinite(maxGapMs) || maxGapMs <= 0) throw new Error('INVALID_GAP');
    this.#clock = clock; this.#maxGap = maxGapMs; this.#zones = new Map();
    for (const zone of zones) {
      if (!zone.id || !zone.worldId || !zone.cellId || this.#zones.has(zone.id)
        || ![zone.x, zone.y, zone.z, zone.radius, zone.holdMs].every(Number.isFinite)
        || zone.radius <= 0 || zone.holdMs < maxGapMs || !['always', 'day', 'night'].includes(zone.availability)) throw new Error('INVALID_EXIT');
      this.#zones.set(zone.id, { ...zone });
    }
  }
  cancel(playerId: string) { this.#attempts.delete(playerId); }
  clear() { this.#attempts.clear(); }
  update(exitId: string, sample: Observation): { ready: boolean; remainingMs: number; reason: string } {
    const zone = this.#zones.get(exitId), now = this.#clock();
    const deny = (reason: string) => { this.cancel(sample.playerId); return { ready: false, remainingMs: zone?.holdMs ?? 0, reason }; };
    if (!zone) return deny('UNKNOWN_EXIT');
    if (!Number.isFinite(now) || ![sample.x, sample.y, sample.z, sample.observedAt, sample.hour].every(Number.isFinite)
      || !Number.isSafeInteger(sample.damageSequence) || sample.damageSequence < 0
      || sample.hour < 0 || sample.hour >= 24 || !sample.playerId || !sample.expeditionId || !sample.connectionId) return deny('INVALID_OBSERVATION');
    if (sample.observedAt > now || now - sample.observedAt > this.#maxGap) return deny('STALE_OBSERVATION');
    if (sample.alive !== true || sample.connected !== true || sample.inCombat !== false) return deny('PLAYER_UNAVAILABLE');
    if (sample.worldId !== zone.worldId || sample.cellId !== zone.cellId) return deny('WRONG_WORLD');
    if (Math.hypot(sample.x - zone.x, sample.y - zone.y, sample.z - zone.z) > zone.radius) return deny('OUTSIDE_EXIT');
    const night = sample.hour >= 20 || sample.hour < 6;
    if ((zone.availability === 'night' && !night) || (zone.availability === 'day' && night)) return deny('EXIT_CLOSED');
    const signature = JSON.stringify([exitId, sample.worldId, sample.expeditionId, sample.connectionId]);
    let attempt = this.#attempts.get(sample.playerId);
    if (attempt && (now < attempt.last || sample.observedAt <= attempt.sample)) return deny('REORDERED_OBSERVATION');
    if (!attempt || attempt.signature !== signature || now - attempt.last > this.#maxGap || attempt.damage !== sample.damageSequence) {
      attempt = { signature, start: now, last: now, sample: sample.observedAt, damage: sample.damageSequence };
      this.#attempts.set(sample.playerId, attempt);
    }
    attempt.last = now; attempt.sample = sample.observedAt;
    const remainingMs = Math.max(0, zone.holdMs - (now - attempt.start));
    return { ready: remainingMs === 0, remainingMs, reason: remainingMs === 0 ? 'READY' : 'HOLD' };
  }
}
