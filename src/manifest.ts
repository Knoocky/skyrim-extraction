import { createHash } from 'node:crypto';
import { ITEMS, RECIPES } from './catalog.mjs';
import { MISSIONS } from './missions.mjs';
import { ECONOMY } from './economy.mjs';
import { REGION } from './region.mjs';
export const CONTENT_HASH = createHash('sha256').update(JSON.stringify({ITEMS,RECIPES,MISSIONS,ECONOMY,REGION})).digest('hex');
export const ADAPTER_MANIFEST = Object.freeze({protocolVersion:1, schemaVersion:7, contentHash:CONTENT_HASH});
export function canonical(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object') return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}
