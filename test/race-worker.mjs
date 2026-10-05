import { parentPort, workerData } from 'node:worker_threads';
import { ExtractionCore } from '../src/core.mjs';
const core = new ExtractionCore(workerData.filename, { authority: { canPickup: () => true } });
parentPort.postMessage({ ready: true });
parentPort.once('message', () => {
  try {
    const result = core.pickup(...workerData.args);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code ?? error.message });
  } finally { core.close(); }
});
