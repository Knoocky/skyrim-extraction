import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const directory = resolve(process.argv[2] ?? 'data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
writeFileSync(resolve(directory, 'server-token.key'), randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
console.log('Server key created. Keep it on the server; never send it to game clients.');
