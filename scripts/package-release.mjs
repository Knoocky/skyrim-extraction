import { createRelease } from '../src/release.mjs';
const [target]=process.argv.slice(2);
if(!target)throw new Error('Usage: npm run package -- /absolute/path/release.sxe.gz');
console.log(JSON.stringify(createRelease(process.cwd(),target)));
