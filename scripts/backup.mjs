import { backupDatabase } from '../src/backup.mjs';
const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: npm run backup -- path/to/core.sqlite path/to/new-backup.sqlite');
backupDatabase(source, target);
console.log('Verified backup created. Existing files were not overwritten.');
