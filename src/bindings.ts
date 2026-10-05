import { ITEMS } from './catalog.mjs';
import { REGION } from './region.mjs';
import { CONTENT_HASH } from './manifest.ts';
import { object,keys } from './protocol.ts';
interface FormRef {plugin:string;localId:number}
interface Plugin {name:string;sha256:string;light:boolean}
export interface BindingManifest {
 format:1; runtime:'1.6.1170'; contentHash:string;
 plugins:Plugin[];
 items:Record<string,FormRef|null>;
 areas:Record<string,{cell:FormRef|null;containerMarker:FormRef|null}>;
 targets:Record<string,FormRef|null>;
 exits:Record<string,{cell:FormRef|null;position:[number,number,number]|null}>;
}
export function bindingTemplate():BindingManifest {
 return {format:1,runtime:'1.6.1170',contentHash:CONTENT_HASH,plugins:[],
  items:Object.fromEntries(Object.keys(ITEMS).map(id=>[id,null])),
  areas:Object.fromEntries(REGION.areas.map(a=>[a.id,{cell:null,containerMarker:null}])),
  targets:Object.fromEntries(REGION.areas.flatMap(a=>a.targets).map(id=>[id,null])),
  exits:Object.fromEntries(REGION.exits.map(e=>[e.id,{cell:null,position:null}]))};
}
export function validateBindings(raw:unknown,{allowIncomplete=false}={}) {
 const input=object(raw);keys(input,['format','runtime','contentHash','plugins','items','areas','targets','exits']);
 const fail=()=>{throw new Error('INVALID_BINDING_MANIFEST');};
 if(input.format!==1||input.runtime!=='1.6.1170'||input.contentHash!==CONTENT_HASH||!Array.isArray(input.plugins))fail();
 const plugins=new Map<string,Plugin>();
 for(const rawPlugin of input.plugins as unknown[]) {
  const p=object(rawPlugin);keys(p,['name','sha256','light']);
  if(typeof p.name!=='string'||!/^[A-Za-z0-9_ .-]+\.(esm|esp|esl)$/i.test(p.name)||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||typeof p.light!=='boolean')fail();
  const key=(p.name as string).toLowerCase();if(plugins.has(key))fail();plugins.set(key,p as unknown as Plugin);
 }
 let missing=0;
 const ref=(value:unknown):string|null=>{
  if(value===null){missing++;return null;}
  const v=object(value);keys(v,['plugin','localId']);
  if(typeof v.plugin!=='string'||!Number.isSafeInteger(v.localId))return fail();
  const plugin=plugins.get(v.plugin.toLowerCase());
  if(!plugin||Number(v.localId)<1||Number(v.localId)>(plugin.light?0xfff:0xffffff))return fail();
  return v.plugin.toLowerCase()+':'+v.localId;
 };
 const expected=bindingTemplate(),items=object(input.items),areas=object(input.areas),targets=object(input.targets),exits=object(input.exits);
 keys(items,Object.keys(expected.items));keys(areas,Object.keys(expected.areas));keys(targets,Object.keys(expected.targets));keys(exits,Object.keys(expected.exits));
 const itemRefs=new Set<string>();
 for(const value of Object.values(items)){const key=ref(value);if(key&&itemRefs.has(key))fail();if(key)itemRefs.add(key);}
 for(const value of Object.values(areas)){const a=object(value);keys(a,['cell','containerMarker']);ref(a.cell);ref(a.containerMarker);}
 for(const value of Object.values(targets))ref(value);
 for(const value of Object.values(exits)){
  const e=object(value);keys(e,['cell','position']);ref(e.cell);
  if(e.position===null)missing++;
  else if(!Array.isArray(e.position)||e.position.length!==3||!e.position.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10000000))fail();
 }
 if(!allowIncomplete&&missing)throw new Error('UNRESOLVED_BINDINGS');
 return {complete:missing===0,missing,items:Object.keys(items).length,plugins:plugins.size};
}
/** Resolve against measured load order; the verified plugin hash must also match. */
export function resolveForm(ref:FormRef,plugin:Plugin,loaded:{index:number;sha256:string}) {
 if(plugin.name.toLowerCase()!==ref.plugin.toLowerCase()||loaded.sha256!==plugin.sha256||!Number.isInteger(loaded.index)||loaded.index<0||loaded.index>(plugin.light?0xfff:0xfd)||!Number.isInteger(ref.localId)||ref.localId<1||ref.localId>(plugin.light?0xfff:0xffffff))throw new Error('LOAD_ORDER_MISMATCH');
 return plugin.light ? (0xfe000000 + loaded.index*0x1000 + ref.localId) : (loaded.index*0x1000000 + ref.localId);
}
