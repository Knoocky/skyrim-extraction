import { writeSync } from 'node:fs';
import { ExtractionCore } from '../src/core.mjs';

const [filename, phase, raidId, itemId] = process.argv.slice(2);
const core = new ExtractionCore(filename, { authority: { canConsume: () => true } });
function block() {
  writeSync(1, 'kill-point\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
if (phase === 'before-commit') {
  const run = core.run.bind(core);
  core.run = (sql, ...args) => {
    // Item already changed; command receipt and commit are still missing.
    if (sql.startsWith('INSERT INTO receipts')) block();
    return run(sql, ...args);
  };
}
core.consume('crash-consume', 'alice', raidId, itemId, 2);
block(); // Committed, but no command response delivered to the caller.
