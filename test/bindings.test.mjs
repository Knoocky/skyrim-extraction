import test from 'node:test';
import assert from 'node:assert/strict';
import {bindingTemplate,validateBindings,resolveForm} from '../src/bindings.ts';
test('binding template enumerates every unresolved item/area/exit and cannot pass production validation',()=>{
 const template=bindingTemplate();assert.equal(validateBindings(template,{allowIncomplete:true}).missing,98);
 assert.throws(()=>validateBindings(template),/UNRESOLVED_BINDINGS/);
 template.contentHash='old';assert.throws(()=>validateBindings(template,{allowIncomplete:true}),/INVALID_BINDING_MANIFEST/);
});
test('full/light references resolve only against matching plugin hash and legal load order',()=>{
 const sha256='a'.repeat(64),plugin={name:'Test.esm',light:false,sha256};
 assert.equal(resolveForm({plugin:'Test.esm',localId:0x123},plugin,{index:2,sha256}),0x02000123);
 assert.equal(resolveForm({plugin:'Test.esm',localId:0xabc},{...plugin,light:true},{index:5,sha256}),0xfe005abc);
 assert.throws(()=>resolveForm({plugin:'Test.esm',localId:0x1000},{...plugin,light:true},{index:5,sha256}),/LOAD_ORDER_MISMATCH/);
 assert.throws(()=>resolveForm({plugin:'Test.esm',localId:1},plugin,{index:2,sha256:'b'.repeat(64)}),/LOAD_ORDER_MISMATCH/);
});
