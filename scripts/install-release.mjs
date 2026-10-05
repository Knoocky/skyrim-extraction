import { installRelease } from '../src/release.mjs';
const [source,destination,flag]=process.argv.slice(2);
if(!source||!destination||(flag&&flag!=='--apply'))throw new Error('Usage: node scripts/install-release.mjs archive.sxe.gz destination [--apply]');
console.log(JSON.stringify(installRelease(source,destination,{dryRun:flag!=='--apply'})));
