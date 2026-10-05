import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createRelease,readRelease,installRelease} from '../src/release.mjs';
import {restoreDatabase} from '../src/restore.mjs';
import {backupDatabase} from '../src/backup.mjs';
import {ExtractionCore} from '../src/core.mjs';
function temp(t){const dir=mkdtempSync(join(tmpdir(),'extraction-release-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(t){
 const root=temp(t);for(const d of ['src','scripts','dist/ui','licenses','config','docs','adapters','ui'])mkdirSync(join(root,d),{recursive:true});
 for(const [p,s] of Object.entries({'package.json':'{"version":"0.8.0"}','package-lock.json':'{}','README.md':'readme','tsconfig.json':'{}','LICENSE':'MIT','THIRD_PARTY_NOTICES.md':'notice','src/core.mjs':'// core','scripts/serve.ts':'// server','dist/ui/app.js':'// ui','licenses/react.txt':'MIT'}))writeFileSync(join(root,p),s);
 const archive=join(root,'test.sxe.gz');createRelease(root,archive);return {root,archive};
}
test('release validates hashes, dry-run has no effects, install/upgrade keeps a complete rollback copy',t=>{
 const {root,archive}=fixture(t),target=join(root,'installed');
 assert.equal(readRelease(archive).version,'0.8.0');assert.equal(installRelease(archive,target).dryRun,true);assert.equal(existsSync(target),false);
 const installed=installRelease(archive,target,{dryRun:false});assert.equal(installed.backup,null);
 const upgrade=installRelease(archive,target,{dryRun:false});assert.equal(readFileSync(join(upgrade.backup,'src/core.mjs'),'utf8'),'// core');
 writeFileSync(join(target,'src/core.mjs'),'changed');assert.throws(()=>installRelease(archive,target,{dryRun:false}),/MODIFIED_INSTALLATION/);
});
test('package rejects corruption, traversal and case-insensitive collisions before writing files',t=>{
 const {root,archive}=fixture(t),value=JSON.parse(gunzipSync(readFileSync(archive)));
 for(const mutate of [v=>v.files[0].data='YmFk',v=>v.files[0].path='../escape',v=>v.files.push({...v.files[0],path:v.files[0].path.toUpperCase()})]){
  const bad=structuredClone(value);mutate(bad);const path=join(root,'bad.sxe.gz');writeFileSync(path,gzipSync(Buffer.from(JSON.stringify(bad))));
  assert.throws(()=>installRelease(path,join(root,'bad-install'),{dryRun:false}));assert.equal(existsSync(join(root,'bad-install')),false);
 }
});
test('restore preserves data/receipts, rotates database identity, closes sessions and refuses existing target',t=>{
 const root=temp(t),source=join(root,'source.sqlite'),backup=join(root,'backup.sqlite'),target=join(root,'restored.sqlite');
 const c=new ExtractionCore(source);c.registerPlayer('register','a');const session=c.openConnection('connect','a');const before=c.snapshot('a');backupDatabase(source,backup);c.close();
 restoreDatabase(backup,target);const restored=new ExtractionCore(target);
 try{assert.deepEqual(restored.snapshot('a').stash,before.stash);assert.notEqual(restored.snapshot('a').databaseId,before.databaseId);assert.throws(()=>restored.connection(session.connectionId),e=>e.code==='STALE_CONNECTION');assert.equal(restored.registerPlayer('register','a').playerId,'a');}finally{restored.close();}
 assert.throws(()=>restoreDatabase(backup,target),/EEXIST/);
});
