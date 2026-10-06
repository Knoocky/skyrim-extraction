import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/ui', { recursive: true });
await build({ entryPoints: ['ui/app.tsx'], bundle: true, outdir: 'dist/ui', entryNames: 'app', platform: 'browser', target: 'es2020', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('ui/index.html', 'dist/ui/index.html');
await build({ entryPoints: ['adapters/skymp.ts'], bundle: true, outfile: 'dist/skymp-adapter.cjs', platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['adapters/runtime.ts'], bundle: true, outfile: 'dist/adapter-runtime.cjs', platform: 'node', target: 'node22', format: 'cjs' });
await build({ entryPoints: ['adapters/combat-runtime.ts'], bundle: true, outfile: 'dist/combat-runtime.cjs', platform: 'node', target: 'node24', format: 'cjs' });
console.log('Built UI, experimental SkyMP adapter and optional server combat library. No game assets included.');
