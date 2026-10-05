import { restoreDatabase } from '../src/restore.mjs';
const [source,target]=process.argv.slice(2);
if(!source||!target)throw new Error('Usage: npm run restore -- backup.sqlite unused-restored.sqlite');
restoreDatabase(source,target);
console.log('Verified restore created with new database identity and fenced sessions. Reconcile the adapter before use.');
