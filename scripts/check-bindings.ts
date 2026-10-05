import {readFileSync,writeFileSync} from 'node:fs';
import {bindingTemplate,validateBindings} from '../src/bindings.ts';
const [file,mode]=process.argv.slice(2);
if(!file||!['--template','--write-template',undefined].includes(mode))throw new Error('Usage: npm run check:bindings -- manifest.json [--template|--write-template]');
if(mode==='--write-template'){writeFileSync(file,JSON.stringify(bindingTemplate(),null,2)+'\n',{flag:'wx',mode:0o600});console.log('Unverified binding template written.');}
else console.log(JSON.stringify(validateBindings(JSON.parse(readFileSync(file,'utf8')),{allowIncomplete:mode==='--template'})));
