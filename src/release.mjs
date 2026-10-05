import { readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync,existsSync,renameSync,rmSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
const safe=path=>typeof path==='string'&&path.length<240&&/^[a-zA-Z0-9_.\-/]+$/.test(path)&&!path.startsWith('/')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)&&!p.endsWith('.'));
const fail=code=>{throw new Error(code);};
function walk(root,prefix='') {
 const entries=[];
 for(const name of readdirSync(join(root,prefix)).sort()) {
  const path=prefix?prefix+'/'+name:name,stat=lstatSync(join(root,path));
  if(stat.isSymbolicLink())fail('SYMLINK_NOT_ALLOWED');
  if(stat.isDirectory())entries.push(...walk(root,path));else if(stat.isFile())entries.push(path);else fail('SPECIAL_FILE_NOT_ALLOWED');
 }return entries;
}
const roots=['src','scripts','dist','licenses','config','docs','adapters','ui'];
const top=['package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md','tsconfig.json'];
const allowed=path=>top.includes(path)||roots.some(root=>path.startsWith(root+'/'));
export function createRelease(root,filename) {
 root=resolve(root);
 const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
 if(!existsSync(join(root,'dist/ui/app.js')))fail('BUILD_REQUIRED');
 const paths=[...top,...roots.flatMap(dir=>walk(join(root,dir)).map(p=>dir+'/'+p))].sort();
 const files=paths.map(path=>{
  if(!safe(path)||!allowed(path)||/\.(sqlite|db|key|pem|log|p12|pfx)(-|\.|$)/i.test(path))fail('UNSAFE_PACKAGE_FILE');
  if(lstatSync(join(root,path)).isSymbolicLink())fail('SYMLINK_NOT_ALLOWED');
  const bytes=readFileSync(join(root,path));
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(bytes.toString()))fail('SECRET_IN_PACKAGE');
  return {path,bytes:bytes.length,sha256:digest(bytes),data:bytes.toString('base64')};
 });
 const archive={format:1,version:pkg.version,schema:7,protocol:1,node:'24.19.0',files};
 writeFileSync(filename,gzipSync(Buffer.from(JSON.stringify(archive))),{flag:'wx',mode:0o600});
 return {version:pkg.version,files:files.length,sha256:digest(readFileSync(filename))};
}
export function readRelease(filename) {
 const zipped=readFileSync(filename);if(zipped.length>32*1024*1024)fail('PACKAGE_TOO_LARGE');
 const value=JSON.parse(gunzipSync(zipped,{maxOutputLength:64*1024*1024}).toString());
 if(!value||value.format!==1||value.schema!==7||value.protocol!==1||value.node!=='24.19.0'||!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value.version)||!Array.isArray(value.files)||value.files.length<1||value.files.length>1000)fail('INVALID_PACKAGE');
 const seen=new Set();
 for(const file of value.files) {
  if(!file||!safe(file.path)||!allowed(file.path)||seen.has(file.path.toLowerCase())||typeof file.data!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))fail('INVALID_PACKAGE_PATH');
  seen.add(file.path.toLowerCase());
  const bytes=Buffer.from(file.data,'base64');
  if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)fail('PACKAGE_HASH_MISMATCH');
 }
 for(const required of [...top,'src/core.mjs','scripts/serve.ts','dist/ui/app.js'])if(!seen.has(required.toLowerCase()))fail('INCOMPLETE_PACKAGE');
 const pkg=JSON.parse(Buffer.from(value.files.find(f=>f.path==='package.json').data,'base64').toString());
 if(pkg.version!==value.version)fail('PACKAGE_VERSION_MISMATCH');
 return value;
}
const version=n=>n.split('.').map(Number);
const older=(a,b)=>{const aa=version(a),bb=version(b);for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]<bb[i];}return false;};
/** Data/key directories must live outside this managed immutable installation. */
export function installRelease(filename,destination,{dryRun=true}={}) {
 const archive=readRelease(filename),target=resolve(destination);
 if(older(process.versions.node,archive.node))fail('NODE_VERSION_TOO_OLD');
 let previous=null;
 if(existsSync(target)) {
  if(lstatSync(target).isSymbolicLink())fail('SYMLINK_NOT_ALLOWED');
  const oldFile=join(target,'release-manifest.json');if(!existsSync(oldFile))fail('UNMANAGED_INSTALLATION');
  previous=JSON.parse(readFileSync(oldFile,'utf8'));
  if(older(archive.version,previous.version))fail('DOWNGRADE_REFUSED');
  const installed=walk(target).filter(p=>p!=='release-manifest.json').sort();
  const expected=previous.files.map(f=>f.path).sort();
  if(JSON.stringify(installed)!==JSON.stringify(expected))fail('UNMANAGED_INSTALLATION_FILES');
  for(const f of previous.files)if(!safe(f.path)||digest(readFileSync(join(target,f.path)))!==f.sha256)fail('MODIFIED_INSTALLATION');
 }
 const plan={version:archive.version,previousVersion:previous?.version??null,files:archive.files.length,dryRun};
 if(dryRun)return plan;
 const stage=target+'.stage-'+randomUUID(),backup=previous?target+'.backup-'+randomUUID():null;
 mkdirSync(dirname(target),{recursive:true});mkdirSync(stage,{mode:0o700});
 try {
  for(const file of archive.files){const path=join(stage,file.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.from(file.data,'base64'),{flag:'wx',mode:0o600});}
  writeFileSync(join(stage,'release-manifest.json'),JSON.stringify({...archive,files:archive.files.map(({data,...meta})=>meta)},null,2),{flag:'wx',mode:0o600});
  if(backup)renameSync(target,backup);
  try{renameSync(stage,target);}catch(error){if(backup)renameSync(backup,target);throw error;}
  return {...plan,backup};
 }finally{rmSync(stage,{recursive:true,force:true});}
}
